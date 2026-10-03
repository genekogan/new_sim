# eden4 — Eden as one persistent, simulated world

> Status (2026-10-03): **the merge is running at sim.eden.art; canonical code is `<repo>`.**
> Current release, remaining work, verification and anything needing Gene are in
> [`MERGE-LOG.md`](MERGE-LOG.md). Preflight passed; Gene owns all twelve Souls
> in the three new worlds. Four persistent worlds share the 3D shell and private
> owner mandate controls; browser-only Labs and all eight year pages are mounted.
> Camp and Little Martians each passed 48 simulated days, exact restart and daily
> fresh-Runtime renewal. Construction/controller qualification is progressing;
> the final native Mars gate remains pending.
> The approved execution brief is [`23`](23-MERGE-KICKOFF-PROMPT.md), with plan
> v3 in [`22`](22-MERGE-PLAN.md). Original `~/Mars`, `~/Dev/littlemartians` and
> `<old-sim-repo>` are read-only references. The imported closing unit is exact
> release43 `fa0c9b6`; sim.mars.college stays on its independent old codebase.
> Historical rounds and the broader vision below are retained as design context,
> not a claim that their economy, terrain or community features have been built.
> Only Gene moves an item to **Decided** in [`06`](06-DECISIONS-AND-OPEN-QUESTIONS.md).
> Notes are mirrored into the Sim repo through `infra/sync-docs.sh`.

## Where it sits

- **A separate project from eden1, eden2 and eden3.** eden3 (the live
  insider-alpha on dev/bp.eden.art) is its own lane, described in
  `~/Eden/AGENTS.md`. Don't touch it from here.
- **One project, two heads.** The Mars world simulator
  (`<mars-campus-repo>`) is the engine: it is finished first,
  then eden4 takes over its development and generalizes it, and Mars becomes one
  world inside eden4. Sim is the shell built to wrap it. Gene: the Mars world
  "is eventually going to become a special case of the broader thing." 
- Moved here from `~/Eden/vision/eden-world/` on 2026-09-29.

## One paragraph

Eden becomes a single persistent 3D world, simulated in one place. Anyone can
buy a **body** and **drop into the world right away**; each body is an NFT, and
its owner names and describes it once. You own a **body, not a mind**. Bodies
are always on and stay **alive and influential even when their owners are
idle**. Owners steer them from any agent they like (Claude, ChatGPT, Codex, a
DAO). Every body receives **manna** daily as UBI and spends it to build, place
art and shape the city. The ground expands outward to make room: the rich,
slow, stable **center** keeps growing and hardening, while the poor, fast,
experimental **frontier** keeps moving outward. At the center, every day at a
time that rotates with the moon, there is **one ritual**. History is canonical
and replayable. The rules can evolve, but the past never changes.

*Sims × Second Life × Decentraland × Nouns DAO, applied to Eden, and a
successor to the Abraham Covenant.*

## Method: shape now, numbers later

Gene, round 8: *"i dont need to design everything now."* Fix what kinds of
things exist and how they change; leave the numbers (birth curve, UBI,
inertia, caps…) as dials set by rule versions after watching the early
community. Versioned rules make each change a logged event, never a
retroactive fix. Every dial, its trade-offs and its status is in
[`13-PARAMETERS-AND-TRADEOFFS.md`](13-PARAMETERS-AND-TRADEOFFS.md).

## Reading order

Currency: **vision** = still the design intent, open questions included · **ledger** = kept current · **historical** = a record of its date · **spec** = has a currency note at its top.

