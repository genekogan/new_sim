# STATUS-S — story view (worker S, 2026-10-25)

**Done.** Every report now has a story: the session cut to 10–30 important moments. Each moment shows the
director's view at that time (the persona's own `shown/<n>.png`; a camera shot within 15 s otherwise), what the player
said and thought, what the agent ran and said, the card line, the body line, and the verdict chip with the
Reviewer's reason, the issue link and any oracle fails.

- `review/story.mjs`: `buildStory(run, {maxMoments=30, minGapSec=4, gapSec=90})`, `summarizeCall`, `readLedgerTsv`, and the CLI
  `node tools/playtest/review/story.mjs <run-dir> [--out story.html] [--max 30]`, which writes `<run>/story.json` and `<run>/story.html`.
- `review/story-html.mjs`: `renderStoryHtml` (a filmstrip plus a time-aligned timeline, one column per seat, stacked on a phone),
  `storyPage`, `storyLines`, `inlineThumbs` (sips, 640 px JPEG, about 40 KB each), `writeStory`.
- Hooks, each in a marked block:
  - `report.mjs` §2 lists the story as `m:ss · who · what · shot` plus a link to story.html, and `reportRun` writes the story.
  - `booklet.mjs` puts the Story section after Setup, adds a `story` (+ standalone) link per index row, and uses a wide page for multi-seat runs.
- Selection:
  - Importance: W or an oracle fail 3; a send, ack, result, reply or close 2; a body change, move or rating 1; idle glances 0.
  - Candidates within 4 s merge. The lowest importance is dropped first, densest first.
  - Sends, W closes and the final rating are never dropped. A dropped close's verdict rides on its send's moment.
  - Gaps over 90 s get one "nothing visible happened" frame.
  - Multi-seat runs share the budget: each seat gets max(10, ⌈1.6·max/seats⌉).
- Tests: `review/test/story.test.mjs` (4). The full suite passes: 47 tests.
- Built for all 16 runs with a ledger (1.0–3.0 MB each) and the booklet was rebuilt. Screenshots are in `review/fixtures/story-shots/` (`shoot.cjs`).

Open:
- The REPORT.md story list appears only when a run is re-reported; existing REPORT.md files were not regenerated.
- Tool-call times come from the transcript `_rx`. Codex transcripts without `_rx` fall back to cumulative call durations.
