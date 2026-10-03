# Handoff prompt — engine / simulation / controller / app agent

Paste this to the agent that takes over the Mars College 3D Studio engine work (Codex or Claude). It is
written for a single autonomous agent that may spawn helpers; adapt the worker protocol to your tooling.

---

You are taking over the **Mars College 3D Studio simulation engine** at a clean checkpoint. Repo:
`<mars-campus-repo>` (local git only, author `genekogan`; **never push, never add a
remote** — Gene does that). Work in `viewer/`. Production is a Cloudflare Worker (see
`viewer/deploy/deployment.json` for the live version and rollback target).

## Your scope — and what is NOT yours
- **Yours:** the engine (`viewer/engine/**`), simulation/control plane (`viewer/simulation/**`, MCP tools,
  `viewer/deploy/**`), and the app (`viewer/app/**`: studio, lab, renderer): development, bug fixing, all
  tests passing, code quality, performance / reliability / stability, feature completion against the spec,
  self-evaluation and critique — making the whole app run great.
- **Not yours — historical Mars content reconstruction** (a separate agent works on it in parallel): the
  year scenes `viewer/app/history/scenes.ts` / `photographic-corrections.ts` / `kit.ts` content values,
  the generated `viewer/public/engine/campus-20*.json`, `app/history/id-migration.json`, the 2022
  reconciliation (`docs/engineering/RECONCILIATION_2022.md`), per-house year-build *content* (which house has
  what), `docs/engineering/QUESTIONS_FOR_GENE.md` + `questions/`, `docs/engineering/HISTORICAL_CONTENT.md`.
  You may touch those files only for engine/renderer *mechanics* (a new field, a schema, a renderer of a
  new kind) and must say so in your report. If a content edit lands from the other agent and moves a pin,
  they re-pin; you re-run your gate. Never guess historical facts; route them to QUESTIONS_FOR_GENE.md
  using the fenced fields W41 defined and regenerate the page (`node deploy/questions-html.mjs`).

## Read in this order
1. `docs/engineering/HANDOFF.md` — state, evidence, releases, known shortcomings (now only re-classified ones).
2. `docs/engineering/ENGINE_GUIDE.md` — hard rules (strip-types TS, zod only, `DT = 1/20 s`, deterministic
   trig from `core/math.ts` — `source-scan.test.ts` bans host `Math.*` transcendentals and `**`; fail loudly
   with `Diagnostic`; canonical entity order; plain-JSON world; cameras never mutate the world).
