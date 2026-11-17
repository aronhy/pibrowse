// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

//! Driving the page of an open profile: go to an address, read what is there,
//! click, type, take a picture.
//!
//! This is what an assistant connected over MCP needs to do the thing people
//! actually ask it for -- "open the profiles tagged warm, check the inbox,
//! close them" -- and it is the part competitors sell as an "AI agent" running
//! on their servers. Here it runs on the operator's machine, against a browser
//! started with the debugging port on loopback (`profile.launch` with `cdp`).
//!
//! Same discipline as warm.rs: `Runtime.enable` is never called, and scripts
//! run in an isolated world rather than the page's own, so a page cannot see
//! our functions, our globals or our stack frames. The DOM is shared, which is
//! all reading and clicking need. Clicks are real input events at the
//! element's position, not `element.click()`, which a page can tell apart.

use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::cookies::Cdp;

/// How much page text one read returns unless asked for more. A long article
/// is hundreds of kilobytes, and the model on the other end pays for each one.
const DEFAULT_TEXT: usize = 8000;
const MAX_TEXT: usize = 100_000;
/// Interactive elements listed per read. A results page can have thousands of
/// links; the first ones in document order are the ones a person would see.
const MAX_ELEMENTS: usize = 200;

/// The elements a person could act on, in document order. One expression for
/// both reading and clicking, so index N means the same element in both.
const ELEMENTS: &str = r#"(() => {
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [contenteditable=""], [contenteditable=true]';
  return Array.from(document.querySelectorAll(sel)).filter(e => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none';
  });
})()"#;

/// How long `page.wait` waits unless told, and the most it will: the request
/// that carries it is given 120 seconds by the MCP side (mcp.rs, agent_call).
const DEFAULT_WAIT: u64 = 10;
const MAX_WAIT: u64 = 60;
/// What one wheel event sent from here carries, in CSS pixels. A scroll is
/// sent as several of these rather than as one event carrying 900 pixels,
/// which is a wheel nobody owns.
///
/// What is known about 120 is what the real-browser test below shows: the
/// page receives `deltaY` of 120 unchanged, in a trusted event. That a
/// physical wheel delivers 120 per notch is not claimed -- it differs by OS
/// and by device, and none was measured.
const WHEEL_NOTCH: f64 = 120.0;
/// At most this many screens per scroll. Reading a page is done a screen or
/// two at a time; a number far past that is a typo, not a request.
const MAX_SCREENS: f64 = 10.0;

/// A key that is pressed rather than typed: what moves focus, submits,
/// dismisses and scrolls. Letters go through `page.type`.
struct Key {
    name: &'static str,
    code: &'static str,
    vk: u32,
    /// What the key inserts, for the two that insert something. A key with
    /// text is a `keyDown`; one without is a `rawKeyDown`, which is how
    /// Chrome itself tells them apart.
    text: &'static str,
}

const KEYS: &[Key] = &[
    Key { name: "Enter", code: "Enter", vk: 13, text: "\r" },
    Key { name: "Tab", code: "Tab", vk: 9, text: "" },
    Key { name: "Escape", code: "Escape", vk: 27, text: "" },
    Key { name: "Backspace", code: "Backspace", vk: 8, text: "" },
    Key { name: "Delete", code: "Delete", vk: 46, text: "" },
    Key { name: "Space", code: "Space", vk: 32, text: " " },
    Key { name: "ArrowUp", code: "ArrowUp", vk: 38, text: "" },
    Key { name: "ArrowDown", code: "ArrowDown", vk: 40, text: "" },
    Key { name: "ArrowLeft", code: "ArrowLeft", vk: 37, text: "" },
    Key { name: "ArrowRight", code: "ArrowRight", vk: 39, text: "" },
    Key { name: "PageUp", code: "PageUp", vk: 33, text: "" },
    Key { name: "PageDown", code: "PageDown", vk: 34, text: "" },
    Key { name: "Home", code: "Home", vk: 36, text: "" },
    Key { name: "End", code: "End", vk: 35, text: "" },
];

/// By the name a person would say, in any case: "enter", "Esc", "pagedown".
fn key(name: &str) -> Option<&'static Key> {
    let name = name.trim();
    let name = if name.eq_ignore_ascii_case("esc") { "Escape" } else { name };
    KEYS.iter().find(|k| k.name.eq_ignore_ascii_case(name))
}

