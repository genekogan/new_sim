# 03 — Simulator, chain and neutrality

This is **the central unresolved design knot.** Everything else depends on it.

## Starting facts

- **There is one simulator, not a decentralized one.** Gene: the simulator
  affects the actions and vice versa, so competing simulators would contradict
  each other. It's a single thing, run in one place.
- **The world state (or its record) is on-chain.**
- **The simulator itself is not on-chain**, so it can be experimented with heavily.
- The existing Mars engine (see `07`) is **deterministic**: the same plan
  gives a byte-identical result in Node and in Cloudflare workerd. Its plans
  are bound to a `physicalHash` and a `rulesVersion`, and it rejects stale
  plans. It has no background tick yet; the world advances only when called.

## Neutral compiler vs. central interpreter

**Interpreter** (Claude's earlier proposal): a model call that **Eden runs
and pays for** inside the central simulator. It acts as a "game master." When
an owner's agent asks for something outside the physics vocabulary ("build a
glass tea house"), the interpreter decides what that concretely means: which
materials, shape, cost, and whether it's allowed. The engine then executes
it. The interpreter's outputs are logged so that replay never re-calls a model.

**Gene's objection** (the key point): an interpreter conflicts with the world
being like a blockchain, a sequence of actions run through a pre-built
compiler, and with **credible neutrality**. *What happens if the interpreter
goes away?* The web3 lesson is that the artifact must be able to live alone:
decentralized, neutral, autonomous.

**The alternative Gene sketched:** lock the simulator in place and handle all
types ahead of time. There's a **fixed building vocabulary** (blocks, wood,
walls…), actions replay the world, and everything is replayable.
**His fear:** not being able to upgrade, or getting the initial spec wrong.

### Claude's current recommendation (Leaning, not decided)

1. **Move the interpreter to the edges.** The core is a fixed, neutral,
   deterministic vocabulary of primitives. Creative interpretation happens in
   owners' own agents: "glass tea house" → *their* LLM composes it from
   primitives and uploads the needed assets. The center never has to *judge
   meaning*, only validate and execute. This matches the Moltbook-style edges
   in `05`.
2. **Make the primitives generic enough to be expressive**, not a
   catalog of specific items. For example: volumes/blocks with a material,
   structural members, surfaces that can hold media (image, video, audio, 3D
   asset), light, sound, and doors/rooms. Expressiveness comes from
   composition plus uploaded assets, not from new verbs.
3. **Upgrade by adding vocabulary through versioned rules** (below), never by
   giving a central model discretion.
4. **If an LLM ever does run at the center**, only for things like turning a
   birth description into a body, its output is a logged event at birth. It's
   a one-time creative act, not ongoing discretion. Worth deciding whether
   even this belongs at the edge (the winner's agent supplies the body).

**Round 7 update:** Gene endorsed the *input shape* of Runway's WorldPrompt
resolved by the game engine. Claude's three-layer refinement (edge intents →
versioned policy → engine, intents as the logged unit) makes this section
concrete; see `11` and the report's chapters 4–5. Gene's answer to "how is the
policy deterministic with mushy inputs": it isn't mushy by the time it
arrives; the owner's agent emits a closed structured intent.

## Replayable *and* upgradeable: versioned rules

The claim (Gene now agrees in principle): immutability and upgradeability are
compatible if **every rule set stays runnable forever** and **upgrades are
events in history**.

- Every action is recorded with the rules version in force at the time.
- Rule versions are frozen and content-addressed, and never deleted.
- An upgrade is a logged event at tick N: "from tick N, rules vK", plus a
  logged **migration** from the old state shape to the new one.
- To replay: run v1 up to the first upgrade, migrate, run v2, and so on. The
  same log always yields the same world.
- **Mistakes in the spec are fixed forward, never retroactively.** History
  keeps the bug, the way Ethereum keeps the DAO fork. Upgrades become historic
  moments ("the day glass was invented") and add to the scarcity and
  canonicity Gene values.
- Cost: discipline. Old versions must stay deterministic and runnable
  (pinned dependencies, no floating-point drift across platforms, and so on).
  The engine's Node/workerd byte-identity is a promising start.
- Gene's phrasing: *"a future-proof rule set that replays the world from t=0
  with rules as they evolve. so the universe itself can evolve."*

## One simulator, many verifiers: the rollup analogy

(Claude, Leaning) This maps closely onto a blockchain **rollup**:

- **Eden is the sequencer.** It orders the inputs (births, steering, spends,
  uploads) and runs the canonical simulator.
- **On-chain:** the input log (or its commitments) plus periodic **state roots**.
- **Anyone can verify** by replaying the log with the open-source,
  versioned simulator and checking the root.
- **Escape hatch ("if Eden goes away"):** the log, all rule versions and all
  assets are public and permanently stored (for example on Arweave or IPFS),
  so anyone can reconstruct the world and continue sequencing it. This is how
  "the artifact can live alone" while still having one simulator.
- Open: who gets to sequence if Eden stops. Governance, the treasury, or a
  pre-committed succession rule.

## What's on-chain (Open)

| Candidate | Notes |
|---|---|
| Body NFTs | Yes, almost certainly |
| Auction and treasury | Yes (Nouns-style) |
| Input log | Full on-chain vs. commitments with data on Arweave/IPFS: a cost trade-off |
| State roots | Periodic, cheap |
| Manna balances | Open; see `04` |
| Rule versions | At least their hashes; the code lives in public permanent storage |
| Assets (media) | Content-addressed storage, with hashes in the log |

## Compute and scale

- Always-on simulation in steps of **seconds to minutes**, not per action,
  keeps compute bounded.
- Current engine limits: 30 simultaneous walkers take about 200 ms per tick
  (20 Hz), and there's no background loop. A **scheduled world-step loop** is
  the first infrastructure need.
- The body count grows by one a day, so 10,000 bodies is roughly a 2050s
  problem. The growth schedule doubles as the scaling roadmap.
- Idle-body behavior must be cheap: rule-based routines, not an LLM call per
  body per step.

## Self-modifying simulator (Gene's wild idea, Open)

Gene floated letting the simulator "interpret" and even **modify its own code
as it goes**, since the simulator isn't on-chain. Under versioned rules this
becomes possible *and* legitimate: every code change is a new rule version
logged at a tick. The open question is who or what is allowed to propose and
enact versions (the team, governance, an AI steward, the citizens?). It fits
the edge-interpreter model if changes are proposals that go through a process
rather than live model discretion.
