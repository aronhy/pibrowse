// SPDX-License-Identifier: AGPL-3.0-or-later

//! Hosted workspace subscriptions, following the Open SaaS Stripe flow:
//! Checkout, Customer Portal, and verified webhook reconciliation.

mod stripe;

use std::{env, sync::Arc};

use anyhow::{anyhow, bail, Context};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use fury_shared::rbac::OrgRole;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{PgConnection, PgPool};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use crate::{
    auth::Caller,
    error::{ApiError, ApiResult},
    AppState,
};
use stripe::Stripe;

#[derive(Clone)]
pub struct Billing {
    stripe: Stripe,
    price: String,
    webhook_secret: String,
    return_url: String,
}

impl Billing {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        match env::var("FURY_BILLING_MODE").as_deref() {
            Err(&env::VarError::NotPresent) | Ok("") | Ok("off") => return Ok(None),
            Ok("hosted") => {}
            _ => bail!("FURY_BILLING_MODE must be off or hosted"),
        }
        let key = required("STRIPE_SECRET_KEY")?;
        let price = required("STRIPE_PRICE_ID")?;
        let webhook_secret = required("STRIPE_WEBHOOK_SECRET")?;
        let return_url = required("FURY_BILLING_RETURN_URL")?;
        if !stripe::is_id(&key, "sk_test_") && !stripe::is_id(&key, "rk_test_") {
            bail!("STRIPE_SECRET_KEY must be a Stripe test-mode secret key");
        }
        if !stripe::is_id(&price, "price_") {
            bail!("STRIPE_PRICE_ID must be a Stripe Price ID");
        }
        if !stripe::is_id(&webhook_secret, "whsec_") {
            bail!("STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret");
        }
        let parsed_url = reqwest::Url::parse(&return_url)
            .map_err(|_| anyhow!("FURY_BILLING_RETURN_URL must be an HTTPS URL"))?;
        if parsed_url.scheme() != "https"
            || parsed_url.host_str().is_none()
            || !parsed_url.username().is_empty()
            || parsed_url.password().is_some()
        {
            bail!("FURY_BILLING_RETURN_URL must be an HTTPS URL without credentials");
        }
        Ok(Some(Self {
            stripe: Stripe::new("https://api.stripe.com".into(), key)?,
            price,
            webhook_secret,
            return_url,
        }))
    }

    #[cfg(test)]
    pub fn for_test(api_base: String) -> Self {
        Self {
            stripe: Stripe::new(api_base, "sk_test_fixture".into()).unwrap(),
            price: "price_monthly_fixture".into(),
            webhook_secret: "whsec_test_fixture".into(),
            return_url: "https://fury.example.test/billing".into(),
        }
    }

    async fn validate_price(&self) -> anyhow::Result<()> {
        let price = self
            .stripe
            .get(&format!("/v1/prices/{}", self.price))
            .await?;
        stripe::test_object(&price)?;
        if stripe::id(&price, "id", "price_")? != self.price
            || price.get("active").and_then(Value::as_bool) != Some(true)
            || price.pointer("/recurring/interval").and_then(Value::as_str) != Some("month")
            || price
                .pointer("/recurring/interval_count")
                .and_then(Value::as_u64)
                != Some(1)
            || !price
                .get("unit_amount")
                .and_then(Value::as_u64)
                .is_some_and(|amount| amount > 0)
        {
            bail!("STRIPE_PRICE_ID must identify an active, paid monthly test price");
        }
        Ok(())
    }

    async fn subscriptions(&self, customer: &str) -> anyhow::Result<Vec<Value>> {
        let subscriptions = self
            .stripe
            .list(
                "/v1/subscriptions",
                &[("customer", customer), ("status", "all")],
            )
            .await?;
        for subscription in &subscriptions {
            stripe::customer_object(subscription, customer)?;
            stripe::id(subscription, "id", "sub_")?;
            subscription_status(subscription)?;
        }
        Ok(subscriptions)
    }

    async fn paid_through(
        &self,
        customer: &str,
        subscription: &str,
        period_end: i64,
    ) -> anyhow::Result<Option<OffsetDateTime>> {
        let invoices = self
            .stripe
            .list(
                "/v1/invoices",
                &[
                    ("customer", customer),
                    ("subscription", subscription),
                    ("status", "paid"),
                ],
            )
            .await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let mut paid_through = None;
        for invoice in invoices {
            stripe::customer_object(&invoice, customer)?;
            let id = stripe::id(&invoice, "id", "in_")?;
            if invoice.get("status").and_then(Value::as_str) != Some("paid")
                || !invoice["amount_paid"]
                    .as_u64()
                    .is_some_and(|amount| amount > 0)
                || invoice
                    .pointer("/parent/subscription_details/subscription")
                    .and_then(Value::as_str)
                    != Some(subscription)
            {
                continue;
            }
            let additional_lines;
            let lines = if invoice.pointer("/lines/has_more").and_then(Value::as_bool) == Some(true)
            {
                additional_lines = self
                    .stripe
                    .list(&format!("/v1/invoices/{id}/lines"), &[])
                    .await?;
                &additional_lines
            } else {
                invoice
                    .pointer("/lines/data")
                    .and_then(Value::as_array)
                    .context("missing invoice lines")?
            };
            for end in lines
                .iter()
                .filter_map(|line| paid_line_end(line, &self.price, now))
            {
                let end = OffsetDateTime::from_unix_timestamp(end.min(period_end))?;
                paid_through =
                    Some(paid_through.map_or(end, |previous: OffsetDateTime| previous.max(end)));
            }
            if paid_through.is_some_and(|end| end.unix_timestamp() == period_end) {
                break;
            }
        }
        Ok(paid_through)
    }

    async fn reconcile(&self, db: &mut PgConnection, org: Uuid, customer: &str) -> ApiResult<()> {
        let subscriptions = self.subscriptions(customer).await?;
        let candidates = subscriptions
            .iter()
            .filter_map(|s| matching_period_end(s, &self.price).map(|end| (s, end)));
        let chosen = candidates
            .clone()
            .find(|(s, _)| !is_terminal(s))
            .or_else(|| candidates.into_iter().next());
        let (id, status, paid_through) = if let Some((s, end)) = chosen {
            let id = stripe::id(s, "id", "sub_")?;
            let status = subscription_status(s)?;
            let paid_through = if status == "active" {
                self.paid_through(customer, id, end).await?
            } else {
                None
            };
            (Some(id), status, paid_through)
        } else {
            (None, "unpaid", None)
        };
        sqlx::query(
            "UPDATE hosted_billing_accounts
             SET stripe_subscription_id = $2, subscription_status = $3, paid_through = $4
             WHERE org_id = $1",
        )
        .bind(org)
        .bind(id)
        .bind(status)
        .bind(paid_through)
        .execute(db)
        .await?;
        Ok(())
    }
}

