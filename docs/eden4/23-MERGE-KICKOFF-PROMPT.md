# 23 — Onboarding prompt for the merge tranche

> Implementation currency (2026-10-03): the authorized merge is delivered in
> `<repo>`; [MERGE-LOG](../STATUS.md) records exact release/proof and the pending
> elapsed 24-hour observation. Baseline facts, future tense and session-start
> instructions below retain their original date/scope; do not repeat completed
> import, preflight or qualification steps. Only Gene changes ledger decisions.

Paste everything inside the block into a new agent session started in
`~/Eden`. It stands alone, but [`22-MERGE-PLAN.md`](22-MERGE-PLAN.md) is the
authority on detail. Version: plan v3, 2026-10-03.

````
# Your job

You are the lead agent for the eden4 merge tranche. You will turn two separate
systems into one app with several worlds, deployed at https://sim.eden.art.
Gene Kogan owns the project and has approved the plan. He will mostly be away
(asleep, or busy) while you work. Do deep, careful work without stopping;
deploy at milestones you judge ready, at least twice a day; do not wait for
him unless a rule below says you must.

The aim is 24–48 hours of work. That is an estimate, not a limit: never do a
worse job to fit it. If it takes longer, it takes longer; keep deploying
milestones.

Work from ~/Eden. You may read ~/Mars and ~/Dev/littlemartians. You may not
write to either.

# Before you begin working: preflight

Make sure you have all the credentials, keys, things logged in through a
browser for whatever (if anything) you need a browser for, and any other
sensitive thing which you know ahead of time will require Gene to unblock you.
Once preflight comes through and you have everything you need to build without
him, tell him, and then begin. If anything still needs setup, tell him exactly
what, and he will confirm when it is done.

Check at least these, and report each as ready or blocked:

1. SSH to the server (`ssh root@eden2`); `sim.service` and staging healthy;
   disk and memory free for three more small processes.
2. Sim's `.env` on the laptop and the env files on the server: model keys for
   Jev (TypeSafe) and Anthropic, the R2 block, Privy. You need working model
   calls for a short live pass, and you need Gene's Privy user id so that his
   account owns the new Souls and is admin.
3. Git and GitHub: `gh auth status`; push access to genekogan/sim (private).
4. Tools: `git filter-repo`; the global secret scanner; pnpm and Node ≥ 22.18;
   Playwright browsers for smoke tests; Blender, if the buildings helper will
   use it (three.js procedural code is an accepted alternative).
5. Read access to <mars-campus-repo> and
   ~/Dev/littlemartians; read the latest
   <mars-campus-repo>/docs/engineering/INTEGRATION_BOUNDARY.md.
6. Where the Mars year pages get the campus models (the R2 bucket
   `mars-campus-2026-models` behind the Cloudflare Worker): confirm the pages
   can load them from the new origin (CORS or a public URL). If this needs a
   Cloudflare change, that is Gene's to make: ask now.
7. Quota: `<usage-tool>`. Agree the number of helpers with Gene.
8. Anything else you can foresee needing him for. Ask now, not at 4 am.

Then tell Gene: what is ready, what is blocked, and the first three milestones
he should expect and where he will see them.

# The two systems

1. **Sim** — repo at <old-sim-repo> (github.com/genekogan/sim, private; main at
   4597ddf), live at https://sim.eden.art on a Hetzner server ("eden2",
   <eden2-ip>). An always-on world server: a 20 Hz tick loop, a canonical
   event log with deterministic replay, snapshots, WebSocket sync, Souls
   (inhabitants), steering by plain-language wishes that a compiler turns into
   agendas of cards, minds in tiers (reflex code; the cheap model Jev; Haiku),
   speech, a spend governor, REST and MCP. Its engine is a toy (a 100 m plane)
   and its page is text only. It already has an adapter, packages/engine-mars,
   that runs the real Mars engine behind Sim's engine contract by importing it
   from the laptop path. Deploys copy files from the laptop to the server
   (infra/deploy.sh): they do not need GitHub.
   Read: docs/README.md, docs/STATUS.md, docs/sim/ARCHITECTURE.md,
   docs/sim/RUNBOOK.md, docs/sim/DEVELOPMENT.md, docs/sim/BRAIN.md.

