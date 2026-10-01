# The next frontier of the Eden world simulation

Started 2026-09-30 by Gene, from a discussion with the agent working on the Mars
world engine. **This folder is a discussion in progress, not a plan.** Take it
over: read, argue, extend, and record decisions in `DECISIONS.md` here.

## Latest

2026-10-01: Gene answered the agent-interface questions (`../eden4/17-AGENT-INTERFACE.md`,
last section) and Claude proposed a design that responds to them and to his
competing goals: `../eden4/18-KERNEL-CARDS-AND-SELF-CHANGE.md` (a small kernel of
kinds and effects, an open minted action space of cards, speech acts, layered
knowing, and levels of self-change). It awaits Gene's answers to its eight questions.

## What is in this folder

- `../mars/SIMULATION_FRONTIER.md`, `../mars/SIMULATION_FRONTIER_APPLICATIONS.md`:
  the Mars-side statement of the frontier, mirrored verbatim on 2026-09-30. The
  first describes the capabilities (multi-day projects, commitments, relationships,
  learning, care, social choreography) and the continuity they need; the second
  separates Mars-shaped engagements, the reusable simulator, and the broader Eden
  world.
- `../mars/` holds the rest of the Mars engine's docs (indexed in its README) and
  `ENGINE-SNAPSHOT.md`, a survey of the engine's architecture and contracts as
  Sim wraps them.
- `../eden4/`: the seventeen eden4 strategy documents (vision, bodies, neutrality
  and versioned rules, economy, formalism, engine frontier, dials, the MVP and
  scaffold specs, the hardening sprint, the agent interface).
- `../sim/`: how Sim (this repo) actually works; `../STATUS.md`: what is built and what is not.

## Where the three projects stand

| | State on 2026-09-30 |
|---|---|
| **Mars engine** | Release 24 live: deterministic engine; classroom → talks → conversation → food → quiet rest → resumed work as one purposeful routine; physical furniture setup. Release 25 (continuing purposes, first non-Mars studio) passed locally, failed in production, rolled back. Local-only Git. Details: `../mars/ENGINE-SNAPSHOT.md`. |
| **Sim (this repo)** | The shell: one canonical world on a server, event log + replay, WebSocket sync, accounts, Souls, three-tier brain (Jev mid-brain, Haiku narrator, Jev director), agent pairing, MCP, spend governor, staging/rollback, R2 replication. Engine is a toy behind the Mars contract. Live at sim.eden.art. Details: `../STATUS.md`. |
| **eden4 (the idea)** | One persistent, centrally simulated world; owned inhabitants (Souls, "bodies" in the older notes) as the unit; always on; steering not puppeting; versioned rules; economy designed as we go; names and numbers deliberately shelved. |

## The discussion, framed

The Mars frontier and the eden4 vision describe the same leap from two sides.
Mars asks: how do a few dozen simulated people sustain intentions across days,
cooperate, and leave consequences? eden4 asks: how do hundreds of *owned* Souls,
each steered occasionally by a person or an agent, do that together in one shared
world that keeps its history? The shell already forces some answers (the log is
canonical; the mind is three tiers; steering is intents), and leaves the rest open.

Questions worth taking up, roughly in order of how much they constrain the rest:

1. **Which experience leads?** Mars's own doc asks it: a society you direct and
   observe, a world you inhabit, or a world-building environment. eden4's answer
   so far is "a society of owned Souls that people steer and watch", with Gene
   also wanting to walk the camera around. Does the frontier's "prepare an
   exhibition opening tonight" belong to the narrator (a governance-keyed scene
   intent), to a group of owners, or to a single owner?
2. **What is the unit of a long intention?** eden4 has one standing intent per
   Soul (doc 11, Q22). The frontier needs *projects*: unfinished state, materials,
   collaborators, milestones, suspended/finished status, handover. Is a project an
   entity in the world state (so it is canonical, hashed, visible), an intent with
   a recurrence and a memory, or a narrator-owned beat? What does an owner's agent
   see of it through `perceive`?
3. **Commitments between Souls.** "Ask for help, accept, decline, postpone" is a
   message between minds. Sim's minds do not talk. Is a commitment an event kind
   in the log (auditable, replayable, public), and who may author it: the Soul's
   mid-brain, the owner's agent, or both?
4. **Relationships and local knowledge.** The frontier wants familiarity to
   change choices and wants people to know only what they have seen. eden4's doc
   17 raises the same asymmetry for agents. Where does memory live: in the
   canonical state (replayable, but heavy and public), in the mind (cheap, not
   replayable), or in the log as derived views?
5. **Shared things.** Borrowing, reservations, return obligations, wear, depletion
   and care. Mars has reservations and support graphs already; eden4 has manna
   and property (doc 04). Which of these is state, which is economy, and which is
   simply an activity template with preconditions?
6. **Places as activity systems.** The frontier's table (kitchen, workshop,
   gallery, household, garden, café, clinic, transport) is a vocabulary of
   *affordances*. eden4 doc 03 argues for a fixed, neutral primitive vocabulary
   upgraded by versioned rules, with meaning at the edges. Which places are
   primitives, which are compositions, and how does a new kind of place enter the
   world without a central interpreter?
7. **Scale of mind.** Mars insists routine behavior never depends on continuous
   model calls; Sim's mid-brain calls Jev only on events and self-set timers, and
   the narrator plans per region. Multi-day projects and commitments want a
   *fourth* timescale (hours to days): who thinks at it, how often, and at what
   cost per Soul?
8. **What Gene wants to decide himself.** Topic/region subscriptions and the
   world ontology are explicitly his (2026-09-30). Design here should present
   shapes and trade-offs for him, not settle them.

## Suggested way to work

Start from one engagement, as the Mars doc advises ("derive the minimum
mechanisms from a working engagement"), and trace it through all three layers: how
Mars would run it, what the reusable simulator needs, what the Sim shell must add
(events, views, agent API), and what an owner and an agent would see. The
collaborative workshop project followed by a gallery opening is the strongest
candidate on both sides. Keep the toy engine in mind: any mechanism can be faked
in Sim today to test the shell's part before the real engine arrives.

Record outcomes as short decision records in `DECISIONS.md` (one per decision:
question, options, choice, why, date). Keep this README as the map.
