# REPORT — govern (P2), cloud session D, 2026-10-16

Branch `cloud/govern-20261016` (from `lane/govern-20261016` @ f7898837). Code head `373cabd`; this report is the
commit after it.

## Done (no browser needed)
- **God CLI commands** in `tools/god-skill/lib/governance.mjs` (same pattern as `lib/layers.mjs`), wired into
  `cli.mjs` with 5 small edits; `eden-god.mjs` regenerated with `node tools/god-skill/build.mjs` (`--check`: fresh).
  - `amendments [--all]` — open proposals with support (active residents), supporters, "written for vN" when stale,
    "replaces the whole text"; `--all` adds decided ones with reason/version.
  - `decide <id> accept [--text <markdown|file>] [--reason r]` → new constitution version (proposal or own wording).
  - `decide <id> decline --reason "<why>"` — the CLI refuses a decline without a reason before calling the world.
  - `governance [--residents-decide on|off]` — versions, prayers waiting/answered, the switch. Reading never flips
    it; **residents-decide stays OFF by default** (server default unchanged; only an explicit `on` turns it on).
  - `--json` on all three for raw data.
- `tools/god-skill/SKILL.md`: new "Constitution and amendments" section (the switch is off unless the human asks).

## Tests (this sandbox)
- `node --test tools/god-skill/lib/governance.test.mjs` — 2/2 pass (decideBody rules, text formatting)
- `node --test apps/server/src/god/governance.test.ts governance-edge.test.ts governance-cli.test.ts` — 8/8 pass
  (new governance-cli.test.ts runs the built `eden-god.mjs` against real GodMode + routes on 127.0.0.1)
- `pnpm -C apps/server exec tsc --noEmit -p .` — clean; `node tools/god-skill/build.mjs --check` — fresh

## To do locally / left
- Browser (from the lane status): dev world on :6130, set a constitution, 2–3 fake Souls propose/support, revise;
  real-Chrome shots at dpr 1 and 2 of the visitor chip ("changed since your last visit"), the open card with diff,
  and the owner card with accept/decline + prayers. Fix what looks wrong.
- Modal suite run — not from cloud.
- Merge note: `cli.mjs`/`SKILL.md`/`eden-god.mjs` are shared with Godmode lanes. On conflict, take both `cli.mjs`
  edits and **regenerate** `eden-god.mjs` (never hand-merge it).
