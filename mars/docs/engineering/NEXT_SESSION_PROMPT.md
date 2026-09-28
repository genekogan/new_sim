# Takeover prompt — Mars College 3D Studio (pointer)

> **Content is parked (Gene, 2026-09-29 evening; OWNER_DECISIONS.md).** Historical content is Gene's separate job: no
> further reconstruction workers are scheduled and nothing is re-pinned or re-recorded for content. Per-year state,
> what each year needs from Gene and the exact re-run recipe: **`HISTORICAL_CONTENT.md`**.

The engine tranche was handed over on 2026-09-29 (HANDOFF.md "Handoff 2026-09-29 — engine tranche"). There are now two
separate takeover prompts; paste the one that matches the job:

- **Engine / simulation / controller / app agent:** `docs/engineering/HANDOFF_PROMPT_ENGINE.md` (the work list is
  `LAST_MILE.md`, ordered by its §13; the "Status at handoff" block under §11 says what is fixed, partial and left).
- **Historical content agent:** `docs/engineering/HISTORICAL_CONTENT.md` (per year: scene source, protected state and
  hash, north, pins, stale takes; the 2022 reconciliation; what each year needs from Gene; the re-run recipe; the
  engine / content boundary).

Both are local-git only (`<mars-campus-repo>`, author genekogan; never push). Verify the checkpoint
first: `cd viewer && npm run gate`.

**Usage rules (unchanged, for any unattended / overnight run):**

**Self-manage usage so you are never cut off by the 5-hour limit.** Nobody will report numbers to you
and `<usage-tool>` does not track this session, so budget by your own accounting:
- Target: spend roughly **50 % of each 5-hour window** overnight, so the session never hits the cap.
  Measured on 2026-09-28: one Opus subagent task of the usual size costs 150–300k subagent tokens and
  runs 10–30 minutes; six in parallel exhausted a full 5-hour window in about two hours. So overnight run
  **2–3 subagents at a time, never more**, and keep your own turns short (evaluate reports, don't
  re-derive their work).
- Keep a running tally in PROGRESS.md: for every subagent that finishes, note its reported token cost
  and the wall-clock time. If the sum since the last window boundary exceeds ~1.5 M subagent tokens per
  hour, drop to 2 workers; above ~2 M, drop to 1 and let it land. Window boundaries: assume windows
  start when you start; note the start time in PROGRESS.md.
- A 429 "session limit" error on any tool call means the window is exhausted: immediately stop
  spawning, let nothing new start, and write the checkpoint (below). Do not retry in a loop.
- Every ~2 hours, and always before you think a window may close: land what is running (each agent
  commits at its next green point), regenerate EVIDENCE.md, append PROGRESS.md, and update this file and
  HANDOFF.md so that a cut-off at any moment leaves a clean, resumable tree. Never let a limit catch
  agents mid-write — that is exactly what happened at 20:00 on 2026-09-28 and it cost an hour.
- In the morning Gene may raise the parallelism (he will say so and report numbers); until he does,
  the overnight rule stands.
