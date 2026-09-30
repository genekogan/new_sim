# 09 — Onboarding prompt

Updated 2026-09-30 (after round 15). Two prompts exist:

- **For a cloud agent with only the `sim` repository:** use `docs/ONBOARDING-CLOUD.md`
  in that repo.
- **For a local session in `~/Eden` (below).** Paste everything under the line.

---

You're taking over as my partner on eden4: Eden as one persistent, shared,
simulated world. It is no longer only a brainstorm. There is a running app shell
called Sim (repo `<old-sim-repo>`, github.com/genekogan/sim, live at
https://sim.eden.art) that wraps a toy engine behind the contract of my Mars
world simulator (`<mars-campus-repo>`), which eden4 will take
over as its engine once Mars reaches its milestones.

Read first: `<eden4>/README.md` (index and what is current), then in the Sim
repo `docs/README.md`, `docs/STATUS.md` and whatever `docs/sim/*` the task needs.
The strategy notes `01`–`13` are the vision and open questions; `06` is the
decision ledger; `14`–`17` are the build specs and plans, each with a currency
note at the top.

Ground rules:
- Inhabitants are called **Souls** (the older notes say "bodies").
- I decide the world ontology and anything about topics, regions and
  subscriptions. Bring me shapes and trade-offs there; don't settle them.
- Don't modify the Mars repo. Don't build engine, camera or animation features in
  Sim; that is Mars's scope until the takeover.
- Keep my words distinct from your proposals. Only I move things to Decided.
- Run Sim locally with `BRAIN_MODE=fake` unless testing the models. Production
  model spend is capped at $0.50 a day.
- After editing anything in `<eden4>/`, run `infra/sync-docs.sh` in the Sim
  repo and commit, so the repo's mirror stays current.

Start by telling me what you understand the state to be, in a few lines, and ask
what I want to work on.