3. `docs/engineering/LAST_MILE.md` — **the work list** (216 items with source, category, effort, pin
   impact; §13 lead ordering + rulings; row `notes` carry each item's "Next step" and status). Definition of
   done: every item FIXED with a test, or RE-CLASSIFIED as content / out-of-scope with one sentence why.
4. `docs/engineering/OWNER_DECISIONS.md` (all entries — Gene's standing decisions) and
   `OWNER_FEEDBACK_2026-09-28.md` §1–§15 (product requirements).
5. `docs/engineering/PROGRESS.md` (last ~40 entries: what every worker landed, weak spots, follow-ups),
   `PLANNING_BUDGET.md` (current pinned hashes + every re-pin with its reason), `EVIDENCE.md`,
   `RELEASE_CHECKLIST.md`, `CODEX.md` (worktree recipe, ports, merge protocol — the ownership map there is
   superseded by this prompt: you own everything except the content paths above).
6. Per area as needed: SPEC.md, CARRY, PROGRESSIVE, SOCIAL, VEHICLES, CAMERA + CAMERA_VERIFY + CAMERA_DIRECT,
   TAKES_AND_PLANS, MOVEMENT, HANDUP, BODY_MODEL, ITEMS, POSES, SOLAR_PAINT, FRAMING, YEAR_BUILD (mechanics),
   STUDIO_REPLAY, DIRECTOR_DEMO, HISTORY_IDS, CAMPUS_SCENE, LAB_GUIDE.

## Non-negotiable protocol
- **Gate before every merge to main:** `cd viewer && npm run gate` GREEN on the rebased branch (unit, engine
  0 fail — drive skips to 0 or document each —, tsc, Playwright e2e, determinism probe; plus
  `SIM_BASE=<wrangler dev url> node deploy/simulation-integration.mjs` PASS; lint joins the gate only once it
  is 0). Report the gate table with every merge. Run long things in the background with logs and poll with
  short commands — a silent 10-minute wait can get a helper killed.
- **Pins are the truth.** Pinned final-state hashes (PLANNING_BUDGET.md; `deploy/perf-walk.mjs` checks five;
  the year-build tests hold the rest) move only with a reason recorded in PLANNING_BUDGET.md, verified
  first as "0 violations, same discrete outcome". Batch pin-moving items into one re-pin window per wave
  (LAST_MILE §11/§13) and re-record takes once (`node deploy/record-campus-take.mjs --all --full --check`).
- **Honesty over completion:** nothing levitates, teleports, clips or "succeeds" by interpolation; refuse with
  a diagnostic naming the object. Every capability ships with tests including deliberately invalid cases;
  anything visual ships with Playwright captures you LOOK at yourself before accepting. Record what is
  approximate in the area doc.
- **Commits:** small, own paths only (`git add <paths>`), never `git add -A`; message ends with your
  `Co-Authored-By:` line. Work in a worktree per task (`CODEX.md` recipe: symlink `viewer/node_modules`,
  `viewer/public/browser/campus.glb`, `campus.glb.br`, `viewer/.pw-browsers`; own `E2E_VITE_PORT` /
  `E2E_RUN`). Branch names `codex/<topic>` (or `<agent>/<topic>`); the branch is merged (ff/no-ff) only
  after its gate is green.
- **Deploy at each green milestone** exactly per `RELEASE_CHECKLIST.md` (record the rollback version first;
  smoke against production; write the "Production deploy N" record) and tell Gene the release number.
- **Budget:** 2–3 parallel helpers at most, ≤ 50 % of any 5-hour usage window; keep a running tally in
  PROGRESS.md (worker, tokens, minutes, verdict). Read PROGRESS.md before spawning anything — it is the log.
- **Docs are part of every change:** the area doc (what/rules/approximations), LAST_MILE row status, a
  PROGRESS.md entry; HANDOFF.md + NEXT_SESSION_PROMPT.md at every checkpoint so a cut-off leaves a resumable tree.

## Where to start (wave 1 of LAST_MILE §13)
1. Confirm the checkpoint: `cd viewer && npm run gate` — report the table to Gene.
2. Check for landed-but-unmerged branches (`git branch --list '*w*' 'codex/*'`) and their REPORT/PROGRESS
   notes; merge what is gate-green; every partial item has a "Next step" in LAST_MILE notes.
3. Controller lane A (Gene's #1): region-scoped staleness, automatic replan/rebind, directed tracks stored
   beside the take, vehicles over `edit_world`, `engine_parse_camera` + `sentences[]` on
   `engine_direct_camera` (the parser `engine/camera/parse.ts`; SPEC:146 keeps NL out of verbs), one control
   path for the 20 legacy tools, integration covering every tool.
4. Tooling: lint → 0 in `engine/**`, `deploy/**`, `simulation/**`, `app/**` (mechanical, hash-identical;
   `setpart.ts:241` erasing-op and `core/math.ts` precision literals only inside a re-pin window), then lint
   into the gate.
5. Evidence: `engine/test/evidence-map.json` covers every test file, `npm run evidence`, every row PROVEN
   with its approximation note shrunk or removed.
6. Then wave 2 (engine pin window), wave 3 (renderer/studio), wave 4 (close) as ordered in LAST_MILE §13.

Report to Gene at every merge with LAST_MILE counts (fixed / re-classified / remaining), the gate table, and
the release number when you deploy. Questions that need Gene go to QUESTIONS_FOR_GENE.md (with a capture and
the plain-English fields) — never block on them.
