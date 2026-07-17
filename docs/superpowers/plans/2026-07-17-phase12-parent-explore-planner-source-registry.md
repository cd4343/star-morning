# Phase 12 Parent Explore Planner and Trusted Source Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the parent Explore long-form discovery flow with a 20-second planner that returns only recent, source-backed places or activities and preserves every existing Explore workflow.

**Architecture:** Add append-only SQLite tables for source metadata, evidence, and privacy-safe coverage runs; keep parsing, verification, ranking, and HTTP routing in focused backend modules. The React page keeps its existing plan, record, check-in, media, and statistics flows, while the discovery area moves into focused components backed by one hook. The first source catalog contains only the already-integrated Amap provider; official links and family sources enter results only after the existing public-network and completeness checks pass.

**Tech Stack:** Node.js, Express, TypeScript, SQLite, Axios, React 18, Vite, Tailwind CSS, i18n, Vitest, Playwright, PowerShell.

---

## File map

- Create `backend/src/exploreSourceCatalog.ts`: versioned trusted-source catalog, health state, idempotent synchronization.
- Create `backend/src/exploreDiscoveryRules.ts`: deterministic text parsing, freshness gates, field authority, deduplication, and integer ranking.
- Create `backend/src/exploreDiscoveryRoutes.ts`: authenticated planner endpoints, Amap/local-source orchestration, evidence writes, privacy-safe run records.
- Create matching `*.test.ts` files for all new backend rules.
- Modify `backend/src/database.ts`: append-only Phase 12 schema and catalog sync.
- Modify `backend/src/exploreFeed.ts`: export the existing safe link-preview function; keep old routes unchanged.
- Modify `backend/src/server.ts`: register routes and maintenance scheduler only.
- Modify `backend/src/operationsReport.ts` and its test: aggregate source health and discovery coverage without raw queries.
- Extend `frontend/src/types/explore.ts`: shared planner request/response contracts.
- Create `frontend/src/hooks/useExploreDiscovery.ts`: planner API state, cancellation, partial and error handling.
- Create `frontend/src/components/explore/ExplorePlannerForm.tsx`, `ExplorePlannerResults.tsx`, and `ParentExploreDiscovery.tsx`: focused 375px-first UI.
- Modify `frontend/src/pages/parent/ParentExplore.tsx`: default to Discover, mount the new view, retain legacy source/manual tools under Advanced.
- Modify `frontend/src/i18n/locales/zh-CN.ts`: all new visible copy.
- Modify Playwright smoke tests for the new parent flow and existing child/plan/record regressions.

### Task 1: Add append-only source, evidence, and discovery-run storage

**Files:**
- Create: `backend/src/exploreSourceCatalog.ts`
- Create: `backend/src/exploreSourceCatalog.test.ts`
- Modify: `backend/src/database.ts:200-340`

- [ ] **Step 1: Write a failing in-memory migration/catalog test**

```ts
it('syncs the vetted catalog idempotently without inventing official sources', async () => {
  await createPhase12ExploreSchema(db);
  await syncExploreSourceCatalog(db, new Date('2026-07-17T04:00:00.000Z'));
  await syncExploreSourceCatalog(db, new Date('2026-07-17T05:00:00.000Z'));
  const rows = await db.all('SELECT source_key, trust_tier, authority_fields_json FROM explore_source_registry');
  expect(rows).toEqual([{ source_key: 'amap-poi', trust_tier: 'A', authority_fields_json: '["title","address","latitude","longitude","category","imageUrl"]' }]);
});
```

- [ ] **Step 2: Run the test and confirm it fails because the module does not exist**

Run: `cd backend; npx vitest run src/exploreSourceCatalog.test.ts`

Expected: FAIL with an unresolved `exploreSourceCatalog` import.

- [ ] **Step 3: Add the exact append-only schema**

Add `CREATE TABLE IF NOT EXISTS` statements for `explore_source_registry`, `explore_feed_item_evidence`, and `explore_discovery_runs`; add indexes on `(is_enabled, health_status)`, `(feed_item_id, evidence_status)`, and `(created_at, result_count)`. Add `verified_at`, `fresh_until`, and `verification_level` to `explore_feed_items` only after checking `PRAGMA table_info(explore_feed_items)`. Use snake_case for every new database column and never update historic rows to a verified state.

