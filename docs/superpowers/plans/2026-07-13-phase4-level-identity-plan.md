# Phase 4 Level Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing `floor(xp / 100) + 1` progression while presenting six understandable growth stages and removing false feature-permission claims.

**Architecture:** A shared deterministic level-stage definition is mirrored by an exact frontend view model and verified with boundary tests. Level remains a display identity only; no route or feature gate reads the stage.

**Tech Stack:** TypeScript, Vitest, React 18, i18n, Playwright.

---

## Task 1: Define and test level-stage boundaries

**Files:**
- Create: `backend/src/levelIdentity.ts`
- Create: `backend/src/levelIdentity.test.ts`
- Modify: `frontend/src/utils/levelPerks.ts`

- [x] Write boundary tests for levels 1, 3, 4, 7, 8, 12, 13, 18, 19, 25 and 26, plus invalid input normalization.
- [x] Implement six stages exactly as approved: `启程星芽`, `稳步行动家`, `自主探索者`, `习惯建造师`, `成长领航员`, `星河开拓者`.
- [x] Keep `level = Math.floor(Math.max(0, xp) / 100) + 1`; export `currentXp`, `nextLevelXp` and remaining XP without changing stored data.
- [x] Replace `LEVEL_TITLE_ANCHORS`, Roman numerals and `PERK_MILESTONES` with the six-stage display model. Do not add feature gates.
- [x] Run `npm test -- levelIdentity.test.ts` and `npm run build`.
- [x] Commit: `git commit -m "P4-3: define six-stage level identity"`

## Task 2: Correct upgrade and growth-page messaging

**Files:**
- Modify: `frontend/src/components/LevelUpModal.tsx`
- Modify: `frontend/src/pages/child/ChildMe.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Modify: `frontend/tests/smoke/product-phase2.spec.ts`

- [x] Add smoke assertions that the modal never says lottery, transfer or autonomous-task permission was unlocked.
- [ ] Show only new level, current stage, distance to the next level and any cosmetic newly earned from the growth-identity response.
- [x] Replace inline styles added by this batch with Tailwind safe-area utilities or existing project classes; preserve a 56px primary close action.
- [x] Replace new hard-coded text with `t('growthIdentity.*')` keys.
- [x] At 375px verify stage title, XP ledger and privilege ledger are visually distinct and no horizontal scroll occurs.
- [x] Run frontend build and the focused smoke test.
- [x] Commit: `git commit -m "P4-3: align level feedback with growth identity"`

## Task 3: Regression checkpoint

- [x] Verify existing `xp` and `rewardXpTotal` tests still encode separate ledgers.
- [x] Search `rg -n "PERK_MILESTONES|抽奖资格|背包转赠权|罗马" frontend/src`; expect no obsolete level-permission copy.
- [x] Run backend full tests and frontend build before cosmetics work.
