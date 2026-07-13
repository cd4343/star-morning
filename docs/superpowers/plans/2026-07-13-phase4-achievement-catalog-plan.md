# Phase 4 Achievement Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 92 system achievements use stable identities, globally unique names and one server-authoritative display contract without altering rewards or unlock history.

**Architecture:** A typed backend catalog owns system keys, copy keys and icon keys. An idempotent migration adds identity columns and conservatively classifies legacy rows. Existing parent and child endpoints call one display service; the frontend only renders returned fields and retains a custom-achievement fallback.

**Tech Stack:** TypeScript, Node.js, Express, SQLite, Vitest, React 18, Playwright.

---

## Task 1: Freeze the 92-entry catalog contract

**Files:**
- Create: `backend/src/growthIdentityCatalog.ts`
- Create: `backend/src/growthIdentityCatalog.test.ts`
- Reference: `docs/superpowers/specs/2026-07-13-growth-identity-system-design.md` sections 4 and 5.3

- [x] Write a failing test that asserts exactly 92 entries; unique `systemKey`, Chinese title and `iconKey`; non-empty `displayTitleKey`, `displayDescriptionKey`, category and legacy matcher; and complete icon registration.
- [x] Define `SystemAchievementDefinition` and transcribe every approved row in spec order. Use stable keys such as `task.count.1`, `streak.all.3`, `life.count.1`, and `explore.checkin.1`; never derive identity from title.
- [x] Export read-only maps by `systemKey` and legacy signature. Throw during module initialization on any duplicate or missing field.
- [x] Run `npm test -- growthIdentityCatalog.test.ts` from `backend`; expect all catalog tests to pass.
- [x] Commit: `git commit -m "P4-1: establish system achievement catalog"`

## Task 2: Add an idempotent, conservative identity migration

**Files:**
- Create: `backend/src/growthIdentitySchema.ts`
- Create: `backend/src/growthIdentitySchema.test.ts`
- Modify: `backend/src/database.ts`

- [x] Start from an in-memory legacy schema containing unlocked, rewarded, renamed and custom achievements. Write failing tests for two repeated migrations, append-only columns, system classification, custom-row preservation and unchanged foreign keys.
- [x] Implement `ensureGrowthIdentitySchema(db)` with a transaction, `PRAGMA table_info`, additive `system_key`/`is_system` columns and a partial unique index on `(familyId, system_key)` where `is_system = 1`.
- [x] Match legacy rows only by the catalog's full condition signature plus approved historical titles. Leave ambiguous or renamed rows custom; log a count, never the child's data.
- [x] Call the migration from `initializeDatabase` after `achievement_defs` exists and after legacy achievement seeds are applied.
- [x] Run `npm test -- growthIdentitySchema.test.ts`; expect migration tests to pass twice against the same database.
- [x] Commit: `git commit -m "P4-2: migrate stable achievement identities"`

## Task 3: Make backend display fields authoritative

**Files:**
- Create: `backend/src/achievementDisplay.ts`
- Create: `backend/src/achievementDisplay.test.ts`
- Modify: `backend/src/server.ts` around the display helpers and achievement routes

- [ ] Write failing tests proving parent and child projections return identical `systemKey`, `isSystem`, `displayTitleKey`, `displayDescriptionKey`, `displayTitle`, `displayDescription`, `iconKey` and fallback `displayIcon` for the same row.
- [ ] Implement a pure `buildAchievementDisplay` that reads the catalog for system rows and preserves database text/icon for custom rows.
- [ ] Replace the duplicate `ACHIEVEMENT_DISPLAY_THEMES` path in `server.ts` with the imported pure helper; keep reward, progress and sorting logic unchanged.
- [ ] Reject edits to identity/condition/icon fields of system achievements with HTTP 409 and code `system_achievement_identity_locked`; continue allowing only reward fields. Keep custom CRUD behavior unchanged.
- [ ] Run `npm test -- achievementDisplay.test.ts` and `npm test`; expect zero skipped tests.
- [ ] Commit: `git commit -m "P4-2: unify achievement display contract"`

## Task 4: Remove client-side renaming and render stable icons

**Files:**
- Modify: `frontend/src/utils/achievementDisplay.ts`
- Create: `frontend/src/components/GrowthIcon.tsx`
- Create: `frontend/src/utils/growthIconRegistry.ts`
- Modify: `frontend/src/pages/child/ChildMe.tsx`
- Modify: `frontend/src/pages/parent/ParentAchievements.tsx`
- Modify: `frontend/src/pages/child/ChildLayout.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Modify: `frontend/tests/smoke/product-phase2.spec.ts`

- [ ] Add a failing smoke assertion that life, study and sport three-day achievements have different names and icons in both roles.
- [ ] Reduce `getAchievementDisplay` to server-field rendering plus safe custom fallback; delete `THEMES` and client rank-based title inference.
- [ ] Map all approved `iconKey` values to Lucide components or bundled local SVGs. `GrowthIcon` must have an accessible label and use the legacy emoji only as fallback.
- [ ] Show `系统成就`/`家庭自定义` on the parent page and disable identity inputs for system rows while leaving reward controls enabled.
- [ ] Move every newly visible string behind `t('achievement.*')` keys and keep 44px touch targets at 375px.
- [ ] Run `npm run build` and `npm run test:smoke -- product-phase2.spec.ts` from `frontend`; expect zero errors and no horizontal scroll.
- [ ] Commit: `git commit -m "P4-2: render unique achievements consistently"`

## Task 5: Catalog release checkpoint

- [ ] Run backend full tests and both builds.
- [ ] Query a copy of production-like data for duplicate non-empty `system_key`, duplicate catalog titles and rows left ambiguous; do not edit `stellar.db`.
- [ ] Record exact changed paths and rollback order in the Phase 4 release plan before starting level work.
