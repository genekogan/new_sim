# Y4b: co-builder token scope (cloud session C1, 2026-10-16)

Branch `cloud/y4b-cobuilder-scope-20261016`, built on Y4 at `8efdeac`. Head commit: `a8646bf` (this report is the commit after it).

## What I did
- A token whose label starts with `cobuilder:<account>:` is treated as a co-builder. That's the label the worldops launcher writes
  after an authenticated co-build pairing. The account goes on the identity, on any helper it mints, and on every journal row
  (a new nullable `world_edits_v1.acct` column, added the same way Y4 added `hash8`/`label`). Owner tokens are unchanged.
- Co-builders are refused with `cobuilder.scope` for:
  - POST `/v1/god/env` and `/v1/god/strike` (403, in the god route middleware);
  - any `world` op (sky, time, weather, strike, constitution, ground) in act, dryrun, preview, or a commit of a sealed preview;
  - pause, resume, done or abandon of a build that another account leads (route middleware, `{ok:false, failures}`);
  - edits through another account's lease or claim (in `admit`);
  - taking or releasing another account's claim;
  - undo or redo of any row from another account or the system. A mixed group is refused whole, and that includes `abandon --undo`;
  - minting helper tokens. The brief says "may not mint", so a sub-agent gets `EDEN_GOD_CLAIM` instead;
  - lock-doctor `--fix` on another account's locks. They still see those locks.
- Two agents on the same account count as one: either can undo, resume or finish the other's work.
- The world's own `pair/start` renames an agent that calls itself `cobuilder:…` to `agent-…`, so an agent can't pose as a co-builder.
- SKILL.md gets one refusal-table row (`cobuilder.scope`), under 130 bytes. `eden-god.mjs` is unchanged (`build.mjs --check` passes).

## Tests (all pass)
- New `apps/server/src/god/cobuilder-scope.test.ts`: 7/7. It covers identity/status, env/weather/strike via every route,
  build and claim lifecycle across three accounts, undo/redo, attribution, the doctor, and a seeded fuzz (150 env/world/strike
  attempts; world state unchanged).
- With Y4 and neighbours (helper-tokens, helper-cli, lock-doctor, build-claims, builds, env-routes, route-safety): 117 pass, 0 fail.
- `god.test.ts`, `define-undo.test.ts`, `parts.test.ts`: 44 pass, 0 fail. `tools/god-skill/cli.test.mjs`: 90/90.
- `tsc --noEmit -p apps/server`: clean.

## Left / decisions for Gene
- **Removing or moving the owner's things outside an undo.** Co-builders still have ordinary edit rights (remove/move/set) on
  anything that isn't in another account's lease or claim. The brief covers only undo/redo/abandon. Stopping this needs
  per-entity ownership, which the world doesn't track yet.
- **Still allowed, because the brief doesn't name them:** land/terrain, `expand`, economy ops (`economy`, `mint`, `pay`, `relate`),
  answering prayers, and new claims inside the owner's open builds. Each is a one-line addition to `cobuilderOpFailure` or
  `cobuilderRoute` if you want it closed.
- **Helper minting is refused for co-builders**, per the brief's "may not mint". Allowing it is a one-line change
  (`mintHelper` and `cobuilderRoute`), and helpers would inherit the co-builder's account limits.
- Rows written before this change have no `acct`. A co-builder can still undo them when its own token made them (hash8 match).
- **Before shipping:** merge with `lane/worldops-20261015` and confirm its label format (`cobuilder:<account>:<agent>`, accounts
  with no `:`), then run the full `node tools/god-gate.mjs` locally. The cloud rules limited me to focused tests.
