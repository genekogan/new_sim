# STATUS-F — morning summary page (worker F, 2026-10-25)

Done.

- `review/summary.mjs`: `node tools/playtest/review/summary.mjs [--runs-root dir] [--out file.html] [--assets dir] [--max-shots 12] [--night-log file]`
  writes one self-contained HTML page (inline CSS, light/dark, phone width; no scripts, no external resources, no base64).
  Sections: header (runs, requests, issues, FRs, quota from the newest preflight, two caveat sentences picked from the
  night log, first sentence of every COORDINATOR-NOTES.md) · basics scorecard (one row per run, per-seat sub-rows for the
  basics-walk-act batteries, one computed conclusion line) · egregious failures (every W and inside-solid / stuck oracle
  fail, physical first, then newest run; 12 thumbnails, the rest listed) · merged feature requests (top 15; tagged
  engine/world or agent/latency only when the Reviewer's class is unanimous O4/O1 or its wording says so) · issues by
  class O1..O5 + top 10 merged titles · Developer drafts (relative links) · runs index (REPORT.md + booklet page) ·
  harness notes (night log "Open harness items" as bullets, its last entry, and REPORT.md section 8 per run).
- Runs counted: those with `evidence/` and `ledger.tsv`. Reuses booklet `loadBundle`/`listRuns`/`md2html`, metrics
  `computeMetrics` (per-seat basics), reviewer `similar`. Absolute home paths are scrubbed from page text.
- Thumbnails: latest index shot of the request's seat inside sent..cutoff, else the evidence's last shot, else
  `shots/<seat>/`; resized with `sips` to 640 px JPEG, quality stepped down until < 120 KB.
- Tests: `review/test/summary.test.mjs` (2 tests; whole review suite 30/30 pass).
- Built page: `<team>/playtest/runs/summary/index.html` (~56 KB, 9 runs, 12 assets ~592 KB).
  Screenshots: `review/fixtures/summary-shots/` (viewport tops and section clips at 1280 and 400, dark at 400).

Caveats: FR merge compares against each group's first title/want only (earlier wording-chain merging snowballed to one
×70 group). Arrival in the scorecard is the strict arrival oracle, so Codex Astra reads 0/6 arrived in basics-2 even
though the night log reports it reaching most places (stopping short = P). trio-social-2 was still finishing when the
page was built (no REPORT.md section 8 yet); rerun the CLI to refresh.