```ts
export const TRUSTED_SOURCE_CATALOG = [{
  sourceKey: 'amap-poi', label: '高德地点', sourceType: 'poi_provider' as const,
  trustTier: 'A' as const, baseUrl: 'https://restapi.amap.com',
  authorityFields: ['title', 'address', 'latitude', 'longitude', 'category', 'imageUrl'],
  refreshMinutes: 43_200,
}];
export const EXPLORE_SOURCE_CATALOG_VERSION = '2026-07-17.1';
```

- [ ] **Step 4: Implement and invoke `syncExploreSourceCatalog(db, now)`**

Use one parameterized `INSERT INTO explore_source_registry` statement with `ON CONFLICT(source_key) DO UPDATE` for catalog-owned label/type/tier/base URL/authority/refresh/version fields. Preserve runtime health timestamps and failure counters. Call it after the Phase 12 tables exist in `initializeDatabase()`.

- [ ] **Step 5: Verify idempotency and commit**

Run: `cd backend; npx vitest run src/exploreSourceCatalog.test.ts; npm run build`

Expected: the focused test and TypeScript build pass.

Commit: `P12A-1: add trusted explore source storage`

### Task 2: Implement deterministic intent parsing and reliable ranking rules

**Files:**
- Create: `backend/src/exploreDiscoveryRules.ts`
- Create: `backend/src/exploreDiscoveryRules.test.ts`

- [ ] **Step 1: Define the contracts before implementation**

```ts
export type ExplorePlannerRequest = {
  childId?: string; customText?: string; city: string; districtScope?: string[];
  datePreset?: 'today' | 'weekend' | 'next-week' | 'custom'; dateFrom?: string; dateTo?: string;
  objective?: 'energy' | 'knowledge' | 'hands-on' | 'family'; budgetMax?: number;
  indoorPreference?: 'indoor' | 'outdoor' | 'any'; experienceKeys?: string[];
};
export type UnsupportedConstraint = 'crowd' | 'route_time' | 'transit_convenience';
export type ParsedExploreIntent = {
  hardConditions: { city: string; districtScope: string[]; dateFrom?: string; dateTo?: string; budgetMax?: number; indoorPreference: 'indoor' | 'outdoor' | 'any'; explicitPlace?: string; officialUrl?: string };
  preferences: { queryText: string; objective?: ExplorePlannerRequest['objective']; experienceKeys: string[] };
  unsupported: UnsupportedConstraint[];
};
```

- [ ] **Step 2: Write failing tests for dates, money, URLs, unsupported claims, hard-condition refusal, dedupe, expiry, and score weights**

Assert that `周末想去浦东室内做手工，预算100元，人少，车程30分钟，https://example.com/a` produces a weekend date range, `budgetMax: 100`, `indoor`, the URL, `handcraft`, and unsupported `crowd` plus `route_time`. Assert unknown words remain in `queryText`. Assert expired evidence and equal-tier critical conflicts are rejected. Assert scores equal `experience*40 + objective*20 + date*15 + budget*10 + district*10 + freshness*5` using integer 0/1 matches.

- [ ] **Step 3: Run the tests and confirm rule functions are missing**

Run: `cd backend; npx vitest run src/exploreDiscoveryRules.test.ts`

Expected: FAIL on missing exports.

- [ ] **Step 4: Implement minimum deterministic rules**

Use `getLocalDateString` from `backend/src/beijingTime.ts`; cap custom text at 160 characters, districts at 5, experience keys at 2, and generated queries at 4. Recognize today/weekend/next-week, Arabic or common Chinese integer amounts, public HTTP(S) URL, indoor/outdoor, and the keywords already held in `EXPLORE_EXPERIENCE_GROUPS`. Never infer crowd, route time, transport convenience, price, opening time, or age suitability from absent source fields.

Apply field authority exactly as follows: S controls activity dates, signup, tickets, and temporary changes; A controls POI name, address, coordinates, category, and provider image; B can discover candidates but cannot verify activity dates or prices; family evidence stays inside its family. Reject unresolved equal-tier conflicts on a critical field. Set freshness to 6 hours for activity/date evidence, 24 hours for opening/price evidence, and 30 days for stable POI evidence.

- [ ] **Step 5: Verify and commit**

Run: `cd backend; npx vitest run src/exploreDiscoveryRules.test.ts; npm run build`

Expected: all focused rule tests and build pass.

Commit: `P12A-2: add deterministic explore discovery rules`

### Task 3: Add authenticated preview and trusted search endpoints

