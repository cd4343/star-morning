# Phase 6 Parent Lottery Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let parents set 1–5 paid draws per day (default selection 5 for this family) and allow at most one effort ticket per Beijing business day.

**Architecture:** Extend the existing lottery safety module with additive SQLite migration and deterministic quota helpers. Keep quota checks inside the existing transaction, expose one normalized quota payload to parent and child clients, then update both UIs from server state.

**Tech Stack:** TypeScript, Express, sqlite/sqlite3, Vitest, React 18, Playwright.

---

### Task 1: Add additive settings and ticket-usage schema

**Files:**
- Modify: `backend/src/lotteryRules.ts`
- Test: `backend/src/lotteryRules.test.ts`

- [ ] Add failing tests proving old rows remain at 2, values 1–5 validate, and a child can consume only one ticket per Beijing date.
- [ ] Run `npm test -- --run src/lotteryRules.test.ts` in `backend`; expect the new assertions to fail.
- [ ] Add `paid_draw_limit_v2`, `daily_ticket_limit`, and `lottery_ticket_daily_usage` through `PRAGMA table_info` guarded migrations; keep `daily_paid_limit` unchanged.
- [ ] Extend `LotterySafetySettings` with `dailyTicketLimit`; add a single setter accepting `{ enabled, dailyPaidLimit, dailyTicketLimit }` and integer validation.
- [ ] Add helpers that read and insert `(child_id, usage_date)` ticket usage within the caller's transaction.
- [ ] Rerun the focused test; expect pass.
- [ ] Commit as `P6-1: add lottery quota schema and rules`.

### Task 2: Enforce and expose quotas in the API

**Files:**
- Modify: `backend/src/server.ts:6658-6820`
- Test: `backend/src/lotteryRules.test.ts`

- [ ] Add failing API-level rule tests for the fifth paid draw succeeding, sixth failing before debit, first ticket succeeding after paid quota, and second ticket failing.
- [ ] Update `PUT /api/parent/lottery-settings` to accept the three settings atomically while preserving stored limits when an old client sends only `enabled`.
- [ ] Build one quota response containing `dailyPaidLimit`, `todayPaidDrawCount`, `remainingPaidDraws`, `dailyTicketLimit`, `todayTicketDrawCount`, `remainingTicketDraws`, `availableTicketCount`, and `nextDrawMode`.
- [ ] In `/api/child/lottery/play`, select and debit a ticket only when ticket quota remains; insert usage before prize settlement in the same transaction. Otherwise enforce paid quota before guarded coin debit.
- [ ] Keep `/api/child/lottery/redraw` outside both quotas and reject all draw modes when the family switch is off.
- [ ] Run `npm test -- --run src/lotteryRules.test.ts` and `npm run build` in `backend`; expect pass.
- [ ] Commit as `P6-2: enforce paid and ticket lottery quotas`.

### Task 3: Update parent and child lottery interfaces

**Files:**
- Modify: `frontend/src/pages/parent/ParentWishes.tsx`
- Modify: `frontend/src/pages/child/ChildWishes.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Test: `frontend/tests/smoke/product-phase2.spec.ts`

- [ ] Add a failing 375px smoke test that selects 5 paid draws, saves, and verifies the 75-coin maximum plus ticket toggle.
- [ ] Replace the parent switch-only state with `enabled`, `dailyPaidLimit`, and `dailyTicketLimit`; present 1–5 as discrete 44px controls.
- [ ] Render the child button from `nextDrawMode`: effort ticket, 15 coins, completed, or parent closed. Show paid and ticket counters separately.
- [ ] Move all new visible strings into `zh-CN.ts` and use `t('lottery.*')`.
- [ ] Run the focused Playwright test and `npm run build` in `frontend`; expect pass.
- [ ] Commit as `P6-3: add parent lottery controls and child quota feedback`.

