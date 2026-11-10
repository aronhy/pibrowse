# Hosted Billing Implementation Plan

> **For agentic workers:** Use parallel, non-overlapping implementation tasks and verify the integrated changes before reporting completion.

**Goal:** Allow an owner to pay for a hosted Fury organization and enforce its paid period on new hosted operations.

**Architecture:** Stripe Checkout, Portal, and signed event reconciliation live in the existing Fury service. PostgreSQL stores entitlement by organization; existing RBAC is evaluated before entitlement. The desktop uses its existing authenticated Rust transport.

**Tech stack:** Rust/Axum, SQLx/PostgreSQL, Tauri/React, Stripe test API.

**Spec:** `docs/superpowers/specs/2026-11-10-hosted-billing-design.md`.

## Global Constraints

- Hosted billing is opt-in. Solo and default self-hosted installs are unaffected.
- Owners can manage billing. Server configuration selects the only monthly price and the HTTPS return address.
- Access requires a matching paid invoice and current subscription state. Existing locks can be renewed, saved, and released after expiry.
- Use sandbox keys and synthetic accounts for acceptance. Use non-superuser application DB credentials.

## Review Focus

- Duplicate checkout requests and out-of-order webhook delivery.
- Expired access, and safe finish of existing sessions.
- Unpaid buyer or cross-organization guest acting on a paid/unpaid resource.
- Old servers and disabled billing must remain compatible with the desktop.
- Missing or live Stripe credentials must fail safely during test acceptance.

## Tasks

- [x] Add a billing module and migrations for Stripe Checkout, Portal, event verification, reconciliation, and status.
- [x] Add typed desktop commands and an organization billing panel.
- [x] Wire hosted configuration and enforce entitlement at authorized lock, create, clone, restore, and invitation entry points.
- [x] Run Rust, PostgreSQL, and desktop checks. Exercise Stripe Sandbox Checkout, webhook activation, Portal session creation, and loss of entitlement at a scheduled cutoff. Confirm an existing session can still save and unlock.
