# Owner decisions (Gene, 2026-09-27 interview)

> Inherited native reference: source dates, release IDs and operating instructions
> retain their original scope. For the current Eden fork use [the index](README.md),
> [STATUS](../STATUS.md) and the Sim runbook; this file is not production authority.


- Production deploys of validated work are allowed ("pre-release, ok to break stuff"). Record previous Worker version for rollback before each deploy.
- Git: local repo at campus-2026-reconstruction/, author genekogan <1335251+genekogan@users.noreply.github.com>. Remote (github.com/genekogan) to be set up by Gene later. Never push without him.
- Any npm libs / Playwright+Chromium / CC0 assets allowed. No account sign-ups.
- Terminology: **upright** = the tall blue frame with two columns (a braced side frame), up to 19 ft; carried/raised as one unit. **beam** = the orange horizontal members.
- Rack component sizes in use: 8 ft, 9 ft, 12 ft, 19 ft (which apply to uprights vs beams to be confirmed against the 2026 catalog; unknowns marked provisional).
- Flagship demo: hypothetical build on open ground in a *fork of 2026* (2-bay, 2-level rack building w/ 2x4 joists, plywood, stairs), clearly labelled non-historical.
- Compute: spend ~50 points of weekly quota over 12–20 h; not front-loaded. Gene's meter said 58% remaining when usage.py read 11% used → hard stop around usage.py week ≈ 61%.
- (2026-09-28) **How Martian floors are made:** builders stand on and climb the rack structure itself while
  staging — uprights' bracing works as a ladder, beams as a walkway — and materials come up by hand-up
  (ground crew lifts, two receivers on the beams take and lay) or by forklift. Nothing above standing reach
  may be interpolated into place. Full requirements: OWNER_FEEDBACK_2026-09-28.md.
- (2026-09-28) Movement quality bar: gradual splined turns; immediate reaction to blocks (no pushing into
  objects for strides); feet on stair treads; animated fire. Same file.
- (2026-09-28) **Build order at Mars:** skeleton first — large tranches of pallet racks raised and connected,
  then 2x4 framing (top plates, rafters, joists) and a 2x4 stair/ramp to the upper level — and only then floors,
  ceilings and walls, gradually, in a logical, ergonomic and safe order. Wood comes as strapped bundles
  (plywood, 2x4, 2x6, other sizes); there is cutting equipment on site; solar panels are their own piles and go
  up last onto roofs. Photos: docs/engineering/evidence/. Headline milestone: replay each year's construction
  from piles to the canonical state (OWNER_FEEDBACK_2026-09-28.md §7–10).

- (2026-09-28 02:20 EDT, **lead decision, overnight — Gene may veto**) **One body model.** The engine's reach envelope (arm 0.75 m,
  overhead 2.1 m, reach-down 1.0 m) and the Quaternius rig (arm 0.44–0.50 m from 1.33 m shoulders, ≈ 1.9 m overhead) disagreed,
  so hand-ups rendered with hanging arms under a sheet nobody could reach. Resolution: a single `engine/body/model.ts`
  (shoulder height, arm length 0.62 m, overhead reach ≈ 2.0 m, reach-down, lean limits) is the source of truth; the rig's arm
  bones are scaled to it once per template; hand-up/items/paint constants import it; a Playwright test pins measured rig reach
  to the model within 2 cm. Anything the model cannot reach is refused by the engine, never interpolated (feedback §5/§6).
- (2026-09-28 04:20 EDT, lead, overnight — Gene may veto) **Body model = the measured rig.** Renderer measurement (W9, three templates
  scaled to 1.75 m): shoulders 1.34 m, arm 0.62 m, overhead 2.00 m (2.06 on heels), kneeling reach-down at a deck edge ≈ 0.35–0.54 m
  below the feet at 0.45 m out. The engine model adopts these (shoulders 1.34, half-width 0.15, reach-down 0.5 m below the feet);
  the spec's "≈ 1.0 m reach-down" is therefore replaced by 0.5 m — hand-offs needing more are refused ("use the forklift").
  Supersedes the reach-down question in PROGRESS.md unless Gene wants a lying-down receiver posture instead.
