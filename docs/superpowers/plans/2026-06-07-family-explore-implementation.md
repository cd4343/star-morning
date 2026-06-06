# Family Explore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of Family Explore so parents can discover/add places and children can view, check in, and leave photo/voice/text memories without affecting coins or game tickets.

**Architecture:** Keep the existing Express/SQLite/React architecture. Add three SQLite tables for places, check-ins, and media; add protected parent/child REST routes in `backend/src/server.ts`; add two lazy-loaded React pages and a new child bottom-nav entry. Media is uploaded as base64 JSON and stored under `uploads/explore` to avoid introducing a new server dependency in this release.

**Tech Stack:** Express, SQLite, React, TypeScript, Tailwind, existing `api` service, browser `MediaRecorder`, browser `FileReader`, optional AMap Web Service API through `AMAP_WEB_SERVICE_KEY`.

---

### Task 1: Data Model

**Files:**
- Modify: `backend/src/database.ts`

- [ ] Add `explore_places`, `explore_checkins`, and `explore_media` tables in `createTables()`.
- [ ] Add indexes for family, child, place, and check-in lookup.
- [ ] Keep migration idempotent with `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
- [ ] Verify with `npm run build` in `backend`.

### Task 2: Backend Routes

**Files:**
- Modify: `backend/src/server.ts`

- [ ] Add helpers for explore category/status normalization, safe base64 upload saving, and AMap POI mapping.
- [ ] Add parent routes:
  - `GET /api/parent/explore/search`
  - `GET /api/parent/explore/places`
  - `POST /api/parent/explore/places`
  - `PUT /api/parent/explore/places/:id`
  - `DELETE /api/parent/explore/places/:id`
  - `GET /api/parent/explore/checkins`
  - `POST /api/parent/explore/checkins/:id/confirm`
- [ ] Add child routes:
  - `GET /api/child/explore/places`
  - `GET /api/child/explore/places/:id`
  - `GET /api/child/explore/checkins`
  - `POST /api/child/explore/checkins`
  - `POST /api/child/explore/checkins/:id/media`
- [ ] Serve uploaded explore files from `/uploads/explore` using random filenames.
- [ ] Verify with `npm run build` in `backend`.

### Task 3: Achievement Integration

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `frontend/src/pages/parent/ParentAchievements.tsx`

- [ ] Add achievement condition support:
  - `explore_checkin_count`
  - `explore_category_count`
  - `explore_media_count`
  - `explore_voice_count`
  - `explore_confirmed_count`
- [ ] Trigger achievement checking after child check-in, media upload, and parent confirmation.
- [ ] Add default parent achievement templates under category `探索`.
- [ ] Keep default rewards at zero coins and no game tickets.

### Task 4: Child Explore Page

**Files:**
- Create: `frontend/src/pages/child/ChildExplore.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/child/ChildLayout.tsx`

- [ ] Add lazy route `/child/explore`.
- [ ] Add child bottom-nav item `探索`.
- [ ] Build place list, category filter, detail view, check-in form, photo upload, voice recording, and recent footprints.
- [ ] Keep the check-in flow compact and child-friendly.

### Task 5: Parent Explore Page

**Files:**
- Create: `frontend/src/pages/parent/ParentExplore.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/parent/ParentDashboard.tsx`

- [ ] Add lazy route `/parent/explore`.
- [ ] Add parent dashboard entry `家庭探索`.
- [ ] Build search/manual-add tabs, place list, edit drawer, check-in review list, and parent confirmation.
- [ ] Show AMap setup hint when search is unavailable.

### Task 6: Verification and Handoff

**Files:**
- Modify as needed: docs or release notes only if the implementation needs deployment notes.

- [ ] Run `npm run build` in `backend`.
- [ ] Run `npm run lint` in `frontend`.
- [ ] Run `npm run build` in `frontend`.
- [ ] Verify new database migration on a temporary fresh database.
- [ ] Verify old-database migration on a temporary database with no explore tables.
- [ ] Commit implementation.
- [ ] Prepare a code-only incremental package if requested.
