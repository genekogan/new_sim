# Retained release diagnostics

Generate a concise Markdown report and detailed JSON from **existing local evidence**. No dependencies, network, subprocesses, credentials, Modal calls, retries, gate mutations, or qualification decisions. The release owner retains all release authority. Run only outside a quiet test window.

```sh
node tools/release-diagnostics/report.mjs \
  --run /absolute/path/to/retained/gate \
  --evidence /absolute/path/to/copied-progress.jsonl \
  --evidence /absolute/path/to/copied-watch.jsonl \
  --cost-ledger /absolute/path/to/modal-tranche-cost-ledger.json \
  --out /absolute/path/to/new-report-directory

node --test tools/release-diagnostics/report.test.mjs
```

Without `--out`, Markdown goes to stdout. An output directory must be new and outside retained inputs. Exit 0 means report generation succeeded, including for a failed/incomplete run; **never use this exit code as a ship gate**. Exit 2 means invalid arguments or an input/read failure. Symlink evidence is refused; on macOS use the canonical `/private/var/...` path for temporary files if `/var` is an alias.

`--run` accepts a gate directory containing `receipt.json` and `candidate/out/`, or a standalone suite directory containing `out/`. Reads stay within that supplied run plus explicitly supplied evidence files. Paths embedded in receipts are not followed. Input contents remain unchanged; each read artifact gets an absolute path, byte count and SHA-256. A report is a snapshot; it does not freeze a concurrently changing run. Prefer a completed/stopped run or a retained copy.

The JSON schema (`schemaVersion: 1`, `kind: release-diagnostic-report`) includes:

| Field | Meaning |
| --- | --- |
| `outcome` | Completion, receipt result, comparison failure count, raw/accounted/unaccounted assertion counts, first unaccounted useful error and missing stages/logs. `newFailures=0` never overrides incomplete artifacts or unaccounted assertion failures. |
| `identity` / `identityMismatches` | Exact recorded source/archive, harness ref/tree/archive/suite tree, Node/pnpm runtime, baseline SHA/source. Unknown identities stay null. Metadata/receipt/group/source/app conflicts are exposed. Git commit contents and archive provenance are not independently revalidated. |
| `stages` / `observations` | Stage exit/time, first error, local path/line. Copied progress JSONL accepts `reads[].data.logs[].failures` as strings or `{title,line,context}` objects, retaining original failure context and observed container/time. Repeated snapshots do not multiply identical assertions. |
| `elapsed` / `groups` / `containers` | Driver wall time, step duration, observed container inventory and lower bounds. Step time excludes preparation/install. Missing exact container lifetimes, group-to-container mapping, CPU and memory allocation remain null. |
| `cost` | Exactly one app/name-matched entry from the supplied ledger, requested-resource plan, estimate method/rates/as-of and unknowns. An estimate remains explicitly distinct from an invoice. No current prices are fetched or guessed. |
| `release` | Separate implemented, locally verified, release-qualified and live-verified evidence states; exact supplied build/deployment timestamp. No CPU receipt alone establishes a deployed or release-qualified state. |
| `retainedEvidence` / `issues` | Complete artifact manifest and parsing/attribution problems. Retained evidence is presented before any decision about rerunning. |

An observed assertion failure is labelled `test-or-build-failure (product cause requires diagnosis)`: it may represent a product regression, stale expectation or harness defect. Infrastructure interruptions and operator stops are separate, possibly simultaneous observations. An operator stop is not silently relabelled a platform preemption. `receipt-reports-clean-cpu-scope` describes a complete passing/quarantined CPU receipt within its recorded scope; it is not a release qualification. This tool does not duplicate the harness's TAP inventory, quarantine, baseline, V7/V8 or ship-validation logic.

Raw `not ok`/TODO observations remain retained even when expected. An observation matching the existing receipt's recorded quarantine by stage, assertion title and fail/TODO/SKIP status is labelled `accounted-by-receipt`; the TAP directive is removed for title comparison, and a recorded hierarchical ID may end in ` > <title>`. A legitimate complete passing/quarantined receipt with only these accounted assertions reports clean CPU scope, including an already accounted nonzero stage exit. Expected observations are counted separately and do not become the first error or a new product-failure category. A TODO directive by itself is not accounting; unaccounted assertions still surface as failures. The reporter never adds quarantine entries or certifies their validity. Modal's normal `local entrypoint completed` shutdown is retained as completion, not an operator interruption.

Optionally pass `--release-evidence <json>` to display already retained release-owner claims, pinned to the same exact source SHA:

```json
{
  "sourceSha": "<full candidate SHA>",
  "build": "<exact observed build>",
  "deployedAt": "2026-10-27T22:00:00-04:00",
  "implemented": ["implementation-handoff.txt"],
  "locallyVerified": ["focused-test.log"],
  "releaseQualified": ["ship-receipt.json"],
  "liveVerified": ["live-check.json"]
}
```

Paths are absolute or relative to that JSON file. Successful reads produce `reported-with-retained-evidence`, **not certified acceptance**. Missing evidence, a different source or a deployment timestamp without an explicit timezone prevents the corresponding claim from being presented as established. Do not infer a build from a source SHA or treat a gate end time as deployment time. This optional input is a report attachment, not another active status ledger.

Focused fixtures include the retained regression shape: stopped V5, `SHARDS-MISSING`, two real assertions in copied JSONL and `newFailures=[]`; it reports failure observed/incomplete. A complete passing/quarantined case with accounted failure+TODO reports clean CPU scope; an unaccounted failure/TODO or same title quarantined in another stage cannot be hidden. Other checks cover conflicting provenance, hidden assertion failures, missing logs, infrastructure-only interruption, app/cost ambiguity, source-pinned release claims, zoned timestamps, lower-bound lifetimes and output immutability.

Known limits: textual errors are diagnostic observations rather than a replacement test parser; aggregate failures can appear alongside leaf failures. Distinct assertion counts deduplicate identical stage/title across snapshots and can undercount identically named tests. Infrastructure patterns can identify a symptom without identifying its cause. Exact compute invoices and per-container metering cannot be recovered when absent from retained evidence. Nothing in this directory changes the release contract or establishes checkpoint/resume validity.
