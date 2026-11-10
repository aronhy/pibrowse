// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 the Fury authors

use super::{
    bind, fixture, make_shared_fixture, DB_LOCK, ORG_A, PRIVATE, PROJECT_A, SHARED, USER_A, USER_B,
};
use crate::{api, auth, billing, AppState, Limits};
use axum::extract::{Form, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use hmac::{Hmac, Mac};
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Executor, PgConnection};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use uuid::Uuid;

const PRICE: &str = "price_monthly_fixture";
const CUSTOMER: &str = "cus_test_fixture";
const SESSION: &str = "cs_test_fixture";
const CHECKOUT_URL: &str = "https://checkout.stripe.com/c/pay/cs_test_fixture";
const PORTAL_URL: &str = "https://billing.stripe.com/p/session/fixture";
const MEMBER: &str = "cccccccc-0000-0000-0000-000000000003";
const PROXY: &str = "00000000-0000-0000-0000-0000000000e1";

struct TestServer {
    url: String,
    task: JoinHandle<()>,
}

impl TestServer {
    async fn start(router: Router) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener");
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self { url, task }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn fury(billing: Option<billing::Billing>) -> TestServer {
    let state = Arc::new(AppState {
        db: crate::connect().await.expect("test application pool"),
        billing,
        open_signup: false,
        limits: Limits::default(),
        mailer: None,
    });
    TestServer::start(api::routes().merge(billing::routes()).with_state(state)).await
}

async fn new_session(db: &mut PgConnection, user: &str) -> String {
    let (token, digest) = auth::new_token();
    sqlx::query(
        "INSERT INTO sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2::uuid, now() + interval '1 hour')",
    )
    .bind(digest)
    .bind(user)
    .execute(db)
    .await
    .expect("seed session");
    token
}

async fn seed_launchable_profiles(db: &mut PgConnection) -> Uuid {
    make_shared_fixture(db).await;
    let private = Uuid::now_v7();
    db.execute(
        format!(
            "INSERT INTO proxies
               (id, org_id, name, kind, host, port, credentials_enc, wrapped_dek)
             VALUES ('{PROXY}', '{ORG_A}', 'test proxy', 'http', '127.0.0.1', 1, '\\x01', '\\x02');
             UPDATE profiles SET id = '{private}' WHERE id = '{PRIVATE}';
             UPDATE profiles SET proxy_id = '{PROXY}' WHERE id IN ('{SHARED}', '{private}');
             INSERT INTO profile_grants (profile_id, user_id, permissions, granted_by, wrapped_key)
             VALUES ('{SHARED}', '{USER_B}', 3, '{USER_A}', '\\x01');"
        )
        .as_str(),
    )
    .await
    .expect("seed launchable profiles");
    private
}

struct Api {
    client: Client,
    server: TestServer,
}

impl Api {
    fn new(server: TestServer) -> Self {
        let client = Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap();
        Self { client, server }
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.server.url))
    }

    async fn status(&self, token: &str) -> Value {
        response_json(
            self.request(Method::GET, "/v1/billing/status")
                .bearer_auth(token),
            StatusCode::OK,
        )
        .await
    }

    async fn lock(&self, token: &str, profile: &str, status: StatusCode) -> Value {
        response_json(
            self.request(Method::POST, &format!("/v1/profiles/{profile}/lock"))
                .bearer_auth(token)
                .json(&json!({"machine_id": "fixture", "machine_name": "fixture"})),
            status,
        )
        .await
    }

    async fn webhook(&self, id: &str, kind: &str, created: i64, valid_signature: bool) -> Response {
        let body = json!({
            "id": id,
            "type": kind,
            "created": created,
            "livemode": false,
            "data": {"object": {"id": "sub_fixture", "customer": CUSTOMER, "status": "canceled"}}
        })
        .to_string();
        let now = unix_now();
        let secret: &[u8] = if valid_signature {
            b"whsec_test_fixture"
        } else {
            b"wrong"
        };
        let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
        mac.update(format!("{now}.{body}").as_bytes());
        let signature = format!("t={now},v1={:x}", mac.finalize().into_bytes());
        self.request(Method::POST, "/v1/billing/stripe/webhook")
            .header("Content-Type", "application/json")
            .header("Stripe-Signature", signature)
            .body(body)
            .send()
            .await
            .expect("webhook")
    }
}

