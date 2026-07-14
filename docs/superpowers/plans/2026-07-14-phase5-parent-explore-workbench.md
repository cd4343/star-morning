# Phase 5B Parent Explore Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Parent Explore into a mobile-first Discover–Plan–Records action workbench without changing exploration into tasks or rewards.

**Architecture:** Preserve existing APIs and business handlers in `ParentExplore`. Replace only the page-level navigation and compose the existing search, place, check-in, memory and settings sections into three stages. Extend the feed-settings projection with existing structured fields so frontend filtering is truthful and schema-free.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Express, SQLite, Vitest, Playwright

---

### Task 1: Encode the workbench contract

**Files:**
- Modify: `frontend/tests/smoke/navigation.spec.ts`
- Create: `backend/src/exploreFeed.test.ts`

- [ ] Mock places, pending and confirmed check-ins, feed settings and timeline.
- [ ] Assert only the three primary stages are visible and the old five-tab control is absent.
- [ ] Assert summary counts, the single primary discovery CTA and 375px no-overflow.
- [ ] Exercise Discover filters and verify matching structured recommendations remain visible while known mismatches are hidden.
- [ ] Exercise Plan status grouping and Records pending-first/memory switch.
- [ ] Simulate initial API failure and assert the retry action reloads data instead of showing a false empty state.
- [ ] Run the targeted Playwright and backend test commands; expect new assertions to fail before implementation.

### Task 2: Return complete pending-review data

**Files:**
- Modify: `backend/src/exploreFeed.ts:566-598`
- Test: `backend/src/exploreFeed.test.ts`

- [ ] Extract the feed-settings read into `getParentExploreFeedSettings(db, familyId, poiEnabled)` so its family isolation and response contract can be tested without changing route URLs.
- [ ] Expand the pending-review `SELECT` with existing structured columns: image, venue, district, feed category, age bounds, activity dates, price, booking, official URL, recommendation reason, notes, verification and score.
- [ ] Keep the `familyId` predicate and 50-item limit unchanged.
- [ ] Assert another family's row is absent and structured fields are returned for the current family.
- [ ] Run `npm test` from `backend`; expect exit code 0 with no skipped Phase 5B test.
- [ ] Run `npm run build` from `backend`; expect exit code 0.
- [ ] Commit as `P5B-2: expose structured Explore recommendations`.

### Task 3: Recompose Parent Explore

**Files:**
- Modify: `frontend/src/pages/parent/ParentExplore.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`

- [ ] Replace the five-tab state with `discover`, `plan`, `records`, plus a secondary settings view and a records subview.
- [ ] Add the workbench summary and one primary CTA using current `places` and `checkins` data.
- [ ] Move generate-now preferences and pending-review cards into Discover; add age/time/category filters that preserve unknown metadata.
- [ ] Keep concrete POI search and manual add in a collapsible advanced area.
- [ ] Group Plan cards by `planned`, `wishlist`, and `visited` while preserving create/edit/archive/delete handlers.
- [ ] Put unconfirmed check-ins first in Records and expose Memories as its secondary view.
- [ ] Add an explicit initial-load error and retry state; preserve forms and filters on later failures.
- [ ] Move existing quota, source, push, statistics, achievement and geocode tools behind the secondary settings entry without changing their handlers.
- [ ] Ensure new visible strings use `t()` and all primary controls are at least 44px.
- [ ] Run `npm run test:smoke -- navigation.spec.ts`; expect all Phase 5B cases to pass.
- [ ] Run `npm run build`; expect exit code 0.
- [ ] Commit as `P5B-3: reorganize Parent Explore workbench`.
