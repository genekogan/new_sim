# Codex brief: tooling (repair `npm run lint` and gate it; extend the source scan to `**`)

Branch `codex/tooling` · worktree per CODEX.md §1 (`TOPIC=tooling`) · ETA (estimate): 2–4 h of Codex work (more if
lint surfaces many real findings) · report: `docs/engineering/briefs/codex-tooling.REPORT.md`.

## Why

- **`npm run lint` is broken locally.** HANDOFF lists it as open since the 2026-09-28 checkpoint.
  `viewer/package.json` runs `oxlint app simulation lib deploy engine --ignore-pattern simulation/env.d.ts`.
  `viewer/.oxlintrc.json` sets `options: { typeAware: true, typeCheck: true }`, which needs the `tsgolint`
  executable. `oxlint-tsgolint` is not a devDependency, and `node_modules/@oxlint-tsgolint/` is an empty
  directory. The run ends with: "Failed to find tsgolint executable. You may need to add the `oxlint-tsgolint`
  package to your project?" (W33 reproduced this at `be0f66a`). Lint is **not** a gate stage.
- **The determinism source scan misses `**`.** `engine/test/core.test.ts:292-313` bans host transcendentals
  and `Math.hypot` / `Math.pow` in every file under `viewer/engine/`. It does not catch the exponent operator.
  `x ** y` is `Math.pow` under another name: implementation-approximated, so it can differ in the last bit
  across JS engines and break cross-host state hashes. **14 non-test engine lines use it today**, one each in:
  - `camera/quality.ts`, `carry/fragile.ts`;
  - `construction/{invariants,solar,stance}.ts`;
  - `core/hash.ts`, `env/sun.ts`;
  - `social/{actions,slots}.ts`, `spatial/{grid,path}.ts`;
  - `vehicles/curve.ts`;
  - and two in `take/metrics.ts`.

  All of these are Claude-owned.

## Context to read first

1. `docs/engineering/CODEX.md`, all of it. §1: **replace the `node_modules` symlink with your own `npm ci`
   before touching dependencies.**
2. `docs/engineering/ENGINE_GUIDE.md` (hard rules), and `docs/engineering/RELEASE_CHECKLIST.md` "Release gate".
3. `viewer/deploy/gate.mjs`:
   - its stages (lines ~39–46): `npm test`, `npm run test:engine`, `npx tsc --noEmit -p .`,
     `npm run e2e -- --workers=1`, `node deploy/determinism-probe.mjs`, and `simulation-integration` only when
     `SIM_BASE` is set;
   - it writes `.cloudflare/gate/<stamp>/{<step>.log,report.json}`;
   - `ok` means every step passed.
4. `viewer/.oxlintrc.json`, `viewer/package.json` (`lint`, devDependencies `oxlint` 1.76.0, `oxfmt` 0.61.0).
5. `viewer/engine/test/core.test.ts:292-313`, the current scan. Note the comment stripping it does for
   `core/math.ts` only.

## Files owned (create / edit only these)

- `viewer/.oxlintrc.json`.
- `viewer/package.json`, only the `lint` script and `devDependencies`, plus `viewer/package-lock.json`.
- `viewer/deploy/gate.mjs`, only to add a `lint` stage, and only once lint is green (below).
- **New** `viewer/engine/test/source-scan.test.ts`, plus deleting the old block `engine/test/core.test.ts:292-313`
  that it supersedes. That deletion is your **only** edit to `core.test.ts`.
- `docs/engineering/briefs/codex-tooling.REPORT.md`.

## Files forbidden (Claude-owned; read only)

- **All source files lint may complain about:** `viewer/app/**`, `viewer/engine/**` (except the new
  `source-scan.test.ts` and the one deletion above), `viewer/lib/**`, `viewer/simulation/**`, and `viewer/deploy/**`
  other than `gate.mjs`. You do **not** fix lint findings in source. You configure, report, and hand the list to
  the lead.
- **The 14 `**` lines.** Do not rewrite them. Replacing `x ** 2` by `x * x` can change bits, and so move pins.
  The lead does it with a re-pin decision.