- (2026-09-29 morning, Gene) **Reach-down:** the 0.5 m kneel rule stands as the default; a **prone receiver** (lying on the
  stomach at the deck edge, then rising to knees and feet while holding the load) is a real Mars practice and is to be modelled
  as a further posture (OWNER_FEEDBACK §13). **Top beams:** two people climb the upright on its cross braces and each holds one
  side of the beam while setting it — the `hang_beam`/stance mechanism is the real method (§14).
- (2026-09-29 ~09:45 EDT, Gene) **External Codex split.** Bounded areas move to an external Codex contributor (not a Claude
  subagent) on `codex/<topic>` branches off main; the Claude lead merges (ff/cherry-pick) after re-gating in a worktree; a Codex
  change that moves a pin is rejected back with the reason. **Codex-owned:** `engine/camera/parse.ts` (+ its tests);
  `app/engine-view/fire.ts` + `e2e/fire.spec.ts`; the paint/solar/equipment mesh files under `app/engine-view/` named by the
  render-polish brief; `docs/engineering/data/**` (2026 grouping output); lint/gate tooling files. **Claude-owned:** everything
  else — locomotion, construction, campus, spatial, body, take (`engine/take/**`), year-build sequencing, studio replay,
  `app/history/scenes.ts`. Never brief Claude workers into Codex areas; never touch `codex/*` except to merge. Codex uses its own
  Vite/Playwright port and artifact/.cloudflare dirs, reports to `docs/engineering/briefs/<brief>.REPORT.md`, never PROGRESS or
  HANDOFF. Guide: `docs/engineering/CODEX.md`; briefs: `briefs/`. Questions for Gene are parked in `QUESTIONS_FOR_GENE.md`
  (non-blocking; not re-surfaced in handoffs).
- (same) **Checkpoint 1** = 2022 complete: phase B landed and pinned, 2x4 framing verbs, all four houses, studio "Watch it being
  built · 2022". No deploy until Gene says so. The 2026 frame grouping is Codex's; Claude takes the integration half once its JSON
  is on a `codex/*` branch.
- (2026-09-29 ~12:00 EDT, Gene) **Deploy bleeding edge to production** (the public Worker link) now, then continue autonomously; Codex
  starts its tranche in parallel. Release protocol unchanged: full gate GREEN at the deployed head, rollback version recorded.
- (2026-09-29 ~13:40 EDT, lead — Gene may veto) **2x4 framing in year replays only where the reconstruction has it.** The framing verbs
  (`install_top_plate` / `install_rafter` / `install_blocking`, FRAMING.md) are landed and gated. The 2022 Kit draws no plates, rafters
  or ceiling joists (roof sheets lie on the top beams; its 10 "roof" features are the kitchen guard rail), so the 2022 replays do not
  sequence framing — adding it would put members in the take that the protected checkpoint lacks and lift the roof deck 13 cm
  (breaking the 1 cm acceptance). Whether the real 2022 roofs had 2x4s under the plywood is parked in QUESTIONS_FOR_GENE.md.
- (2026-09-29 afternoon, Gene §15; sign from evidence by W42) **North bearing.** The 2020 tire ring's long axis (world X)
  runs N–S; the March 4 2020 aerial DJI_0079 (10:10:34 PST, FlightYaw +99.4, sun az 143° / el 43°, shadows NW =
  behind-left of the east-facing camera) fixes the sign: **world −X is north, −Z east** → `NORTH_AZIMUTH_OFFSET = −90`
  (`engine/env/sun.ts`). Construction is untouched by construction of the import graph (only `camera/` and `api/` see
  the sun; `physicalView` excludes env) — tested in `env-sun.test.ts`; perf-walk's 5 pins and all year-build pins green.
  Camera fixtures that named a compass side for a fixed geometry were relabelled to keep their geometry
  (`camera-correct` "group outgrows the frame": south → west; `studio-direct.spec`: east → south); the synth tests now
  derive bearings from the constant. Studio year / take baselines refreshed (shadows rotate; geometry identical). The lab
  uses a fixed key light, not the solar model, so its shadow baselines (2022/2024 top prisms) do not move. **Caveat:** the
  other year frames differ (2026 CAD ≈ −57°, 2025 Kit ≈ 0°, 2022 Kit mirrored, 2024 kitchen/RV side) — QUESTIONS_FOR_GENE
  A3; a per-year bearing is an open follow-up.
