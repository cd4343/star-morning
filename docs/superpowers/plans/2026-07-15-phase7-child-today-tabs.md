# Phase 7 Child Today Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every applicable parent-created task visible on the child's Today page and place tasks and breakfast in reversible peer tabs.

**Architecture:** Keep dashboard task data in `ChildLayout`, compose Today from a task panel and a reusable breakfast content component, and retain the existing challenge detail/timer flow. Use URL query only for legacy breakfast entry; ordinary visits default to tasks.

**Tech Stack:** React 18, TypeScript, React Router, Tailwind CSS, Playwright.

---

### Task 1: Encode complete-task and filter intent in smoke tests

**Files:**
- Modify: `frontend/tests/smoke/product-phase1.spec.ts`

- [ ] Change the Today mock to six tasks spanning `todo`, `running`, `rejected`, `pending`, `approved`, and `completed`.
- [ ] Assert the default list renders all six titles and exposes counts for All, To do, Reviewing, and Completed.
- [ ] Click each status control and assert only its mapped task statuses remain; return to All and assert six again.
- [ ] Assert switching to breakfast and back resets the task filter to All.
- [ ] Run `npx playwright test tests/smoke/product-phase1.spec.ts --grep "child today"`; expect failure against the current truncated page.

### Task 2: Extract reusable breakfast content

**Files:**
- Create: `frontend/src/components/child/BreakfastKitchenContent.tsx`
- Modify: `frontend/src/pages/child/ChildMorning.tsx`

- [ ] Move the existing morning API, date selection, order calculation, save action, and food groups into `BreakfastKitchenContent` without duplicating requests.
- [ ] Remove only the gradient “今天早餐怎么搭” hero; keep date, combination, settlement, save, and food choices.
- [ ] Make `ChildMorning` a compatibility wrapper around the same content until routing changes in Task 4.
- [ ] Run `npm run build` in `frontend`; expect pass.
- [ ] Commit as `P7-1: extract breakfast kitchen content`.

### Task 3: Rebuild Today as complete task and breakfast tabs

**Files:**
- Modify: `frontend/src/pages/child/ChildToday.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`

- [ ] Replace the recommendation hero, primary card, breakfast entry card, and `slice(0, 2)` list with two 44px peer tabs.
- [ ] Map statuses exactly: To do = empty/`todo`/`running`/`rejected`; Reviewing = `pending`; Completed = `approved`/`completed`.
- [ ] Default to All and render every dashboard task; status controls filter locally and show an explicit empty state.
- [ ] Keep every task card opening the current detail sheet and current challenge query path.
- [ ] Render `BreakfastKitchenContent` in the breakfast tab; switching back resets the filter to All.
- [ ] Add i18n keys for tabs, status counts, empty states, and task-state labels.
- [ ] Run the focused smoke test; expect pass.
- [ ] Commit as `P7-2: show all Today tasks with breakfast tabs`.

### Task 4: Preserve the legacy breakfast route and verify release

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/tests/smoke/product-phase1.spec.ts`

- [ ] Redirect `/child/morning` to `/child/today?tab=breakfast` and assert the breakfast content is visible after navigation.
- [ ] Run `npm run build` and the complete `npm run test:smoke` in `frontend`; expect zero failures and no skipped tests.
- [ ] Verify 375px has no horizontal overflow and the last task clears the fixed bottom navigation.
- [ ] Commit as `P7-3: preserve breakfast route and verify Today flow`.

### Task 5: Build one cumulative code-only patch

**Files:**
- Create: `临时/starcoin-incremental-patch-YYYYMMDD-HHMMSS-P6P7抽奖与今日任务-code-only/`

- [ ] Copy only modified source, test, build output, scripts, and deployment instructions while preserving project-relative paths; exclude `stellar.db`, `node_modules`, previous patches, and local visual companion files.
- [ ] Add `REPLACE_FILES.md`, `ROLLBACK.md`, `VERIFICATION.md`, and `SHA256SUMS.txt`.
- [ ] Verify hashes and archive contents, then update `临时/LATEST_PATCH_PATH.txt` to this cumulative package.

