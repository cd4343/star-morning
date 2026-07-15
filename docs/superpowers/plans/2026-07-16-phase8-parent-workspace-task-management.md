# Phase 8 Parent Workspace and Task Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use engineering-discipline to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the parent dashboard and task management information architecture without removing any existing parent capability, while adding an account-wide once-per-Beijing-day welcome prompt and a backend-derived Today task preview.

**Architecture:** Deliver Phase 8A and Phase 8B as separately testable commits. Keep the existing APIs and settlement rules as the source of truth, add only one append-only user column, move new deterministic rules into small tested backend modules, and turn the two oversized React pages into data-owning page shells plus focused presentational/interaction components.

**Tech Stack:** React 18, TypeScript, React Router, Tailwind CSS, lucide-react, Express, SQLite, Vitest, Playwright.

---

## Success gates

- [ ] All existing dashboard approvals, history filters, batch review, rejection, punishment, evidence, detail and adjustment flows remain reachable.
- [ ] All existing reports and all 11 parent tools remain reachable from the new four-tab workspace.
- [ ] The daily welcome claim is atomic, uses Beijing business dates and shows automatically at most once per parent account per day across devices.
- [ ] The task page exposes Today schedule, all tasks and family collaboration without changing task persistence or reward settlement.
- [ ] Parent Today preview and child Today use the same backend schedule functions.
- [ ] New visible strings use `t('key')`, 375px has no horizontal overflow and primary touch targets are at least 44px.
- [ ] Backend tests, backend build, frontend build and all Playwright smoke tests pass with zero skipped tests.
- [ ] The release contains no `stellar.db`, uploads, secrets, `node_modules`, historical patch edits or local visual-companion files.

### Task 1: Lock the Phase 8 compatibility baseline in smoke tests

**Files:**
- Create: `frontend/tests/smoke/parent-workspace.spec.ts`
- Modify: `frontend/tests/smoke/product-phase2.spec.ts`

- [ ] Add a reusable parent-auth and API mock fixture local to `parent-workspace.spec.ts`; mock every current dashboard request with representative pending, approved, rejected, reminder, inbox, weekly-report and statistics records.
- [ ] Assert the existing critical capabilities before layout work: pending/history approval views, review detail, score inputs, reject action, punishment controls, adjustment entry, child statistics and all 11 tool destinations.
- [ ] Extend the task-management smoke data to cover daily, once, custom-weekday, parallel and family tasks, including every field that must survive edit/save.
- [ ] Run `npx playwright test tests/smoke/parent-workspace.spec.ts tests/smoke/product-phase2.spec.ts`; require the compatibility baseline to pass. Add the deliberately failing Phase 8 navigation assertions immediately before Tasks 4 and 8 rather than committing a red branch.
- [ ] Commit as `P8-1: lock parent workspace compatibility baseline`.

### Task 2: Add an idempotent account-level daily welcome rule

**Files:**
- Create: `backend/src/parentDailyWelcome.ts`
- Create: `backend/src/parentDailyWelcome.test.ts`
- Modify: `backend/src/database.ts`

- [ ] Write Vitest cases using an in-memory SQLite database for: an append-only migration, repeat migration, first claim, second same-day claim, concurrent same-day claims, different parents and next Beijing day.
- [ ] Run `npm test -- parentDailyWelcome.test.ts` in `backend`; expect failure because the module does not exist.
- [ ] Implement `ensureParentDailyWelcomeSchema(db)` using `PRAGMA table_info(users)` followed by `ALTER TABLE users ADD COLUMN parent_welcome_last_shown_date TEXT` only when absent.
- [ ] Implement `claimParentDailyWelcome(db, parentId, beijingDate)` as one conditional update:

```sql
UPDATE users
SET parent_welcome_last_shown_date = ?
WHERE id = ?
  AND role = 'parent'
  AND COALESCE(parent_welcome_last_shown_date, '') <> ?
```

- [ ] Return `shouldShow: changes === 1` and fail loudly when the parent record is missing; never use client local time or SQLite `localtime`.
- [ ] Invoke the schema helper during database initialization after the `users` table exists; do not modify or replace `stellar.db`.
- [ ] Run the focused test and `npm run build` in `backend`; expect pass.
- [ ] Commit as `P8A-1: add atomic daily welcome claim`.

### Task 3: Expose parent workspace endpoints without enlarging business logic in server.ts

**Files:**
- Create: `backend/src/parentWorkspaceRoutes.ts`
- Create: `backend/src/parentWorkspaceRoutes.test.ts`
- Modify: `backend/src/server.ts`

- [ ] Write route-level tests for parent-only access, missing parent, same-day repeat and the `{ shouldShow, date }` response contract.
- [ ] Register `POST /api/parent/daily-welcome/claim` through a small route module that receives the database provider and existing authentication middleware.
- [ ] Use the existing Beijing date helper or move only the directly involved date-string helper into a shared exported module; do not introduce a second date formula.
- [ ] Keep claim failures isolated from dashboard loading by returning the normal API error response instead of mutating dashboard data.
- [ ] Run `npm test -- parentWorkspaceRoutes.test.ts parentDailyWelcome.test.ts` and `npm run build` in `backend`; expect pass.
- [ ] Commit as `P8A-2: expose parent daily welcome endpoint`.

