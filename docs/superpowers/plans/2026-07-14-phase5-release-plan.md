# Phase 5 Release and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify, package, publish and production-accept Phase 5 as one reversible release.

**Architecture:** Source commits remain independently reversible. A new code-only patch copies only tracked files changed since the Phase 4 baseline and includes replacement, rollback, verification and SHA-256 manifests; historical patches and `stellar.db` remain untouched.

**Tech Stack:** Git, npm, TypeScript, Vitest, Playwright, PowerShell, GitHub SSH

---

### Task 1: Full local verification

**Files:**
- Modify only test files required to correct a demonstrated coverage gap

- [ ] Run `npm test` and `npm run build` in `backend`; record every test count and any skipped test.
- [ ] Run `npm run build` in `frontend`.
- [ ] Run the targeted Phase 5 smoke specs, then the complete `npm run test:smoke` suite.
- [ ] Start the production-shaped local stack and verify Today detail/target/return plus Explore Discover/Plan/Records at 375px with console checks and screenshots outside the repository.
- [ ] Run `git diff --check` and review `git diff --stat` plus every changed file.

### Task 2: Create the incremental patch

**Files:**
- Create: a new Phase 5 directory under `临时/` using the P6 Beijing-time naming rule
- Create inside patch: `REPLACE_FILES.md`, `ROLLBACK.md`, `VERIFICATION.md`, `SHA256SUMS.txt`
- Modify: `临时/LATEST_PATCH_PATH.txt`

- [ ] Copy only changed code, tests, docs and built `backend/dist` / `frontend/dist` paths needed by the established server deployment flow.
- [ ] Exclude `stellar.db`, WAL/SHM, `.env*`, `node_modules`, logs, uploads and all historical patch directories.
- [ ] Document exact relative replacement paths and the established `setup_server_production.bat` deployment command.
- [ ] Document rollback to the immediately previous Phase 4 files and verify every SHA-256 line.
- [ ] Commit as `P5-R: publish action loop and Explore workbench patch`.

### Task 3: GitHub and production acceptance

**Files:**
- No source edits unless verification exposes a defect; any defect receives its own commit and a regenerated patch.

- [ ] Confirm `git status --short` contains only known user-owned untracked files.
- [ ] Push `codex/phase5-action-loop-explore-workbench` by SSH and verify the remote commit equals local `HEAD`.
- [ ] Deploy the new patch without replacing `stellar.db`; run the production verification script and HTTP/API health checks.
- [ ] Verify production child and parent accounts on the real domain at 375px, including console health and no blank page.
- [ ] Record the exact patch path, commit SHA, verification results and any untested external dependency.