| File | What it holds |
|---|---|
| [`01-VISION.md`](01-VISION.md) | *(vision)* Thesis, influences, soul, audience, the long arc |
| [`02-WORLD-AND-BODIES.md`](02-WORLD-AND-BODIES.md) | *(vision)* Bodies, arrival, the daily ritual, steering and idle life, ground growth, construction, rooms and doors |
| [`03-SIMULATOR-CHAIN-AND-NEUTRALITY.md`](03-SIMULATOR-CHAIN-AND-NEUTRALITY.md) | *(vision)* One simulator vs. decentralization, the interpreter debate, versioned-rules replay, what happens if Eden goes away |
| [`04-ECONOMY-AND-PROPERTY.md`](04-ECONOMY-AND-PROPERTY.md) | *(vision)* Manna, UBI, idle wealth, center/frontier inertia, parcels vs. commons, Harberger, treasury, NFTs |
| [`05-CREATION-AND-MODERATION.md`](05-CREATION-AND-MODERATION.md) | *(vision)* How art and media get into the world, creation at the edges, moderation |
| [`06-DECISIONS-AND-OPEN-QUESTIONS.md`](06-DECISIONS-AND-OPEN-QUESTIONS.md) | *(ledger)* Ledger: Decided / Withdrawn / Leaning / Shelved / Open / Rejected |
| [`07-TRIBUTARIES.md`](07-TRIBUTARIES.md) | Existing code and prior work that feeds in (Abraham, eden3 manna, poop, prior writing), with paths. *Its Mars section is historical* |
| [`08-CONVERSATION-LOG.md`](08-CONVERSATION-LOG.md) | Chronology: rounds 1–8 in detail (Gene's words separate from Claude's), rounds 9–15 in brief |
| [`09-ONBOARDING-PROMPT.md`](09-ONBOARDING-PROMPT.md) | A paste-ready prompt for a new local session (*historical since 10-03*: use `23` for the merge tranche) |
| [`10-FRONTIER-REPRESENTATION.md`](10-FRONTIER-REPRESENTATION.md) | Round 6: the field (Runway WorldPrompt, World Labs, rigging), Mars engine as of 09-28 (*historical*), nouns-open/verbs-closed, standing intents, any-topology bodies |
| [`11-STATE-AND-UPDATE-FORMALISM.md`](11-STATE-AND-UPDATE-FORMALISM.md) | *(vision; the log and fold are built in Sim)* Round 7: three layers (edge intents → policy → engine), the log, the fold, the intent payload |
| [`12-ENGINE-FRONTIER.md`](12-ENGINE-FRONTIER.md) | *(vision; a menu, research dated 2026-09)* Round 7: engine innovation menu (simulation, camera, rendering, NPCs, assets, physics, audio, networking) |
| [`13-PARAMETERS-AND-TRADEOFFS.md`](13-PARAMETERS-AND-TRADEOFFS.md) | *(vision)* Round 8: every dial, what each end gives, lean, and whether it's shelved for the community |
| [`14-MVP-TECHNICAL-SPEC-DRAFT.md`](14-MVP-TECHNICAL-SPEC-DRAFT.md) | Rounds 9–10 (*spec*): technical construction of a playable eden4, prior art, three timescales of mind |
| [`15-SCAFFOLD-SPEC.md`](15-SCAFFOLD-SPEC.md) | Rounds 11–13 (*spec*): the scaffold plan, then what was built (§15–§16) |
| [`16-HARDENING-SPRINT.md`](16-HARDENING-SPRINT.md) | Round 14 (*spec*): measurements, defects, the sprint; done/not-done at its top |
| [`17-AGENT-INTERFACE.md`](17-AGENT-INTERFACE.md) | Round 15: the arrive → own → steer → attach-an-agent flow, who knows what, open questions, and Gene's answers (round 16) |
| [`18-KERNEL-CARDS-AND-SELF-CHANGE.md`](18-KERNEL-CARDS-AND-SELF-CHANGE.md) | Rounds 16–18 (*kernel, cards and speech are built; knowing and self-change are proposals*): a kernel that is a grammar (things, links, time, five changes) with open vocabulary; one coherence rule; cards, decks, plans and minting; speech acts; what running it taught; how the world can safely change itself |
| [`19-MARS-BRIDGE.md`](19-MARS-BRIDGE.md) | Round 18 (*proven on the proving ground, planned for the campus*): the shell running on the real Mars engine; body language as the layer between cards and engine verbs; how Mars's activities become vocabulary; scenes (proposed); what the takeover must change in the engine; first days |
| [`20-WORLDS-BODIES-AND-LIBRARIES.md`](20-WORLDS-BODIES-AND-LIBRARIES.md) | Round 19 (*a small decided core; the rest is proposal*): many worlds on one codebase; capabilities as general code that worlds turn on; world code; the engine as depiction that a world model may replace; bodies as family + morphology vector + skin; capabilities and landmarks instead of an adapter per body and activity; a library of things; terrain as landforms; build or reuse (three.js, Blender, glTF-Transform) |
| [`21-WORLD-ECONOMY-OPEN-QUESTIONS.md`](21-WORLD-ECONOMY-OPEN-QUESTIONS.md) | Round 19 (*nothing decided*): anyone mints a world; one birth a day per world; rent; Harberger on worlds and on residency; birth rate and death as constants; who owns a world |
| [`22-MERGE-PLAN.md`](22-MERGE-PLAN.md) | Round 19 (*plan v3, authorized and executing*): the implementation plan to merge the Mars engine into Sim, run it without stopping (a one-hour day from decisions, steering, quiet-point snapshots, nightly compaction), and add Little Martians and Eden. Decisions D1–D26, measured facts, phases, risks |
| [`23-MERGE-KICKOFF-PROMPT.md`](23-MERGE-KICKOFF-PROMPT.md) | The long onboarding prompt for the lead agent that executes `22` (a fresh session in `~/Eden`) |
| [`research/`](research/) | Reports R1–R8 (kernel prior art, agent worlds, ledger options, cheap dialogue, the Mars campus probe, Spore, The Sims, Second Life), two illustrated tours, `RESUME.md` (historical replay faults F1–F9; successor regressions cover F1–F8 and the intentional F9 frontier behavior), and the two books: `EDEN4-COMPENDIUM.html` (full) and `EDEN4-BLUEPRINT-STE.html` (short, plain English, with a worked example and a terms page) |
| [`report/eden4.html`](report/eden4.html) | The articulation after round 8 as one HTML report (*historical*: predates Sim) |