### Task 4: Rebuild the dashboard shell and daily welcome experience

**Files:**
- Create: `frontend/src/pages/parent/dashboard/types.ts`
- Create: `frontend/src/pages/parent/dashboard/ParentDashboardTabs.tsx`
- Create: `frontend/src/pages/parent/dashboard/ParentDailyWelcomeModal.tsx`
- Create: `frontend/src/pages/parent/dashboard/ParentOverviewTab.tsx`
- Create: `frontend/src/pages/parent/dashboard/ParentToolsTab.tsx`
- Modify: `frontend/src/pages/parent/ParentDashboard.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Modify: `frontend/tests/smoke/parent-workspace.spec.ts`

- [ ] Implement `overview|approvals|reports|tools` parsing from `?tab=` with unknown values falling back to `overview`; switching tabs updates the URL without adding a new bottom-navigation item.
- [ ] Build four 44px minimum tab targets, a pending-count badge and a compact mobile-first active state matching approved Scheme A.
- [ ] Move only overview and tool rendering into focused components; keep API state and refresh callbacks in `ParentDashboard` so review writes still refresh the same sources.
- [ ] Group the existing 11 routes exactly as specified and test each target; do not rename or remove routes.
- [ ] Replace the old inline first-use banner with the daily modal. Call the claim endpoint once on dashboard mount, open only when `shouldShow` is true, and ignore claim failure without blanking the page.
- [ ] Add a “查看今日提醒” action in Overview that reopens the already-loaded modal without making another claim.
- [ ] Preserve the new-family first-task empty-state action independently of the welcome modal.
- [ ] Add i18n keys for all new tabs, badges, headings, empty states, actions and errors.
- [ ] Run `npm run build` and `npx playwright test tests/smoke/parent-workspace.spec.ts`; expect pass for shell, tools and welcome assertions.
- [ ] Commit as `P8A-3: rebuild parent workspace shell`.

### Task 5: Isolate approvals and reports while preserving every workflow

**Files:**
- Create: `frontend/src/pages/parent/dashboard/ParentApprovalTab.tsx`
- Create: `frontend/src/pages/parent/dashboard/ParentReviewSheet.tsx`
- Create: `frontend/src/pages/parent/dashboard/ParentReportsTab.tsx`
- Modify: `frontend/src/pages/parent/ParentDashboard.tsx`
- Modify: `frontend/src/components/parent/StatsPanel.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Modify: `frontend/tests/smoke/parent-workspace.spec.ts`

- [ ] Move approval list/history/filter markup into `ParentApprovalTab` with typed props; keep the current handlers, request payloads and settlement behavior unchanged.
- [ ] Move the single-review interaction into `ParentReviewSheet`, retaining evidence, duration, target, review focus, suggestion, time/quality/initiative scores, rejection, punishment and submit flows.
- [ ] Keep task detail and post-review adjustment reachable from approval history.
- [ ] Render weekly reports plus the existing complete `StatsPanel` inside Reports; add a child selector only when current report data can be filtered without recomputing metrics in the frontend.
- [ ] Make report loading lazy and isolated: a report failure shows a retry state inside Reports while Overview, Approvals and Tools remain usable.
- [ ] Re-run a whole-file search for `showPunishmentStats` and `punishmentStats`. Delete only the unreachable analytics modal and its exclusive state if no setter/entry path exists; preserve normal punishment settings and review punishment flows.
- [ ] Test URL restoration, pending/history filters, batch approval, individual review, rejection, adjustment, report rendering and one failed report request.
- [ ] Run `npm run build`, the focused parent-workspace smoke file and the full `npm run test:smoke`; expect zero failures and zero skipped tests.
- [ ] Commit as `P8A-4: preserve approvals and reports in workspace tabs`.

### Task 6: Extract and test the shared task schedule rule

**Files:**
- Create: `backend/src/taskSchedule.ts`
- Create: `backend/src/taskSchedule.test.ts`
- Modify: `backend/src/server.ts`

- [ ] Capture current `shouldTaskAppearOnDate` and `getTasksForDate` behavior in tests for daily, once, custom weekdays, legacy weekday fields, disabled tasks and an existing entry.
- [ ] Run `npm test -- taskSchedule.test.ts`; expect failure before extraction.
- [ ] Move the two existing functions, unchanged in behavior, into `taskSchedule.ts` and import them back into the child dashboard path.
- [ ] Compare task IDs from the extracted helper with the pre-extraction fixture to prove the child path did not change.
- [ ] Run the focused test, complete `npm test` and `npm run build` in `backend`; expect pass.
- [ ] Commit as `P8B-1: share task schedule rules`.

### Task 7: Add a family-isolated parent Today preview endpoint

**Files:**
- Modify: `backend/src/parentWorkspaceRoutes.ts`
- Modify: `backend/src/parentWorkspaceRoutes.test.ts`
- Modify: `backend/src/server.ts`

