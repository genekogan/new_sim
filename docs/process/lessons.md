# Lessons

Things this project learned the hard way. Each one is now a rule somewhere; this page keeps the reason.

- **A busy laptop is not a measurement instrument.** Arrival, latency and frame-rate numbers move several-fold with
  background load. Measure on a quiet machine, say which machine, and treat a timing bar you can't measure as
  unverified. Walks and the CDN walk are the machine-independent live checks.
- **Two repeats or no verdict.** A single run of a playtest arm can't separate a fix from reviewer variance.
- **Agent permissions are an onboarding problem.** Seats that compose absolute paths and chained commands get refused
  by their allowlist and give up. One relative command per call fixed it.
- **Closure rules need targets, not verbs.** "Done" must mean the body reached the resolved target. Most wrong results
  were a "done" ahead of the body.
- **Gate spend is a count problem.** Gating every iteration against a freshly re-run baseline multiplies cost. Cache
  the baseline, gate the release head, scope candidates ([Modal policy](modal-policy.md)).
- **One board, one lock.** Work spread across many status documents and lease files caused scheduling mistakes. Issues
  and PRs are the one board; the release workflow's concurrency group is the one lock.
- **Scripted e2e isn't proof of use.** A script that drives the page proves the script works. Only a walk on the real
  URL with real input shows a person can do it.
- **Contact sheets hide hitches.** Reviews use uncut, real-speed video.
- **Context is a budget.** Long agent sessions get slower, costlier and less accurate. Keep context small, hand large
  outputs to files, and start fresh sessions for new work.
- **Keep long-tail state out of agents' context.** Object state that is absent, distant or inactive must not grow what
  a Soul's agent reads each turn. Measure the bytes.
- **Docs drift unless the code is the authority.** Docs here describe the code; a PR that changes behaviour updates its
  doc, and reviewers check it.
