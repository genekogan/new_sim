# Playtest method

Playtests answer "can a person, through their agent, actually do this?" They are the evidence for T3 changes. The
framework is described in [testing/playtests.md](../testing/playtests.md); this page is about running them well.

## Running

- **Use a quiet machine.** Arrival times, acknowledgement latency and frame-rate bars move a lot under load. Nothing
  else runs on the machine during a battery or a ship check: no builds, test suites, other agents or background
  indexing. A battery contaminated by other work is re-run, not scored.
- **Two repeats per arm, or no verdict.** Compare baseline and candidate arms with at least two repeats each, and
  report ranges, not single numbers. One seat's score moves by a hit from reviewer variance alone.
- **Healthy seats only.** Seats are told to use one relative command per tool call from their own folder. A seat that
  hasn't paired within a couple of minutes is restarted, not scored.
- **Fake minds, isolated worlds.** Playtests run against a dev world with its own data directory. They never use real
  people's worlds or Souls.
- **Not in CI.** Playtests are run on purpose, for a change that needs them, with their budget stated up front.

## Judging

- **Closure needs a target.** An act is done when the body reached the resolved target, not when the agent said it
  was done or when the last step's verb matched. A wrong "done" is a failure even if the world looks fine.
- **The body is the truth.** Judge what the Soul's body did in the world, then what the agent claimed. An agent's claim
  ahead of its body is its own kind of bug.
- **Every failure becomes a case.** A finding goes into the issue with its replay and, when it is fixed, into a
  scenario so it stays fixed.
- **Watch it.** The Reviewer's verdicts link to uncut clips of the moments they judge.

## Directing

For a live scene with several Souls, use the [swarm director](../testing/swarm-director.md): a cast file states each
Soul's goal and a success condition the world can check. Directed runs are for exploring and demonstrating; measured
claims come from batteries with repeats.
