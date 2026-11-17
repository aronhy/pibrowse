// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

//! The local automation API.
//!
//! Every competitor ships one on a fixed loopback port — AdsPower :50325,
//! Dolphin :3001, Octo :58888 — because it is what makes the product
//! scriptable from any language that can make an HTTP request. A Unix socket
//! speaking newline-delimited JSON is fine for the shell that ships beside it
//! and useless to a customer's Python.
//!
//! # Why this is dangerous, and what stops it
//!
//! `ipc.rs` says plainly why the shell uses a socket: on a machine where a
//! browser runs arbitrary sites' JavaScript all day, `127.0.0.1` is reachable
//! from a page. A profile visiting a hostile site could `fetch()` this port and
//! read the organisation's proxy list. Opening it without answering that would
//! undo the reason the socket was chosen.
//!
//! Four things answer it, and each is load-bearing:
//!
//! 1. **A bearer token**, generated on first run into a 0600 file. A page
//!    cannot read that file, so it cannot form an authorised request.
//! 2. **Any request carrying `Origin` is refused.** A browser attaches that
//!    header to every cross-origin `fetch` and `XMLHttpRequest`; a script does
//!    not. This is what actually keeps pages out, token or no token, and it
//!    holds even if a token leaks into a page's reach.
//! 3. **`Host` must be loopback.** Otherwise a name that resolves to 127.0.0.1
//!    lets a page treat this as same-origin — DNS rebinding, which defeats (2)
//!    by removing the cross-origin-ness.
//! 4. **Bound to 127.0.0.1**, so nothing off the machine can reach it at all.
//!
//! Off unless switched on. A port that exists because it shipped enabled is a
//! port on the machines of everyone who never wanted it.

use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// The conventional port for the automation API.
///
/// Nothing binds it by default — the API is off until `FURY_API_PORT` says
/// otherwise ([`crate::api_port`]). This is the number the examples and the
/// documentation use, so that scripts agree with each other.
///
/// Not one of the competitors' numbers: a script pointed at the wrong product
/// should fail to connect rather than half-work against it.
pub const DEFAULT_PORT: u16 = 35000;

/// Where the token lives. Mode 0600, beside the database.
pub fn token_path() -> std::path::PathBuf {
    crate::paths::data_dir().join("api-token")
}

/// The token, created on first use.
pub fn token() -> anyhow::Result<String> {
    let path = token_path();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();

    std::fs::write(&path, &token)?;
    // The whole authorisation story, in one file — so it is restricted to this
    // user explicitly rather than left to inherit whatever the directory had.
    fury_platform::perms::owner_only_file(&path)?;
    Ok(token)
}

pub async fn serve(agent: Arc<crate::ipc::Agent>, port: u16) -> anyhow::Result<()> {
    let token = token()?;
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    tracing::info!(
        port,
        token = %token_path().display(),
        "local automation API listening"
    );

    loop {
        let (stream, _) = listener.accept().await?;
        let agent = Arc::clone(&agent);
        let token = token.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(stream, agent, token).await {
                tracing::debug!(error = %e, "api connection ended");
            }
        });
    }
}

struct Request {
    method: String,
    path: String,
    body: String,
    origin: Option<String>,
    host: Option<String>,
    auth: Option<String>,
}

async fn handle(
    mut stream: TcpStream,
    agent: Arc<crate::ipc::Agent>,
    token: String,
) -> anyhow::Result<()> {
    let Some(req) = read_request(&mut stream).await? else {
        return Ok(());
    };

    // (2) and (3) before anything else, and before the token is even compared:
    // a page must not be able to learn whether its guess was right.
    if req.origin.is_some() {
        return respond(
            &mut stream,
            403,
            &serde_json::json!({
                "error": "origin_present",
                "message": "This endpoint refuses requests from a browser. It is for scripts.",
            }),
        )
        .await;
    }
    let host_ok = req
        .host
        .as_deref()
        .map(|h| {
            let name = h.rsplit_once(':').map(|(n, _)| n).unwrap_or(h);
            name == "127.0.0.1" || name == "localhost" || name == "[::1]"
        })
        .unwrap_or(false);
    if !host_ok {
        return respond(
            &mut stream,
            403,
            &serde_json::json!({
                "error": "bad_host",
                "message": "Address this by its loopback address.",
            }),
        )
        .await;
    }

    let presented = req
        .auth
        .as_deref()
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    // Constant time, because the comparison is against a secret and the
    // attacker controls one side of it.
    if !constant_time_eq(presented.as_bytes(), token.as_bytes()) {
        return respond(
            &mut stream,
            401,
            &serde_json::json!({
                "error": "unauthenticated",
                "message": "Send the token from the api-token file as a bearer token.",
            }),
        )
        .await;
    }

    let params: serde_json::Value =
        serde_json::from_str(&req.body).unwrap_or(serde_json::Value::Null);
    let params = if params.is_null() {
        serde_json::json!({})
    } else {
        params
    };

    let Some(method) = route(&req.method, &req.path) else {
        return respond(
            &mut stream,
            404,
            &serde_json::json!({ "error": "not_found", "message": "No such endpoint." }),
        )
        .await;
    };

    match agent.dispatch_public(method, params).await {
        Ok(value) => respond(&mut stream, 200, &serde_json::json!({ "ok": true, "data": value })).await,
        Err(e) => {
            respond(
                &mut stream,
                400,
                &serde_json::json!({ "error": "failed", "message": e.to_string() }),
            )
            .await
        }
    }
}

