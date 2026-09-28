# Takeover prompt — Mars College 3D Studio / world engine

Paste the block below as the first message of a new Claude Code session opened in
`~/Mars` (or `<mars-campus-repo>`). Everything it references is in the repo.

---

You are taking over the Mars College 3D Studio simulation-engine work from a previous session that
ended at a clean checkpoint on 2026-09-28. You are running OVERNIGHT and unattended: Gene (the owner) is
asleep and cannot answer questions or report usage numbers until morning. Work as the lead: you evaluate
and collate; delegate narrow, well-bounded tasks to Opus 5.5 subagents. Every subagent brief must name
the files it owns and the files other agents own, require small tool calls and early commits, and forbid
host `Math.sin/cos/atan2…` in `viewer/engine/**`. Never brief a Claude worker into a Codex-owned path
(`docs/engineering/CODEX.md` §6), and never touch a `codex/*` branch except to merge it.

**Self-manage usage so you are never cut off by the 5-hour limit.** Nobody will report numbers to you
and `<usage-tool>` does not track this session, so budget by your own accounting:
- Target: spend roughly **50 % of each 5-hour window** overnight, so the session never hits the cap.
  Measured on 2026-09-28: one Opus subagent task of the usual size costs 150–300k subagent tokens and
  runs 10–30 minutes; six in parallel exhausted a full 5-hour window in about two hours. So overnight run
  **2–3 subagents at a time, never more**, and keep your own turns short (evaluate reports, don't
  re-derive their work).
- Keep a running tally in PROGRESS.md: for every subagent that finishes, note its reported token cost
  and the wall-clock time. If the sum since the last window boundary exceeds ~1.5 M subagent tokens per
  hour, drop to 2 workers; above ~2 M, drop to 1 and let it land. Window boundaries: assume windows
  start when you start; note the start time in PROGRESS.md.
- A 429 "session limit" error on any tool call means the window is exhausted: immediately stop
  spawning, let nothing new start, and write the checkpoint (below). Do not retry in a loop.
- Every ~2 hours, and always before you think a window may close: land what is running (each agent
  commits at its next green point), regenerate EVIDENCE.md, append PROGRESS.md, and update this file and
  HANDOFF.md so that a cut-off at any moment leaves a clean, resumable tree. Never let a limit catch
  agents mid-write — that is exactly what happened at 20:00 on 2026-09-28 and it cost an hour.
- In the morning Gene may raise the parallelism (he will say so and report numbers); until he does,
  the overnight rule stands.

**Decision rule:** anything that needs Gene (a reconstruction question, a product choice, a doubt about
historical truth) is appended to `docs/engineering/QUESTIONS_FOR_GENE.md` as a block: what the engine sees,
a picture, what the answer changes, and an empty `Gene:` line. Then skip it and pick the next item that doesn't
need him. Those questions are parked and non-blocking: do not re-surface them in handoffs or reports. Never
guess historical facts.

**Read in this order before doing anything:**
1. `docs/engineering/HANDOFF.md` — state of the system, evidence, releases, known shortcomings, next tranche.
2. `docs/engineering/CODEX.md`: the external Codex split, the ownership map and the merge protocol.
   `docs/engineering/ENGINE_GUIDE.md`: hard rules for engine code (strip-types TS, zod only, DT = 1/20 s,
   deterministic trig from `core/math.ts`, fail loudly, canonical entity order) and the commit protocol.
3. `docs/engineering/PROGRESS.md` (last three entries), `EVIDENCE.md` (what is proven vs approximate),
   `REVIEW.md` (open low findings), `OWNER_DECISIONS.md`.
4. Per area as needed: CARRY, PROGRESSIVE, SOCIAL, VEHICLES, CAMERA + CAMERA_VERIFY, TAKES_AND_PLANS
   (resumability), CAMPUS_SCENE, HISTORY_IDS, PLANNING_BUDGET, DIRECTOR_DEMO, RELEASE_CHECKLIST.