**Files:**
- Create: `backend/src/exploreDiscoveryRoutes.ts`
- Create: `backend/src/exploreDiscoveryRoutes.test.ts`
- Modify: `backend/src/exploreFeed.ts:50-170`
- Modify: `backend/src/server.ts:35-45,1563-1570,4618-4678`

- [ ] **Step 1: Write failing service tests with injected provider and clock**

Cover parent-family child validation and server-side age derivation from the selected child; maximum four provider queries; one POI deduplicated across Amap and a fresh local item; incomplete, expired, wrong-city, age-incompatible, over-budget-known-price, and conflicting candidates removed; one or two reliable results returned without padding; raw custom text absent from `explore_discovery_runs`.

- [ ] **Step 2: Export the existing network-safe preview and image cache as narrow functions**

Expose `previewTrustedExploreLink(url)` and `cacheTrustedExploreImage(url, familyId)` from `exploreFeed.ts`; they must continue to apply DNS/private-IP rejection, three-redirect limit, 8-second timeout, 2MB HTML limit, image MIME/1MB checks, and existing Explore upload storage. Do not duplicate those security functions or return an unvalidated remote image URL.

- [ ] **Step 3: Implement the search service contract**

```ts
export type ExploreDiscoveryCandidate = {
  id?: string; sourceKey: string; sourceUrl: string; trustTier: 'S' | 'A' | 'B' | 'family';
  type: 'poi' | 'activity'; title: string; summary: string; imageUrl: string;
  category: string; city: string; district?: string; address?: string; venue?: string;
  latitude?: number; longitude?: number; activityStart?: string; activityEnd?: string;
  priceAmount?: number; experienceKeys: string[]; verifiedAt: string; freshUntil: string;
  authorityFields: string[];
};
export interface PoiSearchProvider {
  search(input: { city: string; query: string; signal: AbortSignal }): Promise<ExploreDiscoveryCandidate[]>;
}
export type ExploreDiscoveryResult = ExploreDiscoveryCandidate & {
  id: string; trustLabel: string; matchedReasons: string[];
  recommendationRole: 'primary' | 'alternative';
};
export type ExploreDiscoveryResponse = {
  parsed: ParsedExploreIntent;
  results: ExploreDiscoveryResult[];
  adjustments: Array<'date' | 'district' | 'budget'>;
  partial: boolean;
  message: string;
};
export type SearchExploreDiscovery = (
  db: Database, request: ExplorePlannerRequest,
  context: { familyId: string; now: Date; searchPoi: PoiSearchProvider; previewLink: typeof previewTrustedExploreLink }
)=> Promise<ExploreDiscoveryResponse>;
```

`PoiSearchProvider` returns only source fields and evidence; Amap candidates receive 30-day POI freshness and their images pass through `cacheTrustedExploreImage`. Existing local items enter only when they have active evidence and unexpired `fresh_until`. Explicit links are previews until complete and verified; incomplete previews become parent-only pending review, never planner results. Recheck source reachability and activity validity for final candidates before returning them. When both kinds survive the gates, select one place and one activity before filling the last slot by score. Save field evidence and item updates in one SQLite transaction. Give the whole request a 12-second deadline, never persist API keys or raw custom text, return verified partial results when a provider times out, and never auto-register an input domain in the system catalog.

- [ ] **Step 4: Register both protected parent routes**

Register `POST /api/parent/explore/discovery/preview-intent` and `POST /api/parent/explore/discovery/search` with `protect` and `requireParent`. Validate the optional `childId` using `users.id + familyId + role='child'`. Use HTTP 400 for invalid input, 404 for foreign/missing child, and 503 only when no verified partial result exists after provider failure.

Extend the existing `POST /api/parent/explore/places` body with optional `sourceFeedId`. Resolve it by `id + familyId`, require ready/unexpired evidence, copy only source-backed fields, and return the existing place when the same family already has that `sourceFeedId`. This makes double taps idempotent without adding a new URL.

- [ ] **Step 5: Verify and commit**

Run: `cd backend; npx vitest run src/exploreDiscoveryRoutes.test.ts src/exploreFeed.test.ts; npm run build`

Expected: route-service, legacy feed isolation, and build pass.

Commit: `P12A-3: add trusted parent explore discovery APIs`

### Task 4: Add source maintenance and privacy-safe coverage reporting

**Files:**
- Modify: `backend/src/exploreSourceCatalog.ts`
- Modify: `backend/src/exploreSourceCatalog.test.ts`
- Modify: `backend/src/server.ts:7702-7708`
- Modify: `backend/src/operationsReport.ts`
- Modify: `backend/src/operationsReport.test.ts`