## Handoff note for the next agent

- Gene's mode is **exploratory**. Be a thinking partner: clarify, push back,
  recommend. He rejects combining ideas for their own sake (programs-not-pixels)
  and prefers **fewer rules**.
- Keep Gene's words distinct from Claude's proposals. Only Gene moves things to
  **Decided**. Round 8 added **Shelved** (let the community settle it) and
  withdrew two old decisions (1/day births; steering getting harder).
- Don't design every number. If a question is a dial, put it in `13` with its
  trade-offs rather than forcing an answer.
- The HTML report was published as a Claude artifact at
  https://claude.ai/artifact/NXCEKB153vze1nX4mDcUS5 (private). It reflects
  rounds 1–8 and has not been updated for Sim.
- The persistent camp, ceramic garden, green field and Toy are live; current proofs and limits are in MERGE-LOG. How Sim works, its current state and
  what remains are documented in the Sim repo (`docs/sim/`, `docs/STATUS.md`).
- The world ontology and anything about topics, regions and subscriptions are
  Gene's to design. Present shapes and trade-offs; do not settle them. The kernel
  in `18` is the ontology he judged "good enough to develop and try"; he intends
  to upgrade it.
- The takeover is executing under `22`/`23` (round 19). Mars direct development stops at
  its v1 alpha (release 42, tag `mars-world-v1-alpha`); from the import onward,
  engine, camera and animation are developed in the Sim repo. `19` remains the
  design of the bridge between cards and engine verbs.
- The economy and the ontology of worlds are deliberately open (`20` §8, `21` §8).
  Gene holds and tunes the worlds by hand for now. Build practically; do not
  design a platform.

## Deferred roadmap — outside this merge

Terrain, retiring/redirecting sim.mars.college, restructuring the engine into
packages, talking faces, logins/permissions for other owners, the 2026 campus as
a persistent world, economy and plugin platforms stay deferred. The ontology of
worlds and residency remains Gene’s open design work (`20` §8, `21` §8).

Practical implementation limits are not new product decisions: finite construction
uses the original small lookout; scenery kin are not Souls; static campus assets
use the published derivative proxy; a failed model or spent budget uses seeded
needs/journal choices; building types and floater shafts belong to the ceramic
garden. New ownership, property and capability policy needs another design pass.
