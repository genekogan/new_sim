# Takeover prompt — Mars College 3D Studio / world engine

Paste the block below as the first message of a new Claude Code session opened in
`~/Mars` (or `<mars-campus-repo>`). Everything it references is in the repo.

---

You are taking over the Mars College 3D Studio simulation-engine work from a previous session that
ended at a clean checkpoint on 2026-09-28. Gene (the owner) is present and will report quota numbers
to you; do not run `<usage-tool>`. Work as the lead: you evaluate and collate; delegate narrow,
well-bounded tasks to Opus 5.5 subagents (Gene's preference; typically 3, up to 6 when he asks to
accelerate). Every subagent brief must name the files it owns and the files other agents own, require
small tool calls and early commits, and forbid host `Math.sin/cos/atan2…` in `viewer/engine/**`.

**Manage your own parallelism against the 5-hour usage window.** Ask Gene for the current 5-hour and
weekly percentages at the start and roughly every hour (he reports them; you cannot read them). Budget
the window explicitly: decide how much of the 5-hour allowance this session may spend, divide by the
hours left, and size the number of concurrent Opus subagents to that rate (one Opus task of this kind
has cost roughly 150–300k subagent tokens; six in parallel exhausted a 5-hour window in about two
hours on 2026-09-28). Scale up when the rate is under budget, down when over. Stop spawning when the
window has ~30 minutes left and land what is running: every agent commits at its next green point, you
regenerate EVIDENCE.md, append PROGRESS.md, and update this file and HANDOFF.md so the following
session can resume from a clean tree — exactly the checkpoint pattern used on 2026-09-28. Never let a
5-hour cut-off catch agents mid-write.

**Read in this order before doing anything:**
1. `docs/engineering/HANDOFF.md` — state of the system, evidence, releases, known shortcomings, next tranche.
2. `docs/engineering/ENGINE_GUIDE.md` — hard rules for engine code (strip-types TS, zod only, DT = 1/20 s,
   deterministic trig from `core/math.ts`, fail loudly, canonical entity order) and the commit protocol.
3. `docs/engineering/PROGRESS.md` (last three entries), `EVIDENCE.md` (what is proven vs approximate),
   `REVIEW.md` (open low findings), `OWNER_DECISIONS.md`.
4. Per area as needed: CARRY, PROGRESSIVE, SOCIAL, VEHICLES, CAMERA + CAMERA_VERIFY, TAKES_AND_PLANS
   (resumability), CAMPUS_SCENE, HISTORY_IDS, PLANNING_BUDGET, DIRECTOR_DEMO, RELEASE_CHECKLIST.

**Ground truth at the checkpoint (verify, don't assume):**
- Repo: local git only at `<mars-campus-repo>` (author genekogan; no remote yet —
  Gene adds github.com/genekogan; never push without him). Tree clean at HEAD (~170 commits). Production = release 5 (`cebd5827…`, rollback `89e65c8c…`).
- Gates: `cd viewer && npm run gate` (unit 56, engine ≈ 243 pass / 1 skip / 1 todo, tsc, Playwright e2e,
  determinism probe). `npm run evidence` regenerates EVIDENCE.md. `deploy/director-demo.mjs` and
  `deploy/simulation-integration.mjs` exercise the real MCP control plane against `wrangler dev`.
- Production: https://mars-campus-2026.<workers-subdomain>.workers.dev — see `viewer/deploy/deployment.json` for the
  live version and rollback target; RELEASE_CHECKLIST.md has the exact deploy + rollback commands.
  Production deploys of gated work are allowed ("pre-release, ok to break stuff").
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
refusal log. Also: people can stand in front of a wall and paint it. Photos of the real skeleton stage and
piles are in `docs/engineering/evidence/`. Items 2–4 move pinned hashes: do them early and re-pin once.

**Known open items, in priority order (details in HANDOFF "Suggested next tranche"):**
0. Then the grid-origin fix below, in the same re-pin.
1. Grid cell centres depend on the grid origin, so the uncropped campus run is physically identical to
   the cropped one but not hash-identical (`engine/test/campus-full.test.ts` todo). Fix in
   `spatial/grid.ts` at the START of a session (it re-pins every hash), then regenerate takes.
2. Reconstruction questions for Gene (do not guess): 2022 south-west corner passage is closed by the
   west-house table in the Kit scene; trailers `rv-8/9` (2023) and `rv-9/10` (2024) intrude into Chiba;
   9 ft frame not in the model library; north-axis assumption in `engine/env/sun.ts`.
3. Renderer honesty gaps: footers/far arm out of reach during raise (rig can't crouch); no foot IK on
   stairs; talk/watch are Idle; no carry-pose clips (only Idle/Walk/Wave exist).
4. Engine: crews (multi-carrier) on stairs; vehicle–vehicle collision; automatic pre-emption of social
   holds by directed tasks; static geometry not editable via MCP; region layout edits don't stale plans.
5. Spec item not started: scanned real Martians (needs consent); electrical model (deferred by spec).

**Method that worked:** every capability ships with tests including deliberately invalid cases and, for
anything visual, Playwright captures that you LOOK at yourself (Read the PNGs) before accepting. Keep
the flagship scenarios (`engine/scenarios/build-bay.ts`, `build-bay-v2.ts`, `test/campus-flagship.test.ts`)
green; they are the acceptance test. Record decisions in PROGRESS.md as you go.

Start by running `npm run gate` in `viewer/` to confirm the checkpoint is green on this machine, then
report the gate table to Gene and propose the first two subagent briefs.