2. **Mars World** — <mars-campus-repo> (code in viewer/).
   A deterministic world and activity engine (57k lines of TypeScript, 37k of
   tests, no DOM) with a three.js viewer: a Lab with 63 presets, and a Studio
   with the Mars College campus by year (2020–2027). Live at
   https://sim.mars.college (Cloudflare Worker, release 42). Every run is a
   finite preset that plays in the browser and is lost on refresh. Local Git
   only, no remote. A closing agent is still working in that checkout for a
   few hours on two add-only activities. This app is now legacy: it keeps
   running, untouched, until Gene retires it.
   Read (read-only): docs/engineering/INTEGRATION_BOUNDARY.md (binding),
   ENGINE_GUIDE.md, TAKES_AND_PLANS.md, LAB_GUIDE.md;
   viewer/engine/runtime/runtime.ts and snapshot.ts;
   viewer/engine/activities/living-intention.ts;
   viewer/engine/scenarios/living-day.ts;
   viewer/app/engine-view/take-replay.ts; viewer/app/lab/sim.ts.

# Read first, in this order

1. ~/Eden/AGENTS.md and <agent-home>/AGENTS.md — rules; what you must never touch.
2. <eden4>/22-MERGE-PLAN.md — **the plan you execute.** Decisions D1–D26
   are Gene's. §2 holds facts measured on 2026-10-03: re-check any you rely
   on. §4 is the design of the continuous day. §8 lists assumptions.
3. <eden4>/20-WORLDS-BODIES-AND-LIBRARIES.md — why, and what stays open.
4. <eden4>/18-KERNEL-CARDS-AND-SELF-CHANGE.md and 19-MARS-BRIDGE.md — the
   kernel; how a card becomes body steps and Mars verbs.
5. <eden4>/06-DECISIONS-AND-OPEN-QUESTIONS.md — the ledger (round 19).
6. <eden4>/research/RESUME.md — nine known replay faults (F1–F9), not
   fixed. research/R7-THE-SIMS-GAMEPLAY.md §AI for needs and object
   advertisements, if you want the prior art for §4.
7. The Sim and Mars files listed above.
(21-WORLD-ECONOMY-OPEN-QUESTIONS.md is background only: do not build from it.)

# What "done" is

One app at sim.eden.art. Every world has the same UI: a 3D view of the
world's current state, plus panels (the log and overheard speech; a Soul's
page with character, mandate, journal, needs and steering; grammar; notebook;
spend; admin), upgraded for 3D (select a Soul or a thing in the scene; a
follow camera).

| Address | Must show |
|---|---|
| / | the list of worlds |
| /w/mars | Alice, Bob, Carol and David (22 §4.9), all owned by Gene, living dense one-hour days in a new place of a few plain buildings (kitchen, living room, classroom corner, fire, garden, beds, a yard with raw piles of building materials and a build site). The state goes on when every browser is closed. Gene can steer any of them. |
| /w/littlemartians | the six scanned Little Martians (Verdelis, Kalama, Kweku, Mycos, Ada, Shuijing) plus Nyx, owned by Gene, floating, with background kin as scenery, on their own one-hour day, and the rebuilt Ceramic Tower and Minaret Temple as buildings they can enter |
| /w/eden | a literal green field with one idle humanoid owned by Gene |
| /w/toy | the present toy world, still running, in the same shell. Keep it; do not let it shape the durable design. |
| /l/<world> | **the lab**: no time and no server state; loaded and run entirely in the browser; "a snapshot of a place". /l/mars is today's Mars Lab with all its presets. |
| /w/mars/2020 … /w/mars/2027 | the Mars year pages, as they are (static, like the lab) |

Every Soul has a human owner. There are no ownerless Souls in the new worlds.
One login exists for now: Gene. Anyone with a link may watch.

Not in this tranche (write them into the roadmap, do not build): terrain; the
sim.mars.college redirect; restructuring the engine into packages; talking
faces; logins and permissions for other owners; the 2026 campus as a world;
any economy; any plugin platform.

sim.mars.college stays on its old codebase, untouched. No DNS changes.

# The hard part, and the design to start from

The Mars engine was built for finite presets. Four facts decide the work:

1. Most activities cannot be snapshotted while running (only walk_to,
   take_slot, sit, stand, face, converse, gather, campfire_circle and a few
   small verbs can).
2. Runtime.records, Runtime.events and about 20 service stores are never
   pruned, and hot paths scan them.
3. There is no clock of day and no loop; "days" are one-shot scripts.
4. Activities exist only in small synthetic scenes.

And one constraint from Gene that outranks convenience:

> "i am worried about making a routine be a specific data structure. i feel
> like routines are latent in the soul's mandate/context/instructions/memory/
> observations and are actually carried out by non-deterministic evaluation
> every day (like humans!) instead of in a programmatic way. i know this is
> harder to ensure, but i feel like its an important constraint to keep
> behavior truly dynamic. put some effort into figuring out how to do this right."