fn required(name: &str) -> anyhow::Result<String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("{name} is required in hosted billing mode"))
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/billing/status", get(status))
        .route("/v1/billing/checkout", post(checkout))
        .route("/v1/billing/portal", post(portal))
        .route(
            "/v1/billing/stripe/webhook",
            post(webhook).layer(DefaultBodyLimit::max(512 * 1024)),
        )
}

pub async fn require_active(enabled: bool, db: &mut PgConnection, org: Uuid) -> ApiResult<()> {
    if enabled && !sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (
             SELECT 1 FROM hosted_billing_accounts
             WHERE org_id = $1 AND subscription_status = 'active' AND paid_through > clock_timestamp()
         )",
    )
    .bind(org)
    .fetch_one(db)
    .await? {
        return Err(ApiError::SubscriptionRequired);
    }
    Ok(())
}

async fn status(State(state): State<Arc<AppState>>, caller: Caller) -> ApiResult<Json<Value>> {
    if state.billing.is_none() {
        return Ok(Json(json!({
            "enabled": false, "active": false, "can_manage": false, "has_customer": false,
            "status": "disabled", "paid_through": null
        })));
    }
    let (has_customer, stripe_status, paid_through, active) =
        sqlx::query_as::<_, (bool, String, Option<OffsetDateTime>, bool)>(
            "SELECT stripe_customer_id IS NOT NULL, subscription_status, paid_through,
                    subscription_status = 'active' AND COALESCE(paid_through > clock_timestamp(), FALSE)
             FROM hosted_billing_accounts WHERE org_id = $1",
        )
        .bind(caller.org_id)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or_else(|| (false, "unpaid".into(), None, false));
    let status = if stripe_status == "active" && !active {
        if paid_through.is_some() {
            "expired"
        } else {
            "unpaid"
        }
    } else {
        stripe_status.as_str()
    };
    let paid_through = paid_through
        .map(|date| date.format(&Rfc3339))
        .transpose()
        .context("formatting paid period")?;
    Ok(Json(json!({
        "enabled": true, "active": active, "can_manage": caller.role == OrgRole::Owner,
        "has_customer": has_customer, "status": status, "paid_through": paid_through
    })))
}

