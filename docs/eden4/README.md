# eden4 — Eden as one persistent, simulated world

> Status: **idea development, not a project yet.** Brainstormed by Gene and
> Claude over 8 rounds, 2026-09-27 → 09-29. Nothing here is decided unless it
> appears as **Decided** in [`06-DECISIONS-AND-OPEN-QUESTIONS.md`](06-DECISIONS-AND-OPEN-QUESTIONS.md).
> **eden4** is the working name (Gene, round 8). Earlier working names:
> "Eden World", "Eden 2.0", "the Covenant of the City".

## Where it sits

- **A separate project from eden1, eden2 and eden3.** eden3 (the live
  insider-alpha on dev/bp.eden.art) is its own lane, described in
  `~/Eden/AGENTS.md`. Don't touch it from here.
- **Overlaps with the Mars world project** (the Mars studio engine and
  campus simulator, `07`). Gene: the Mars world "is eventually going to become
  a special case of the broader thing." Today, the Mars engine is the likely
  engine for eden4 and the Mars 2026 campus the likely first room.
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

| File | What it holds |
|---|---|
| [`01-VISION.md`](01-VISION.md) | Thesis, influences, soul, audience, the long arc |
| [`02-WORLD-AND-BODIES.md`](02-WORLD-AND-BODIES.md) | Bodies, arrival, the daily ritual, steering and idle life, ground growth, construction, rooms and doors |
| [`03-SIMULATOR-CHAIN-AND-NEUTRALITY.md`](03-SIMULATOR-CHAIN-AND-NEUTRALITY.md) | One simulator vs. decentralization, the interpreter debate, versioned-rules replay, what happens if Eden goes away |
| [`04-ECONOMY-AND-PROPERTY.md`](04-ECONOMY-AND-PROPERTY.md) | Manna, UBI, idle wealth, center/frontier inertia, parcels vs. commons, Harberger, treasury, NFTs |
| [`05-CREATION-AND-MODERATION.md`](05-CREATION-AND-MODERATION.md) | How art and media get into the world, creation at the edges, moderation |
| [`06-DECISIONS-AND-OPEN-QUESTIONS.md`](06-DECISIONS-AND-OPEN-QUESTIONS.md) | Ledger: Decided / Withdrawn / Leaning / Shelved / Open / Rejected |
| [`07-TRIBUTARIES.md`](07-TRIBUTARIES.md) | Existing code and prior work that feeds in (Mars engine, Abraham, eden3 manna, poop, prior writing), with paths |
| [`08-CONVERSATION-LOG.md`](08-CONVERSATION-LOG.md) | Chronology of the brainstorm, rounds 1–8, Gene's words separate from Claude's |
| [`09-ONBOARDING-PROMPT.md`](09-ONBOARDING-PROMPT.md) | A paste-ready prompt to start a new agent session |
| [`10-FRONTIER-REPRESENTATION.md`](10-FRONTIER-REPRESENTATION.md) | Round 6: the field (Runway WorldPrompt, World Labs, rigging), Mars engine as of 09-28, nouns-open/verbs-closed, standing intents, any-topology bodies |
| [`11-STATE-AND-UPDATE-FORMALISM.md`](11-STATE-AND-UPDATE-FORMALISM.md) | Round 7: three layers (edge intents → policy → engine), the log, the fold, the intent payload |
| [`12-ENGINE-FRONTIER.md`](12-ENGINE-FRONTIER.md) | Round 7: engine innovation menu (simulation, camera, rendering, NPCs, assets, physics, audio, networking) |
| [`13-PARAMETERS-AND-TRADEOFFS.md`](13-PARAMETERS-AND-TRADEOFFS.md) | Round 8: every dial, what each end gives, lean, and whether it's shelved for the community |
| [`report/eden4.html`](report/eden4.html) | The whole articulation as one HTML report |

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
  https://claude.ai/artifact/NXCEKB153vze1nX4mDcUS5 (private). When the docs
  change, update `report/eden4.html` and republish to that URL (needs a
  session with artifact publishing).
- Don't start building or scoping code until Gene asks. The "candidate first
  slice" in `06` is not approved.