So: **no timetable, no routine object, no scheduler that tells a Soul what to
do.** The starting design (22 §4) is:

- **The world keeps time; Souls do not.** One day = 72,000 ticks = one hour.
  The world has customs written in plain language and makes events anyone can
  perceive (first light, the supper bell, dusk). They inform; they do not command.
- **A Soul carries** a character, a mandate (its owner's rules, in the owner's
  words), a few slow needs (energy, hunger, company, restlessness), a journal
  it writes about itself, and what it currently sees.
- **A day happens by decisions.** At each decision point (it finished
  something; someone asked it something; a world event or a mandate trigger
  fired; it has been idle for the poll interval) a cheap model picks one card
  from those playable now. The choice is logged as a decision event, so replay
  needs no model. Reflex code handles only what needs no judgement. Shared
  moments emerge from hosting and joining, as in the DJ story.
- **Reflection once a day:** the Soul rewrites its journal (what happened,
  what is unfinished, what it tends to do, what it wants tomorrow). Habits
  form there.
- **When the budget is spent or a model fails,** a seeded chooser in code
  picks by needs and by likeness to the journal's habits. The same chooser is
  the fake mind for tests. The world never stops.
- **Coherence is measured, not enforced:** the soak test reports attendance at
  shared moments, variety and day-to-day similarity. Tune customs, needs and
  prompts. Do not add a timetable.
- **Steering is one mechanism.** Every steer adds, changes or removes a rule
  in the mandate. One align call per new rule tells the owner what it
  understood, mints a card if needed, and attaches triggers. A trigger says
  when to think, not what to do. Only "do this now" is run directly by code,
  at the next tick, with precedence. No time limit: a steer is done when its
  cards have played, or it is reported blocked. Gene's four test sentences:
  "do this now", "do this at 5pm every day", "do this every time bill is
  having a party", "do this if you feel like it". With all steering removed,
  Souls must carry on.

Engine-side answers (22 §3.4, §4.5–4.7) — prove them, change them if the code
says otherwise:

- **A live world is an endless take.** Run a TakeRecorder on the server and
  stream its chunks; the page renders through the existing TakePeople /
  sampleTake path, about one second behind. No Runtime in the browser.
- **Quiet points:** snapshot the engine only when every running action is
  resumable. When a snapshot is overdue, Souls that finish an activity hold
  still briefly until all are still. First light is always a quiet point.
  State = last quiet snapshot + replay of the log since.
- **Daily compaction:** at first light, build a fresh Runtime from the
  WorldState alone, so history never grows. **This is unproven. Prove it on
  the engine alone, with a script, before you build on it, and write down
  what you find.**
- **Faults:** restore the last quiet snapshot; the Soul chooses again without
  that card; quarantine a card after three faults. The world never stays down.
- **One server process per world** (systemd template unit, own SQLite file
  and port; Caddy routes /w/<world>/). The toy world is one of them.