- **`viewer/engine/take/**` entirely.** Take tracks / events thinning is Claude's; it is not part of this brief.
- `RELEASE_CHECKLIST.md` and every other `docs/engineering/*.md` other than your REPORT. The lead updates the
  checklist's gate description when it merges the lint stage.

**Pin rule (CODEX.md §4):** never edit a pinned hash. If one moves, STOP, REVERT, REPORT. Tooling must move none.
`test:engine` must give identical pass counts before and after, apart from the scan test moving files.

## Deliverables

1. **Lint runs.** Add the `oxlint-tsgolint` devDependency at the version matching `oxlint` 1.76.0 (check the
   oxlint docs or package metadata; say which), with `npm ci` in your own `node_modules`. If the package cannot
   be installed (network, platform), fall back to `typeAware: false` / `typeCheck: false` in `.oxlintrc.json`,
   state it, and state what coverage is lost. `tsc` already type-checks.
2. **Lint findings triaged, not fixed.** Run `npm run lint` on your branch. In the REPORT, give:
   - counts by rule and by top-level directory;
   - for each rule, whether it is a real bug class, noise for this codebase (with a reason), or a false positive
     of type-aware mode;
   - the complete list of real findings (file:line, rule, message).

   You **may** tune `.oxlintrc.json`: rule severities, `ignorePatterns` for generated or vendored files, per-rule
   options. Give one line of justification per change. You may **not** disable a rule just to get to zero if its
   findings are real. The lead fixes real findings in Claude-owned source.
3. **Gate stage, only when green.** If `npm run lint` exits 0 on your branch (after config tuning only), add a
   `lint` stage to `gate.mjs` right after `tsc`, with the same logging / timing / summary conventions as the other
   steps, and parse the error / warning counts into the step summary. If lint is not green, do **not** add the stage.
   Commit a gate change only when lint is green; the REPORT says what the lead must fix first.
4. **Source scan extended to `**`** (`engine/test/source-scan.test.ts`):
   - the existing ban list, unchanged;
   - **plus** the exponent operators `**` and `**=` in code;
   - comments and string / template literals are stripped first (no false hits on `/** doc */` or glob strings).
     Use a small tokenizer, not a line regex, and test it on tricky inputs: `/** a ** b */`, `'**/*.ts'`,
     `` `${a ** b}` `` (that one must be caught), regex literals;
   - the scope is every file under `viewer/engine/` except `engine/test/**`. Test files may use host maths for
     assertions; state the scope explicitly in the test name;
   - **an explicit allowlist of today's 14 `**` sites**, as `file` + the exact trimmed line text (not line
     numbers, which drift). The test passes today, fails for any new `**`, and fails if an allowlisted line
     disappears without being removed from the list, so the list only shrinks;
   - a unit test of the scanner on fixture strings: banned `Math.sin`, `Math.hypot`, `a ** b`, `x **= 2`; allowed
     `Math.sqrt`, `Math.abs`, a doc comment with `**`, a glob string.

   Then delete the superseded block from `core.test.ts`.
5. **Do not run `npm run gate`.** It is the lead's release gate (CODEX.md §3). Check your `gate.mjs` change with
   `node --check deploy/gate.mjs` and by reading the step list. The lead runs the full gate at merge.

## Tests (acceptance)

- `npm run lint` exits 0 (with the stage added), or the REPORT explains why not (with no stage added).
- `npm run test:engine`: the same pass / fail / skip totals as `main` (the scan test moved files, so the count is
  equal), `source-scan.test.ts` green, all pins unchanged.
- `npx tsc --noEmit -p .` clean, and `npm test` green (`gate.mjs` is imported by nothing, but check the allowlist
  scanner tests in `deploy/`).
- Deliberately invalid cases in `source-scan.test.ts`, as above.

## Report format

CODEX.md §8, plus:
- the `oxlint-tsgolint` version and install result;
- the lint findings table by rule and directory;
- the config changes, each with its justification;
- the real-findings list for the lead;
- the scanner's allowlist (all 14 entries).
