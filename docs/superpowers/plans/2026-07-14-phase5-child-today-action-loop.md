# Phase 5A Child Today Action Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a verified child flow from Today task detail to the exact Challenge task and back to refreshed Today data.

**Architecture:** Keep `/child/dashboard` as the authority. `ChildToday` renders a local detail sheet and encodes a navigation intent; `ChildChallenge` validates that intent against freshly fetched tasks and reuses its existing focus/timer machinery. `ChildLayout` continues to own task data and exposes the existing refresh callback.

**Tech Stack:** React 18, React Router 6, TypeScript, Tailwind CSS, Playwright

---

### Task 1: Encode the failing journey

**Files:**
- Modify: `frontend/tests/smoke/product-phase1.spec.ts`

- [ ] Add a task fixture with `completionMode`, `targetValue`, `xpReward` and game-ticket preview.
- [ ] Assert clicking the Today CTA opens details without changing `/child/today`.
- [ ] Assert the detail shows the completion target, coins, growth and game-ticket preview.
- [ ] Click the detail CTA and assert `taskId=task-running`, `tab=today` and `from=today`.
- [ ] Assert Challenge opens the matching running timer and its “返回今天” action.
- [ ] Change the dashboard mock to a completed state, return, and assert Today re-requested the dashboard and no longer presents the task.
- [ ] Add an invalid `taskId` case that shows `challenge.targetUnavailable` and never opens another task.
- [ ] Run `npm run test:smoke -- product-phase1.spec.ts`; expect the new assertions to fail before implementation.

### Task 2: Add Today details and refresh

**Files:**
- Modify: `frontend/src/utils/todayPriority.ts`
- Modify: `frontend/src/pages/child/ChildToday.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`

- [ ] Extend `TodayTask` with the task fields already returned by `/child/dashboard`.
- [ ] Add `selectedTask` and render the existing `BottomSheet` with `getTaskCompletionSummary`.
- [ ] Make primary and later-task clicks open the sheet; keep breakfast navigation unchanged.
- [ ] Navigate from the sheet with `tab`, `taskId` and `from=today`; pass `{ fromToday: true }` in router state.
- [ ] Call the outlet `refresh()` when Today mounts, regains focus, or becomes visible; retain current UI if refresh rejects.
- [ ] Run the targeted smoke test; expect detail assertions and URL contract to pass.
- [ ] Commit as `P5A-2: add Today task details and refresh`.

### Task 3: Validate and consume the Challenge intent

**Files:**
- Modify: `frontend/src/pages/child/ChildChallenge.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`

- [ ] Parse `taskId` only as an opaque string and wait for one fresh dashboard fetch before resolving it.
- [ ] For a valid unfinished task, reuse `getTaskTab`, `focusRequest`, highlight and existing task/timer sheets.
- [ ] For a missing or finished task, show the translated unavailable message and replace the URL without `taskId`.
- [ ] Show a translated “返回今天” control only for the Today-origin intent.
- [ ] Return with router state requesting a refresh; never mutate task state merely because a URL was opened.
- [ ] Run `npm run test:smoke -- product-phase1.spec.ts`; expect all Phase 5A cases to pass.
- [ ] Run `npm run build`; expect TypeScript and Vite to finish with exit code 0.
- [ ] Commit as `P5A-3: target Challenge tasks from Today`.