/// `background`: the profile was started with MCP's background start, so its
/// window is not the active one and the page knows it — document.hasFocus() is
/// false and focus moved away. Clicks and keystrokes arriving at a page that
/// has no focus are not something a person can produce, so for as long as this
/// session is attached Chrome is told to treat the page as focused
/// (Emulation.setFocusEmulationEnabled, upstream's own answer for driving
/// windows that are not in front). It ends with the detach below, and the page
/// sees a focus/blur pair around the action, as it would around somebody
/// switching to the window, doing one thing and switching back.
pub async fn dispatch(method: &str, ws: &str, params: &Value, background: bool) -> anyhow::Result<Value> {
    let mut page = Page::attach(ws).await?;
    if background {
        // Not fatal: without it the action still happens, only from a page
        // that thinks it is unfocused.
        if let Err(e) = page.call("Emulation.setFocusEmulationEnabled", json!({ "enabled": true })).await {
            tracing::warn!(error = format!("{e:#}"), "could not give the background page focus");
        }
    }
    let out = match method {
        "page.navigate" => {
            let url = params.get("url").and_then(Value::as_str).unwrap_or_default();
            page.navigate(url).await
        }
        "page.read" => {
            let max = params
                .get("max_chars")
                .and_then(Value::as_u64)
                .map(|n| (n as usize).min(MAX_TEXT))
                .unwrap_or(DEFAULT_TEXT);
            page.read(max).await
        }
        "page.click" => page.click(element(params)?).await,
        "page.type" => {
            let text = params.get("text").and_then(Value::as_str).unwrap_or_default();
            let target = params.get("element").and_then(Value::as_u64).map(|n| n as usize);
            let submit = params.get("submit").and_then(Value::as_bool).unwrap_or(false);
            page.type_text(target, text, submit).await
        }
        "page.screenshot" => page.screenshot().await,
        "page.key" => {
            let name = params.get("key").and_then(Value::as_str).unwrap_or_default();
            match key(name) {
                Some(k) => page.press(k).await,
                None => Err(anyhow::anyhow!(
                    "no key {name:?}; the keys are {}",
                    KEYS.iter().map(|k| k.name).collect::<Vec<_>>().join(", ")
                )),
            }
        }
        "page.scroll" => {
            let up = match params.get("direction").and_then(Value::as_str).unwrap_or("down") {
                "down" => false,
                "up" => true,
                other => anyhow::bail!("direction is \"down\" or \"up\", not {other:?}"),
            };
            let screens = params.get("screens").and_then(Value::as_f64).unwrap_or(1.0);
            page.scroll(up, screens).await
        }
        "page.wait" => {
            let text = params.get("text").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
            let url = params.get("url").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
            if text.is_none() && url.is_none() {
                anyhow::bail!("say what to wait for: text that appears on the page, or part of the address");
            }
            let seconds = params.get("seconds").and_then(Value::as_u64).unwrap_or(DEFAULT_WAIT).clamp(1, MAX_WAIT);
            page.wait_for(text, url, Duration::from_secs(seconds)).await
        }
        "page.history" => {
            let action = params.get("action").and_then(Value::as_str).unwrap_or_default();
            page.history(action).await
        }
        other => anyhow::bail!("no page method {other:?}"),
    };
    page.detach().await;
    out
}

fn element(params: &Value) -> anyhow::Result<usize> {
    params
        .get("element")
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .ok_or_else(|| anyhow::anyhow!("element: the number from read_page is required"))
}

/// Accepts what a person would type in an address bar.
pub fn normalise(url: &str) -> anyhow::Result<String> {
    let url = url.trim();
    if url.is_empty() {
        anyhow::bail!("url is empty");
    }
    // A scheme is letters then a colon not followed by a port number:
    // "javascript:x" has one, "localhost:3000" does not.
    let has_scheme = url.contains("://")
        || url.split_once(':').is_some_and(|(head, rest)| {
            head.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && head.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
                && !rest.starts_with(|c: char| c.is_ascii_digit())
        });
    let full = if has_scheme { url.to_string() } else { format!("https://{url}") };
    // chrome:// and file:// reach the browser and the disk rather than a site,
    // and nothing an assistant was asked to do on the web needs either.
    let scheme = full.split(':').next().unwrap_or_default().to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https" | "about") {
        anyhow::bail!("only http and https addresses can be opened, not {scheme}:");
    }
    Ok(full)
}