async fn response_json(request: RequestBuilder, expected: StatusCode) -> Value {
    let response = request.send().await.expect("request");
    let actual = response.status();
    let body = response.text().await.expect("response body");
    assert_eq!(actual, expected, "{body}");
    serde_json::from_str(&body).expect("JSON response")
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[derive(Default)]
struct MockStripe {
    checkout_creations: usize,
    reads: usize,
    period_end: Option<i64>,
    cancel_at_period_end: bool,
}

type Mock = Arc<Mutex<MockStripe>>;

fn checkout_object() -> Json<Value> {
    Json(json!({
        "id": SESSION, "customer": CUSTOMER, "mode": "subscription", "livemode": false,
        "url": CHECKOUT_URL, "status": "open", "expires_at": unix_now() + 1800,
    }))
}

fn stripe_router(state: Mock) -> Router {
    Router::new()
        .route(
            "/v1/customers",
            post(|| async { Json(json!({"id": CUSTOMER, "livemode": false})) }),
        )
        .route(
            "/v1/prices/price_monthly_fixture",
            get(|| async {
                Json(json!({
                    "id": PRICE, "active": true, "livemode": false, "unit_amount": 1000,
                    "recurring": {"interval": "month", "interval_count": 1}
                }))
            }),
        )
        .route(
            "/v1/checkout/sessions",
            post(|State(state): State<Mock>, Form(form): Form<HashMap<String, String>>| async move {
                assert_eq!(form.get("customer").map(String::as_str), Some(CUSTOMER));
                assert_eq!(form.get("mode").map(String::as_str), Some("subscription"));
                assert_eq!(form.get("line_items[0][price]").map(String::as_str), Some(PRICE));
                assert!(form.keys().all(|key| !key.starts_with("payment_method_types")));
                state.lock().unwrap().checkout_creations += 1;
                checkout_object()
            }),
        )
        .route("/v1/checkout/sessions/cs_test_fixture", get(|| async { checkout_object() }))
        .route(
            "/v1/billing_portal/sessions",
            post(|Form(form): Form<HashMap<String, String>>| async move {
                assert_eq!(form.get("customer").map(String::as_str), Some(CUSTOMER));
                Json(json!({"url": PORTAL_URL, "customer": CUSTOMER, "livemode": false}))
            }),
        )
        .route(
            "/v1/subscriptions",
            get(|State(state): State<Mock>| async move {
                let mut state = state.lock().unwrap();
                state.reads += 1;
                let data = state.period_end.map_or_else(|| json!([]), |end| json!([{
                    "id": "sub_fixture", "customer": CUSTOMER, "livemode": false, "status": "active",
                    "cancel_at_period_end": state.cancel_at_period_end,
                    "items": {"has_more": false, "data": [{
                        "id": "si_fixture", "price": {"id": PRICE}, "quantity": 1,
                        "current_period_end": end
                    }]}
                }]));
                Json(json!({"has_more": false, "data": data}))
            }),
        )
        .route(
            "/v1/invoices",
            get(|State(state): State<Mock>| async move {
                let state = state.lock().unwrap();
                let data = state.period_end.map_or_else(|| json!([]), |end| json!([{
                    "id": "in_fixture", "customer": CUSTOMER, "livemode": false,
                    "status": "paid", "amount_paid": 1000,
                    "parent": {"subscription_details": {"subscription": "sub_fixture"}},
                    "lines": {"has_more": false, "data": [{
                        "id": "il_fixture", "amount": 1000, "quantity": 1,
                        "parent": {"type": "subscription_item_details",
                            "subscription_item_details": {"subscription": "sub_fixture", "proration": false}},
                        "pricing": {"price_details": {"price": PRICE}},
                        "period": {"start": end - 30 * 24 * 3600, "end": end}
                    }]}
                }]));
                Json(json!({"has_more": false, "data": data}))
            }),
        )
        .with_state(state)
}

#[tokio::test]
async fn billing_off_leaves_self_hosted_lock_and_invite_available() {
    let _guard = DB_LOCK.lock().await;
    let Some(mut db) = fixture().await else {
        eprintln!("SKIPPED billing_off: set DATABASE_URL to an isolated test database");
        return;
    };
    let profile = seed_launchable_profiles(&mut db).await.to_string();
    let owner = new_session(&mut db, USER_A).await;
    let api = Api::new(fury(None).await);

    assert_eq!(api.status(&owner).await["enabled"], false);
    let lock = api.lock(&owner, &profile, StatusCode::OK).await;
    assert!(lock["lock_token"].is_string());
    let invite = response_json(
        api.request(Method::POST, "/v1/org/invitations")
            .bearer_auth(&owner)
            .json(&json!({"email": "invite@example.test", "role": "member"})),
        StatusCode::OK,
    )
    .await;
    assert!(invite["code"].is_string());
}

#[tokio::test]
async fn hosted_billing_is_org_scoped_and_expires_without_losing_existing_locks() {
    let _guard = DB_LOCK.lock().await;
    let Some(mut db) = fixture().await else {
        eprintln!("SKIPPED hosted billing flow: set DATABASE_URL to an isolated test database");
        return;
    };
    let profile = seed_launchable_profiles(&mut db).await.to_string();
    bind(&mut db, USER_A).await;
    db.execute(
        format!(
            "INSERT INTO users (id, email, password_hash, public_key, wrapped_private_key, kdf_salt)
             VALUES ('{MEMBER}', 'member@example.test', 'x', '\\x00', '\\x00', '\\x00');
             INSERT INTO org_members (org_id, user_id, role, wrapped_ork, ork_generation)
             VALUES ('{ORG_A}', '{MEMBER}', 'member', '\\x00', 1);"
        )
        .as_str(),
    )
    .await
    .expect("seed member");
    let owner = new_session(&mut db, USER_A).await;
    let member = new_session(&mut db, MEMBER).await;
    let guest = new_session(&mut db, USER_B).await;
    let stripe = Mock::default();
    let stripe_server = TestServer::start(stripe_router(stripe.clone())).await;
    let api = Api::new(fury(Some(billing::Billing::for_test(stripe_server.url.clone()))).await);

    response_json(
        api.request(Method::GET, "/v1/billing/status"),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    let unpaid = api.status(&owner).await;
    assert_eq!(unpaid["enabled"], true);
    assert_eq!(unpaid["active"], false);
    assert_eq!(unpaid["can_manage"], true);
    assert_eq!(api.status(&member).await["can_manage"], false);
    for path in ["/v1/billing/checkout", "/v1/billing/portal"] {
        response_json(
            api.request(Method::POST, path).bearer_auth(&member),
            StatusCode::FORBIDDEN,
        )
        .await;
    }
    let denied = api
        .lock(&owner, &profile, StatusCode::PAYMENT_REQUIRED)
        .await;
    assert_eq!(denied["error"], "subscription_required");
    api.lock(&guest, &profile, StatusCode::NOT_FOUND).await;

    let checkout = || {
        response_json(
            api.request(Method::POST, "/v1/billing/checkout")
                .bearer_auth(&owner),
            StatusCode::OK,
        )
    };
    let (first, second) = tokio::join!(checkout(), checkout());
    assert_eq!(first["url"], CHECKOUT_URL);
    assert_eq!(second["url"], CHECKOUT_URL);
    assert_eq!(stripe.lock().unwrap().checkout_creations, 1);
    let portal = response_json(
        api.request(Method::POST, "/v1/billing/portal")
            .bearer_auth(&owner),
        StatusCode::OK,
    )
    .await;
    assert_eq!(portal["url"], PORTAL_URL);
    assert_eq!(
        api.status(&owner).await["active"],
        false,
        "checkout creation is not proof of payment"
    );

    let now = unix_now();
    stripe.lock().unwrap().period_end = Some(now + 600);
    let invalid = api
        .webhook("evt_fixture_paid", "invoice.paid", now, false)
        .await;
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    assert_eq!(api.status(&owner).await["active"], false);
    let paid = api
        .webhook("evt_fixture_paid", "invoice.paid", now, true)
        .await;
    assert!(
        paid.status().is_success(),
        "valid event failed: {}",
        paid.text().await.unwrap()
    );
    let reads = stripe.lock().unwrap().reads;
    assert!(api
        .webhook("evt_fixture_paid", "invoice.paid", now, true)
        .await
        .status()
        .is_success());
    assert_eq!(
        stripe.lock().unwrap().reads,
        reads,
        "duplicate must not reconcile twice"
    );
    assert_eq!(api.status(&owner).await["active"], true);
    assert_eq!(api.status(&member).await["active"], true);
    assert_eq!(api.status(&guest).await["active"], false);

    stripe.lock().unwrap().cancel_at_period_end = true;
    assert!(api
        .webhook("evt_old", "customer.subscription.deleted", now - 120, true)
        .await
        .status()
        .is_success());
    assert_eq!(
        api.status(&owner).await["active"],
        true,
        "old payload must not replace current Stripe state"
    );
    let own_lock = api.lock(&owner, &profile, StatusCode::OK).await;
    let token = own_lock["lock_token"].as_str().unwrap();
    let shared_lock = api.lock(&guest, SHARED, StatusCode::OK).await;
    response_json(
        api.request(Method::POST, &format!("/v1/profiles/{SHARED}/unlock"))
            .bearer_auth(&guest)
            .json(&json!({"lock_token": shared_lock["lock_token"]})),
        StatusCode::OK,
    )
    .await;

    stripe.lock().unwrap().period_end = Some(now - 5);
    assert!(api
        .webhook(
            "evt_fixture_end",
            "customer.subscription.updated",
            now,
            true
        )
        .await
        .status()
        .is_success());
    assert_eq!(api.status(&owner).await["active"], false);
    api.lock(&owner, &profile, StatusCode::PAYMENT_REQUIRED)
        .await;
    api.lock(&guest, SHARED, StatusCode::PAYMENT_REQUIRED).await;
    for (path, body) in [
        (
            format!("/v1/projects/{PROJECT_A}/profiles"),
            json!({
                "name": "new", "persona_id": "win11", "fp_seed": "0101010101010101",
                "timezone": "", "languages": [], "proxy_id": PROXY
            }),
        ),
        (format!("/v1/profiles/{profile}/clone"), json!({"count": 1})),
        (format!("/v1/profiles/{profile}/restore"), json!({})),
        (
            "/v1/org/invitations".into(),
            json!({"email": "new@example.test", "role": "member"}),
        ),
    ] {
        let denied = response_json(
            api.request(Method::POST, &path)
                .bearer_auth(&owner)
                .json(&body),
            StatusCode::PAYMENT_REQUIRED,
        )
        .await;
        assert_eq!(denied["error"], "subscription_required");
    }

    for action in ["lock/heartbeat", "unlock"] {
        if action == "unlock" {
            verify_can_save(&api, &owner, &profile, token).await;
        }
        response_json(
            api.request(Method::POST, &format!("/v1/profiles/{profile}/{action}"))
                .bearer_auth(&owner)
                .json(&json!({"lock_token": token})),
            StatusCode::OK,
        )
        .await;
    }

    stripe.lock().unwrap().period_end = Some(now + 1200);
    assert!(api
        .webhook("evt_fixture_renewed", "invoice.paid", now, true)
        .await
        .status()
        .is_success());
    assert_eq!(api.status(&owner).await["active"], true);
    api.lock(&owner, &profile, StatusCode::OK).await;
}

async fn verify_can_save(api: &Api, owner: &str, profile: &str, token: &str) {
    let path = format!("/v1/profiles/{profile}/bundle");
    let request = api.request(Method::POST, &path).bearer_auth(owner);
    if std::env::var_os("FURY_BUNDLE_DIR").is_none() {
        // Test permissions even when no isolated filesystem root is configured.
        let response = response_json(request, StatusCode::BAD_REQUEST).await;
        assert_eq!(response["message"], "missing x-fury-wrapped-key");
        eprintln!("Set FURY_BUNDLE_DIR to an isolated directory to check saved bundle bytes");
        return;
    }

    struct RemoveTestBundle(std::path::PathBuf);
    impl Drop for RemoveTestBundle {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = RemoveTestBundle(api::bundle_root().join(profile));
    let bytes = b"test ciphertext".as_slice();
    response_json(
        request
            .header("x-fury-wrapped-key", "fixture")
            .header("x-fury-sha256", format!("{:x}", Sha256::digest(bytes)))
            .header("x-fury-base-version", "0")
            .header("x-fury-lock-token", token)
            .body(bytes),
        StatusCode::OK,
    )
    .await;
    let response = api
        .request(Method::GET, &path)
        .bearer_auth(owner)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(&response.bytes().await.unwrap()[..], bytes);
}
