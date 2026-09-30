# eden4 — Eden as one persistent, simulated world

> Status (2026-09-30): **a vision with a running shell.** Rounds 1–8 (09-27 → 09-29)
> were brainstorm; rounds 9–15 designed and built **Sim**, the app shell
> (`<old-sim-repo>`, github.com/genekogan/sim, live at https://sim.eden.art), around a
> toy engine. The world itself (building, economy, ritual, rooms, graphics) is
> not built. Nothing here is decided unless it appears as **Decided** in
> [`06-DECISIONS-AND-OPEN-QUESTIONS.md`](06-DECISIONS-AND-OPEN-QUESTIONS.md).
> Inhabitants are now called **Souls**; notes written before 09-30 say "bodies".
> These notes are mirrored into the Sim repo at `docs/eden4/` (run
> `infra/sync-docs.sh` there after editing here).
> **eden4** is the working name (Gene, round 8). Earlier working names:
> "Eden World", "Eden 2.0", "the Covenant of the City".

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
| [`09-ONBOARDING-PROMPT.md`](09-ONBOARDING-PROMPT.md) | A paste-ready prompt for a new local session (current) |
| [`10-FRONTIER-REPRESENTATION.md`](10-FRONTIER-REPRESENTATION.md) | Round 6: the field (Runway WorldPrompt, World Labs, rigging), Mars engine as of 09-28 (*historical*), nouns-open/verbs-closed, standing intents, any-topology bodies |
| [`11-STATE-AND-UPDATE-FORMALISM.md`](11-STATE-AND-UPDATE-FORMALISM.md) | *(vision; the log and fold are built in Sim)* Round 7: three layers (edge intents → policy → engine), the log, the fold, the intent payload |
| [`12-ENGINE-FRONTIER.md`](12-ENGINE-FRONTIER.md) | *(vision; a menu, research dated 2026-09)* Round 7: engine innovation menu (simulation, camera, rendering, NPCs, assets, physics, audio, networking) |
| [`13-PARAMETERS-AND-TRADEOFFS.md`](13-PARAMETERS-AND-TRADEOFFS.md) | *(vision)* Round 8: every dial, what each end gives, lean, and whether it's shelved for the community |
| [`14-MVP-TECHNICAL-SPEC-DRAFT.md`](14-MVP-TECHNICAL-SPEC-DRAFT.md) | Rounds 9–10 (*spec*): technical construction of a playable eden4, prior art, three timescales of mind |
| [`15-SCAFFOLD-SPEC.md`](15-SCAFFOLD-SPEC.md) | Rounds 11–13 (*spec*): the scaffold plan, then what was built (§15–§16) |
| [`16-HARDENING-SPRINT.md`](16-HARDENING-SPRINT.md) | Round 14 (*spec*): measurements, defects, the sprint; done/not-done at its top |
| [`17-AGENT-INTERFACE.md`](17-AGENT-INTERFACE.md) | Round 15: the arrive → own → steer → attach-an-agent flow, who knows what, open questions |
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
- The shell is built; the world is not. How Sim works, its current state and
  what remains are documented in the Sim repo (`docs/sim/`, `docs/STATUS.md`).
- The world ontology and anything about topics, regions and subscriptions are
  Gene's to design. Present shapes and trade-offs; do not settle them.
- Engine, camera and animation are the Mars project's scope until the takeover.
