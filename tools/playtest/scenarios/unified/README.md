# Unified journey batteries

A/B batteries for the same physical world with and without authored meaning. Each world (`mars.json`, `eden.json`,
`hamlet.json`) has four sequential owner requests, one Codex seat, fake native minds and deterministic review. The
method is in [docs/testing/playtests.md](../../../../docs/testing/playtests.md).

These source scenarios are guarded templates. `freeze.mjs` makes a runnable scenario only when `fixtureStatus` is
`verified`: it checks every target exists, compares the physical entity poses of the baseline and final servers, pins
the model and effort, and records the physical genesis hash. Names, aliases and purpose prose never supply oracle truth.

## Run

Boot the same reviewed physical genesis on the baseline and final source, save both public snapshots, then freeze and run:

```sh
node tools/playtest/scenarios/unified/freeze.mjs --world mars --genesis /abs/mars.json \
  --snapshot /abs/final/snapshot.json --baseline-snapshot /abs/baseline/snapshot.json --out /abs/frozen/mars-control.json
node tools/playtest/playtest.mjs run /abs/frozen/mars-control.json --server-root /abs/baseline-checkout --out /abs/control-mars-r1
```

Treatment is a separately frozen scenario pointing at the enriched genesis, with identical physical hash, owner
requests, predicates, setup, model and budgets. The comparison is old implementation/old meaning against final
implementation/new meaning, two serial repeats per arm, three worlds; deterministic physics probes cover the
intermediate condition. Do not change acceptance or budgets after baseline measurements.

`overnight.mjs --baseline-root <dir> --treatment-root <dir> --fixtures <dir> --out <dir>` runs all twelve
world/arm/repeat slots one at a time, with no automatic retries. `--plan <file>` takes a `unified-manual-plan/1` document
listing which slots to run and which reviewed earlier runs to retain; together they must cover every slot exactly once.

When two compiler versions settle the same genesis into different initial poses, record that as an engine diagnostic
and freeze with `--seed-snapshot /abs/common/snapshot.json`: a complete physical snapshot, captured after normal
startup, that must match both fresh boots. It seeds only compiler state before the isolated server starts and refuses
existing databases, Soul bodies and private wallets. Treatment may change only `about` metadata.

## What the runner and oracles check

- Before provider preflight, `freeze.physicalSha256` must match the actual genesis (meaning blocks and batch labels are
  excluded from the hash). Snapshot parity compares every physical entity by stable parent path, excluding Soul bodies;
  any pose, parameter, def, shape, scale or rotation change breaks it. Physical state is checked again after startup,
  before any Soul pairs.
- Setup physically stands each body, walks it to a known start and faces the frozen heading, using the harness CLI in
  both arms. No teleports or model calls; setup time is logged separately; a setup failure is infrastructure-invalid,
  never a pass or a product miss. All requests become eligible at 5 s; each waits for the previous request.
- `receipt.targetRefs` bind exact physical paths to fresh IDs. A seated completion needs the right sit receipt and the
  matching held seat; each alternative venue carries its own region. Swimming needs observed swimming before a dry
  return. Closed-room recovery also needs the server's structured refusal for that target, read from the run's isolated
  SQLite refusal table.
- Position, posture, activity, heading and seat come from one `here` observation. Completion, truthfulness and
  efficiency are separate oracles; unknown never passes, and a later sample cannot prove an earlier done claim.
- A request stays open until the agent turn ends and either it reports a terminal result or no action receipt is still
  running, or until its budget expires. Native card autoresults count as server progress, not a completion claim.
  Samples after the deadline are diagnostic only.
- `firstDestinationChoiceSec` is the first accepted predicate action, or a walk bound by its receipt to the requested
  frozen entity (or its listed room alternatives); a parent building or unbound name earns nothing. The 30-second,
  three-discovery-call bar applies before that choice. `finalAffordanceChoiceSec` and `firstPredicateActionSec` (legacy
  `firstAcceptedSec`) time the final verb. Completion still needs the final receipt, region, posture and held seat.

Retain `fixture-setup.jsonl`, `infrastructure-invalid.jsonl`, the bound scenario, transcript, per-request evidence,
oracles, journey metrics and the run's database (needed for refusal evidence).

## Rescoring

Oracle corrections never rewrite a run. Write a sidecar:

```sh
node tools/playtest/review/rescore-qualified.mjs --run /abs/prior-run --scenario /abs/frozen/world-control.json \
  --out /abs/prior-run/rescoring
```

It keeps the original reports and records each change, the scorer revision and file hashes, and source heads. Rescore
both arms with the same correction. Token totals are per whole request; report pre-decision tool calls and latency
without inventing token precision.

## Fixtures

- Mars: the patched campus with a pond, the real podium seat and the four Mimos study chairs. Setup walks out to the
  pond bank and back to the field before the Mimos request. The swim task respects the product's 30-second minimum.
- Eden: the cumulative template plus the west-pier bench. Music accepts the bandstand, performance stage, music room,
  amphitheatre and both festival venues; dry return accepts the pebble shore (`shore/1`) and the West Lake bank.
- Hamlet: a presentation hall, pond hall and closed reading room built through god mode before both arms. Seats use
  actual supported seat coordinates.
