# Random Fingerprint Implementation Plan

> **For agentic workers:** Use native execution for the small shared UI task; delegate independent localization and review.

**Goal:** Add one-click coherent fingerprint switching to the new-profile dialog.

**Architecture:** Reuse weighted catalogue selection and the existing live preview. A pure selection helper excludes the current persona, respects its OS and removes only hardware overrides. No backend or persistence changes.

**Tech Stack:** React, TypeScript, Node built-in test runner, Tauri.

**Spec:** `docs/superpowers/specs/2026-11-11-random-fingerprint-design.md`

## Constraints and review focus

- Preserve all existing edits and local app branding.
- No cross-OS fallback when a compatible alternative is absent.
- Empty and zero-weight catalogues must remain safe.
- Preserve advanced overrides and all draft business fields.
- Prevent creation while the new preview is pending or invalid.
- Existing profiles do not show the new randomization button.

## Tasks

- [x] Add behavioral tests for compatible alternate selection, weighted draws and hardware-only override reset; run them before implementation.
- [x] Implement `desktop/src/fingerprintRandom.ts` and integrate it into `ProfileDialog.tsx`, with loading and save validation.
- [x] Add localized button/help text without altering unrelated translation changes.
- [x] Run frontend tests, build and diff checks; obtain independent review.
- [x] Mirror focused changes into the current local release source, build the app and verify repeated clicks and retained inputs in the native UI.

## Verification

- Seven focused behavior tests pass in both the main workspace and local release source. Independent review found no actionable issues.
- Main frontend and local release frontend builds passed; the local Tauri app was built, installed at its existing path and restarted. Ad-hoc bundle signature verification passed.
- Native UI: successive clicks changed Apple M4 Pro / 12 cores / 16 GB → Apple M2 / 8 cores / 16 GB → Apple M1 / 8 cores / 8 GB; each preview reported consistency. Draft name, tags and proxy address remained intact. The verification draft was cancelled and no profile/proxy was saved.
- Actual Chromium launch and website-level fingerprint testing remain unverified because this local app has no browser core installed.
