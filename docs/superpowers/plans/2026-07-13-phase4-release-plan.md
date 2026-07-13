# Phase 4 Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release Phase 4 as independently reversible code-only batches while preserving the production SQLite database, current URLs and server startup workflow.

**Architecture:** Validate each prior batch in isolation, then build a cumulative code-only patch containing source, verified builds and deployment checks. Database changes are additive and remain after code rollback; old code must ignore them safely.

**Tech Stack:** npm, TypeScript, Vite, Vitest, Playwright, Windows batch/PowerShell deployment scripts, SHA-256 manifests.

---

## Task 1: Pre-release audit

**Files:**
- Modify: `scripts/verify_phase1_deployment.js` only if Phase 4 assets require deterministic checks
- Create: `scripts/verify_phase4_growth_identity.js`

- [ ] Check `git diff --check`, `git status --short` and every Phase 4 commit; exclude unrelated untracked user files.
- [ ] Run `npm test` and `npm run build` in `backend`; record exact pass/fail/skip counts.
- [ ] Run `npm run build` and focused Playwright smoke tests in `frontend`; record exact pass/fail/skip counts.
- [ ] Verify the catalog has 92 identities and zero duplicate keys, titles or icon keys.
- [ ] Against a copied database, run migrations twice and verify user, achievement unlock, reward-claim and inventory relation counts are unchanged.
- [ ] Verify production asset references and both child/parent route rendering.

## Task 2: Produce one cumulative patch

**Files:**
- Create only: the folder returned by PowerShell `$patchName = 'starcoin-incremental-patch-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-P4统一成长身份-code-only'` under `临时/`

- [ ] Copy only changed Phase 4 files using their repository-relative paths; do not include `stellar.db`, `node_modules`, secrets, logs or prior patches.
- [ ] Include `REPLACE_FILES.md`, `VERIFICATION.md`, `ROLLBACK.md` and `SHA256SUMS.txt`.
- [ ] State that the newest cumulative Phase 4 package replaces all earlier Phase 4 batches, but does not replace unrelated Phase 1–3 packages.
- [ ] Document server sequence: backup current code/database, copy patch, run `scripts/setup_server_production.bat`, then use `scripts/start_backend_only.bat` for ordinary later restarts.
- [ ] Make health verification accept the configured canonical redirect only if the final target returns HTTP 200; do not treat an arbitrary 301 as healthy.

## Task 3: Production verification and rollback contract

- [ ] Verify child and parent authentication, `/api/child/all-achievements`, `/api/parent/achievements`, `/api/child/growth-identity` and profile customization using non-production test accounts.
- [ ] Check one legacy custom achievement, one unlocked system achievement, one claimed reward and one selected cosmetic.
- [ ] If verification fails, restore previous source/build files and restart backend. Do not delete additive columns/tables and do not restore `stellar.db` unless a separately verified database-corruption incident requires it.
- [ ] Update `LATEST_PATCH_PATH.txt` only after every verification passes.
- [ ] Commit package metadata separately: `git commit -m "P4-6: publish unified growth identity patch"`.

## Task 4: Post-release observation

- [ ] Observe error logs and the five Phase 4 endpoints for one normal usage cycle.
- [ ] Confirm no spike in white screens, 4xx/5xx responses or duplicate achievements.
- [ ] Record any deferred issue without expanding the release scope.
