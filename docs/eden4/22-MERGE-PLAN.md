# 22 — The merge: Sim drives the Mars world, then two more worlds

> Status (2026-10-03, round 19, revised after a second interview): **plan v3 authorized by Gene and executing in `<repo>`.**
> Current exact deployment/proofs/remaining work: [`MERGE-LOG`](MERGE-LOG.md). The paste-ready prompt for the
> agent is [`23`](23-MERGE-KICKOFF-PROMPT.md). **(plan v3: Gene's notes of 2026-10-03 applied)** It is written to be handed to a new agent working from `~/Eden`
> with read access to `~/Mars`. Decisions marked **(Gene)** came from his
> message and three interview rounds on 2026-10-03. Everything else is the
> planner's proposal: change it when the code says otherwise, and say so.
> Why we are doing this: [`20`](20-WORLDS-BODIES-AND-LIBRARIES.md). What is
> deliberately left open: [`21`](21-WORLD-ECONOMY-OPEN-QUESTIONS.md).

## 0. The goal in one paragraph

Today there are two things. **Sim** (`<old-sim-repo>`, live at sim.eden.art) is an
always-on server with a log, Souls, steering and minds, on a toy engine with a
text page. **Mars World** (`<mars-campus-repo>`, live at
sim.mars.college as release 42) is a rich 3D engine and viewer where every run
is a finite preset that starts when the page loads and is lost on refresh.
The merge makes one app in which **the Sim server runs the Mars engine without
stopping**: a world has an objective state at every tick, a few Souls live a
repeating one-hour day, Gene steers them, and anyone who opens the page sees
the current state in 3D. Mars is the first world, Little Martians the second,
Eden (a green field) the third.

Gene: "the important thing is merging the sim (simulation) we built here as a
real driver of the sim as it is now in mars world. right now there is no sim,
every page refresh lets you play out the steps… now the mars world has an
objective state at any timestep which is continuously evolving as we go. the
agents are going through various cycles, perhaps a day night cycle, a bunch of
rituals, and those rituals evolve through continual stewardship through
steering souls, and the results are emergent over time."

## 1. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | Mars direct development stops at the v1 alpha. Gene winds the Mars agent down himself. | Gene |
| D2 | One repo. The Mars code is **copied (a hard fork)** into the Sim repo **with its history**, made smaller first. The Mars repo is not moved or changed: the legacy app at sim.mars.college keeps running from it until Gene deletes it and redirects. | Gene (v3) |
| D3 | The merged repo lives at `<repo>`. Planner's reading: make it by cloning `<old-sim-repo>`; leave `<old-sim-repo>` in place, unused, until Gene removes it. | Gene (v3) |
| D4 | Canonical address: **sim.eden.art**. Worlds at `/w/<world>`, labs at `/l/<world>`. | Gene |
| D5 | Worlds: `/w/mars`, `/w/littlemartians`, `/w/eden`. Mars year pages at `/w/mars/2020` … `/w/mars/2027`, hardcoded. | Gene |
| D6 | The always-on process runs on the Hetzner server that hosts sim.eden.art now. Campus models stay in the R2 bucket. Raw footage and photos never leave the laptop. | Gene |
| D7 | **sim.mars.college stays on the old codebase**, soft-deprecated, hosted as it is. No redirect and no DNS change in this tranche. The redirect is a later step that Gene triggers. | Gene (v2) |
| D8 | **The toy world is kept** (at `/w/toy`) as an explanatory space with toy data. It must not shape the durable design, and may be retired at parity. **Every world has the same UI**: the old shell's panels map onto the 3D worlds and are upgraded for 3D. | Gene (v2) |
| D9 | `/w/mars` starts with four fictional Souls, **all owned by Gene**. "all souls have true human owners, there is no such thing as a truly orphaned or ownerless soul." State persists when the browser closes. | Gene (v3) |
| D10 | The Mars place is **a new canonical place made of a few basic buildings**: "a kitchen, a living room, some outdoors, enough to have basic activities and test coherence… not as ornate as the buildings we've made for the studio", plus **building materials in raw piles "so maybe agents can build stuff from the raw piles as they go"**. Not the 2026 campus for now (a changeable copy of it is a possible later start). | Gene (v3) |
| D11 | **One day is one hour.** | Gene |
| D12 | **Behaviour is not programmed.** Gene: "i am worried about making a routine be a specific data structure. i feel like routines are latent in the soul's mandate/context/instructions/memory/observations and are actually carried out by non-deterministic evaluation every day (like humans!) instead of in a programmatic way… its an important constraint to keep behavior truly dynamic." **Steering is general**: "do this now", "do this at 5pm every day", "do this every time bill is having a party", "do this if you feel like it"; a Soul turns its owner's mandate "into some kind of ongoing behavior that both never stops, even if steering goes away, but can become increasingly sophisticated with more rules in arbitrary natural language." Souls are polled at an interval that shortens as it gets cheaper. No time limit on a steer: "steering should trigger an internal alignment call to turn the intention to an actual objective effect on the world at the next tick." | Gene (v3) |
| D13 | Little Martians cast: the six scanned characters, plus Nyx and background kin. They float. No talking faces yet. | Gene |
| D14 | Eden is "literally a green field": no new features. | Gene |
| D15 | Keep three.js. Use Blender only as an offline tool. Do not reinvent what exists. Keep everything Mars World has now. | Gene |
| D16 | Economy and world ontology stay open. Build practically; write the open questions down. | Gene |
| D17 | The four Mars Souls are **Alice, Bob, Carol and David**, with very different personalities (§4.9; the planner made them up at Gene's request). Their days are "fairly sophisticated and dense, made out of the activities we assembled in the current mars lab". | Gene (v3) |
| D18 | **One login: Gene.** Permissions and other owners (the Little Martians artist may own that world) come later. | Gene (v2) |
| D19 | *(withdrawn in v3: the 2026 campus is not the place for now; see D10.)* Every world is "an objective thing with a current state that is now being evolved by the server." | Gene (v3) |
| D20 | **The Little Martians buildings are in**, as a separate parallel job with its own timeline that the lead manages: rebuild **both** the Ceramic Tower and the Minaret Temple as clean, regular geometry, larger, with rooms and openings the Little Martians (and a camera) can enter, textured to resemble the originals. A new building type for the Little Martians world. | Gene (v2) |
| D21 | **Model spend: at most $1 per world per real day (24 hours)**, not per one-hour world day, whoever is watching. Eden holds one idle humanoid. | Gene (v3) |
| D22 | **Aim: 24–48 hours of work**, on things Gene clearly wants. "dont enforce it artificially by doing a bad job on things. if my estimate was wrong, so be it. i just want you to do this well and at least give me new deployments at least twice a day as we go ideally, at self-assessed milestones." Deferred to the roadmap: terrain, the sim.mars.college redirect, restructuring the engine into packages. | Gene (v3) |
| D23 | **Production deploys are authorised** without asking again, staging first, with the toy world kept. | Gene (v2) |
| D24 | **Staffing: one lead agent with a few helpers** for bounded, separable jobs. | Gene (v2) |
| D25 | **Push the merged repo to the private GitHub repo if the secret scan of the filtered history is clean.** | Gene (v2) |
| D26 | **The Mars repo stays where it is; we copy.** The Mars closing agent finishes two add-only activities (computer workshop, library reading). Fork from `75d0223` exactly. Import its delta later as a unit. Rules: `<mars-campus-repo>/docs/engineering/INTEGRATION_BOUNDARY.md`. | Gene (v2) |

## 2. Facts the plan rests on (measured 2026-10-03)

**Mars repo**
- Alpha checkpoint: tag `mars-world-v1-alpha` at `75d0223`. The tested and
  deployed source is `043957e8`. Release 42: Worker `mars-campus-2026`, R2
  bucket `mars-campus-2026-models`.
- **No Git remote.** 935 commits, 282 branches, 220 worktrees, 48 uncommitted
  paths in the main checkout that belong to other work.
- Tracked files: 1,786, about 165 MB. Pack: 280 MB. The weight is not code:
  Playwright screenshot baselines (`viewer/e2e/**/*.png`, about 190 MB over
  history), recorded takes (`viewer/public/engine/takes/*.json`), photo textures
  (`.webp`, `research/2020/*.jpg`) and very large engineering logs
  (`docs/engineering/*.md`, 205 MB uncompressed over history).
- `viewer/public/data` and `viewer/public/modular` are **symlinks to
  `<mars-media>/reconstruction/…`**, outside the repo. The people models
  (Quaternius, CC0) live there. `vendor/` holds the SketchUp SDK: not
  redistributable, gitignored.
- Code: engine 57k lines + 37k tests; app 31k; simulation Worker 20k; e2e 18k;
  deploy 10k. Runtime dependencies: three 0.185, react 19, zod 4,
  `@modelcontextprotocol/server`.
- Release gate: nine stages; the browser stage took 85 minutes for release 42.

**Mars engine, for an always-on world**
1. **A Soul cannot be saved in the middle of most activities.** `snapshot()`
   works only for `walk_to`, `take_slot`, `sit`, `stand`, `face`, `converse`,
   `gather`, `campfire_circle` and a few small verbs. Every activity
   coordinator (`living_intention`, `purposeful_routine`, classroom, food,
   reading, music, chess, sleep, garden…) refuses. What does persist is
   progress stored on world objects (an unfinished drawing, a book position, a
   seedbed).
2. **History grows without limit.** `Runtime.records`, `Runtime.events`, each
   record's history and about 20 service stores are never pruned, and several
   hot paths scan all records. Cost per tick rises with age.
3. **There is no clock of day and no loop.** `env.datetime` is fixed and only
   visual. A "day" is a one-shot script that refuses a second start. The
   longest connected day ends in about 13 simulated minutes.
4. **Activities exist only in small synthetic scenes** (a 32 m floor with two
   walls). The real 2026 campus in the engine has collision geometry and
   regions, no furniture.
5. **A fault is terminal** in the Lab: it needs a Reset.
6. **The renderer can run without a live Runtime.** The Studio replays
   recorded takes through `take-replay.ts` (`TakePeople`, `sampleTake`), with
   random access. A walking person costs about 125 bytes a second as a thinned
   take. Gaps: head "attention" targets and HUD read-outs come from runtime
   services; take fields omit `planting`, `gardenCare`, `foodPreparation`.
7. **The Lab runs the engine in the browser.** The Cloudflare Durable Object
   does not step worlds: it runs short jobs inside one request.
8. Tick cost: 0.36 ms for 20 walkers; planning peaks can reach 250 ms.

**Sim**
- Main at `4597ddf`, deployed. One world per process (`WORLD_ID = 'toy-1'` is
  a constant; the database tables already carry `world_id`).
- `packages/engine-mars` runs the Mars engine behind Sim's engine contract,
  importing it from the laptop path (`MARS_ENGINE_DIR`). The DJ story and the
  Mars meal scenario pass on it.
- Sim already has: log, fold, replay, snapshots every 5 minutes, WebSocket
  sync with keyframes, agendas of cards with one-step lookahead and give-up
  after ten minutes, a compiler from wishes to agendas, speech, spend caps,
  REST and MCP, invite codes.
- Nine reproduced replay faults (F1–F9, `research/RESUME.md`) are not fixed.

**Little Martians** (`~/Dev/littlemartians`)
- Scans exist for Verdelis, Kalama, Kweku, Mycos, Ada, Shuijing and Nyx. They
  are **heads**, with no bodies. Web-ready copies (Draco + WebP, 0.9–1.4 MB)
  are in `3d-models/web/*--characters.glb` for all but Verdelis (32.6 MB:
  strip its 104 morph targets and reprocess).
- 29 unnamed ceramic head scans in `3d-models/ceramic-heads/` (about 1 MB web
  copies): the background kin.
- Existing code to reuse: `3d-models/tools/optimize.mjs` (glTF-Transform),
  `flock.html` (floating heads; the `ORIENT` map of each scan's facing),
  `scenes100/lib/kit.js`. It uses three r170.
- Lore and places: `wiki/02-pantheon.md`, `wiki/07-bestiary-environments.md`
  (Eden Dome at the base of Olympus Mons, the volcano, lava tubes).
- The Sketchfab library (74 GB) is third-party; licence per model in
  `3d-models/sketchfab/catalog.json`. Do not copy it into the repo.

## 3. Target shape

### 3.1 Addresses

| Address | What |
|---|---|
| `sim.eden.art/` | list of worlds |
| `/w/<world>` | the live world in 3D: the canonical state, now |
| `/w/<world>` panels | the same UI for every world (D8): the 3D view plus the shell's panels (log and overheard speech, Soul and steering, grammar, notebook, spend, admin), upgraded for 3D (select a Soul or a thing in the scene; follow camera). `/w/<world>/watch` opens the panels without 3D |
| `/w/toy` | the toy world, kept; the same shell with its text map in place of 3D |
| `/w/<world>/soul/<id>` | a Soul's page: character, mandate, journal, needs, steering, history |
| `/l/<world>` | **the lab**: it has no time and no server state. It is loaded and run entirely in the browser, as `sim.mars.college/lab` is now: "a snapshot of a place, like the mars campuses 2020-2026". Every world has one. `/l/mars` is today's Mars Lab with all its presets. |
| `/w/mars/2020` … `/w/mars/2027` | the Mars year pages (the Studio), hardcoded (D5). Like the lab, they are static snapshots with no server state. |
| `/w/<world>/v1/…`, `/w/<world>/ws`, `/w/<world>/mcp` | that world's REST, WebSocket and MCP |

### 3.2 Processes

**One server process per world**, each with its own SQLite file and port, as
systemd template units (`sim@mars`, `sim@littlemartians`, `sim@eden`, `sim@toy`). Caddy
routes `/w/<world>/…` to the right port and serves the web app once.

Why not one process for all worlds: the server has a constant world id and
module-level state; a fault or a long planning tick in one world would stall
the others; memory is about 150 MB each, which the server has. Accounts are
checked by token (Privy), so each world can verify sign-in alone. Revisit when
there are many worlds.

### 3.3 Repo layout

Stage 1 (import, nothing restructured):

```
<repo>/
  apps/server  apps/web  packages/*  infra  docs      ← Sim as it is
  mars/                                               ← the Mars repo, history kept:
    viewer/engine  viewer/app  viewer/simulation  viewer/deploy  viewer/e2e  docs  scripts
  worlds/
    mars/  littlemartians/  eden/                     ← manifest, scene, customs, cast, cards
  tools/assets/                                       ← glTF-Transform and Blender scripts
```

Stage 2 (later, only when it pays): `mars/viewer/engine` → `packages/engine`;
`mars/viewer/app/engine-view` → `packages/view`; `mars/viewer/app/lab`,
`studio`, `history` → `apps/web`. Mars-only content (`campus`, `scenarios`,
year scenes) → `worlds/mars`. Do not start stage 2 before §5 phase 4 passes.

`packages/engine-mars` stays the adapter. Its import path changes from the
laptop path to the in-repo copy. `packages/engine-toy` stays for tests only.

### 3.4 How a live world reaches the screen

**A live world is an endless take.** The server runs a `TakeRecorder` on the
runtime and sends its output in chunks over the WebSocket: thinned pose tracks
`[tick, x mm, y mm, z mm, yaw mrad]` and field changes `[tick, id, field,
value]`. The page keeps a buffer about one second behind and renders through
the existing `TakePeople` / `sampleTake` path. A page that opens late receives
the current world (the take's `entities0` form) and then the stream.

- This is the path the Studio already uses, so the renderer needs no live
  Runtime.
- It costs under 1 KB/s for a few people.
- Stored chunks give rewind and replay of any past hour at no extra design.
- Work: add `planting`, `gardenCare`, `foodPreparation` to the take fields;
  compute head attention targets on the server and send them as a field;
  replace HUD read-outs with data from the kernel (who is doing which card).
- Sim's existing keyframe sync stays for `/watch` and for the view hash.

### 3.5 Meaning and depiction

Unchanged from `18` and `19`: a Soul plays a **card** (kernel, logged); the
card's depiction is **body steps**; the adapter lowers them to engine verbs.
Mars activities enter as cards whose depiction is a raw Mars verb
(`mars:read_book`, `mars:prepare_food`, `mars:sleep`…), as `19` §4 planned.

## 4. The continuous day

This is the part with no existing answer. Gene's constraint (D12): a routine is
**not a data structure**. It is latent in what a Soul is told, remembers and
sees, and it is carried out by non-deterministic evaluation each day, as a
person's is. The design below is a proposal built on that constraint.

### 4.1 The world keeps time; Souls do not

- `DAY = 72,000 ticks` (one hour at 20 Hz). Time of day is `tick mod DAY`:
  derived, never stored. The sun follows it (`engine/env/sun.ts`).
- **The world has customs, written in plain language**, in the world's config:
  "People here wake at first light and warm up together outside. Supper is in
  the kitchen when the light turns gold. There is a fire after dark. People
  sleep when the fire dies." Customs are context for minds, not a timetable.
- **The world makes events anyone can perceive**: first light, the supper
  bell, dusk, the fire being lit. A bell is a fact in the world, like a church
  bell. It commands nobody.
- The clock-rate dial in the admin panel speeds time up for tests.

### 4.2 What a Soul carries

| Part | Content | Changes |
|---|---|---|
| **Character** | a few sentences: temperament, likes, dislikes (§4.9) | rarely |
| **Mandate** | its owner's rules, in the owner's words (§4.4) | when the owner steers |
| **Needs** | a few slow numbers: energy, hunger, company, restlessness. They rise and fall with what the Soul does (Sim's minds already keep mood and energy; The Sims is the model, `research/R7`). | every minute |
| **Journal** | short text the Soul writes about itself: what it did recently, what is unfinished, what it tends to do, what it means to do tomorrow | once a day, by the Soul |
| **What it sees** | time of day, the world's events, who is where and doing what, who asked it something, which cards it could play now | every decision |

There is no routine object. A habit is a sentence in the journal ("I usually
draw after the warm-up") or a rule in the mandate, and it holds only as far as
the mind follows it today.

### 4.3 How a day happens

1. **Decision points.** A Soul decides when it finishes something, when
   something addressed to it happens (an ask, an invitation), when a world
   event or one of its mandate's triggers fires, or when it has been idle for
   the poll interval.
2. **The mind chooses** (the cheap model, Jev): given character, mandate,
   needs, journal, the world's customs and what it sees, it picks one card
   from those playable now, with a manner. This is the non-deterministic
   evaluation Gene asks for. **The choice is logged as a decision event**, so
   replay repeats the day without calling a model.
3. **Reflex** (code, free) handles only what needs no judgement: carrying on
   with an activity in progress; answering yes or no where the mandate already
   says; an owner's `now` rule; collapse (a Soul with no energy sleeps).
4. **Shared moments emerge.** Someone hosts (a gathering thing appears in the
   kernel, as in the DJ story), others see it and their needs and customs make
   joining likely. The supper bell makes hosting supper likely for whoever
   tends to cook. Nobody is scheduled to attend.
5. **Reflection, once a day per Soul** (a slightly larger call, at dusk or
   before sleep): the Soul reads its day's events and rewrites its journal:
   what happened, what is unfinished, what it tends to do, what it wants
   tomorrow. This is how habits form, drift and respond to steering. It is the
   "self-update" of D12.
6. **When the budget is spent or a model fails**, a seeded chooser in code
   picks among playable cards by needs and by likeness to the journal's
   habits. The world never stops. The same chooser is the fake mind for tests.

**Cost** at four Souls: an activity lasts 5–12 minutes, so about 8 decisions
per Soul per one-hour day: about 770 cheap calls per real day, under $0.10.
Reflection: 96 calls per real day, about $0.10 on Jev or $0.30 on Haiku.
Speech and align calls take the rest of the $1 (D21).

**What keeps it coherent without a schedule:**
- the deck: a mind is only offered cards that are playable here and now;
- needs: hunger and tiredness make eating and sleeping happen;
- customs and world events: common knowledge of when things usually happen;
- the place is small: every card's target is in the camp;
- a recent-acts list in the prompt, against loops;
- measurement, not enforcement: the soak test reports attendance at shared
  moments, variety per Soul and day-to-day similarity. Tune the customs, the
  needs and the prompt. Do not add a timetable.

Do **not** use Mars's `living_intention` or `tickLivingDay` as the day driver:
they are one-shot scripts. Mars activities enter as cards.

### 4.4 Steering: one mandate, many rules (D12)

There are no kinds of steering. A Soul has a **mandate**: a list of rules in
its owner's words. Every steer adds, changes or removes a rule. With no owner
input a Soul still has its character, journal and the world's customs, so its
behaviour never stops; more rules make it more particular.

When a rule is added, **one align call** (the compiler, Haiku) reads it and:
- tells the owner what it understood and what objective effect to expect;
- mints a card if the rule needs an action the world lacks;
- attaches **triggers**: the moments at which this rule should wake the mind.

A trigger says **when to think**, not what to do:

| Gene's example | Trigger | What happens |
|---|---|---|
| "do this now" | now | the one case code runs directly: the agenda starts at the next tick and takes precedence |
| "do this at 5pm every day" | a time of day | the mind is woken then with the rule in front of it |
| "do this every time bill is having a party" | a kernel condition (Bill hosts a gathering), watched by code at no cost | the mind is woken when it becomes true |
| "do this if you feel like it" | none | the rule is simply part of the mandate the mind reads at every decision |

- The rule's text always goes to the mind. Triggers only make sure the mind
  looks at the right moment.
- **No time limit** (Gene). A `now` steer is finished when its cards have
  played: the kernel logged their changes, which is the objective effect. If a
  step stays impossible for ten minutes, Sim's give-up rule ends it. The Soul
  panel shows: done, or blocked and why.
- An owner's `now` outranks everything. Otherwise the mind weighs rules,
  needs and customs. A rule the owner marks as strict is put first in the
  prompt and reported when it is not followed.
- Rules and triggers are state on the Soul in the kernel, changed by logged
  events. The owner's words stay private, as wishes do today.
- **The poll interval is a budget setting** (D21): shorter as calls get
  cheaper or Souls are batched in one call.

### 4.5 Persistence: quiet points

The engine cannot save mid-activity, and does not need to. Sim's rule is:
**state = last snapshot + replay of the log after it.** Replay re-submits the
logged decisions at the same ticks to a deterministic engine.

- Take engine snapshots **only at quiet points**: ticks at which every running
  action is resumable.
- Without a timetable, quiet points are not guaranteed. So: when a snapshot is
  overdue (proposed: 10 minutes), Souls that finish an activity hold still for
  a moment before choosing again, until all are still; then snapshot. The wait
  is capped (proposed: 60 seconds), and it reads as people pausing.
- **First light is always a quiet point**: everyone stands before the day begins.
- On restart: restore the last quiet snapshot and replay the log since. An
  hour of four Souls replays in well under a minute.
- While the server is down the world is paused. It resumes at the same tick.

### 4.6 Compaction: the engine is renewed each day

At first light, build a **fresh Runtime from the WorldState alone**. Records,
events, histories and service stores start empty. Object progress, held items
and built structures survive, because they live in WorldState. This bounds
memory and tick cost; it is the pruning the engine lacks.

This must be proven first (§5 phase 3, step 1): run 48 simulated days with
and without compaction and compare state hashes at each compaction tick.

### 4.7 Faults

When the engine raises an invariant violation or an executor fault: log an
`admin` event with the diagnostic, restore the last quiet snapshot, replay up
to the tick before the faulting decision, and have that Soul choose again
without that card. After three faults on a card, quarantine it and list it in
the admin panel. The world never stays down.

### 4.8 What makes it change over time

- Journals: habits form and drift.
- Mandates that grow by steering ("rituals evolve through continual stewardship").
- Object progress that carries across days (a drawing, a garden bed, a book).
- **Building from the piles** (D10): what Souls build stays built.
- Things made by cards persist in the kernel; speech acts between Souls.
- Later, not now: longer memory, relationships, a narrator.

### 4.9 The four Mars Souls (made up by the planner; all owned by Gene)

| Soul | Character | Tends to |
|---|---|---|
| **Alice** | Exact, quiet, up first. Finishes what she starts and is bothered by what others leave half done. Shows care by fixing things. Dislikes noise and being watched while she works. | garden, build, tidy up, eat early, sleep early |
| **Bob** | Warm, loud, generous. Cannot bear an empty table. Cooks too much, invites everyone, remembers what each person likes. Bad at being alone and bad at finishing chores. | cook, host supper, light the fire, start conversations |
| **Carol** | Restless and funny, a night person. Starts five things and abandons four. Plays music whenever there is an instrument. Argues for sport and is late to everything, including supper. | music, drawing, walks, staying at the fire, sleeping late |
| **David** | Slow, dry, sceptical. Reads, plays chess, works at a computer for long stretches. Needs solitude after company. Teaches well when asked and never volunteers. | read, chess, computer work, give a class, leave gatherings first |

## 5. Phases

Each phase ends with a checkpoint that can be shown to Gene. Do them in order;
phases 5 and 6 may swap. Estimates are for one agent working with tests, and
are guesses.

### Phase 0 — Preflight (with Gene, before the long session)

1. Gene approves this plan.
2. The Mars repo is **not frozen and not moved**: its closing agent keeps
   working there for a few hours (D26). Our fork point is commit `75d0223`
   (tag `mars-world-v1-alpha`), taken by clone. The 48 uncommitted paths in
   its main checkout are other owners' work: never copied, never touched.
3. Check access and tools: SSH to the server; `git filter-repo`; the secret
   scanner; `wrangler` is not needed; Blender if the buildings job uses it.
4. Check quota (`<usage-tool>`) and agree the helper model.
5. Sim: sync and commit the eden4 notes.

### Phase 1 — Import (about 4 hours)

1. **Never rewrite the original Mars repo.** Work on a fresh clone made in the
   scratchpad: `git clone --no-local --single-branch --branch mars-world-v1-alpha …`
   (or clone and check out `75d0223`). Do not add a remote to the Mars repo.
2. Keep only the history that leads to `75d0223`. With `git filter-repo`:
   - drop from history: `viewer/e2e/**/*.png` and other screenshot baselines,
     `viewer/public/engine/takes/**`, `research/**/*.jpg`,
     `docs/engineering/*.png|jpg`, anything over 1 MB, `vendor/`;
   - keep all `.ts`, `.tsx`, `.mjs`, `.py`, `.md`, small `.json`;
   - move everything under `mars/`.
   Measure the result. Target: under 80 MB. If `docs/engineering/*.md` is
   still heavy, drop the largest logs from history and keep their final copies.
3. Add back, as one normal commit, the **current** copies of what was dropped
   and is still needed (current takes, current baselines), or put baselines in
   R2 and fetch them in the gate.
4. **Secret scan the whole filtered history before the first push.** This code
   has never left the laptop. Check for room capabilities
   (`.cloudflare/simulation-test-room.json`), tokens in logs and docs, and the
   SketchUp SDK. The global pre-commit scanner must pass; never `--no-verify`.
5. Vendor the files behind the two symlinks that the app needs at run time:
   the people GLBs (Quaternius, CC0) into the repo; the campus GLBs stay in R2
   (D6) and the app loads them by URL.
6. Clone `<old-sim-repo>` to `<repo>` (D3) and work there; leave `<old-sim-repo>` in place. Update `~/Eden/AGENTS.md`,
   `infra/sync-docs.sh`, memory files and the laptop launch config. `~/Eden` is
   not a Git repo, so nesting is safe.
7. Merge the filtered history (`git merge --allow-unrelated-histories`). Push to
   the private GitHub repo **only if the secret scan is clean** (D25); if it is
   not, fix or leave unpushed and report. Deploys do not need the push: they
   copy files from the laptop (`infra/deploy.sh`).
   Record the imported Mars commit in `mars/IMPORTED_FROM.md`, and keep the six
   shared wiring files of `INTEGRATION_BOUNDARY.md` easy to merge: the closing
   agent's two activities are imported later as a unit (phase 8).
8. `packages/engine-mars` imports from `mars/viewer/engine`. Remove
   `MARS_ENGINE_DIR` as a requirement; the Mars adapter tests now run in CI.
9. **Checkpoint:** `pnpm check` passes with the Mars tests on; the Mars engine
   tests (`node --test mars/viewer/engine/test/*.test.ts`, 1,465 tests) pass
   from the new location; the Mars app builds and runs locally from `mars/viewer`.

### Phase 2 — One app, many worlds (about 6 hours)

1. Server: world id, engine, port, database path and world folder from
   config. Remove the `WORLD_ID` constant. All routes under `/w/<world>/`.
2. `worlds/<id>/world.json`: name, engine, capabilities, day length, scene,
   customs, cast, card pack. A loader builds the starting WorldState from it.
3. Web: path routing. `/` lists worlds. One shell for every world (D8): the
   3D view with the panels beside it. The toy world moves to `/w/toy` and keeps
   running in production the whole time.
4. `/l/mars` and `/w/mars/20xx`: build the Mars app (`mars/viewer`) and serve
   it under those paths. First pass: mount its build as it is, with a base path.
5. Infra: systemd template unit, Caddy routes, Litestream and backups per
   world, deploy script per world, watchdog per world.
6. **Checkpoint and first production deploy:** `/w/toy` (unchanged behaviour),
   `/w/mars` on the Mars engine (the proving ground, as `ENGINE=mars` does
   now) with the panels, `/l/mars` with all 63 presets, the year pages.

### Phase 3 — The live Mars world (about 12 hours; the core of the tranche)

1. **Prove compaction and quiet points** (§4.5, §4.6) on the engine alone,
   with a script, before any other work. If a fresh Runtime from WorldState is
   not valid, find what state is missing and decide: carry it, or change the
   plan. Report to Gene.
2. **The place** (`worlds/mars/scene`; D10): a new canonical place of about
   40 × 40 m with a few plain buildings: a kitchen (table, food preparation),
   a living room (workstations, reading chairs, a chess table), a classroom
   corner, a fire circle, a garden with planters, four sleeping places, and a
   yard with **raw piles of building materials and a marked build site**. Compose from the
   existing scene factories (`classroomScene`, `livingDayWorld`, supper,
   garden, reading). Check every activity of §4.2 runs there as a Lab preset
   first (`/l/mars?scenario=camp`).
3. **Cards for Mars activities** (`worlds/mars/cards`): one card per Lab
   activity that runs reliably here, depiction = the Mars verb, conditions from the kernel (at the
   place; the seat is free).
4. **Clock, customs, world events, needs, journals, the decision loop and
   reflection** (§4.1–4.3). Alice, Bob, Carol and David (§4.9), all owned by
   Gene's account (D9). Dense days: offer as many of the Lab's activities as
   run reliably here. A seeded chooser stands in for models in tests.
5. **Streaming** (§3.4) and the 3D page `/w/mars`: the camp, the four Souls,
   sun over the hour, a free camera and a "follow" camera, name labels, the
   current card of each Soul.
6. **Faults** (§4.7).
7. **Soak test:** run at a fast clock on the laptop for 48 simulated days
   before the production deploy, then leave staging running at real speed.
   Pass when:
   no restart needed; tick time flat (within 20% from day 1 to day 48); memory
   flat; report (do not enforce) attendance at shared moments, variety per Soul and day-to-day similarity, with the fake chooser and, for one simulated day, with live models; a kill
   and restart in the middle of supper resumes with the same state hash as an
   uninterrupted run.
8. **Checkpoint:** Gene opens `/w/mars`, closes the browser, opens it an hour
   later, and the day has gone on.

### Phase 4 — Steering (about 6 hours)

1. The mandate (§4.4): rules in the owner's words, the align call, triggers
   that wake the mind, `now` steers. From the Soul panel and from MCP.
2. The mandate shown on the Soul panel: each rule's words, what the compiler
   understood, when it last fired and with what result. Rules can be removed.
3. Speech at shared moments, with the words model under the spend cap.
4. **Checkpoint:** each of Gene's four examples works on a Mars Soul: a `now`
   steer happens in 3D and the Soul then goes back to its own day; a
   time-of-day rule is mostly kept on later days; a condition rule wakes the
   Soul when Bob hosts; an "if you feel like it" rule happens on some days
   and not others. With steering removed, the Souls carry on. Spend stays
   under $1 per real day (D21).

### Phase 5 — Little Martians (about 6 hours; the floater body can be a helper's job)

1. **Body family `floater`** in the engine: an entity with `body.family`
   (default `humanoid`); a float way of moving (the planner with a radius and a
   hover height, no stairs); capabilities per §4 of `20`.
2. **Renderer `FloaterViews`**: a static GLB, with bob, tilt and yaw in code;
   the `ORIENT` map from `flock.html`. Process Verdelis; copy the seven web
   GLBs and about ten kin heads into `worlds/littlemartians/assets`.
3. **Activities.** For each Mars activity decide: works (gather, converse,
   wander, attend a class, the fire circle, sleep as "settle and dim"),
   approximates (dance as spin and bob; read as hovering at a book), or refuses
   with a named reason (eat, carry, chess). Record the table in
   `worlds/littlemartians/ACTIVITIES.md`. This table is the first real test of
   the capability layer in `20` §4.
4. **The place:** a small dome garden with a volcano as scenery, from the lore.
   Flat ground first. Terrain is a later tranche (`20` §6).
5. A one-hour day with customs and world events from the lore (§4.1–4.3, the
   same mechanism as Mars); characters from `wiki/02-pantheon.md`; all seven
   owned by Gene; kin drift in the background as scenery.
6. Humanoids must still work in this world (a visitor from Mars).
7. **Checkpoint:** `/w/littlemartians` runs for 24 hours.

### Phase 6 — Eden (about 1 hour; a helper's job)

A flat green ground, a sky, one idle humanoid (D21). `/w/eden`, `/l/eden`.

### Phase 6b — Building from the piles (after phase 4; size unknown until tried)

The Mars engine already has construction (racks, beams, the build-bay and
year-build presets) and carrying. Make them available in the live world: cards
for "carry a part from the pile" and "build the next part of the bay" at the
marked site, so that a Soul who chooses to build changes the place for good.
Start with one small structure. Carrying and lifting cannot be snapshotted
mid-action, which the quiet-point rule already handles. If the existing
construction verbs need a crew, let a host card gather one, as supper does.

### Phase 6c — The Little Martians buildings (a helper, in parallel, own timeline; D20)

Source scans (read-only): `<lm-3d-models>/architecture/tower/`
(the Ceramic Tower: pale blue-green, tiered, round arches on each level, a
finial) and `architecture/temple-minarete/` (the Minaret Temple: darker blue,
four legs with tall arches, a domed body with round windows, a stepped spire).

- Rebuild each **from scratch as regular geometry**: parametric tiers, arches,
  columns and openings with clean vertices. Not the scan, and not a decimated scan.
- Make it **much larger** than a head, with large rooms on each level and
  doors and windows wide enough for a floating head and for the camera.
- Use the scans' textures (glaze colour, drips, crackle) to make materials that
  resemble the originals.
- Deliver: a generator script (three.js procedural code, or a Blender Python
  script kept under `tools/`), the GLB, and a footprint for the engine
  (walls as obstacles, rooms as regions, openings passable), as a **building
  type of the Little Martians world** (`worlds/littlemartians/buildings/`).
- The lead places the tower in `/w/littlemartians` when both are ready. This
  job needs Gene's eye more than any other: publish pictures early.

### Phase 7 — Production and records (throughout, and at the end)

1. Deploy each milestone to staging, check it, then to production (D23):
   `/w/mars` live, `/w/eden`, the first Little Martians, the mandate, building
   from the piles, the buildings. **At least two production deploys a day**,
   at milestones the lead judges ready (D22). The toy world keeps running at `/w/toy`.
2. sim.mars.college is not touched (D7). Write, do not run, the steps for the
   later redirect.
3. At each milestone update `docs/STATUS.md` and the runbook in the repo, and
   at the end the eden4 notes and memory.

### Phase 8 — Import the closing agent's delta (when it finishes)

When the Mars closing agent records its final commits in
`INTEGRATION_BOUNDARY.md`: import its two activities (computer workshop,
library reading), their HUDs and tests as a unit, reconcile the six shared
wiring files, run their tests here, and add both to the Mars day if they fit.

### Later, not in this tranche

Stage 2 of the repo layout (the engine as packages); the whole 2026 campus
as a world or a changeable copy; terrain; the sim.mars.college redirect and retiring
the old Worker; retiring the toy world; talking faces for Little Martians;
logins and permissions for other owners; engine version pinning per world; world code
sandbox; the capability and landmark layers as formal interfaces; longer memory
and relationships; economy; the nine replay faults F1–F9 (fix those that touch
anything in this plan, list the rest).

## 6. Risks

| Risk | Sign | Response |
|---|---|---|
| A fresh Runtime from WorldState is not valid (compaction fails) | hashes differ in phase 3 step 1 | carry the missing state, or prune records in place, or compact only what is safe; report first |
| Planning spikes stall the 20 Hz loop | ticks over 50 ms | the camp is small and has few obstacles; cap replans per tick; let the loop catch up |
| Activities misbehave outside their authored scenes | refusals at the camp | keep each fixture group laid out as in its scene; test each as a Lab preset |
| Secrets or private media in Mars history | scanner hits | filter them out before the first push; never push the unfiltered clone |
| The Mars gate (85 minutes of browser tests) does not fit CI | — | CI runs the engine tests and a smoke set; the full gate is a manual pre-release step |
| Two UIs (Sim shell, Mars app) with different builds | — | mount the Mars build under a base path first; unify in stage 2 |
| three versions differ (Mars 0.185, Little Martians r170) | — | use Mars's version; test the GLBs load |
| Replay faults F1–F9 affect the live world | hash mismatch after restart | the soak test's restart check catches it; fix what it finds |
| a second admin has root on the server | — | accepted by Gene (D6); no private media on the box |

## 7. Rules for the agent who takes this

- Read `~/Eden/AGENTS.md` and `<agent-home>/AGENTS.md` first. eden3 is a separate
  lane on the same server: never touch `/opt/eden3`, the `mars` user or
  mars-mcp. Never rescale the server. DNS is Gene's.
- **`~/Mars` is read-only.** Import from a clone. Never rewrite, prune or
  delete anything there, including worktrees and the uncommitted paths.
- Nothing is pushed until the filtered history passes the secret scan.
- Local development uses `BRAIN_MODE=fake`. Production retains the stronger $0.50 default per rolling real 24 hours;
  the authorized absolute ceiling is $1/world/24 hours.
- Staging before production, always. The toy world keeps running in
  production throughout (D8).
- Do not modify, push from, or add a remote to the Mars checkout (D26).
- Do not design the economy, the world ontology or a plugin platform. When a
  choice touches them, take the practical path and add the question to `20` §8
  or `21` §8.
- Keep Gene's words apart from proposals. Only Gene moves things to Decided in `06`.
- Update `docs/STATUS.md` in the repo at each checkpoint.

## 8. Assumptions made for Gene (say no to any of them)

1. **The two buildings go in the Little Martians world**, not in Mars.
2. **Anyone with the link can watch** every world (pages marked noindex), as
   Mars and Sim are now. Only Gene can steer or administer. The Little
   Martians scans (Vanessa's work) are therefore public on the page.
3. **The worlds run all the time**, 24 one-hour days per real day, whether or
   not anyone watches. While the server is down a world is paused.
4. **Souls speak** at shared moments, in words made by the small model, inside
   the $1 a real day.
5. **Every Soul in the new worlds is owned by Gene's account** (D9): the four
   on Mars, the seven named Little Martians, the one humanoid in Eden. The
   Little Martians background kin are scenery, not Souls. The toy world keeps
   its existing native Souls as they are.
6. **`<old-sim-repo>` is left in place, unused**, after `<repo>` is cloned from
   it (D3). Production deploys come from `<repo>` from then on.
7. **The year pages stay at `/w/mars/20xx`** (D5), although they are static
   snapshots like the lab.
8. **Quality bar for a deploy**: Sim's tests, the Mars engine tests and a
   browser smoke test of each world. The full Mars release gate (85 minutes of
   browser tests) runs once at the end, not before each deploy.
9. **Web-ready Little Martians models are committed to the repo** (about
   20 MB). The Mars year pages keep loading the campus models from R2.
10. **The engine fork diverges from the Mars repo from the import onward.**
    Changes made here (the floater body, take fields, compaction) are not sent
    back.
11. **The nine replay faults F1–F9** are fixed only where this plan runs into them.
12. **Staging runs the same worlds as production**, with fake minds.
13. **Needs (energy, hunger, company, restlessness) are added to Souls** as
    part of §4.2. They are the planner's device for making days cohere without
    a timetable.

## 9. Still open for Gene (none blocks the start)

1. The world's customs and events for Mars (§4.1 is a first guess; Gene: "first guess is fine").
2. Little Martians customs and place details (the Little Martians artist has a say later).
3. Everything in `20` §8 and `21` §8.

## 10. Measured merge corrections (October 3, implementation facts)

- Import completed from exact `75d0223` and the published release43 closing
  unit `4b89357`, `1b57a55`, `ab1f6be`, `fa0c9b6`. Original source trees, DNS,
  Cloudflare and eden3 remain untouched.
- Every live world uses server-recorded chunks and the same playback shell,
  including Toy through a recording-only observer of its unchanged rules.
  Measured camp storage is about 13 KB/s, superseding the small streaming
  assumption; verified five-minute R2 segments and a bounded 24-hour SQLite
  buffer preserve rewind.
- Quiet checkpoints and fresh Runtime are proven over 48 camp days and 48
  seven-head ceramic-garden days, with exact actual activity restart and bounded
  memory/tick time. Held raising phases remain unsnappable; a codec’s existence
  does not mean every phase is resumable.
- The rebuilt buildings have wide ground ramps and paired floater lanes through
  five vertical openings. All seven rooms are reachable by ordinary physical
  movement; a humanoid can use ground entries and receives a named refusal for
  a floating-only shaft. Builds include generator scripts and engine footprints.
- Labs start paused, run only in the browser, and preserve the place and poses
  on Reset/reload. No server world state is involved. The original 65 presets
  and all eight years are retained; three new place snapshots bring the inventory
  to 68.
- Construction uses finite stage/frame/deck/stairs work, lowered into the original
  physical actions. Progress is the parts’ actual geometry/support, not a second
  checklist. Six autonomous days completed all 24 parts without a driver or
  recovery. A native interrupted sleep purpose needs bounded live-card blockage
  handling to avoid retaining a daily barrier; its finite Lab semantics stay intact.
- F1–F8 have successor replay regressions; F9 is preserved as an intentional
  frontier refusal. No universal claim about all historical native cases is made.

Full native Mars release-gate qualification and successor construction soak are
still pending; use MERGE-LOG for their eventual receipts. Deferred scope remains
unchanged from `23`: terrain, redirect, engine packages, talking faces, other
owners, persistent 2026 campus, economy and plugins.