- (2026-09-29 evening, Gene — questionnaire answers, verbatim in QUESTIONS_FOR_GENE.md) **2022 reconciliation + build rules:**
  north in the 2022 model is roughly "8 o'clock" of the top-down render (left and slightly down; exact rotation from the solar panels,
  which all face south); the four 2022 buildings are **Huaqiangbei, Cahuilla (right / south), Chatsubo (down), Ba Sing Se (up)** — no
  "Chiba" in 2022; each building's stairs run PARALLEL to the building (wide), not perpendicular; trailers on the left are parked
  nose-to-tail in a train; solar: one row on two buildings, staggered on another, all facing south, on **triangular wood frames ≈ 45°**
  propped on one side with the low edge on the SOUTH roof edge (not a table in the middle); no table at the SW corner (tables are
  incidental); **no trailers under Chiba in 2023/2024** and side trailers must not touch the walls; **floors = orange beams → 2x4
  joists laid across several beams perpendicularly → plywood on the joists** (criss-cross; plywood never directly on beams); strips
  sometimes get a sideways third row (3 ft); **roofs had 2x4 framing as in 2026**; walls outside the beams (as now); materials
  hand-to-hand (as now) but the forklift must stay supported; piles look right; **posts stood directly on the sand → ground datum
  y = 0** (the drawn −0.16 ground is wrong); beam hole pitch and the 9 ft part: unknown (skip).
- (2026-09-29 evening, Gene) **Historical content is Gene's separate job.** In-flight reconstruction workers land at their next natural
  green checkpoint (complete if close; else land green with tests + an explicit "next step" in the area doc) and stop; no new
  reconstruction workers (W52/W53 not started); pins/takes green at that point stay; nothing is re-pinned or re-recorded purely for
  content from here on. `HISTORICAL_CONTENT.md` (per-year state, what each year needs from Gene, the exact re-run recipe, open
  questions) + "Content is parked" banners in RECONCILIATION_2022.md, YEAR_BUILD.md, NEXT_SESSION_PROMPT.md.
- (same) **New goal: last mile to 100 % of SPEC.md + OWNER_FEEDBACK §1–§15, no new features.** Definition of done: every known
  shortcoming / approximate / weak spot / not-done line (HANDOFF, EVIDENCE notes, PROGRESS entries, per-area docs) is FIXED with a test
  or RE-CLASSIFIED as "content" (Gene) or "out of scope by spec" (scanned Martians, electrical) with one sentence why. `LAST_MILE.md`
  lists every item (source, category engine / simulation / controller / renderer / tooling / content / out-of-scope, effort, moves
  pins?), ordered by the lead; run 2–3 workers at a time. Priority: controller (auto replan/rebind on stale, static geometry over MCP
  + region edits stale plans, NL parser → `engine_direct_camera` + studio, directed tracks beside the take via an op, one control path
  for the 20 legacy tools, integration covers every tool) → engine (space-time reservations or a proven ordering, deadlock detector,
  pre-empted social resumes, stand-on-top-beams, solar side stations, mid-raise cancel, install-lift cancel tests, crews on stairs,
  forklift swerve/reverse + 3-vehicle cycles, look-ahead on the shared budget, all movers publish speed, combined camera corrections +
  scene occlusion, per-person body variants, lint to 0 and in the gate) → renderer (talk/watch poses, carry/lift/hold gaps, beam-flange
  feet, item–item collision + lap support, prone phaseK replay exactness) → evidence (every row PROVEN, notes shrunk, HANDOFF
  shortcomings only re-classified).
- (same) **All tests passing, always:** full `npm run gate` GREEN (unit, engine 0 fail + skips → 0 or documented, tsc, e2e, probe,
  lint once green, simulation-integration vs wrangler dev) before EVERY merge to main; pins move only with a PLANNING_BUDGET reason;
  deploy at each green milestone with the release number reported. 2–3 workers, ≤ 50 % of a 5-h window, Codex owns its paths.