- [ ] Add tests for all-family preview, one valid child, another-family child rejection, parent-only authorization and consistency with `getTasksForDate` on the current Beijing date.
- [ ] Register `GET /api/parent/tasks/today-preview`; validate optional `childId` against `request.user.familyId` before querying tasks.
- [ ] Return child identity plus task title, category, completion fields, fixed reward fields, state and schedule source needed for rendering; do not expose data from another family.
- [ ] Do not add arbitrary date simulation or change task table structure.
- [ ] Run `npm test -- parentWorkspaceRoutes.test.ts taskSchedule.test.ts` and `npm run build`; expect pass.
- [ ] Commit as `P8B-2: add parent Today task preview`.

### Task 8: Rebuild task management as three maintainable tabs

**Files:**
- Create: `frontend/src/pages/parent/tasks/types.ts`
- Create: `frontend/src/pages/parent/tasks/ParentTasksTabs.tsx`
- Create: `frontend/src/pages/parent/tasks/ParentTodayTasksTab.tsx`
- Create: `frontend/src/pages/parent/tasks/ParentTaskListTab.tsx`
- Create: `frontend/src/pages/parent/tasks/ParentFamilyMissionsTab.tsx`
- Create: `frontend/src/pages/parent/tasks/TaskTemplatePicker.tsx`
- Create: `frontend/src/pages/parent/tasks/TaskEditorSheet.tsx`
- Modify: `frontend/src/pages/parent/ParentTasks.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`
- Modify: `frontend/tests/smoke/product-phase2.spec.ts`

- [ ] Make `today|all|family` query tabs with Today as the default and 44px minimum touch targets.
- [ ] Load Today preview only when needed, support child selection, and show explicit “no tasks configured” versus “configured but not scheduled today” states.
- [ ] Keep Today read-only except for edit/new-task navigation; saving or deleting a task refreshes both Today and All.
- [ ] Move the existing category filter/list/edit/delete behavior into `ParentTaskListTab` without changing request payloads.
- [ ] Move existing family mission create/edit/delete into `ParentFamilyMissionsTab` without mixing family and individual task APIs.
- [ ] Move template batch selection into `TaskTemplatePicker` and preserve template IDs, task types, custom weekdays and recommended rewards.
- [ ] Move new/edit form into `TaskEditorSheet`, grouped as base information, completion requirements, rewards and schedule. Editing must round-trip every old value, including completion mode, target, review focus, rewards, parallel flag and custom weekdays.
- [ ] Keep advanced explanations collapsed, but never disable or reset hidden form values.
- [ ] Test all task types, template batch creation, field round-trip, family mission CRUD, Today refresh after write and 375px overflow.
- [ ] Run `npm run build` and the focused task smoke test; expect pass.
- [ ] Commit as `P8B-3: rebuild parent task management tabs`.

### Task 9: Run full health checks and create the cumulative production package

**Files:**
- Modify: `docs/superpowers/plans/2026-07-16-phase8-parent-workspace-task-management.md`
- Create: `临时/starcoin-incremental-patch-YYYYMMDD-HHMMSS-P8家长工作台与任务管理累计-code-only/REPLACE_FILES.md`
- Create: `临时/starcoin-incremental-patch-YYYYMMDD-HHMMSS-P8家长工作台与任务管理累计-code-only/ROLLBACK.md`
- Create: `临时/starcoin-incremental-patch-YYYYMMDD-HHMMSS-P8家长工作台与任务管理累计-code-only/VERIFICATION.md`
- Create: `临时/starcoin-incremental-patch-YYYYMMDD-HHMMSS-P8家长工作台与任务管理累计-code-only/SHA256SUMS.txt`
- Modify: `临时/LATEST_PATCH_PATH.txt`

- [ ] Run `npm test` and `npm run build` in `backend`; record exact passed/failed/skipped counts.
- [ ] Run `npm run build`, `npm run lint` and `npm run test:smoke` in `frontend`; do not label skipped checks as passed.
- [ ] Start the backend with a temporary copied database or isolated test database and curl the health endpoint, welcome claim and Today preview; never point migration verification at the production `stellar.db`.
- [ ] Inspect `git diff --check`, changed-file scope, new `any`, unused imports, console noise and user-visible strings not routed through i18n.
- [ ] Mark every completed plan checkbox and list any deliberately deferred item; fail loud if a required gate is not met.
- [ ] Build a new timestamped cumulative code-only patch preserving project-relative paths. Include source, tests, required build output and deployment scripts; exclude database, uploads, secrets, dependencies, history packages and `.superpowers`.
- [ ] Document the deployment order, `setup_server_production.bat`/`deploy_server_production.bat` use, ordinary restart behavior, API checks and per-commit rollback file list.
- [ ] Generate and verify SHA-256 hashes, zip the package, and point `临时/LATEST_PATCH_PATH.txt` only to the verified newest package.
- [ ] Commit as `P8-RELEASE: package parent workspace and task management` and push `codex/phase8-parent-workspace` to GitHub only after all required checks pass.