- [ ] **Step 1: Write failing maintenance/report tests**

Assert three consecutive source failures set `health_status='degraded'`, one success restores `healthy`, discovery runs older than 90 Beijing-calendar days are deleted, and the report exposes only aggregate source/result counts. Assert serialized output excludes `customText`, URLs, child IDs, family IDs, item titles, coordinates, and source error bodies.

- [ ] **Step 2: Implement `runExploreDiscoveryMaintenance(db, now, probe)`**

Probe enabled catalog providers at most once per 24 hours, update only health counters/timestamps, and delete expired discovery-run rows. Start it 15 seconds after boot and every 24 hours; catch and log one concise scheduler error without stopping the backend.

- [ ] **Step 3: Extend the report**

Set `reportVersion` to `phase12-operations-v2`. Add enabled/healthy/degraded source counts, total/zero/partial discovery runs, integer average result count, and zero-result buckets grouped by normalized city plus experience key. Never emit individual runs or raw parent input.

Generate the same seven-day aggregate once per Beijing week and overwrite only `logs/explore-source-coverage-latest.json`; do not create dated report files. The scheduler never edits the source catalog. Operators add or disable a vetted catalog entry in code and ship it in a code-only patch.

- [ ] **Step 4: Verify and commit**

Run: `cd backend; npx vitest run src/exploreSourceCatalog.test.ts src/operationsReport.test.ts; npm test; npm run build`

Expected: all backend tests run with no skips and build passes.

Commit: `P12C-1: add explore source health and coverage metrics`

### Task 5: Add typed planner state and focused mobile components

**Files:**
- Modify: `frontend/src/types/explore.ts`
- Create: `frontend/src/hooks/useExploreDiscovery.ts`
- Create: `frontend/src/components/explore/ExplorePlannerForm.tsx`
- Create: `frontend/src/components/explore/ExplorePlannerResults.tsx`
- Create: `frontend/src/components/explore/ParentExploreDiscovery.tsx`
- Modify: `frontend/src/i18n/locales/zh-CN.ts`

- [ ] **Step 1: Mirror the backend request/parsed/response types exactly**

Use camelCase API fields and the exact unions from Task 2. Extend result items with `trustLabel`, `verifiedAt`, and `matchedReasons`; do not add a free-form “AI summary” field.

- [ ] **Step 2: Implement `useExploreDiscovery`**

Expose `draft`, `setDraft`, `preview()`, `search()`, `cancel()`, `parsed`, `results`, `adjustments`, `partial`, `loading`, and `error`. Cancel the previous Axios request when a new search begins. Preserve draft text after errors. Treat a successful zero-result response as a reliable empty state, not a transport error.

- [ ] **Step 3: Build the 20-second planner form**

Display optional custom input, current child selections (maximum two), date, goal, city/district, budget, and indoor/outdoor quick choices. Add a low-emphasis “识别这句话” action and one visually dominant “查找可靠方案” action. After preview, render editable verified-condition chips, preference chips, and unsupported chips; never label unsupported crowd/route statements as applied. Use typed city/district choices only and never call `navigator.geolocation`.

- [ ] **Step 4: Build result and empty states**

Render at most one primary plus two alternatives, each with valid image, place/activity tag, verified location/date, source freshness label, matched reason, “加入家庭计划”, and “推荐给孩子看看”. For one or two results, show exactly those results. For zero results, show one adjustment action selected from backend `adjustments`. Keep every target at least 44px and avoid hover-only behavior.

- [ ] **Step 5: Add every new visible string under `explore.planner.*` and build**

Run: `cd frontend; npm run build`

Expected: TypeScript and Vite production build pass with no missing i18n keys.

Commit: `P12B-1: add parent explore planner components`

### Task 6: Integrate the planner without removing existing Explore functions

**Files:**
- Modify: `frontend/src/pages/parent/ParentExplore.tsx:1-180,700-850,1074-1498`

- [ ] **Step 1: Make Discover the default tab and mount `ParentExploreDiscovery`**

Remove discovery-only local state and handlers now owned by the hook. Keep plan, records, check-in approval, voice/media, timeline, statistics, geocoding, photo requirement, and child-intent settings unchanged.

- [ ] **Step 2: Connect result actions to existing APIs**