fn owner_billing(state: &AppState, caller: Caller) -> ApiResult<&Billing> {
    let billing = state.billing.as_ref().ok_or(ApiError::NotFound)?;
    if caller.role != OrgRole::Owner {
        return Err(ApiError::Refused("billing_owner_required"));
    }
    Ok(billing)
}

async fn ensure_customer(pool: &PgPool, billing: &Billing, org: Uuid) -> ApiResult<String> {
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO hosted_billing_accounts (org_id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(org)
        .execute(&mut *tx)
        .await?;
    let customer = sqlx::query_scalar::<_, Option<String>>(
        "SELECT stripe_customer_id FROM hosted_billing_accounts WHERE org_id = $1 FOR UPDATE",
    )
    .bind(org)
    .fetch_one(&mut *tx)
    .await?;
    let customer = match customer {
        Some(id) => id,
        None => {
            let org_id = org.to_string();
            let key = format!("fury-customer-{org}");
            let created = billing
                .stripe
                .post(
                    "/v1/customers",
                    &[("metadata[fury_org_id]", &org_id)],
                    Some(&key),
                )
                .await?;
            stripe::test_object(&created)?;
            let customer = stripe::id(&created, "id", "cus_")?.to_owned();
            sqlx::query(
                "UPDATE hosted_billing_accounts SET stripe_customer_id = $2 WHERE org_id = $1",
            )
            .bind(org)
            .bind(&customer)
            .execute(&mut *tx)
            .await?;
            customer
        }
    };
    // The customer mapping has to be visible before Checkout can send a webhook.
    tx.commit().await?;
    Ok(customer)
}

async fn checkout(State(state): State<Arc<AppState>>, caller: Caller) -> ApiResult<Json<Value>> {
    let billing = owner_billing(&state, caller)?;
    billing.validate_price().await?;
    let org = caller.org_id;
    let customer = ensure_customer(&state.db, billing, org).await?;
    let mut tx = state.db.begin().await?;
    let previous = sqlx::query_scalar::<_, Option<String>>(
        "SELECT stripe_checkout_session_id FROM hosted_billing_accounts WHERE org_id = $1 FOR UPDATE",
    )
    .bind(org)
    .fetch_one(&mut *tx)
    .await?;
    let subscriptions = billing.subscriptions(&customer).await?;
    if subscriptions.iter().any(|s| !is_terminal(s)) {
        return Err(ApiError::Conflict(
            "manage the existing subscription in the billing portal".into(),
        ));
    }
    if let Some(session) = previous.as_deref() {
        if !stripe::is_id(session, "cs_test_") {
            return Err(anyhow!("invalid stored Checkout session ID").into());
        }
        let existing = billing
            .stripe
            .get(&format!("/v1/checkout/sessions/{session}"))
            .await?;
        validate_checkout(&existing, &customer)?;
        if stripe::id(&existing, "id", "cs_test_")? != session {
            return Err(anyhow!("Stripe returned a different Checkout session").into());
        }
        match existing.get("status").and_then(Value::as_str) {
            Some("open") => {
                let url = stripe::hosted_url(&existing, "checkout.stripe.com")?;
                tx.commit().await?;
                return Ok(Json(json!({ "url": url })));
            }
            Some("expired") => {}
            Some("complete") => {
                // The subscription list can lag immediately after Checkout.
                // Don't create a second session until the completed session's
                // subscription is visible in Stripe and has reached a terminal state.
                let id = stripe::id(&existing, "subscription", "sub_")?;
                if !subscriptions
                    .iter()
                    .any(|s| s["id"].as_str() == Some(id) && is_terminal(s))
                {
                    return Err(ApiError::Conflict(
                        "the previous checkout is still being processed".into(),
                    ));
                }
            }
            _ => return Err(anyhow!("unexpected Stripe Checkout status").into()),
        }
    }

    // The previous ID remains committed if we lose the HTTP response or
    // transaction. The retry therefore sends exactly the same idempotency key.
    let key = format!(
        "fury-checkout-{org}-{}",
        previous.as_deref().unwrap_or("first")
    );
    let org_id = org.to_string();
    let created = billing
        .stripe
        .post(
            "/v1/checkout/sessions",
            &[
                ("mode", "subscription"),
                ("customer", &customer),
                ("line_items[0][price]", &billing.price),
                ("line_items[0][quantity]", "1"),
                ("success_url", &billing.return_url),
                ("cancel_url", &billing.return_url),
                ("client_reference_id", &org_id),
                ("subscription_data[metadata][fury_org_id]", &org_id),
            ],
            Some(&key),
        )
        .await?;
    validate_checkout(&created, &customer)?;
    let id = stripe::id(&created, "id", "cs_test_")?;
    let url = stripe::hosted_url(&created, "checkout.stripe.com")?;
    sqlx::query(
        "UPDATE hosted_billing_accounts SET stripe_checkout_session_id = $2 WHERE org_id = $1",
    )
    .bind(org)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "url": url })))
}

