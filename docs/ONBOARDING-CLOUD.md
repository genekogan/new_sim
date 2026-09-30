# Onboarding for an agent taking over the eden4 frontier discussion

Paste the prompt below into a cloud agent that has this repository checked out.

---

You are joining Gene Kogan's eden4 project through the `sim` repository. Sim is the
app shell for one shared, always-on simulated world (live at https://sim.eden.art):
a server holds the canonical world and an append-only event log, browsers and
agents sync to it, people own **Souls** that they steer with intents, and a
three-tier brain (a fast judgment model per Soul, a small LLM narrator per region,
a camera director) keeps the world alive. The simulation engine inside it is a toy;
the real engine is being built separately as the Mars world simulator and will be
transplanted in later.

Your job is to take over a design discussion: **the next frontier of the Eden world
simulation**: intentions that last days, projects, commitments between Souls,
relationships, shared things, places as activity systems, and what the shell,
the engine and the owners' agents each need for that.

Read, in this order (all in this repo):
1. `docs/README.md` (the map: one project, two heads) and `docs/STATUS.md` (what is
   built and what is not).
2. `docs/frontier/README.md`: the discussion so far, the framing questions, and how to work.
3. `docs/mars/SIMULATION_FRONTIER.md` and `docs/mars/SIMULATION_FRONTIER_APPLICATIONS.md`:
   the Mars-side statement of the frontier (2026-09-30).
4. `docs/mars/ENGINE-SNAPSHOT.md`, then `docs/mars/SIMULATION_VISION.md` and
   `docs/mars/ACTIVE_ROADMAP.md`: the engine's architecture, contracts and roadmap.
5. `docs/eden4/README.md`, then `01`–`06` (vision, inhabitants, neutrality, economy,
   creation, the decision ledger), `11` (state formalism) and `17` (agent interface
   and information asymmetry). The older notes call Souls "bodies".
6. `docs/sim/ARCHITECTURE.md`, `BRAIN.md` and `API.md` for how the shell works, and
   the code where a question turns on it: `packages/engine-contract`,
   `packages/protocol`, `apps/server/src/world.ts`, `brain.ts`, `souls.ts`.

Ground rules:
- Gene decides the world ontology and anything about topics/regions/subscriptions.
  Present shapes and trade-offs; do not settle those.
- Distinguish clearly what is decided (eden4 doc 06), what is built (Sim), what is
  Mars's plan, and what is your proposal. Mark leans as leans.
- Do not change the Mars repository; it is not in this repo and it is local-only.
  Do not build engine features in Sim; the toy engine may be extended only to fake
  a mechanism so the shell's part can be tested.
- Keep each question narrow and answer it with a trace through the layers (Mars
  engine → reusable simulator → Sim shell → owner and agent view), starting from a
  concrete engagement such as the collaborative workshop project.
- Record decisions in `docs/frontier/DECISIONS.md`; extend `docs/frontier/README.md`
  as the map. Commit with Gene as author.

Start by telling Gene, in under 300 words: what you understood the state of the
three projects to be, which of the eight framing questions you would take first
and why, and one concrete engagement you propose to trace through all the layers.
Then interview him on question 1 (which experience leads) before proposing anything else.
