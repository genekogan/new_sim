# Capacity bench (`tools/bench/capacity/`)

Measures one world under N scripted Souls (fake minds, $0 model spend) on a fixed 2-core cgroup slice. Metrics and arms
are frozen in [`METRICS.md`](METRICS.md) (v1); the pass table is tranche §2. Tools-only: never gated, never on Modal.

- `bench.mjs`: the runner (boots one fresh world per arm and repeat, drives it, writes `result.json` per run, then `receipt.json` + `REPORT.md`).
- `report.mjs`: rebuilds `REPORT.md` from a run directory (`node report.mjs <out>`).
- `busy-scenario.mjs`: 15 s demo of the polite CLI against a fake `503 world.busy` world (no server needed).

## eden2 (R runs it; the numbers that gate)

Quiet window; record `uptime` before and after (the receipt does too). Everything lives under `/srv/sim-bench/` and
uses ports 5151–5152; it never touches eden3, the `mars` user, production worlds or their data dirs (the fixture is a
compact copy, made once, read-only to the bench).

1. **Source**: a checkout of the commit under test at `/srv/sim-bench/src` (`git -C /srv/sim-bench/src checkout <sha>`
   then `pnpm install --frozen-lockfile`). The baseline is main `da5269cd0`. The bench files are read from this
   lane's branch; copy `tools/bench/capacity/` into `/srv/sim-bench/bench/` if the commit under test predates them.
2. **Fixture** (compact copy only, never a whole DB copy):
   `python3 /srv/sim-bench/compact-copy.py <eden-2026 live sim.db> /srv/sim-bench/fixtures/eden-2026.db`
   (`compact-copy.py` = `team/ops/compact-copy.py`, copied over once; it opens the source read-only in one transaction).
   Note the world key and world id of the live Eden 2026 world (the bench reads the id from the fixture if not given).
3. **Run** (as root, so `systemd-run --scope --uid` can place only the world in the slice; the driver runs outside it):

```bash
cd /srv/sim-bench/src && node /srv/sim-bench/bench/bench.mjs --root /srv/sim-bench/src --fixture /srv/sim-bench/fixtures/eden-2026.db --world-key eden-2026 --out /srv/sim-bench/runs/baseline-da5269cd0 --host-label eden2-slice --world-user simworlds --slice "systemd-run --quiet --scope -p AllowedCPUs=6-7 -p MemoryMax=4G --uid=simworlds --gid=simworlds" --heap-mb 768 --repeats 2 > /srv/sim-bench/runs/baseline-da5269cd0.log 2>&1
```

   About 2 h for six arms × two repeats (boot + join + 60 s warm-up + 30 s idle + 2 × 120 s per run). Background it
   (`nohup … &`); judge by `receipt.json`, never by the shell's exit code.
4. **After**: copy `REPORT.md` + `receipt.json` (not `commands.jsonl`, not `souls/`) back to
   `team/scratch/srv/clients/eden2-<sha>/`; delete the fixture (`/srv/sim-bench/fixtures/eden-2026.db`) — that delete
   is on the bench's own scratch file, not a production artefact. The per-run data copies are moved to
   `~/.Trash/eden-cleanup-20261020/` by the bench itself.

The driver holds about two Node processes per Soul (its `listen` and the command in flight): at N = 24 that is ~50
processes, ~2 GB RSS, outside the slice.

## Laptop (smoke; INDICATIVE, never passes or fails)

```bash
node tools/bench/capacity/bench.mjs --root "$PWD" --fixture genesis:eden-2026 --out <team>/scratch/srv/clients/local-<sha> [--short]
```

`genesis:<template>` boots a fresh world from `worlds/templates/<template>.json` (no history, no real Souls), so it is
lighter than a compact copy of the live world.