async fn portal(State(state): State<Arc<AppState>>, caller: Caller) -> ApiResult<Json<Value>> {
    let billing = owner_billing(&state, caller)?;
    let customer = sqlx::query_scalar::<_, Option<String>>(
        "SELECT stripe_customer_id FROM hosted_billing_accounts WHERE org_id = $1",
    )
    .bind(caller.org_id)
    .fetch_optional(&state.db)
    .await?
    .flatten()
    .ok_or_else(|| {
        ApiError::BadRequest("start checkout before opening the billing portal".into())
    })?;
    let session = billing
        .stripe
        .post(
            "/v1/billing_portal/sessions",
            &[("customer", &customer), ("return_url", &billing.return_url)],
            None,
        )
        .await?;
    stripe::customer_object(&session, &customer)?;
    Ok(Json(
        json!({ "url": stripe::hosted_url(&session, "billing.stripe.com")? }),
    ))
}

async fn webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<StatusCode> {
    let billing = state.billing.as_ref().ok_or(ApiError::NotFound)?;
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !verify_signature(
        signature,
        &body,
        billing.webhook_secret.as_bytes(),
        OffsetDateTime::now_utc().unix_timestamp(),
    ) {
        return Err(ApiError::BadRequest(
            "invalid Stripe webhook signature".into(),
        ));
    }
    let event: Value = serde_json::from_slice(&body)
        .map_err(|_| ApiError::BadRequest("invalid Stripe event".into()))?;
    if event.get("livemode").and_then(Value::as_bool) != Some(false) {
        return Err(ApiError::BadRequest(
            "expected a Stripe test-mode event".into(),
        ));
    }
    let kind = event
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("missing Stripe event type".into()))?;
    if !matches!(
        kind,
        "checkout.session.completed"
            | "customer.subscription.created"
            | "customer.subscription.updated"
            | "customer.subscription.deleted"
            | "customer.subscription.paused"
            | "customer.subscription.resumed"
            | "invoice.paid"
            | "invoice.payment_failed"
            | "invoice.voided"
            | "invoice.marked_uncollectible"
    ) {
        return Ok(StatusCode::NO_CONTENT);
    }
    let id = stripe::id(&event, "id", "evt_")
        .map_err(|_| ApiError::BadRequest("invalid Stripe event ID".into()))?;
    let Some(customer) = event
        .pointer("/data/object/customer")
        .and_then(Value::as_str)
        .filter(|v| stripe::is_id(v, "cus_"))
    else {
        return Ok(StatusCode::NO_CONTENT);
    };
    let mut tx = state.db.begin().await?;
    let org = sqlx::query_scalar::<_, Uuid>(
        "SELECT org_id FROM hosted_billing_accounts WHERE stripe_customer_id = $1 FOR UPDATE",
    )
    .bind(customer)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(org) = org {
        let inserted = sqlx::query(
            "INSERT INTO hosted_billing_events (stripe_event_id, org_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING",
        )
        .bind(id)
        .bind(org)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() != 0 {
            // A snapshot can arrive out of order. Resolve Stripe's current
            // state while holding the workspace lock, so older reads cannot
            // commit after newer ones.
            billing.reconcile(&mut tx, org, customer).await?;
        }
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

fn subscription_status(subscription: &Value) -> anyhow::Result<&str> {
    subscription
        .get("status")
        .and_then(Value::as_str)
        .filter(|s| {
            !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
        })
        .context("missing or invalid Stripe subscription status")
}

fn is_terminal(subscription: &Value) -> bool {
    matches!(
        subscription["status"].as_str(),
        Some("canceled" | "incomplete_expired")
    )
}

fn matching_period_end(subscription: &Value, price: &str) -> Option<i64> {
    let items = subscription.pointer("/items/data")?.as_array()?;
    let [item] = items.as_slice() else {
        return None;
    };
    if subscription.pointer("/items/has_more")?.as_bool()?
        || item["quantity"].as_u64()? != 1
        || item.pointer("/price/id")?.as_str()? != price
    {
        return None;
    }
    let period_end = item["current_period_end"].as_i64()?;
    Some(
        subscription["cancel_at"]
            .as_i64()
            .map_or(period_end, |end| end.min(period_end)),
    )
}

fn paid_line_end(line: &Value, price: &str, now: i64) -> Option<i64> {
    if line.pointer("/pricing/price_details/price")?.as_str()? != price
        || line["amount"].as_i64()? <= 0
        || line
            .pointer("/parent/subscription_item_details/proration")
            .and_then(Value::as_bool)
            == Some(true)
    {
        return None;
    }
    let start = line.pointer("/period/start")?.as_i64()?;
    let end = line.pointer("/period/end")?.as_i64()?;
    (start <= now && end > start).then_some(end)
}

fn validate_checkout(session: &Value, customer: &str) -> anyhow::Result<()> {
    stripe::customer_object(session, customer)?;
    if session["mode"].as_str() != Some("subscription") {
        bail!("unexpected Stripe Checkout mode");
    }
    Ok(())
}

fn verify_signature(header: &str, body: &[u8], secret: &[u8], now: i64) -> bool {
    let parts = || {
        header
            .split(',')
            .filter_map(|part| part.trim().split_once('='))
    };
    let mut timestamps = parts().filter_map(|(k, v)| (k == "t").then_some(v));
    let Some(timestamp) = timestamps.next() else {
        return false;
    };
    let Ok(seconds) = timestamp.parse::<i64>() else {
        return false;
    };
    if timestamps.next().is_some() || now.abs_diff(seconds) > 300 {
        return false;
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts all key lengths");
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    parts().any(|(k, v)| {
        if k != "v1" {
            return false;
        }
        let mut signature = [0; 32];
        hex::decode_to_slice(v, &mut signature).is_ok()
            && mac.clone().verify_slice(&signature).is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_raw_body_and_signature_timestamp() {
        let secret = b"whsec_test_fixture";
        let body = br#"{"test":true}"#;
        let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
        mac.update(b"1000.");
        mac.update(body);
        let signature = hex::encode(mac.finalize().into_bytes());
        let header = format!("t=1000,v0=ignored,v1=bad,v1={signature}");
        assert!(verify_signature(&header, body, secret, 1300));
        assert!(!verify_signature(&header, body, secret, 1301));
        assert!(!verify_signature(&header, body, secret, 699));
        assert!(!verify_signature(
            &header,
            b"{ \"test\":true}",
            secret,
            1000
        ));
        assert!(!verify_signature(&header, body, b"wrong secret", 1000));
        assert!(!verify_signature(
            &format!("{header},t=1000"),
            body,
            secret,
            1000
        ));
    }

    #[test]
    fn paid_period_requires_matching_price_and_non_prorated_coverage() {
        let mut line = json!({
            "pricing": { "price_details": { "price": "price_monthly" } },
            "parent": { "subscription_item_details": { "proration": false } },
            "amount": 1000,
            "period": { "start": 1000, "end": 2000 }
        });
        assert_eq!(paid_line_end(&line, "price_monthly", 1500), Some(2000));
        assert_eq!(paid_line_end(&line, "price_other", 1500), None);
        assert_eq!(paid_line_end(&line, "price_monthly", 999), None);
        line["parent"]["subscription_item_details"]["proration"] = json!(true);
        assert_eq!(paid_line_end(&line, "price_monthly", 1500), None);
    }

    #[test]
    fn current_subscription_caps_paid_period_at_cancellation() {
        let mut sub = json!({
            "status": "active",
            "cancel_at": 1800,
            "items": { "has_more": false, "data": [
                { "price": { "id": "price_monthly" }, "quantity": 1, "current_period_end": 2000 }
            ] }
        });
        assert_eq!(matching_period_end(&sub, "price_monthly"), Some(1800));
        assert!(!is_terminal(&sub));
        sub["status"] = json!("canceled");
        assert!(is_terminal(&sub));
        assert_eq!(matching_period_end(&sub, "price_other"), None);
    }
}
