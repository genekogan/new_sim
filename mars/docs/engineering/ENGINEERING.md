# Mars Studio world engine — engineering assessment & plan (living document)

Status: 2026-09-27, overnight tranche in progress. Companion docs: `AUDIT.md`
(observed architecture, file:line refs), `RESEARCH.md` (engine patterns, 12
decision records), `LIB_EVAL.md` (measured library experiments),
`ENGINE_GUIDE.md` (contributor rules), `PROGRESS.md` (log), `OWNER_DECISIONS.md`.

## 1. Current architecture (observed — see AUDIT.md)
- **Rendering/editor**: React 19 + three.js single page (`app/studio/page.tsx`, one ~935-line effect) with
  years 2020–2026. 2026 = CAD-derived GLB (6459 instances; 667 `rack_member` pieces, *no* frame units).
  2020–2025 = procedural `Kit` scenes; component IDs there are build-order serials (fragile).
- **People/EUCs**: Quaternius CC0 humans with only Idle/Walk/Wave clips; browser-local roaming is non-deterministic.
- **Navigation**: 1 m occupancy grid A* (`ambience-math.ts`), unsmoothed zig-zags, no levels/stairs/interiors,
  obstacles = inflated mesh AABBs; server and browser can compute divergent grids.
- **Control plane**: Worker + one SQLite Durable Object per room (per year), 20 MCP tools, capability auth.
  Purely analytic: immutable motion paths + anchored virtual clock; no tick, no input log, no rules version →
  no replay/fork today. Viewers poll at 1 Hz.
- **Build/deploy**: Vite → `deploy/configure.mjs` bundles the MCP worker; R2 for large files; Wrangler deploy.
  Git did not exist; initialised tonight (local only).

## 2. Gaps vs spec (summary)
| Spec area | Before tonight |
| --- | --- |
| Semantic world model (defs / placements / sim state, provenance) | partial (IDs, assemblies, layers; no sim state, no confidence model) |
| Action lifecycle + diagnostics | none (commands mutate state directly) |
| Global planning w/ corridors, levels, stairs | none |
| Local avoidance / yielding | none |
| Crew carrying, assembly/support semantics | none |
| Versioned world (checkpoints, forks, protected canonical) | none |
| Plans bound to baselines, rehearsal, takes, replay | none |
| Camera collision/readability | none (camera must stay above ground only) |
| Automated visual/e2e evidence | none (unit tests only) |

## 3. Preserve
Year scenes + the 2021/2022/2024 photographic corrections (now protected by e2e baselines); recognizable
humans; studio editor/layout/export; Worker auth, year isolation, receipts; analytic "resolve then broadcast"
pattern (it is the right shape for takes); R2/static asset pipeline.

## 4. Target architecture (being built in `viewer/engine/`)
```
            director agent / UI / scripts / tests / MCP
                         │  typed verbs (zod) — one registry
                ┌────────▼────────┐
  WorldHistory ─┤  Runtime (DT=1/20 s, deterministic)      ──► Take (resolved tracks + events + final state)
 (checkpoints,  │   actions: walk_to, carry, raise, connect…│         │
  workspaces,   │   invariants every tick                   │         ├─► Replay (no planner) ─► renderers
  causes)       │   services: Spatial (grids/links/traffic) │         └─► CameraTracks (independent)
                └────────▲────────┘
          SequenceTemplate → BoundPlan(baseline physicalHash, rulesVersion) → rehearse (fork) → execute
```
- **Authority**: the same Runtime runs rehearsal (isolated fork), official execution (Durable Object) and
  previews. The DO resolves submitted actions to a take immediately (simulate faster than real time) and
  broadcasts; viewers sample the take against the anchored clock — the existing analytic pattern, generalised.
  New inputs mid-take re-simulate from the current tick (runtime state is deterministic; see §6 limits).
- **Canonical years** are protected workspaces in `WorldHistory`; edits require forks; causes distinguish
  `reconstruction-edit` vs `design-edit` vs `simulation-run`.