/// Which IPC method an endpoint is.
///
/// Thin on purpose: every route is one IPC method, so the HTTP surface cannot
/// drift away from what the shell uses and be separately wrong. The rules a
/// method keeps -- a cache is not removed and a seed is not replaced while the
/// browser is open -- are kept in `ipc.rs`, once, and a script meets the same
/// refusal the interface does.
///
/// What is here is what a script needs between two runs of one profile: find
/// the browser that is already open, clear the cache, give it a new seed or a
/// new machine, point its proxy somewhere else and check where that comes out.
/// Creating a profile is still not here; see examples/README.md.
fn route(method: &str, path: &str) -> Option<&'static str> {
    Some(match (method, path) {
        ("GET", "/v1/status") => "status",
        ("GET", "/v1/profiles") => "profiles.list",
        ("GET", "/v1/proxies") => "proxies.list",
        ("GET", "/v1/personas") => "personas.list",
        ("POST", "/v1/profiles/start") => "profile.launch",
        ("POST", "/v1/profiles/stop") => "profile.stop",
        ("POST", "/v1/profiles/connection") => "profile.connection",
        ("POST", "/v1/profiles/usage") => "profiles.usage",
        ("POST", "/v1/profiles/trim") => "profiles.trim",
        ("POST", "/v1/profiles/reseed") => "profiles.reseed",
        ("POST", "/v1/profiles/randomize") => "profiles.randomize",
        ("POST", "/v1/proxies") => "proxies.upsert",
        ("POST", "/v1/proxies/check") => "proxies.check",
        ("POST", "/v1/proxies/rotate") => "proxies.rotate",
        ("POST", "/v1/proxies/delete") => "proxies.delete",
        _ => return None,
    })
}

async fn read_request(stream: &mut TcpStream) -> anyhow::Result<Option<Request>> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];

    // Headers first. Bounded, because an unbounded read from an unauthenticated
    // socket is a way to exhaust this process's memory from a page that cannot
    // even authenticate.
    let head_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > 16 * 1024 {
            anyhow::bail!("request head too large");
        }
    };

    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.lines();
    let start = lines.next().unwrap_or_default();
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default();
    let path = target.split('?').next().unwrap_or("").to_string();

    let header = |name: &str| -> Option<String> {
        head.lines()
            .skip(1)
            .find(|l| l.to_ascii_lowercase().starts_with(&format!("{name}:")))
            .map(|l| l[l.find(':').unwrap() + 1..].trim().to_string())
    };

    let length: usize = header("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if length > 1024 * 1024 {
        anyhow::bail!("request body too large");
    }

    let mut body = buf[head_end..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }

    Ok(Some(Request {
        method,
        path,
        body: String::from_utf8_lossy(&body).to_string(),
        origin: header("origin"),
        host: header("host"),
        auth: header("authorization"),
    }))
}

async fn respond(
    stream: &mut TcpStream,
    status: u16,
    body: &serde_json::Value,
) -> anyhow::Result<()> {
    let body = serde_json::to_vec(body)?;
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n",
        match status {
            200 => "OK",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            _ => "Bad Request",
        },
        body.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.flush().await?;
    Ok(())
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_compare_without_leaking_where_they_differ() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    /// Every endpoint examples/README.md lists, and nothing that reads like
    /// one. A read is a GET and a change is a POST: a GET that removed a cache
    /// would be one a link preview or a retry could trigger.
    #[test]
    fn a_route_is_one_ipc_method_and_a_change_is_never_a_get() {
        assert_eq!(route("GET", "/v1/profiles"), Some("profiles.list"));
        assert_eq!(route("POST", "/v1/profiles/start"), Some("profile.launch"));
        for (path, method) in [
            ("/v1/profiles/connection", "profile.connection"),
            ("/v1/profiles/usage", "profiles.usage"),
            ("/v1/profiles/trim", "profiles.trim"),
            ("/v1/profiles/reseed", "profiles.reseed"),
            ("/v1/profiles/randomize", "profiles.randomize"),
            ("/v1/proxies", "proxies.upsert"),
            ("/v1/proxies/check", "proxies.check"),
            ("/v1/proxies/rotate", "proxies.rotate"),
            ("/v1/proxies/delete", "proxies.delete"),
        ] {
            assert_eq!(route("POST", path), Some(method), "{path}");
            if path != "/v1/proxies" {
                assert_eq!(route("GET", path), None, "{path} answered a GET");
            }
        }
        // The shell's own methods stay the shell's: nothing reaches `dispatch`
        // by being spelled as a path.
        for path in ["/v1/agent/shutdown", "/v1/profiles/delete", "/v1/credentials", "/v1/profiles/", "/"] {
            assert_eq!(route("POST", path), None, "{path}");
        }
    }

    #[test]
    fn a_loopback_host_is_accepted_and_a_rebound_name_is_not() {
        // The check as `handle` performs it. A name that resolves to 127.0.0.1
        // would otherwise make this same-origin for a page, which is the whole
        // of DNS rebinding.
        let ok = |h: &str| {
            let name = h.rsplit_once(':').map(|(n, _)| n).unwrap_or(h);
            name == "127.0.0.1" || name == "localhost" || name == "[::1]"
        };
        assert!(ok("127.0.0.1:35000"));
        assert!(ok("localhost:35000"));
        assert!(ok("127.0.0.1"));
        assert!(!ok("api.attacker.example:35000"));
        assert!(!ok("fury.local:35000"));
    }
}