struct Page {
    cdp: Cdp,
    session: String,
    target: String,
}

impl Page {
    /// The tab the person is looking at: the first page target, which is the
    /// one Chrome lists as most recently active.
    async fn attach(ws: &str) -> anyhow::Result<Self> {
        let mut cdp = Cdp::connect(ws).await?;
        let targets = timed(&mut cdp, None, "Target.getTargets", json!({})).await?;
        let target = targets
            .get("targetInfos")
            .and_then(Value::as_array)
            .and_then(|a| {
                a.iter().find(|t| {
                    t.get("type").and_then(Value::as_str) == Some("page")
                        && !t
                            .get("url")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .starts_with("devtools://")
                })
            })
            .and_then(|t| t.get("targetId").and_then(Value::as_str))
            .ok_or_else(|| anyhow::anyhow!("the browser has no tab open"))?
            .to_string();
        let attached = timed(
            &mut cdp,
            None,
            "Target.attachToTarget",
            json!({ "targetId": target, "flatten": true }),
        )
        .await?;
        let session = attached
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("attaching to the tab gave no session"))?
            .to_string();
        Ok(Self { cdp, session, target })
    }

    async fn detach(mut self) {
        let _ = timed(
            &mut self.cdp,
            None,
            "Target.detachFromTarget",
            json!({ "sessionId": self.session }),
        )
        .await;
    }

    async fn call(&mut self, method: &str, params: Value) -> anyhow::Result<Value> {
        timed(&mut self.cdp, Some(&self.session), method, params).await
    }

    /// A script's value, run in a world of its own. A fresh world per call:
    /// one made earlier dies with the document it was made for.
    async fn eval(&mut self, expression: &str) -> anyhow::Result<Value> {
        let tree = self.call("Page.getFrameTree", json!({})).await?;
        let frame = tree
            .pointer("/frameTree/frame/id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("the tab has no main frame"))?
            .to_string();
        let world = self
            .call(
                "Page.createIsolatedWorld",
                json!({ "frameId": frame, "worldName": "fury", "grantUniveralAccess": false }),
            )
            .await?;
        let context = world
            .get("executionContextId")
            .and_then(Value::as_i64)
            .ok_or_else(|| anyhow::anyhow!("the page refused a script context"))?;
        let r = self
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "contextId": context,
                    "returnByValue": true,
                    "awaitPromise": true,
                }),
            )
            .await?;
        if let Some(e) = r.get("exceptionDetails") {
            let text = e
                .pointer("/exception/description")
                .or_else(|| e.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("the script failed");
            anyhow::bail!("{text}");
        }
        Ok(r.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    async fn where_am_i(&mut self) -> Value {
        self.eval("({ url: location.href, title: document.title })")
            .await
            .unwrap_or_else(|_| json!({}))
    }

    async fn navigate(&mut self, url: &str) -> anyhow::Result<Value> {
        let url = normalise(url)?;
        let r = self.call("Page.navigate", json!({ "url": url })).await?;
        if let Some(e) = r.get("errorText").and_then(Value::as_str) {
            // net::ERR_PROXY_CONNECTION_FAILED and friends: the proxy, not the
            // site, and the assistant should say so rather than retry.
            anyhow::bail!("could not open {url}: {e}");
        }
        self.settle(Duration::from_secs(20)).await;
        Ok(self.where_am_i().await)
    }

    /// Until the document says it has loaded, or the time is up. A page that
    /// keeps a connection open never reaches "complete", and is still usable.
    async fn settle(&mut self, within: Duration) {
        let start = Instant::now();
        // The old document can still answer "complete" for a moment.
        tokio::time::sleep(Duration::from_millis(300)).await;
        while start.elapsed() < within {
            if let Ok(Value::String(s)) = self.eval("document.readyState").await {
                if s == "complete" {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    async fn read(&mut self, max_chars: usize) -> anyhow::Result<Value> {
        let script = format!(
            r#"(() => {{
  const els = {ELEMENTS};
  const label = e => (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const text = (document.body ? document.body.innerText : '').replace(/\n{{3,}}/g, '\n\n');
  return {{
    url: location.href,
    title: document.title,
    text: text.slice(0, {max_chars}),
    text_truncated: text.length > {max_chars},
    elements: els.slice(0, {MAX_ELEMENTS}).map((e, i) => {{
      const o = {{ n: i, tag: e.tagName.toLowerCase(), label: label(e) }};
      if (e.type && e.tagName !== 'BUTTON') o.type = e.type;
      if (e.getAttribute('role')) o.role = e.getAttribute('role');
      if (e.href) o.href = e.href;
      if (e.disabled) o.disabled = true;
      return o;
    }}),
    elements_total: els.length,
  }};
}})()"#
        );
        self.eval(&script).await
    }

    /// Where element N is, after bringing it into view.
    async fn locate(&mut self, n: usize) -> anyhow::Result<(f64, f64)> {
        let script = format!(
            r#"(() => {{
  const e = {ELEMENTS}[{n}];
  if (!e) return null;
  e.scrollIntoView({{ block: 'center', inline: 'center' }});
  const r = e.getBoundingClientRect();
  return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
}})()"#
        );
        let at = self.eval(&script).await?;
        match (at.get("x").and_then(Value::as_f64), at.get("y").and_then(Value::as_f64)) {
            (Some(x), Some(y)) => Ok((x, y)),
            _ => anyhow::bail!(
                "there is no element {n} on the page now; read_page again, the page may have changed"
            ),
        }
    }

    async fn click_at(&mut self, x: f64, y: f64) -> anyhow::Result<()> {
        self.call("Input.dispatchMouseEvent", json!({ "type": "mouseMoved", "x": x, "y": y }))
            .await?;
        for kind in ["mousePressed", "mouseReleased"] {
            self.call(
                "Input.dispatchMouseEvent",
                json!({ "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1 }),
            )
            .await?;
        }
        Ok(())
    }

    async fn click(&mut self, n: usize) -> anyhow::Result<Value> {
        let (x, y) = self.locate(n).await?;
        self.click_at(x, y).await?;
        // A click that navigates needs the new page to exist before the next
        // read; one that does not costs a short wait.
        self.settle(Duration::from_secs(10)).await;
        Ok(self.where_am_i().await)
    }

    async fn type_text(&mut self, target: Option<usize>, text: &str, submit: bool) -> anyhow::Result<Value> {
        if let Some(n) = target {
            let (x, y) = self.locate(n).await?;
            self.click_at(x, y).await?;
        }
        if !text.is_empty() {
            self.call("Input.insertText", json!({ "text": text })).await?;
        }
        if submit {
            self.key_event(key("Enter").expect("Enter is in the table")).await?;
            self.settle(Duration::from_secs(15)).await;
        }
        Ok(self.where_am_i().await)
    }

    /// Down and up, as a keyboard sends them, to whatever has focus.
    async fn key_event(&mut self, k: &Key) -> anyhow::Result<()> {
        // The key as the page reads it: the character for the one key whose
        // name is not its character.
        let named = if k.name == "Space" { " " } else { k.name };
        // No nativeVirtualKeyCode. It is the host's own key number, and the
        // Windows one in its place is a different key on a Mac: with 27 there,
        // Escape reached the page and also opened chrome://settings/help in a
        // second tab (Chrome 156 on macOS, 11.11.2026). Without the field the
        // keydown arrives trusted, with the right `key` and `code`: that is
        // what the real-browser test below asserts for five keys, and all
        // that was measured -- how Chrome fills the native code in was not
        // looked at.
        let down = if k.text.is_empty() { "rawKeyDown" } else { "keyDown" };
        for kind in [down, "keyUp"] {
            self.call(
                "Input.dispatchKeyEvent",
                json!({
                    "type": kind, "key": named, "code": k.code,
                    "windowsVirtualKeyCode": k.vk,
                    "text": if kind == "keyUp" { "" } else { k.text },
                }),
            )
            .await?;
        }
        Ok(())
    }

    async fn press(&mut self, k: &Key) -> anyhow::Result<Value> {
        self.key_event(k).await?;
        // Enter can submit a form and Escape can close what the next read
        // expects to be gone; the others change nothing a read waits for.
        if k.name == "Enter" {
            self.settle(Duration::from_secs(15)).await;
        } else {
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        Ok(self.where_am_i().await)
    }

    /// The wheel, over the middle of the page, a notch at a time. Wheel events
    /// rather than `scrollBy`: a page that loads more as it is scrolled listens
    /// for the scroll either way, but only one of the two comes with the input
    /// events a hand produces.
    async fn scroll(&mut self, up: bool, screens: f64) -> anyhow::Result<Value> {
        if !screens.is_finite() || screens <= 0.0 {
            anyhow::bail!("screens is how far to scroll, in screens: a number above 0");
        }
        let screens = screens.min(MAX_SCREENS);
        let view = self.eval("({ w: innerWidth, h: innerHeight })").await?;
        let (w, h) = match (view.get("w").and_then(Value::as_f64), view.get("h").and_then(Value::as_f64)) {
            (Some(w), Some(h)) if w > 0.0 && h > 0.0 => (w, h),
            _ => anyhow::bail!("the page has no size to scroll in"),
        };
        let (x, y) = (w / 2.0, h / 2.0);
        self.call("Input.dispatchMouseEvent", json!({ "type": "mouseMoved", "x": x, "y": y }))
            .await?;
        let notches = (h * screens / WHEEL_NOTCH).ceil().max(1.0) as usize;
        let delta = if up { -WHEEL_NOTCH } else { WHEEL_NOTCH };
        for _ in 0..notches {
            self.call(
                "Input.dispatchMouseEvent",
                json!({ "type": "mouseWheel", "x": x, "y": y, "deltaX": 0, "deltaY": delta }),
            )
            .await?;
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        // Smooth scrolling is still arriving when the last event has been sent.
        tokio::time::sleep(Duration::from_millis(400)).await;
        let mut out = self.where_am_i().await;
        let at = self
            .eval(
                "(() => { const d = document.scrollingElement || document.documentElement; \
                 return { y: Math.round(scrollY), view: innerHeight, height: d.scrollHeight }; })()",
            )
            .await?;
        let n = |k: &str| at.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        out["scroll_y"] = json!(n("y"));
        out["viewport_height"] = json!(n("view"));
        out["page_height"] = json!(n("height"));
        // Within a pixel: a zoomed page reports fractions it then rounds.
        out["at_top"] = json!(n("y") <= 1.0);
        out["at_bottom"] = json!(n("y") + n("view") >= n("height") - 1.0);
        Ok(out)
    }

    /// Until the page says the text or the address has the part, or the time
    /// is up. Not finding it is an answer and not an error: "it did not
    /// appear" is what the assistant has to tell the person, and an error
    /// would read as the tool having failed.
    async fn wait_for(&mut self, text: Option<&str>, url: Option<&str>, within: Duration) -> anyhow::Result<Value> {
        // JSON is a JavaScript literal, so this is quoting and not building a
        // script out of what a model sent.
        let script = format!(
            "(() => {{ const text = {}, url = {}; \
             const body = document.body ? document.body.innerText.toLowerCase() : ''; \
             return (text === null || body.includes(text.toLowerCase())) \
                 && (url === null || location.href.includes(url)); }})()",
            serde_json::to_string(&text)?,
            serde_json::to_string(&url)?,
        );
        let start = Instant::now();
        let found = loop {
            // A page between two documents refuses a script; that is "not yet".
            if let Ok(Value::Bool(true)) = self.eval(&script).await {
                break true;
            }
            if start.elapsed() >= within {
                break false;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        };
        let mut out = self.where_am_i().await;
        out["found"] = json!(found);
        out["waited_ms"] = json!(start.elapsed().as_millis() as u64);
        Ok(out)
    }

    /// Back, forward and reload: the three buttons beside the address bar.
    async fn history(&mut self, action: &str) -> anyhow::Result<Value> {
        match action {
            "reload" => {
                self.call("Page.reload", json!({})).await?;
            }
            "back" | "forward" => {
                let h = self.call("Page.getNavigationHistory", json!({})).await?;
                let at = h.get("currentIndex").and_then(Value::as_i64).unwrap_or(0);
                let to = if action == "back" { at - 1 } else { at + 1 };
                let entry = usize::try_from(to)
                    .ok()
                    .and_then(|i| h.get("entries").and_then(Value::as_array).and_then(|a| a.get(i)))
                    .and_then(|e| e.get("id").and_then(Value::as_i64))
                    .ok_or_else(|| anyhow::anyhow!("there is no page to go {action} to in this tab"))?;
                self.call("Page.navigateToHistoryEntry", json!({ "entryId": entry })).await?;
            }
            other => anyhow::bail!("action is \"back\", \"forward\" or \"reload\", not {other:?}"),
        }
        self.settle(Duration::from_secs(20)).await;
        Ok(self.where_am_i().await)
    }

    async fn screenshot(&mut self) -> anyhow::Result<Value> {
        // Bringing the tab forward first: a background tab paints nothing.
        // In a background start this switches the tab and nothing more: patch
        // 0305 keeps the window itself where it is (BrowserView::Activate).
        let _ = timed(&mut self.cdp, None, "Target.activateTarget", json!({ "targetId": self.target })).await;
        let r = self
            .call("Page.captureScreenshot", json!({ "format": "jpeg", "quality": 70 }))
            .await?;
        let data = r
            .get("data")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("the browser returned no picture"))?;
        let mut out = self.where_am_i().await;
        out["image"] = json!({ "mime": "image/jpeg", "data": data });
        Ok(out)
    }
}

/// A CDP call that gives up rather than hangs; see warm.rs for the call that
/// taught this.
async fn timed(cdp: &mut Cdp, session: Option<&str>, method: &str, params: Value) -> anyhow::Result<Value> {
    match tokio::time::timeout(Duration::from_secs(20), cdp.call_in(session, method, params)).await {
        Ok(r) => r,
        Err(_) => anyhow::bail!("{method} timed out"),
    }
}

#[cfg(test)]
mod tests {
    use super::normalise;

    #[test]
    fn addresses_are_taken_as_a_person_types_them() {
        assert_eq!(normalise("example.com").unwrap(), "https://example.com");
        assert_eq!(normalise(" http://a.b/c ").unwrap(), "http://a.b/c");
        assert_eq!(normalise("about:blank").unwrap(), "about:blank");
        assert_eq!(normalise("localhost:3000/x").unwrap(), "https://localhost:3000/x");
    }

    #[test]
    fn a_key_is_found_by_the_name_a_person_says() {
        assert_eq!(super::key("enter").unwrap().vk, 13);
        assert_eq!(super::key(" Esc ").unwrap().name, "Escape");
        assert_eq!(super::key("PAGEDOWN").unwrap().code, "PageDown");
        // Letters are typed, not pressed, and a chord is not a key.
        assert!(super::key("a").is_none());
        assert!(super::key("Ctrl+A").is_none());
        assert!(super::key("").is_none());
        // Only the two that insert something carry text; the rest must go as
        // rawKeyDown or Chrome inserts their name's first letter nowhere and
        // fires a keypress no keyboard sends.
        let with_text: Vec<&str> = super::KEYS.iter().filter(|k| !k.text.is_empty()).map(|k| k.name).collect();
        assert_eq!(with_text, ["Enter", "Space"]);
    }

    /// One page, served from this process: it writes down the last key it was
    /// sent and whether the wheel it felt was trusted, and grows a paragraph a
    /// second and a half after it loads.
    async fn serve_test_page() -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        const PAGE: &str = r#"<!doctype html><title>start</title><body style="margin:0">
<input id="i" autofocus><p id="k">key:none</p><p id="w">wheel:none</p>
<div style="height:1500px">tall</div><p>the end</p>
<script>
addEventListener('keydown', e => { k.textContent = 'key:' + e.key + '/' + e.code + '/' + e.isTrusted; });
addEventListener('wheel', e => { w.textContent = 'wheel:' + e.deltaY + '/' + e.isTrusted; });
setTimeout(() => { const p = document.createElement('p'); p.textContent = 'Late Arrival'; document.body.prepend(p); }, 1500);
</script>"#;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf).await;
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        PAGE.len()
                    );
                    let _ = stream.write_all(head.as_bytes()).await;
                    let _ = stream.write_all(PAGE.as_bytes()).await;
                });
            }
        });
        port
    }

    /// The four against a real browser, which is the only way to know that a
    /// key arrives as a key and a wheel as a wheel. Any Chromium started with
    /// a debugging port will do; the endpoint is `webSocketDebuggerUrl` from
    /// its /json/version.
    ///
    /// Not a Fury profile, though: its traffic goes through the relay, which
    /// refuses anything aimed at loopback (relay.rs) -- the rule that keeps a
    /// page away from the automation API -- and the page this test serves is
    /// on loopback. Tried on the 157 core, 11.11.2026: the first navigation
    /// answers net::ERR_HTTP_RESPONSE_CODE_FAILURE. Run on Chrome 156.
    ///
    ///     FURY_TEST_CDP=ws://127.0.0.1:9333/devtools/browser/… \
    ///         cargo test -p fury-agent browse -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "needs a browser: set FURY_TEST_CDP to its DevTools endpoint"]
    async fn keys_wheel_waiting_and_history_against_a_real_browser() {
        use serde_json::json;
        let ws = std::env::var("FURY_TEST_CDP").expect("FURY_TEST_CDP");
        let port = serve_test_page().await;
        let home = format!("http://127.0.0.1:{port}/");
        let go = |method: &'static str, params: serde_json::Value| {
            let ws = ws.clone();
            async move { super::dispatch(method, &ws, &params, false).await }
        };
        let text = || async {
            go("page.read", json!({})).await.unwrap()["text"].as_str().unwrap().to_string()
        };

        let at = go("page.navigate", json!({ "url": home })).await.unwrap();
        assert_eq!(at["url"], home.as_str());

        // Not there yet, then there; and a thing that never comes is `false`
        // after about the time asked, not an error.
        assert!(!text().await.contains("Late Arrival"), "the page was not meant to have it yet");
        let late = go("page.wait", json!({ "text": "late arrival", "seconds": 5 })).await.unwrap();
        assert_eq!(late["found"], true, "{late}");
        let never = go("page.wait", json!({ "text": "no such words", "seconds": 1 })).await.unwrap();
        assert_eq!(never["found"], false, "{never}");
        let waited = never["waited_ms"].as_u64().unwrap();
        assert!((1000..3000).contains(&waited), "waited {waited} ms for one second");
        let there = go("page.wait", json!({ "url": format!(":{port}/") })).await.unwrap();
        assert_eq!(there["found"], true);
        assert!(go("page.wait", json!({})).await.is_err(), "waiting for nothing");

        // The page saw a trusted keydown with the key and code a keyboard
        // sends for each.
        for (name, seen) in [("Escape", "key:Escape/Escape/true"), ("space", "key: /Space/true"),
                             ("Enter", "key:Enter/Enter/true"),
                             ("ArrowDown", "key:ArrowDown/ArrowDown/true"), ("Tab", "key:Tab/Tab/true")] {
            go("page.key", json!({ "key": name })).await.unwrap();
            let body = text().await;
            assert!(body.contains(seen), "{name}: {body}");
        }
        assert!(go("page.key", json!({ "key": "F13" })).await.is_err());

        let down = go("page.scroll", json!({})).await.unwrap();
        assert!(down["scroll_y"].as_f64().unwrap() > 0.0, "{down}");
        assert_eq!(down["at_top"], false);
        assert_eq!(down["at_bottom"], false);
        let body = text().await;
        assert!(body.contains("wheel:120/true"), "a notch of a trusted wheel: {body}");
        let bottom = go("page.scroll", json!({ "screens": 10 })).await.unwrap();
        assert_eq!(bottom["at_bottom"], true, "{bottom}");
        let top = go("page.scroll", json!({ "direction": "up", "screens": 10 })).await.unwrap();
        assert_eq!(top["at_top"], true, "{top}");
        assert!(text().await.contains("wheel:-120/true"));
        assert!(go("page.scroll", json!({ "direction": "sideways" })).await.is_err());
        assert!(go("page.scroll", json!({ "screens": 0 })).await.is_err());

        let two = format!("{home}two");
        go("page.navigate", json!({ "url": two })).await.unwrap();
        assert_eq!(go("page.history", json!({ "action": "back" })).await.unwrap()["url"], home.as_str());
        assert_eq!(go("page.history", json!({ "action": "forward" })).await.unwrap()["url"], two.as_str());
        assert!(go("page.history", json!({ "action": "forward" })).await.is_err(), "nothing ahead of the last page");
        assert_eq!(go("page.history", json!({ "action": "reload" })).await.unwrap()["url"], two.as_str());
        assert!(go("page.history", json!({ "action": "sideways" })).await.is_err());
    }

    #[test]
    fn the_disk_and_the_browser_itself_are_not_sites() {
        assert!(normalise("file:///etc/passwd").is_err());
        assert!(normalise("chrome://settings").is_err());
        assert!(normalise("javascript:alert(1)").is_err());
        assert!(normalise("").is_err());
    }
}