## 5. Library decisions (evidence: LIB_EVAL.md, RESEARCH.md)
| Problem | Decision | Why |
| --- | --- | --- |
| Human global paths, levels, construction changes | **Bespoke** multi-level raster + exact EDT clearance + A* with stair links (`spatial/`) | Pure TS (runs in DO without WASM), per-query radius, exact clearance guarantee (Recast paths came within 0.17–0.25 m of walls for r=0.28), named blockers in diagnostics; 31 ms build / 46 ms long route on proving ground |
| Campus-scale fallback | Recast TileCache fed from *semantic* obstacles/surfaces (not render GLB) if raster rebuild > ~0.5 s | Recast: 4.4 s whole-campus build from raw triangles but µs queries, 0.3 ms obstacle updates |
| Local avoidance | **Bespoke** traffic resources + right-of-way + lateral passing offset | Detour Crowd deadlocked permanently in the 1 m corridor |
| Carried loads | **Bespoke** hybrid-A* over (x, z, θ) on the clearance grid, swept checks | No library models crew+load formations |
| Collision validation | Exact 2D OBB/prism tests now; Rapier deterministic build only if 3D sweeps become necessary | Rapier works (3 µs casts) but needs WASM precompile wrapper for Workers |
| Camera rays in browser | three-mesh-bvh optional later; engine uses obstacle prisms | 62 KB, fast OBB queries |

## 6. Integration strategy
1. Engine grows beside the studio (no rewrite). `/lab` route renders the engine live on the proving ground.
2. Studio adapter: engine humans replace browser-local roaming when a scene/take is active; the studio keeps
   rendering, editor and year scenes.
3. Campus extraction: build `SpatialScene` for 2026/history from existing catalog scripts (obstacle prisms,
   walkable decks, stairs as links) — explicit, provenance-tagged; unknown interiors stay non-walkable.
4. DO: add engine-backed tools (world query, submit plan, rehearse, execute, take fetch) generated from the
   same registry; keep existing 20 tools working (compat layer) until superseded.

## 7. Risks
- Campus-scale raster cost (area ~200×200 m at 0.1 m → 4 M cells/level); mitigate with 0.15–0.2 m ground
  cells + local 0.1 m refinement or Recast fallback.
- DO CPU limits for long takes → resolve in chunks; cap take length.
- Historical ID instability in procedural scenes → introduce stable semantic IDs before binding plans to them.
- Visual quality regressions (humans, lighting) → e2e baselines + manual review of captures.
- Determinism across JS engines (Math.sin etc.) → takes store resolved motion so replay never re-simulates.

## 8. Testing strategy
Layered: engine unit/scenario tests (`npm run test:engine`), deploy tests (`npm test`), Playwright e2e with
baselines/videos (`npm run e2e`), invariant violations recorded per tick, evidence reports per milestone.

## 9. Milestones (spec §30) — status
| | Milestone | Status |
| --- | --- | --- |
| A | Audited foundation, git, proving ground | done (AUDIT, git, e2e harness, proving ground) |
| B | Natural individual movement | core done (walls, U-trap, passage yielding, stairs, levels, construction replans: 23 tests); lab visuals in progress |
| C | Coordinated carry | in progress |
| D | Supported rack bay | next (depends on C) |
| E | Progressive construction | planned |
| F | Rehearsal + official execution | in progress |
| G | Replay + branching | in progress (history store done; takes in progress) |
| H | Inhabited scenes | deferred beyond this tranche except existing activities |

## 10. Deferred (explicit)
Full rigid-body dynamics; electrical simulation; timeline editor UI; automatic branch merge; real-person
scans; mid-action resumable forks for arbitrary actions (subset only, documented when built); loads on stairs;
forklift (only if time permits after assembly).

## Decision log
- 2026-09-27: engine is pure TS, zod-only, strip-types compatible; DT = 1/20 s.
- 2026-09-27: "upright" = two-column braced frame (Gene); stock frames 8/12/16/19 ft; 9 ft unverified.
- 2026-09-27: obstacles rasterize conservatively (touching cells), floors by cell centre (thin panels were being lost).
- 2026-09-27: single-file passages are per-direction traffic resources (direction by travel vector, not entry position).
