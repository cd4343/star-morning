# Phase 4 Lightweight Cosmetics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each child safely choose earned avatars, frames, themes, titles and up to three achievement badges without adding currency, chance or functional privileges.

**Architecture:** A code-owned cosmetic catalog defines unlock sources. Two append-only SQLite tables store unlocks and the selected profile. A dedicated service validates child ownership, family isolation and unlock eligibility before a small route module writes selections.

**Tech Stack:** TypeScript, Express, SQLite, Vitest, React 18, Tailwind CSS, Playwright.

---

## Task 1: Add append-only cosmetic storage

**Files:**
- Create: `backend/src/growthCosmeticCatalog.ts`
- Create: `backend/src/growthCosmeticSchema.ts`
- Create: `backend/src/growthCosmeticSchema.test.ts`
- Modify: `backend/src/database.ts`

- [ ] Write failing tests for two repeated migrations, preserved users, unique `(child_id, cosmetic_key)`, one customization row per child and foreign-key cascades.
- [ ] Create `user_cosmetic_unlocks(child_id, cosmetic_key, source_type, source_key, unlocked_at)` and `user_profile_customization(child_id, avatar_key, frame_key, theme_key, title_key, featured_achievement_ids, updated_at)` using snake_case.
- [ ] Define only the approved first release: existing family avatars, neutral star avatars, six stage frames, five category themes, stage/selected achievement titles and three badge slots.
- [ ] Assert no cosmetic has a coin cost, probability, lottery source or permission flag.
- [ ] Register the idempotent migration after growth identity schema initialization.
- [ ] Run focused schema tests, then backend full tests.
- [ ] Commit: `git commit -m "P4-4: add lightweight cosmetic storage"`

## Task 2: Implement server-authoritative unlock and selection rules

**Files:**
- Create: `backend/src/growthIdentityService.ts`
- Create: `backend/src/growthIdentityService.test.ts`
- Create: `backend/src/growthIdentityRoutes.ts`
- Create: `backend/src/growthIdentityRoutes.test.ts`
- Modify: `backend/src/server.ts`

- [ ] Test level-boundary unlocks, achievement-source unlocks, idempotent writes, unavailable-resource fallback, invalid key rejection, cross-child rejection and cross-family rejection.
- [ ] Implement `getGrowthIdentity(db, childId, familyId)` as a read model combining user XP, stage, unlock catalog, selected profile and verified featured achievements.
- [ ] Implement `updateProfileCustomization` as a transaction. Reject any locked key with HTTP 409 code `cosmetic_not_unlocked`; reject non-owned achievement IDs with 403.
- [ ] Register authenticated kebab-case routes `GET /api/child/growth-identity` and `PUT /api/child/profile-customization`, both child-only.
- [ ] Keep default/fallback cosmetics usable without inserting redundant unlock rows.
- [ ] Run focused service and HTTP tests, then backend full tests.
- [ ] Commit: `git commit -m "P4-4: secure growth identity APIs"`

## Task 3: Build the 375px identity card and closet

**Files:**
- Create: `frontend/src/types/growthIdentity.ts`
- Create: `frontend/src/components/GrowthIdentityCard.tsx`
- Create: `frontend/src/components/CosmeticCloset.tsx`
- Modify: `frontend/src/pages/child/ChildMe.tsx`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Modify: `frontend/tests/smoke/product-phase2.spec.ts`

- [ ] Mock the new read model and write failing smoke coverage for loading, empty, locked, selected, save-error and safe-fallback states.
- [ ] Add typed API calls and render one current-identity card above achievement history.
- [ ] Keep the closet collapsed by default, one primary action at a time, 44px controls, no hover dependency and safe-area bottom padding.
- [ ] Save only after explicit confirmation; on HTTP failure restore the last server state and show a translated error toast.
- [ ] Allow zero to three unlocked achievement badges; prevent duplicates client-side and revalidate server-side.
- [ ] Run frontend build and focused smoke tests at 375px.
- [ ] Commit: `git commit -m "P4-5: add child growth identity and closet"`

## Task 4: Cosmetics checkpoint

- [ ] Confirm no route, task, shop, lottery, backpack or exploration permission imports the cosmetic service.
- [ ] Confirm no database update touches `coins`, `xp`, `rewardXpTotal` or `privilegePoints` when selecting cosmetics.
- [ ] Run backend full tests and frontend build before release packaging.
