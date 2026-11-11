# Proxy Partner Catalog Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent UI and catalog tasks; coordinator integrates and validates.

**Goal:** Replace upstream promotion with a PiBrowse-controlled provider catalog, ready for the owner's approved affiliate links.

**Architecture:** A typed local provider catalog resolves official vs approved promotion destinations. The existing partner panel consumes the resolved offer without exposing affiliate setup details to product users.

**Tech Stack:** Existing React/TypeScript/Tauri transport and Node tests; no dependencies.

**Spec:** docs/superpowers/specs/2026-11-11-proxy-partners-design.md

## Constraints and review focus

- Preserve earlier workspace changes. Limit account/site changes to the user's authorized affiliate onboarding; do not alter credentials, identity documents or payout settings.
- Default official links carry no upstream or fabricated owner attribution.
- Invalid/unapproved promotions must never display affiliate coupons or relationship badges.
- User discounts require actual merchant-approved coupon data; commission rates are not discounts.
- The service list remains usable with and without existing proxies; no automatic vendor requests.

## Tasks

- [x] Write failing behavior tests for offer gating, HTTPS destinations and coupon suppression; implement desktop/src/proxyPartners.ts.
- [x] Replace Partner.tsx and proxy-toolbar promo; add scoped labels/styles and preserve clipboard errors/accessibility.
- [x] Save official research, an accurate reusable application brief and owner setup instructions.
- [x] Run all frontend tests/build, inspect isolated proxy page, and obtain independent code review.
- [x] Report separately: source/UI readiness vs real affiliate account approval and payout setup.

## Validation and current account status

- Five initial offer tests covered official fallback and approval gating. Updated allocation assertions for Webshare and then Proxy-Seller each failed before their configuration was enabled and passed afterward. Added a sixth offer test for the user-supplied ZhizhuIP referral; observed failure before configuration and success afterward. Latest whole frontend suite: 28 tests passed from an independent export of the Git index. TypeScript/Vite build passed there; existing bundle-size warning remains.
- Independent code review passed for the provider allocation and commit scope. No inherited Fury referral URL/codes/discount are used by the current panel.
- User completed all three sign-ins and Proxy-Seller identity verification. Webshare cash Affiliate is ACTIVE; Proxy-Seller Profile confirms KYC passed and its Affiliate portal exposes the owner's link and referral coupon. These public marketing values are now in `desktop/src/proxyPartners.ts`. Credentials, identity documents and payout settings were not changed by the agent.
- Decodo remains unapproved. Added the website verification meta, deployed the existing homepage after checking for unrelated drift, and observed Impact Website `pibrowse.dev` Connected. With the user's explicit authorization, submitted marketplace review ticket 920738; status Open. This does not establish brand approval.
- User additionally supplied `https://www.zhizhuip.com/?ref=12175`. Added ZhizhuIP as the fourth catalog entry, using the complete owner-supplied URL with no coupon or discount claims. Provider count updates from the catalog length.
- Isolated preview shows Webshare, Proxy-Seller and ZhizhuIP affiliate badges, Proxy-Seller's assigned referral code, commercial disclosure and Decodo's official fallback. Exercised all active provider buttons and observed the exact URLs at the fixture boundary. Coupon button showed copied feedback; system clipboard content was not independently verified.
- Proxy and Settings share the provider component; both were inspected during initial catalog validation. Final four-provider screenshot: `/Users/aron/.codex/visualizations/2026/11/11/01a1c8a7-df9d-7ae0-9baf-f654cbb7bf3d/proxy-partners/05-zhizhuip-added.png`.
- Client source/UI configuration is complete for the two account-issued links and the owner-supplied ZhizhuIP link. No desktop release package was built/replaced, and no real merchant purchase or commission payout was used as an acceptance test. Website ownership verification was deployed separately.
- User authorized committing this client work. App/ProfileTable/API changes shared with prior reliability work are staged by feature only; unrelated agent/native/site/assets/download changes remain outside the commit. The staged client snapshot was independently built and tested before committing.