**Ground truth at the checkpoint (end of the overnight session, 2026-09-28 ~08:45 EDT; verify, don't assume):**
- Repo: local git only at `<mars-campus-repo>` (author genekogan; no remote yet —
  Gene adds github.com/genekogan; never push without him). HEAD = the W26 docs commit after the gated `1395dd4` (~315 commits). W13 (year build phase B) may still
  have unstaged files in the main tree (`engine/campus/**`, `construction/**`, `scenarios/year-build.ts`, `test/year-build-b.test.ts`,
  `YEAR_BUILD.md`): they are W13's, not debris. Production = release 5 (`cebd5827…`, rollback `89e65c8c…`); nothing deployed overnight.
- Gates: `cd viewer && npm run gate` — last green 2026-09-28 (W26, `1395dd4`, worktree): unit 56, engine 358 pass / 0 fail / 3 skip of 361, tsc clean, Playwright 61 passed / 1 skipped, determinism probe `b746b0947e65…` @10901. `npm run evidence` regenerates
  EVIDENCE.md (17/17 rows, capabilities 27 PROVEN / 1 PARTIAL (year build B) of 28, 8/8 milestones). A gate in a scratch worktree needs `node_modules`, `.pw-browsers`,
  `public/browser/campus.glb` and `campus.glb.br` symlinked in. `deploy/director-demo.mjs` and `deploy/simulation-integration.mjs`
  exercise the real MCP control plane against `wrangler dev`.
- Current pins (PLANNING_BUDGET.md re-pin tables, last: W21 "no walker jumps"): probe `b746b094…` @10901; campus flagship crop = full
  `c56ea8da…` @11459; stress-30 `5c3a3355…`; meal `3c28879f…` @608; v3 `a2f782ad…` @16401; year build 2022 first bay `251a44c5…` @41317,
  whole skeleton `d382e461…` @117277 (`YEAR_BUILD_FULL=1`); year build B first bay + first deck strip `94db263e…` @53604; A+B whole
  house unpinned.
- Takes (`public/engine/takes/`, all `mars-take/4`; `node deploy/record-campus-take.mjs --all --full --check` → OK for all three, v3
  still fails `beam.no-room`): flagship `d2f16bd3…` (= `c56ea8da…`, 1.54 MB, camera `cam-bb4b6990…`) in the 2026 picker; 2022
  east-house first bay `b7b882fd…` (= `251a44c5…`, 1.34 MB, camera `cam-7492f43a…`) and whole skeleton `69c41651…` (= `d382e461…`,
  3.85 MB, camera `cam-b83a6828…`) under the 2022 picker's "Watch it being built". Directed cameras can be saved into a take file's
  `cameras` (a download the owner copies into `public/engine/takes/`).
- Production: https://mars-campus-2026.<workers-subdomain>.workers.dev — see `viewer/deploy/deployment.json` for the
  live version and rollback target; RELEASE_CHECKLIST.md has the exact deploy + rollback commands.
  Production deploys of gated work are allowed ("pre-release, ok to break stuff") — but Gene said no deploys overnight; ask him first.
- Pinned hashes (determinism probe, stress-30, campus flagship) are listed in PLANNING_BUDGET.md /
  planning.test.ts; a behaviour change that moves them must say so and re-pin with a reason.

**Gene's product feedback after release 5 — read `docs/engineering/OWNER_FEEDBACK_2026-09-28.md` first;
it outranks the list below.** In short: (5) materials go up by hand-up between a ground crew and two
receivers standing on the beams/uprights (builders climb and stand on the rack structure while staging —
that is how Martian floors are made), or by forklift; nothing levitates; (6) handling motions — crouch/kneel to pick up, stand with the load, reach up to pass, reach down to receive — so the hand-up is two people below reaching up and two above reaching down; (3) walkers must notice an
obstacle the tick it happens and never push into it for strides; (2) turns are gradual splined paths,
not straight–pivot–straight; (4) real stair climbing with feet on the treads (leg IK); (1) an animated
fire instead of the static cone.
**Headline milestone (feedback items 7–10):** for each year 2020–2026, replay the ENTIRE construction from
raw material piles (strapped plywood/2x4/2x6 bundles, uprights, beams, solar panels as their own piles,
doors/windows where the reconstruction has them, a wood-cutting station) to the canonical campus — skeleton
first (racks, 2x4 framing, stair/ramp), then floors/ceilings/walls gradually and safely — ending EQUAL to the
year's protected checkpoint, watchable in the studio as "Watch it being built" with the engine camera and the
refusal log. Also: people can stand in front of a wall and paint it. A separate full tranche (feedback §11): autonomous, expressive camera direction — directions like
"pan across Chiba with the sunset behind", "270° revolution around the main racks over 2 minutes", "go inside
the kitchen and face the sink", "look at this crowd doing X" compile to shot programs, trajectories are
*computed* (orbit radius from subject extent, sun-behind windows from the sun model, interior moves routed
through doors on a camera navmesh), and every shot is simulated and self-corrected against failure modes
(stuck between plywood, behind a head, flare, subject leaving frame) with the fix and reason recorded. Photos of the real skeleton stage and
piles are in `docs/engineering/evidence/`. Items 2–4 move pinned hashes: do them early and re-pin once.

**Known open items, in priority order (details and the full list in HANDOFF "End of night"):**
0. Questions for Gene are parked in `QUESTIONS_FOR_GENE.md` (non-blocking; Gene answers from the pictures). Do not ask
   them again. When a `Gene:` line gets filled in, turn it into an OWNER_DECISIONS entry and a brief.
1. Year build phase B (W13): commit a test that executes the stair / wall / solar sections, pin the whole east-house A+B run, record it
   as a take (≈ 8 MB last time — thin further), then the other 2022 houses and the other years (2020 / 2025 racks don't map yet).
2. Flagship v3 `onto_s2_4` `beam_walk` `beam.no-room` (0.25 < 0.28 m; passes by ≈ 3 cm only at the pinned origin) — fix, then record v3.
3. Frame-stance bodies (`construction/stance.ts`): rear `hang_beam` lifter carries the beam behind its back; stance holders' hands
   0.73–0.79 m beside the body (needs an engine facing / turn); one reach-down palm 1.025 m off in the whole skeleton; no foot / hand holds.
4. `makeWay` asks reserved people (95 `reservation.conflict` "refused / failed" lines in the whole-skeleton replay); `$crew[0]` step labels.
5. Year-build camera readability (min 0.31 / 0.42); reach-down cap vs the woman template (0.35 m < 0.5); hand points reached 76.6 % (year
   build) / 92.5 % (v3).
6. Engine: resumption after pre-emption; forklift waits forever behind a parked rider; vehicle reach / side-shift vs vehicles; walker
   look-ahead at 0.9 m/s lateral; crews (multi-carrier) on stairs; static geometry not editable via MCP; region layout edits don't stale
   plans; host `**` unscanned (14 lines; the scan is Codex's `briefs/codex-tooling.md`, the 14 rewrites are Claude's); stress-30 tick-5 spike ≈ 90 ms.
7. Renderer honesty gaps: talk / watch are Idle; no carry-pose clips (Claude). Fire smoke / billboards, paint textures,
   frames blue not green: **Codex** (`briefs/codex-fire-v2-and-render-polish.md`).
8. Spec items not started: scanned real Martians (needs consent); electrical model (deferred by spec).

**Codex split (Gene, 2026-09-29).** An external Codex contributor owns four bounded blocks on `codex/<topic>`
branches (`docs/engineering/briefs/`). Its reports arrive as `briefs/<brief>.REPORT.md`. The lead re-gates each
branch in a worktree (test:engine + tsc + the brief's specs; the full gate before a release), then fast-forwards
or cherry-picks. A pin-moving change is rejected, with the reason appended to its REPORT.

Ownership map (final):
- **Codex-owned:**
  - `engine/camera/parse.ts` (+ its tests);
  - `app/engine-view/fire.ts` + `e2e/fire.spec.ts`;
  - the render-polish files the brief names: `paint.ts`, new `solar-mesh.ts` / `equipment-mesh.ts` / `palette.ts`,
    one-line delegations in `components.ts`, and `e2e/render-polish.spec.ts`;
  - `docs/engineering/data/**` (+ `deploy/group-2026-frames.*`);
  - lint / gate tooling.
- **Claude-owned:** everything else, incl. locomotion, construction, campus, spatial, body, take (`engine/take/**`),
  year-build sequencing, studio replay, and `app/history/scenes.ts`.

The blocks, with W33's ETA estimates in Codex hours (uncalibrated):
- 2026 frame grouping, 6–10 h. Claude then integrates it into `engine/campus/assembly.ts`.
- Camera NL parse, 4–6 h.
- Fire v2 + render polish, 6–10 h.
- Tooling (lint gated once green; source scan covers `**`), 2–4 h.

**Checkpoint 1 = 2022 complete:** phase B landed and pinned, 2x4 framing verbs, all four houses, and the studio's
"Watch it being built · 2022". This is all Claude work. Merge the Codex branches as their REPORTs arrive, but do
not let them block it.

**Method that worked:** every capability ships with tests including deliberately invalid cases and, for
anything visual, Playwright captures that you LOOK at yourself (Read the PNGs) before accepting. Keep
the flagship scenarios (`engine/scenarios/build-bay.ts`, `build-bay-v2.ts`, `test/campus-flagship.test.ts`)
green; they are the acceptance test. Record decisions in PROGRESS.md as you go.

Start by running `npm run gate` in `viewer/` to confirm the checkpoint is green on this machine, then
report the gate table to Gene and propose the first two subagent briefs.
