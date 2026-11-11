# Client Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the selected quick profile creation and useful environment list controls.

**Architecture:** Extend the existing ProfileDialog and ProfileTable; extract validated list preferences and deterministic filtering into a small pure module. Keep unsaved form data in App memory and list preferences in per-account localStorage.

**Tech Stack:** React 19, TypeScript, existing CSS tokens, Node built-in tests, Tauri API unchanged.

**Spec:** docs/superpowers/specs/2026-11-11-client-workspace-design.md

## Global Constraints

- Preserve pre-existing uncommitted changes; no server/core edits or deployments.
- Keep default proxy restrictions, same-host persona defaults, permissions and validation.
- Never persist proxy credentials, WireGuard config or rotation keys in browser storage.
- No extra production dependencies; follow existing theme and language behavior.

## Review Focus

- Quick/advanced switching must retain all typed values, including proxy credentials.
- Draft restore must stay inside its target project/world; save success clears it.
- Damaged or denied localStorage must fall back to safe defaults.
- Hidden selections must never participate in bulk actions; pinned rows still obey filters.
- Filtering/sorting a scrolled virtual table must not render an empty or wrong range.

### Task 1: Quick creation and draft protection

**Files:** Modify desktop/src/components/ProfileDialog.tsx; create focused quick dialog labels/styles/helper/tests as needed; App.tsx integration owned by coordinator.

- [x] Add meaningful dirty-state/draft tests and watch them fail before implementation.
- [x] Add quick/advanced mode using the same state and save path; simplify summary without weakening validation.
- [x] Add in-app close protection and scoped in-memory draft callbacks; test mode switching and draft restore.

### Task 2: List preference model and controls

**Files:** Create desktop/src/profileWorkspace.ts, desktop/src/profileWorkspaceI18n.ts, desktop/src/components/ProfileWorkspaceControls.tsx and scoped CSS/tests; modify desktop/src/components/ProfileTable.tsx.

- [x] Add failing tests for preference sanitization, sorting, recent/attention/pinned filters, saved-view persistence and visible-only selection.
- [x] Implement deterministic filtering and preference model; controls for quick views, sort, saved views and columns.
- [x] Add pinning and optional columns to the existing table; preserve permissions, empty states and virtual scroll.

### Task 3: Integrate and validate

**Files:** Modify desktop/src/App.tsx and desktop/package.json; add isolated UI preview fixtures only if needed.

- [x] Integrate list controls, scoped persistence and in-memory drafts with existing filters and project routing.
- [x] Run baseline/build and all new behavioral tests; review the combined diff.
- [x] Inspect isolated browser preview for quick creation, close protection, saved views, sort, pin, custom columns and filtering; capture screenshots.
- [x] Obtain independent review, fix actionable issues and rerun affected checks.

## Validation record

- Baseline frontend build passed; the existing large-bundle warning remains.
- Whole frontend suite passes: 22 tests, including 4 draft and 11 list preference/selection/view tests, plus 7 concurrent fingerprint tests.
- Isolated IAB preview uses real React components with every API replaced by in-memory test boundaries. No real Agent, server, credentials or browser profiles were touched.
- Verified new=quick/edit=advanced, text input retention across modes, cancel/Escape guards, keep/reopen draft, unchanged close and save success clearing the draft.
- Verified first-save failure keeps the name/URLs/proxy selection and enables a successful retry.
- Verified attention and recent filters, pins respecting search, sorting, hidden columns, same-configuration A/B view selection/deletion, reload persistence, and 220-row scroll-to-end followed by one-row filtering with scroll reset and hidden selection cleared.
- Review found and fixed command-palette bypass of draft protection and content-based saved-view identity. Independent re-review passed.
- Screenshots: `/Users/aron/.codex/visualizations/2026/11/11/01a1c8a7-df9d-7ae0-9baf-f654cbb7bf3d/client-workspace/`.
- This task changes client sources and provides a local test preview; no release, installer replacement, native-network or real-device acceptance was performed.
