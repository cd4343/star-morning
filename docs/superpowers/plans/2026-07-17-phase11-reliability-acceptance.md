# Phase 11 Reliability Acceptance Implementation Plan

> **For agentic workers:** Execute inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current parent-child task, reward, wish, and exploration loops repeatably verifiable without touching the production database.

**Architecture:** Reuse the existing build verifier, Playwright suites, `STARCOIN_DB_PATH`, and deployment scripts. Add only a database-aware health response, an isolated API smoke test, and one PowerShell acceptance runner; do not add product features or refactor unrelated large files.

**Tech Stack:** Node.js, Express, TypeScript, SQLite, Python stdlib, PowerShell, Playwright.

---

### Task 1: Strengthen readiness and build completeness checks

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `scripts/verify_phase1_deployment.js`
- Modify: `scripts/tests/verify-live-redirect.test.js`

- [ ] Make `/api/health` execute `SELECT 1` and return HTTP 503 when SQLite is unavailable.
- [ ] Require Phase 9-10 backend modules and child/parent page chunks in the existing deployment verifier.
- [ ] Parse the live health JSON and require both `status: ok` and `database: ok`.
- [ ] Run `node --test scripts/tests/verify-live-redirect.test.js` and both builds.

### Task 2: Replace the stale destructive smoke script with current core-loop checks

**Files:**
- Modify: `scripts/tests/api-smoke.py`

- [ ] Accept `STARCOIN_API_BASE` instead of hard-coding a production-like target.
- [ ] Register a disposable family, create a learning task, start it, submit it, verify the immediate chest, approve it, and confirm duplicate requests do not duplicate settlement or chest records.
- [ ] Verify one active child wish is enforced and two exploration choices are accepted while three are rejected.
- [ ] Fail with a non-zero exit code and concise diagnostics when any assertion fails.

### Task 3: Add one isolated acceptance command

**Files:**
- Create: `scripts/verify_phase11_acceptance.ps1`

- [ ] Build backend and frontend.
- [ ] Start the built backend against a fresh database under `.tmp/` on port 3199.
- [ ] Run the API smoke, backend tests, frontend smoke tests, and production-page tests.
- [ ] Always stop the temporary backend and remove the temporary database.

### Task 4: Document the real seven-day trial and release

**Files:**
- Create: `docs/PHASE11_TRIAL_RUNBOOK.md`
- Create: a timestamped cumulative package under `临时/`

- [ ] Record the daily parent-child flows, failure evidence, and pass criteria without collecting location or sensitive child behavior.
- [ ] Run the isolated acceptance command and verify no checks were skipped.
- [ ] Package only tracked files changed since the Phase 8 base, excluding `stellar.db`, secrets, build dependencies, logs, and historical packages.
- [ ] Commit and push the Phase 11 branch after validation.

