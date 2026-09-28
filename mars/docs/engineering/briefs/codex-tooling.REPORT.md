# Tooling — Codex report

## 2026-09-28

- Branch: `codex/tooling`; base after rebase: `bb0f932a3bba533631d1170fe149e404b1bb8840` (`git merge-base HEAD main` at report time).
- Feature commit: `05787d2` **Restore type-aware lint and extend deterministic source scan**. This report is the follow-up commit. Local only; no remote, push or deploy.

### Dependency and files

The installed `oxlint@1.76.0` package metadata declares an optional peer `oxlint-tsgolint >=7.0.2001`. Registry metadata identifies `oxlint-tsgolint@7.0.2003` as the current package with the `tsgolint` binary. I added **exact `7.0.2003`** to `viewer/package.json`/lock, replaced this worktree's `node_modules` symlink with its own directory, and verified the updated lock with `npm ci` (**98 packages installed, zero reported vulnerabilities**). Type-aware lint now executes and reports source findings instead of missing `tsgolint`.

- `.oxlintrc.json`: only `engine/test/**/*.test.ts` overrides `typescript/no-floating-promises` (Node's `test()` registers promises that the runner awaits), `typescript/no-explicit-any` (many deliberate invalid-input fixtures), and `typescript/restrict-template-expressions` (test diagnostic formatting). Production rules and type-aware/type-check options remain on.
- `engine/test/source-scan.test.ts`: a token scanner blanks comments, ordinary strings, regex literals and template text, retaining `${…}` code. It enforces the former host-Math ban and rejects new `**`/`**=` in all production `engine/**` files, excluding `engine/test/**`. A path-plus-exact-line allowlist names the 14 existing exponent sites and fails for new or removed sites. Fixture checks cover doc comments, glob strings, regexes, `Math.sqrt/abs`, `Math.sin/hypot`, exponent expressions, compound exponent assignment and template interpolation.
- `engine/test/core.test.ts`: deleted only the superseded source-scan test block. Its three now-unused imports remain because the brief permits no other edit there; they appear in lint's findings for the lead.
- `deploy/gate.mjs`: **unchanged**. Lint exits 1, so the brief forbids adding a stage until the owner fixes the remaining real findings. The lead also updates `RELEASE_CHECKLIST.md` if/when it merges a future lint stage.

### Tests after rebase

From `viewer/`: `npm run test:engine` **387 pass, 0 fail, 3 skip** (390 total, same totals as main); `npx tsc --noEmit -p .` **clean**; `npm test` **59 pass**; `node --check deploy/gate.mjs` **clean**. `node --test engine/test/source-scan.test.ts` **1 pass**. All pinned tests pass unchanged. `npm run lint` now runs but exits **1** with **114 errors** after the latest main rebase. No release gate was run.

### Lint findings and triage

After the test-only overrides and latest main rebase, the 114 findings are **engine 89, app 14, deploy 9, simulation 2**. Main's concurrent questions and take/camera work added findings in `app/lab/highlight.ts`, `deploy/questions-html.mjs`, and `deploy/record-campus-take.mjs`; the owner-review list gained one unused import. JSON results and the plain lint log are under `viewer/e2e/artifacts/codex-tooling-lint/` (gitignored).

| Rule | Count | Triage |
| --- | ---: | --- |
| `eslint(no-unused-vars)` | 26 | Real dead imports/locals; cleanup and check abandoned intent. Three are the old scan's imports intentionally left by this brief. |
| `unicorn(no-new-array)` | 13 | Noise: sized arrays are deliberately allocated for indexed filling. |
| `unicorn(no-useless-spread)` | 12 | Mostly defensive copying/style; a generic suggestion can alter aliasing intent. |
| `typescript(no-explicit-any)` | 10 | Real type-safety gaps in production engine boundaries. |
| `eslint(prefer-const)` | 10 | Style only; no behavior change. |
| `typescript(require-array-sort-compare)` | 10 | Current sites sort string-key tuples/strings lexically; explicit comparators would clarify intent but no current numeric-sort bug is shown. |
| `eslint(no-unused-expressions)` | 10 | Intentional comma expressions and side-effect shorthand; style noise. |
| `unicorn(no-useless-fallback-in-spread)` | 5 | Empty fallbacks are redundant but harmless. |
| `typescript(unbound-method)` | 4 | Type-aware false positives at test method probes and an explicit `.apply` wrapper. |
| `unicorn(prefer-string-starts-ends-with)` | 3 | Style-only regex alternatives. |
| `typescript(restrict-template-expressions)` | 3 | Real diagnostic/label clarity risk from interpolating values with uncertain types. |
| `eslint(no-loss-of-precision)` | 2 | False positive for intentionally rounded fdlibm numeric constants in deterministic `core/math.ts`. |
| `typescript(await-thenable)` | 2 | Type-aware false positive at Cloudflare RPC calls whose runtime result is awaited. |
| `typescript(no-this-alias)` | 1 | Intentional closure capture; style noise. |
| `oxc(erasing-op)` | 1 | Real suspicious multiplication by zero in a construction pose; owner should verify intent. |
| `eslint(no-control-regex)` | 1 | Intentional ANSI escape matcher in the gate's Playwright parser. |
| `typescript(no-base-to-string)` | 1 | False positive: the preceding `!ok.length` guard means `hits` contains only diagnostic strings at that branch. |

**Complete findings for the four owner-review rule classes** (`no-unused-vars`, `no-explicit-any`, `restrict-template-expressions`, `erasing-op`):

- `deploy/record-campus-take.mjs:36:56` — `eslint(no-unused-vars)`: Identifier 'sampleTake' is imported but never used.
- `engine/camera/correct.ts:13:10` — `eslint(no-unused-vars)`: Identifier 'FAILURE_LIMITS' is imported but never used.
- `engine/campus/assembly.ts:67:7` — `eslint(no-unused-vars)`: Variable 'norm' is declared but never used. Unused variables should start with a '_'.
- `engine/campus/sequence-b.ts:100:9` — `eslint(no-unused-vars)`: Variable 'stU' is declared but never used. Unused variables should start with a '_'.
- `engine/campus/sequence-b.ts:481:17` — `eslint(no-unused-vars)`: Variable 'i' is declared but never used. Unused variables should start with a '_'.
- `engine/campus/sequence-b.ts:606:15` — `eslint(no-unused-vars)`: Variable 'Wd' is declared but never used. Unused variables should start with a '_'.
- `engine/campus/sequence.ts:204:31` — `eslint(no-unused-vars)`: Parameter 'kind' is declared but never used. Unused parameters should start with a '_'.
- `engine/construction/handup.ts:35:48` — `eslint(no-unused-vars)`: Identifier 'onWalkway' is imported but never used.
- `engine/construction/handup.ts:882:11` — `eslint(no-unused-vars)`: Variable 'turned' is declared but never used. Unused variables should start with a '_'.
- `engine/construction/passup.ts:45:73` — `eslint(no-unused-vars)`: Identifier 'HAND_SPREAD' is imported but never used.
- `engine/construction/passup.ts:45:119` — `eslint(no-unused-vars)`: Identifier 'KNEEL_BACK' is imported but never used.
- `engine/construction/passup.ts:50:7` — `eslint(no-unused-vars)`: Variable 'xz' is declared but never used. Unused variables should start with a '_'.
- `engine/construction/setpart.ts:23:83` — `eslint(no-unused-vars)`: Type 'OBB2' is imported but never used.
- `engine/items/actions.ts:28:63` — `eslint(no-unused-vars)`: Identifier 'itemDef' is imported but never used.
- `engine/runtime/runtime.ts:5:10` — `eslint(no-unused-vars)`: Identifier 'TERMINAL' is imported but never used.
- `engine/scenarios/build-bay-v3.ts:188:9` — `eslint(no-unused-vars)`: Variable 't' is declared but never used. Unused variables should start with a '_'.
- `engine/scenarios/year-build.ts:32:15` — `eslint(no-unused-vars)`: Type 'Entity' is imported but never used.
- `engine/test/build-bay-v2.test.ts:12:22` — `eslint(no-unused-vars)`: Identifier 'addAll' is imported but never used.
- `engine/test/core.test.ts:4:10` — `eslint(no-unused-vars)`: Identifier 'readdirSync' is imported but never used.
- `engine/test/core.test.ts:4:23` — `eslint(no-unused-vars)`: Identifier 'readFileSync' is imported but never used.
- `engine/test/core.test.ts:5:8` — `eslint(no-unused-vars)`: Identifier 'path' is imported but never used.
- `engine/test/handup-prone.test.ts:14:22` — `eslint(no-unused-vars)`: Identifier 'proneAt' is imported but never used.
- `engine/test/movement.test.ts:17:39` — `eslint(no-unused-vars)`: Type 'WalkLeg' is imported but never used.
- `engine/test/path-reference.ts:5:15` — `eslint(no-unused-vars)`: Type 'Diagnostic' is imported but never used.
- `engine/test/take-chapters.test.ts:13:10` — `eslint(no-unused-vars)`: Identifier 'Runtime' is imported but never used.
- `engine/test/year-hang.test.ts:24:27` — `eslint(no-unused-vars)`: Variable 'D' is declared but never used. Unused variables should start with a '_'.
- `engine/construction/setpart.ts:241:59` — `oxc(erasing-op)`: Unexpected erasing operation. This expression will always evaluate to zero.
- `engine/actions/types.ts:47:37` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/actions/types.ts:47:52` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/actions/types.ts:47:64` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/api/controller.ts:415:61` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/api/controller.ts:434:90` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/rehearsal/rehearse.ts:22:51` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/rehearsal/rehearse.ts:76:83` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/runtime/runtime.ts:49:28` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/runtime/runtime.ts:51:93` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `engine/runtime/runtime.ts:262:100` — `typescript(no-explicit-any)`: Unexpected `any`. Specify a different type.
- `app/engine-view/components.ts:359:64` — `typescript(restrict-template-expressions)`: Invalid type used in template literal expression.
- `app/lab/scenarios.ts:144:87` — `typescript(restrict-template-expressions)`: Invalid type used in template literal expression.
- `app/lab/scenarios.ts:213:120` — `typescript(restrict-template-expressions)`: Invalid type used in template literal expression.

### Existing exponent allowlist

These are exact trimmed production lines, keyed with their file paths. They are not re-pinned or rewritten here.

```text
camera/quality.ts :: if (q.contacts && q.contacts.some((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2 <= cr2)) continue;
carry/fragile.ts :: const run = Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2);
construction/invariants.ts :: const hz = Math.sqrt((p[0] - h.pose.p[0]) ** 2 + (p[2] - h.pose.p[2]) ** 2);
construction/solar.ts :: const d = Math.sqrt((b.p[0] - a.p[0]) ** 2 + (b.p[1] - a.p[1]) ** 2 + (b.p[2] - a.p[2]) ** 2) + Math.abs(angleDelta(a.yaw, b.yaw)) + Math.abs((b.pitch ?? 0) - (a.pitch ?? 0)) + Math.abs((b.roll ?? 0) - (a.roll ?? 0));
construction/stance.ts :: const l = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);
core/hash.ts :: view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
env/sun.ts :: arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
social/actions.ts :: const cost = moves.reduce((s, m, j) => s + dist2(m.p, pos2(order[j].a)) ** 2, 0);
social/slots.ts :: if (id && id !== except) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = id; } }
spatial/grid.ts :: if (id) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = id; } }
spatial/path.ts :: const d = (i - ci) ** 2 + (j - cj) ** 2;
take/metrics.ts :: const d = Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) / POS_Q;
take/metrics.ts :: const d = Math.sqrt((e.pose.p[0] - q[0]) ** 2 + (e.pose.p[2] - q[1]) ** 2);
vehicles/curve.ts :: const d = (i - ci) ** 2 + (j - cj) ** 2;
```

### Open items

- Lint is red on 114 existing/source findings. Keep the gate stage absent. The lead owns all fixes in `app/**`, `engine/**`, `simulation/**`, and non-gate deploy files, including any choice to remove the `core.test.ts` imports. It should review the suspicious `setpart.ts:241` expression before treating it as a bug, because changing it may move a pin.
- No configuration rule was disabled merely to get a zero exit. The 14 exponent expressions remain explicitly tolerated until the lead makes a re-pin decision; the allowlist is designed to shrink as it removes them.

Approximate work: **~25 minutes**, **~13k tokens** (estimates).
