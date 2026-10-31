# Release diagnostics

Generates a concise Markdown report and a detailed JSON report from **existing local evidence** of a gate run. No
dependencies, network, subprocesses, credentials, cloud calls, retries or gate changes; it makes no release decision.

```sh
node tools/release-diagnostics/report.mjs \
  --run /absolute/path/to/gate-run \
  --evidence /absolute/path/to/progress.jsonl \
  --evidence /absolute/path/to/watch.jsonl \
  --cost-ledger /absolute/path/to/cost-ledger.json \
  --out /absolute/path/to/new-report-directory

node --test tools/release-diagnostics/report.test.mjs
```

Without `--out`, Markdown goes to stdout. The output directory must be new and outside the inputs. Exit 0 means the
report was generated, including for a failed or incomplete run: **never use the exit code as a ship gate**. Exit 2 means
invalid arguments or an unreadable input. Symlinked evidence is refused (on macOS, pass `/private/var/...` rather than
the `/var` alias).

`--run` takes a gate directory containing `receipt.json` and `candidate/out/`, or a suite directory containing `out/`.
Reads stay within that run and the explicitly supplied evidence files; paths embedded in receipts are not followed.
Each artifact read is recorded with its absolute path, byte count and SHA-256. A report is a snapshot, so prefer a
completed or stopped run.

The JSON (`schemaVersion: 1`, `kind: release-diagnostic-report`) contains:

| Field | Meaning |
| --- | --- |
| `outcome` | Completion, receipt result, comparison failure count, raw/accounted/unaccounted assertion counts, first unaccounted error, missing stages/logs. `newFailures=0` never overrides incomplete artifacts or unaccounted failures. |
| `identity` / `identityMismatches` | Recorded source/archive, harness ref/tree, Node/pnpm runtime, baseline. Unknown values stay null; conflicts are listed. Git contents are not revalidated. |
| `stages` / `observations` | Stage exit/time, first error, local path/line. Progress JSONL failures may be strings or `{title,line,context}` objects; repeated snapshots do not multiply identical assertions. |
| `elapsed` / `groups` / `containers` | Driver wall time, step duration (excluding install), observed containers and lower bounds. Unknown lifetimes, CPU and memory stay null. |
| `cost` | The one app-matched ledger entry, requested resources, estimate method/rates and unknowns. An estimate is not an invoice; no prices are fetched. |
| `release` | Separate implemented, locally verified, release-qualified and live-verified evidence states. A CPU receipt alone never establishes release qualification or deployment. |
| `retainedEvidence` / `issues` | Artifact manifest and parsing/attribution problems. |

An assertion failure is labelled `test-or-build-failure (product cause requires diagnosis)`: it may be a regression, a
stale expectation or a harness defect. Infrastructure interruptions and operator stops are separate observations; an
operator stop is never relabelled a preemption. A failure or TODO matching the receipt's recorded quarantine by stage,
title and status is `accounted-by-receipt`; a complete passing or quarantined receipt with only accounted assertions
reports `receipt-reports-clean-cpu-scope`, which is not a release qualification. A TODO directive alone is not
accounting, and the reporter never adds quarantine entries.

`--release-evidence <json>` attaches existing release claims, pinned to the same source SHA:

```json
{
  "sourceSha": "<full candidate SHA>",
  "build": "<observed build>",
  "deployedAt": "<ISO timestamp with timezone>",
  "implemented": ["implementation-notes.txt"],
  "locallyVerified": ["focused-test.log"],
  "releaseQualified": ["ship-receipt.json"],
  "liveVerified": ["live-check.json"]
}
```

Paths are absolute or relative to that JSON file. Readable evidence is reported as `reported-with-retained-evidence`,
**not certified acceptance**. Missing files, a different source SHA or a timestamp without a timezone keep that claim
unestablished. The tool never infers a build from a SHA or a deployment time from a gate end time.

Limits: textual errors are observations, not a test parser; aggregate and leaf failures can both appear; identical
stage/title pairs are deduplicated, so identically named tests can be undercounted; exact invoices and per-container
metering cannot be recovered when absent from the evidence.