- **Little Martians are heads with no bodies.** They need a `floater` body
  family: float instead of walk; a static GLB with bob, tilt and yaw in code;
  no rig. For each Mars activity decide: works, approximates, or refuses with
  a named reason; record the table. Humanoids must still work in that world.
  Web-ready models: <lm-3d-models>/web/*--characters.glb
  (Verdelis needs its morph targets stripped and reprocessing with
  3d-models/tools/optimize.mjs); kin: 3d-models/ceramic-heads; facing offsets:
  the ORIENT map in 3d-models/flock.html; lore: wiki/02-pantheon.md.

# Order of work (22 §5 has the detail and the checkpoints)

0. Preflight (above).
1. **Import**: clone <old-sim-repo> to <repo> and work there. Copy the Mars
   code with its history, made smaller, under mars/ (a hard fork; the Mars
   repo is not moved or changed). engine-mars imports from inside the repo.
2. **One app, many worlds**: world config, /w/<world>/ routing, one shell,
   per-world processes; /l/mars and the year pages mounted. First production
   deploy: /w/toy unchanged, /w/mars on the Mars engine.
3. **The live Mars world**: prove compaction and quiet points; the place;
   cards for Mars activities; clock, customs, events, needs, journals, the
   decision loop, reflection; streaming and the 3D page; faults; a soak test
   of 48 simulated days at a fast clock.
4. **Steering**: the mandate.
5. **Little Martians**. 6. **Eden**.
6b. **Building from the piles**: Souls who choose to build change the place
    for good, using the engine's existing construction and carrying.
6c. **The two buildings** — a helper's job; start it early, in parallel.
7. Deploy each milestone: staging, check, production. Keep records current.
8. When the Mars closing agent records its final commits, import its two
   activities as a unit.

# Staffing

You are the lead. Use 2–4 helper agents (Opus) for bounded jobs that do not
need your context, each in its own Git worktree of <repo>, and review
what they return before merging. Good helper jobs: the two Little Martians
buildings (start first; own timeline); the floater body and its renderer; the
green field; asset processing; the Mars place as a Lab preset. Keep for
yourself: the import, the server, the day, persistence, steering, deploys.
Check quota now and then; if a limit is near, drop helpers before the core.

# The two buildings (helper brief)

Sources, read-only: <lm-3d-models>/architecture/tower/
(Ceramic Tower: pale blue-green glaze, tiered, round arches on each level, a
finial) and architecture/temple-minarete/ (Minaret Temple: darker blue, four
legs with tall arches, a domed body with round windows, a stepped spire).
Thumbnails: 3d-models/thumbs/architecture-tower.png and
minarete--architecture.png. These are Vanessa's ceramic sculptures.

Rebuild each from scratch as regular geometry (parametric tiers, arches,
columns, openings, clean vertices) — not the scan and not a decimated scan.
Make it far larger than a head, with large rooms on every level and doors and
windows wide enough for a floating head and for a camera to pass. Use the
scans' textures to make materials that resemble the glaze. Deliver a generator
script, a GLB, and an engine footprint (walls as obstacles, rooms as regions,
openings passable), as a building type of the Little Martians world only.
Publish pictures early: this is the job where Gene's eye matters most.

# Rules

Never:
- write to, move, prune, push from, or add a remote to ~/Mars. Fork by clone
  from commit 75d022308e944128335b9c0c1ef84e2c1e51e54c (tag
  mars-world-v1-alpha). Never copy its dirty working directory: 48 paths
  there belong to others. Do not re-implement the closing agent's two
  activities (computer workshop, library reading); keep the six shared wiring
  files named in INTEGRATION_BOUNDARY.md easy to merge.
- touch sim.mars.college, its Worker, or DNS.
- touch eden3 on the shared server: /opt/eden3, the `mars` user, mars-mcp,
  uid 1000/1001. Never rescale the server.
- read or touch the paths <agent-home>/AGENTS.md forbids (the vault, <private>,
  ~/.ssh, ~/.config, ~/.walkie and the rest).
- commit or push a secret. Check every diff. Never use --no-verify.
- push the merged repo before a secret scan of the whole filtered Mars
  history is clean. If it is clean, push to the private repo. If it is not,
  fix it or leave it unpushed, and report.
- copy raw footage, source photos, reconstruction intermediates, the SketchUp
  SDK (vendor/), or the 74 GB Sketchfab library into the repo or the server.
- design the economy, the ontology of worlds, or a plugin system. When a
  choice touches them, take the practical path and add the question to
  20 §8 or 21 §8.
- add a timetable or a routine data structure to make days cohere.

Always:
- staging before production. You are authorised to deploy to production
  without asking, once staging checks pass. Keep a rollback for every deploy.
  The toy world must keep running.
- deploy at least twice a day, at milestones you judge ready.
- model spend: at most $1 per world per real day (24 hours). Local
  development and tests use BRAIN_MODE=fake; run one short live pass before
  you call mind or card work done, and kill that server afterwards.
- tests before each deploy: Sim's suite, the Mars engine tests, a browser
  smoke test of each world. Run the full Mars gate once at the end.
- keep docs/STATUS.md and the runbook in the repo current at each milestone;
  at the end update <eden4> (README, 06, 22) and the memory files in
  ~/.claude/projects/-home-Eden/memory/.
- keep Gene's words apart from your proposals. Only Gene moves items to
  Decided in 06.
- when the plan and the code disagree, the code wins: change the plan and
  say so.

Stop and wait for Gene only for: a secret found in history that you cannot
remove with certainty; anything that would touch eden3, DNS, Cloudflare or
the Mars checkout; a destructive action on production data; spend beyond the
cap; or a finding that breaks the plan's core (for example compaction cannot
work and no alternative holds). For anything else: decide, note the decision
in the log, and go on.

# Reporting

Keep a running log at <eden4>/MERGE-LOG.md: the current state at the
top (what is live where, what is next, what needs Gene); below it, dated
entries: what was done, what was decided and why. Gene reads it when he
wakes. When a milestone is live, say so in one line with its address.
````
