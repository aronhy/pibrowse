// SPDX-License-Identifier: AGPL-3.0-or-later

use std::time::Duration;

use anyhow::{anyhow, bail, Context};
use reqwest::{Client, Method, Url};
use serde_json::Value;

// Pin REST responses to the same shape regardless of the account's default.
// Webhook payloads only supply the verified event ID, type, and customer.
const API_VERSION: &str = "2026-10-28.endive";

#[derive(Clone)]
pub(super) struct Stripe {
    base: String,
    key: String,
    client: Client,
}

impl Stripe {
    pub(super) fn new(base: String, key: String) -> anyhow::Result<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { base, key, client })
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        params: &[(&str, &str)],
        idempotency_key: Option<&str>,
    ) -> anyhow::Result<Value> {
        let mut req = self
            .client
            .request(method.clone(), format!("{}{path}", self.base))
            .bearer_auth(&self.key)
            .header("Stripe-Version", API_VERSION);
        if let Some(key) = idempotency_key {
            req = req.header("Idempotency-Key", key);
        }
        req = if method == Method::GET {
            req.query(params)
        } else {
            req.form(params)
        };
        let response = req.send().await.context("Stripe request failed")?;
        if !response.status().is_success() {
            // The response body may contain customer data. A request ID is
            // enough to diagnose a failure in Stripe Workbench.
            let request_id = response
                .headers()
                .get("request-id")
                .and_then(|v| v.to_str().ok());
            bail!(
                "Stripe returned {} (request ID: {})",
                response.status(),
                request_id.unwrap_or("unavailable")
            );
        }
        response.json().await.context("invalid Stripe response")
    }

    pub(super) async fn get(&self, path: &str) -> anyhow::Result<Value> {
        self.request(Method::GET, path, &[], None).await
    }

    pub(super) async fn post(
        &self,
        path: &str,
        params: &[(&str, &str)],
        idempotency_key: Option<&str>,
    ) -> anyhow::Result<Value> {
        self.request(Method::POST, path, params, idempotency_key)
            .await
    }

    pub(super) async fn list(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> anyhow::Result<Vec<Value>> {
        let mut out = Vec::new();
        let mut cursor = String::new();
        loop {
            let mut query = params.to_vec();
            query.push(("limit", "100"));
            if !cursor.is_empty() {
                query.push(("starting_after", cursor.as_str()));
            }
            let mut page = self.request(Method::GET, path, &query, None).await?;
            let has_more = page
                .get("has_more")
                .and_then(Value::as_bool)
                .context("missing Stripe pagination flag")?;
            let items = page
                .get_mut("data")
                .and_then(Value::as_array_mut)
                .context("missing Stripe list data")?;
            if has_more {
                let last = items
                    .last()
                    .and_then(|item| item.get("id"))
                    .and_then(Value::as_str)
                    .context("Stripe pagination has no next cursor")?;
                if cursor == last {
                    bail!("Stripe pagination cursor did not advance");
                }
                cursor = last.to_owned();
            }
            out.append(items);
            if !has_more {
                return Ok(out);
            }
        }
    }
}

pub(super) fn is_id(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() > prefix.len()
        && value.len() <= 160
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

pub(super) fn id<'a>(value: &'a Value, field: &str, prefix: &str) -> anyhow::Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|id| is_id(id, prefix))
        .ok_or_else(|| anyhow!("invalid Stripe {field} identifier"))
}

pub(super) fn test_object(value: &Value) -> anyhow::Result<()> {
    if value.get("livemode").and_then(Value::as_bool) == Some(false) {
        Ok(())
    } else {
        bail!("Stripe object is not from test mode");
    }
}

pub(super) fn customer_object(value: &Value, customer: &str) -> anyhow::Result<()> {
    test_object(value)?;
    if id(value, "customer", "cus_")? != customer {
        bail!("Stripe object belongs to a different customer");
    }
    Ok(())
}

pub(super) fn hosted_url(value: &Value, host: &str) -> anyhow::Result<String> {
    let url = value
        .get("url")
        .and_then(Value::as_str)
        .context("Stripe omitted the hosted URL")?;
    let parsed = Url::parse(url).context("invalid Stripe hosted URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some(host)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        bail!("unexpected Stripe hosted URL");
    }
    Ok(url.to_owned())
}