“加入家庭计划” posts the source-backed title/category/city/address/coordinates/summary and `sourceFeedId` to the existing place flow, then refreshes places and moves to Plan. “推荐给孩子看看” uses the existing feed approval/publish flow and refreshes feed settings. Disable a button while its request is in flight so repeat taps remain idempotent.

- [ ] **Step 3: Move legacy tools under one Advanced disclosure**

Keep family feed sources, source suggestions, manual POI search, long push editor, enrichment retry, and feed settings accessible under “高级设置 / 我的关注源 / 手动补充”. Do not display the system source registry. Do not delete old APIs, database rows, or form capabilities.

- [ ] **Step 4: Build and commit**

Run: `cd frontend; npm run build`

Expected: production build passes and `ParentExplore.tsx` no longer owns planner parsing/search state.

Commit: `P12B-2: integrate trusted explore planning flow`

### Task 7: Encode the mobile and regression acceptance contract

**Files:**
- Modify: `frontend/tests/smoke/navigation.spec.ts`
- Create: `frontend/tests/smoke/phase12-parent-explore-planner.spec.ts`

- [ ] **Step 1: Mock both Phase 12 APIs with source-backed data**

Add a preview response containing hard/preference/unsupported groups and search fixtures for three results, two results, zero results, and a 503 failure. Mock the existing place POST and feed publish endpoints without changing child Explore mocks.

- [ ] **Step 2: Add 375px end-to-end cases**

At `375x812`, verify custom text survives preview, unsupported “人少/车程” is not applied, only one primary CTA is visually emphasized, two reliable cards are not padded, zero results exposes one adjustment, duplicate taps create one plan request, and no horizontal overflow occurs.

- [ ] **Step 3: Preserve existing workflows in smoke coverage**

Keep assertions for Discover, Plan, Records, check-in approval, media/timeline, statistics/settings access, child intent selection, and child recommendation cards. Update selectors only where the approved layout changed.

- [ ] **Step 4: Run all checks without skips**

Run: `cd frontend; npm run build; npx playwright test tests/smoke/phase12-parent-explore-planner.spec.ts tests/smoke/navigation.spec.ts --config=playwright.config.ts; npm run test:smoke; npm run test:production`

Expected: build, focused tests, full smoke, and production-page tests all pass. If the production test environment is unavailable, stop and report the blocker instead of marking this task complete.

Commit: `P12-1: verify parent explore planning on mobile`

### Task 8: Validate, package one cumulative patch, and publish

**Files:**
- Create: `docs/PHASE12_DEPLOYMENT.md`
- Create: `临时/starcoin-incremental-patch-YYYYMMDD-HHMMSS-P12家长探索规划器与可信信源累计-code-only/`
- Modify: `临时/LATEST_PATCH_PATH.txt`

- [ ] **Step 1: Run repository-wide validation**

Run: `cd backend; npm test; npm run build`

Run: `cd frontend; npm run build; npm run test:smoke; npm run test:production`

Run from project root: `powershell -ExecutionPolicy Bypass -File scripts/deploy_server_production.ps1 -ValidateOnly`

Expected: no failed or skipped checks; staged deployment verification passes without touching the running service or database.

- [ ] **Step 2: Create the new cumulative package without changing history**

Read `临时/LATEST_PATCH_PATH.txt`, copy that existing cumulative directory to a new timestamped directory, then overlay tracked files changed after commit `5332c56`. Regenerate `REPLACE_FILES.md`, `ROLLBACK.md`, `VERIFICATION.md`, and `SHA256SUMS.txt`; zip the new directory. Exclude `stellar.db*`, `node_modules`, `uploads`, `backups`, logs, secrets, `.tmp`, untracked user files, and old package directories.

- [ ] **Step 3: Document deployment and rollback**

State that the server merges `backend`, `frontend`, `scripts`, and `docs`, then runs `scripts\deploy_server_production.bat`; normal later restarts still use `scripts\start_backend_only.bat`. Rollback restores the release backup produced by the deployment script. Database rollback is not performed because migrations are append-only and old code ignores the new tables/columns.

- [ ] **Step 4: Verify package contents and pointer**

Confirm `LATEST_PATCH_PATH.txt` points to the new directory; confirm neither directory nor zip contains a database, dependencies, uploads, logs, or `production_env.local.bat`; confirm checksums match.

- [ ] **Step 5: Commit and push**

Commit: `P12-2: release trusted parent explore planning`

Run: `git push -u origin codex/phase9-10-reward-explore`

Expected: GitHub accepts the current branch after all local validation passes.
