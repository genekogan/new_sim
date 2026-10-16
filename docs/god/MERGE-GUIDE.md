# Merge guide: one codebase for old and new worlds

Branch `root/reconcile` (worktree `<worktrees>/reconcile`) is the **integration base**. It is
`root/world-engine` (`af234bdc`) with main `b2e273a2` merged in. main `b2e273a2` is Codex's final state: the e8 frontend
`e8bcdcd3` is live, and the backends are `5e478f8a`. Gene's direction (2026-10-11): get back to **one system**, but only
once the new system demonstrably does everything the old one did, and more. Until then the old worlds keep running
unchanged on Codex's release.

This branch is the step that makes that possible:
- one source tree;
- old worlds behave exactly as e8 does on it;
- new worlds keep working.

Nothing here changed production.

## 1. How one tree serves both kinds of world

| side | switch | where |
|---|---|---|
| server | `config.worldEngine`: true for every `WORLD_KEY` outside `toy/mars/littlemartians/eden`, or `ENABLE_WORLD_ENGINE=1` | `apps/server/src/config.ts` (`KNOWN_WORLD_KEYS`) |
| client | `newWorld` (`isNewWorld(BASE, worldKey)`): a prefixed build (`BASE`, e.g. `/worlds`) or a key outside the four old ones | `apps/web/src/world-kind.ts` |
| client URLs | `BASE` (from Vite `--base`), `worldPath = BASE + /w/<key>` | `apps/web/src/base-path.ts`, `world-path.ts` |

Every world-engine change in a shared file is gated on one of these switches. On the old worlds (a root build, keys
`eden/mars/littlemartians`) each gated branch takes main's path. Section 2 lists every such touch.

Rules for future work in shared files:
- **gate, don't fork.** Put the new-world behaviour behind `newWorld` (client) or `config.worldEngine`/`d.god` (server).
  Keep main's bytes in the old-world branch.
- **prefix-aware URLs.** Build every root-absolute URL from `BASE`/`worldPath`, never from a literal `/w/` or `/`.
- **tests.** Old-world semantics keep main's test, unedited. New-world semantics get their own test beside it, as
  `account-clerk-auth-worlds.test.ts` does next to `account-clerk-auth.test.ts`.

## 2. Shared-file changelog (merged tree vs main `b2e273a2`)

"Shared" means a Codex-owned file (client app, auth, server core, engine) that the world-engine branch touched.
New files (`god/`, `gen-mesh/`, `god-ui/`, `humanoid/`, `world-launcher/`, the generator, compiler and ground packages,
templates) are not listed; nothing old imports them except through the gates below.

### Client (`apps/web`)

**`Shell.tsx`**
- Touch: imports `newWorld as launcherWorld`.
- On new worlds only:
  - publishes the session (`auth-session.ts`) for the God panel and Join;
  - hides `LocalIntegrationNotice`, `LocalConnectionHelp` and e8's `AccountApproval` dialog (the God panel owns
    `#approve/<id>` there);
  - New Soul = e8's `BringAgent` copy-the-prompt dialog on all worlds (lane UXFIX, `cc9bef0f`; S's `SoulsHeader`
    is gone); new worlds add **Copy invite link** to the account menu (`AccountMenu.tsx` `inviteUrl`);
  - shows local dev sign-in (`configuredSignIn(cfg, true)`).
- Adds `AuthCtx.mode`.
- Old worlds: e8 Shell. (Verified: identical header, buttons, dialogs and requests.)

**`main.tsx`**
- Base is e8's file. Added on top:
  - `mode` on Clerk and dev auth;
  - `BASE` in `clerkOriginRoute` and the root-path test;
  - `readWorldBootstrap(r, worldKey, worldPath)`, which is prefix-aware;
  - launcher homepage detection (only on a prefixed build or a local preview) with `LauncherRoot`, `HomeClerk` and
    `HomeWith`.
- Old worlds: the production root never probes for the launcher. It is e8's world list.

**`LiveWorld.tsx`**
- Entity layer, God panel, flags, preview ghost, `?shot`, centred projection (no inset view offset), entity framing and
  camera persistence, and double-click on god terrain.
- All of it is active only when `entityLayer.active`. That needs `newWorld`: the snapshot is not even fetched on old
  worlds.
- The Retina fix (canvas style 100%) is also gated to `newWorld`; see flag F1.
- Alt-click returns early only on entity worlds.
- `position: relative` is set only on entity worlds.

**`auth-ui.ts`**
- `configuredSignIn(cfg, devSignIn=false)`.
- `isWorldPath(path, base)`, and `clerkOriginRoute(..., base)` accepting any launcher slug.
- `#godpair/CODE` is kept only off the old root paths.
- New `clerkHomeRoute`.
- `agentOnboarding` reads the slug after any prefix. The result is unchanged for the old keys.
- Old worlds: main's routes.

**`auth-ui.test.ts`**
- e8's tests stay verbatim, then the new-world tests.
- One edit: the `#godpair` expectation on `/w/eden` is now `#watch` (main's rule).

**`connection-prompt.ts`**
- New 4th parameter `prefix`. With a prefix, any `<prefix>/w/<slug>`; without one, main's old-key rule.

**`AgentConnection.tsx`**
- Passes `BASE` as the prefix.

**`soul-link.ts`, `SoulCard.tsx`, `PublicSoulLink.tsx`**
- `publicSoulLink(..., base)` and `worldLinkPath`: Share Soul works on a prefixed world.
- Old keys: the same link.

**`world-discovery.ts`**
- `readWorldBootstrap(response, key, expectedPath = /w/<key>)`.

**`world-path.ts`, `base-path.ts`**
- Strip the `BASE` prefix. Root build: identical.
- `base-path.ts` survives bundling outside Vite: `import.meta.env` absent means `''`.

**`world-kind.ts`** (new)
- The client switch.

**`WorldBodyModels.ts`**
- The humanoid@2 composed look (L10), keyed by `LOOK_MODEL`.
- Old bodies: `modelUrl` path unchanged.

**`package.json`, `tsconfig.json`**
- Workspace deps (`@sim/generators`, `@sim/ground`, `@sim/world-compiler`), and the `@types/three` position.

**`LiveWorld.tsx`, `WorldEntityLayer.ts`, `world-env.ts`** (GOD-ENV, lightning + world bounds)
- `LiveWorld.tsx`: `WorldLightning` (bolt, flash, WebAudio thunder) created only when `newWorld`; `__simLiving.lightning`.
- `WorldEntityLayer.ts` (active only on new worlds): terrain sectors, `groundAt`, sea plane and horizon read the ground
  recipe's bounds (a rectangle once the god extends the world) instead of ±extent/2; a diff's `constants` is applied.

**`WorldEntityLayer.ts`, `gen-mesh/registry.ts`, `gen-mesh/kit.mesh.ts`, `gen-mesh/mesh.mesh.ts`** (VOCAB-MECH; entity worlds only)
- `registry.ts` `meshFor` wraps every builder with `vocab-look.ts` (stretch/warp/paint/wear/state roles); a def without
  convention params or actuator state gets the builder unchanged (`lookOf` → null), so old content draws as before.
- `kit.mesh.ts`: shapes with `when` are filtered by params/state (no `when` → unchanged); cache/instance keys gain a
  suffix only for kits that use `when`.
- `mesh.mesh.ts` + `WorldEntityLayer.ts`: lazy GLBs (`lazy-assets.ts`): the snapshot plans an eager set (≤ 24 MB nearest
  the arrival) and the loading bar expects only it; the rest load near the camera or in the background. `?shot` and
  `?assets=eager` load everything (god `look`, thumbnails). Old worlds never mount the entity layer.

### Server (`apps/server`)

**`auth.ts`**
- `production` (no `dev:` token of any shape) and the `DEV_AUTH=1` refusal apply when `authProvider==='clerk' &&
  worldEngine`.
- Old worlds keep main's legacy agent-local projection.

**`config.ts`**
- `WORLD_KEY` accepts any slug, plus `KNOWN_WORLD_KEYS` and `worldEngine`.
- The silent duplicate block from the merge was removed.

**`http.ts`**
- Mounts the god and join routes only when `d.god` is set.

**`main.ts`**
- `GodMode`, ground host and engine bridge only when `config.worldEngine`.
- `SOUL_LIFECYCLE` only for world-engine worlds.

**`world-config.ts`, `fold.ts`**
- Ground and world-edit facts. They do nothing without `groundV1`/`worldEdit`.

**`world.ts`**
- Edge fault recovery (`a02f2aa5`, `d138b664`):
  - the narrowest plan first, setting aside only the decision a faulting body is running;
  - rewound bodies land back at their last valid pose.
- **Not gated**: it applies to every edge world. See F4.

**`edge-hotfix-fault.test.ts`**
- Follows the new plan order.

**`edge-body-cli.test.ts`**
- `TEST_BODY_CLI_PORT` (the default stays 4958). See §5.

**`account-clerk-auth.test.ts`**
- main's file, byte-identical.

**`account-clerk-auth-worlds.test.ts`** (new)
- Ours: the Clerk "make a Soul" path and the dev lockout gate.

**`god/god-clerk.test.ts`**
- Its Auth configs say `worldEngine: true`.

**`edge/ledger/ledger.ts`, `edge/boot/world-places.ts`** (R4-INFO, Soul-information parity)
- Two optional hooks on `EdgeLedger`: `placeWalkable(id)` and `beforeMap()`. Only the engine bridge sets them
  (`god/engine-bridge.ts`, so only when `config.worldEngine`): god-built places (`god/places.ts`) count as walkable in
  `map()`, in the vocabulary's place list and in boot-place admission (`knownBootPlaces`), and the map re-derives
  after a god edit before it is read.
- Old worlds: both hooks unset, so `walkable` stays `id in regions` and admission stays the native-region rule.
  (Verified: local Eden `map` identical place-for-place to the pre-change probe; edge place/here/W1 tests pass.)

**`edge/perception/here.ts`, `edge/eyes/{sight,view}.ts`, `edge/ledger/ledger.ts`, `http.ts`, `main.ts`** (R4-LIVE, env + weather)
- `EdgeLedger.weatherNow?` (set only by `god/world-env.ts` `installWorldEnv`, i.e. when `d.god`): `here.weather` and Eyes'
  caption read the god's weather; unset on old worlds, so their words come from engine `env.weather` / the schedule as before.
- `http.ts`/`main.ts`: env routes (`GET /v1/world/env`, `POST /v1/god/env`) and `installWorldEnv`, both under `d.god`.
- `ledger.ts` stop path: an immediate `stand:here` touches the fade clock (C9 "any accepted action"). **Not gated**: a fix;
  see F4 before an old-world backend runs this tree.

**`LiveWorld.tsx`, `WorldAtmosphere.ts`, `WorldBroadcast.ts`, `WorldNightLights.ts`, `gen-mesh/motion.ts`** (R4-LIVE, living view)
- All under `newWorld`/`entityLayer.active`: atmosphere profile `'world'` + the god's weather, `GodWorldLiving` (lamps by
  the clock, night map from god lights), broadcast `hints.views` (god landmarks/tour), arrival in broadcast when Souls
  live there, Explore lists god landmarks. Old worlds: `profile` defaults to `'eden'`, `views` unset, `setClockNight`
  never called (null), `paintOnlySources` never called.

**`edge/perception/here.ts`, `edge/ledger/ledger.ts`, `main.ts`, `god/ground-host.ts`, `god/query.ts`, `god/god.ts`** (GOD-ENV)
- `EdgeLedger.lightningNear?` (set only by `god/lightning.ts` `installLightning`, under `god`): `here.weather.lightning`;
  unset on old worlds, so their `here` is unchanged. `main.ts` installs it under `if (god)`.
- god files only: bounds-aware tiles/free plots, `ground` published with a `constants` diff, ground-host re-logs on growth;
  new routes `POST /v1/god/land`, `POST /v1/god/strike` (god token).

**`edge/ledger/vocabulary.ts`, `god/perceive.ts`, `god/engine-bridge.ts`, `god/god.ts`, `god/assets.ts`** (VOCAB-MECH)
- `vocabulary.ts`: object capabilities whose object id is a god entity (`e_…`) also answer to their action as a verb
  ("open the blue door", "put out the fire", + aliases turn-on/off, shut, extinguish …). Eden/Mars/LM objects never have
  `e_` ids, so their resolution is unchanged.
- `perceive.ts`: god things whose def has `actions` become `built` objects of a kind with those actions (schema + `state`);
  plain kinds keep the old schema. `actuators.ts` wraps `objects.act` to commit the state as an engine edit after the
  ledger's transaction (`afterCommit`). `engine-bridge.ts` passes `commit` (engineAct) to perceive.
- `god.ts`: `publicSnapshot` includes the bases of `extends` defs (presets). `assets.ts`: facets, synonyms and category
  words in `searchDefs`; the library lists presets resolved; `mountCatalogRoutes` (`catalog.ts`: manifest, taxonomy,
  recommend, `/thumbs/<hash>.png`, gzip for snapshot/catalog/defs).
- world-compiler: `schemas.ts` def `category?`/`synonyms?` (optional; hashes unchanged); `model.ts` bake applies
  stretch for defs that declare `sx/sy/sz` and fills kit/2 def param defaults; `vocab/` (taxonomy, conventions, lint).
  generators `kit.ts`: shape `when`, roles `fill`, `screen`.

### Engine (`mars/viewer/engine`, `packages/engine-mars`, `packages/protocol`, `packages/engine-contract`)

**`engine-mars/src/engine.ts` `configureClock`, `engine-contract/src/scene-capture.ts`, `protocol/src/presentation.ts`** (R4-LIVE)
- A clock `origin` may be negative (a god set the time of day early in a world's life). Every logged origin before was
  >= 0 (clockConfig and LivingWorld never wrote one below), so old histories replay and decode unchanged.

**`engine-mars/src/engine.ts`**
- `groundV1` (`attachGround`), world-edit/1, `restoreHumanPoseV1`, humanoid@2 body dims.
- Kept with main's `walkSettleWaitV1` (both sides).

**`spatial/service.ts`, `grid.ts`, `path.ts`, `edits.ts`, `types.ts`**
- Ground spatial, routing round entities, side approaches for stairs, incremental world edits.
- Gated on `groundV1` or `entityPhysicsV1`. `Link.approach` is optional, and absent means unchanged.

**`locomotion/walk.ts`**
- `standY` on ground, wading, and face-off resolution.
- Gated: `sp.ground`, and `rt.world.entityPhysicsV1`.

**`social/actions.ts`**
- `sitDuration` (stays inside the per-tick motion limit) and per-body radius.
- **Not gated.** It changes only spans that previously faulted `motion.teleport`. See F4.

**`social/pose.ts`, `social/slots.ts`**
- Seat fit for body height, and seat state for god-built seats.
- With default bodies: unchanged.

**`bodies/*`, `runtime/invariants.ts`, `world/types.ts`, `protocol/body-v1.ts`, `engine-contract/world.ts`**
- humanoid@2 `params` (height, build, walkSpeed, headSize).
- Defaults are exactly today's bodies.

**`take/recorder.ts`**
- Entity-world fixtures leave the takes.

**`engine-view/humans.ts`, `people.ts`, `take-replay.ts`, `recorded-body.ts`**
- `bodyScale` (default 1) and composed looks.

**`pnpm-lock.yaml`**
- Ours. `pnpm install --offline` is a no-op on the merged manifests.

CLI and skill (`tools/edge-skill/*`), proxy (`tools/core/multiworld/*`) and the account modules: **main's bytes,
untouched.**

**`mars/viewer/engine/locomotion/walk.ts`, `packages/engine-mars/src/ground-bridge.ts`** (GOD-ENV)
- `walkSchema` is `z.lazy` over the same ±500 m schema; `setWalkReach` widens x/z to the ground recipe's bounds, called
  only from `attachGround` (ground/god worlds). Old worlds never call it: same schema, same messages, same replay.
- Not changed, documented: the ground nav window (`spatial/tiled.ts` MAX_WINDOW_TILES = 6, grows only) is one 384 m
  square shared by every body, so Souls cannot walk farther than that from where the window started (needs the nav owner).

**`packages/world-compiler` `compile.ts`/`schemas.ts`** (GOD-ENV; new-world package): `expand` takes `bounds` and has an
inverse (trusted shrink, refused while anything stands there); re-settled buildings get/lose foundation pads; undoing a
`world` op nulls optional fields it added; `weather.strike`. `lightning.ts`: deterministic strikes.

## 3. Conflict report (merge `dfb4669a`)

Of the 34 files changed on both sides since the merge base `1eecf273`, 13 conflicted textually and 21 auto-merged. One
auto-merge was wrong without a conflict (`config.ts`).

**`apps/server/src/auth.ts`**
- Cause: our Clerk-production dev lockout against main's unchanged code.
- Resolution: ours, gated to `worldEngine`. main's legacy projection holds on old worlds.

**`apps/server/src/http.ts`, `main.ts`**
- Cause: comment-only hunks.
- Resolution: main's lines. Our gated god mounts auto-merged.

**`apps/server/src/config.ts`**
- Cause: no conflict was reported, but both sides moved the Clerk block, so it appeared twice. tsc caught it (TS1117).
- Resolution: the duplicate was removed.

**`apps/server/src/account-clerk-auth.test.ts`**
- Cause: add/add.
- Resolution: main's file kept. Ours moved to `account-clerk-auth-worlds.test.ts`.

**`apps/web/src/Shell.tsx`**
- Cause: our header against e8's `WorldAccountControls`, `AccountApproval` and explore group.
- Resolution: e8's header, with the new-world gates listed in §2.

**`apps/web/src/main.tsx`**
- Cause: our Clerk port and launcher home against e8's lazy Privy, `readWorldBootstrap` and `discoverWorlds`.
- Resolution: e8's file plus the deltas listed in §2.

**`apps/web/src/LiveWorld.tsx`**
- Cause: two hunks, entity update against e8's `initialGate`, and dispose against `staticBatches`.
- Resolution: both kept. The other entity hunks auto-merged and were then gated (§2).

**`apps/web/src/auth-ui.ts` (+ test)**
- Cause: our prefix-aware route against e8's `approvalFromHash`.
- Resolution: merged. e8's approval parsing stays. Ours adds the prefix, any slug, and godpair off the old paths.

**`apps/web/src/connection-prompt.ts`, `AgentConnection.tsx`**
- Cause: both sides added a 3rd parameter: ours `prefix`, e8's `name`.
- Resolution: `(base, soulId, name?, prefix='')`. e8's prompt text is kept.

**`packages/engine-mars/src/engine.ts`**
- Cause: constructor line, `groundV1` against `walkSettleWaitV1`.
- Resolution: both kept.

**`pnpm-lock.yaml`**
- Resolution: ours. `pnpm install --offline --no-frozen-lockfile` changed nothing.

Follow-up merges (same day, to keep one base):

**`3f5437b5` merge `root/e8-hotfix`** (the live old-world frontend)
- `LiveWorld.tsx`: OW's unconditional Retina line.
- `Shell.tsx`: OW's `onInitialProgress`, with our `AccountApproval` gate.

**`34762bbc` merge `root/world-engine`** (S: New Soul + Souls on new worlds; loading-card)
- `Shell.tsx`: S's `SoulsHeader` in e8's header, new worlds only (removed again by UXFIX `cc9bef0f`: New Soul =
  e8 `BringAgent` on all worlds; new worlds add Copy invite link to the account menu).
- `ViewerFrame.tsx`, `viewer-arrival.ts`, `place-names.test.ts`: OW's code, plus loading-card's
  `assetDownloadProgress` fallback when no initial gate reports.
- After this merge, `root/world-engine` and main are both ancestors of `root/reconcile`, so both can fast-forward.

Fixed in the first merge commit:
- `base-path.ts` became robust outside Vite. Main's `soul-context-render.test.mjs` bundles the client with esbuild and
  failed on `import.meta.env`.
- god tests: `god-clerk.test.ts` configs say `worldEngine: true`.

## 4. Flags (decide or carry)

**F1. Retina canvas on old worlds: CLOSED**
- Lane OW's `root/e8-hotfix` (`b2f70bf4`) is the live old-world frontend since 04:51 UTC. It is merged here (`3f5437b5`):
  - the Retina fix is unconditional, and our gate is gone;
  - the arrival card carries the loading progress.
- The old-world baseline for every comparison is now `b2f70bf4`, not `e8bcdcd3`.

**F2. Join on new worlds**
- e8's "New Soul" (`BringAgent`) serves all worlds (UXFIX). e8's `AccountApproval` is hidden on new worlds, where the
  God panel's `#approve` card serves.
- One system eventually needs one Join flow. Converge on e8's `BringAgent` + `AccountApproval` when the God panel's
  Join matches it. Both drive the same `/v1/account/approvals` routes.

**F3. Explore, MySouls and the world name on new worlds**
- e8's Explore button labels a new world by its slug ("Explore Hello-world-2"), not its `WORLD_NAME`. Cosmetic; R4 or
  VIS.
- e8 moved MySouls into the explore group, which shows when `viewerHandle.frameLocation` exists.
- New worlds have no authored places yet: check that the explore group is useful there, or hide it, in R4.

**F4. Ungated server/engine deltas that reach old worlds if their backends ever move to this tree**
- `world.ts`: edge recovery, narrowest plan and pose restore.
- `social/actions.ts`: `sitDuration`.
- `pose.ts` seat fit: inert for default bodies.
- These are intended engine fixes and stay. **Before any old-world backend runs this tree, prove a replay** of each
  production history on a read-only copy: `tools/core/multiworld/replay-proof.mjs`, copied with `copy-sqlite.mjs`
  (compact: every table verified, recordings `take_chunks`/`take_archives` left empty), run on ports outside 4930–4970.

**F5. main's own type errors**
- main has two type errors in `apps/server/src/edge-comms-manual-replay.test.ts` (TS2352 casts of `ConverseResult`):
  pre-existing, identical on `b2e273a2`.

**F6. Web test harness**
- With plain `node --test`, 28 web test files fail identically on main and here:
  - `.tsx` tests need esbuild bundling (Codex's receipts used bundled runners);
  - a few need browser globals.
- Under a bundling runner, the 14 `.tsx` tests give the same 12/14 on both.
- A real `test:web` script is debt.

**F7. Local Little Martians dev world**
- It cannot seed its cast with the default `MAX_SOULS_PER_USER=5`, on main as well. Set `MAX_SOULS_PER_USER=50` for
  local old-world dev servers.

**F8. Pre-existing on the world-engine branch: `#godpair` and the hash rewrite**
- Shell's hash effect rewrites the hash to `#watch` on new worlds. `GodPanel` reads `#godpair/` on render; the rehearsal
  party passed, but a dedicated check is cheap.

**F9. Humanoid kit (L10)**
- The kit must be served at `<BASE>/modular/humanoid/` for prefixed worlds. Lane OPS owns that.

**F10. Codex's deferred branches**
- Not merged:
  - steering `a3239b6a`;
  - object names `a5c0e9fc`;
  - Mars Adoption A / Release B (cancelled; never restart them).
- Pick them up only additively, on this base.

## 5. Tests that hard-code Codex's ports, and how to run them safely

Never bind 4930–4970, 4986 or 4987 on this laptop: they are the production writers, the proxy and the tunnel.

**`apps/server/src/mars.test.ts`**
- Hard-coded: 4950 (default).
- Safe run: `TEST_MARS_PORT=5445 node --test apps/server/src/mars.test.ts`. The test itself refuses 4950/4963/4964/4970
  when overridden.

**`apps/server/src/edge-body-cli.test.ts`**
- Hard-coded: 4958 (default).
- Safe run: `TEST_BODY_CLI_PORT=5446 node --test apps/server/src/edge-body-cli.test.ts`. This env override was added
  on this branch; it refuses 4930–4970.

**Every other server test with a fixed port**
- The fixed ports are in 4952–4959 (`camp-station-era`, `client-station`, `clock-frontier-wire`, `intent-*`,
  `lifecycle-*`, `me-live`, …).
- Never run them bare on the laptop. Run them under the **port-remap preload**
  (`tools/test-harness/port-remap.mjs`):
  - every `listen()`/`connect()` on 4930–4969 moves to `PORT_REMAP_BASE + (port − 4930)`;
  - 4970/4986/4987 throw;
  - the preload re-injects itself into children, even children spawned with a hand-built env.
- The full suite, safely:
  ```
  NODE_OPTIONS="--import=$PWD/tools/test-harness/port-remap.mjs" PORT_REMAP_BASE=5400 TEST_MARS_PORT=5445 \
    TEST_BODY_CLI_PORT=5446 node --test --test-concurrency=1 apps/server/src/*.test.ts
  ```
- Proven on the 39 port-bound files: 256/256. Lesson: `mars.test.ts` spawns its fixture with an env that drops
  `NODE_OPTIONS`; before the child re-injection existed, its child tried port 4950 and exited on `EADDRINUSE`.
  Always set `TEST_MARS_PORT` as well.

**`tools/core/multiworld/*` (`local-worlds.mjs`, `world-server.mjs`, `public-cli-acceptance.mjs`, ...)**
- Hard-coded: 4950–4970 by design (Codex's local release topology).
- Do not run them on the laptop while production runs from it.

## 6. Toward one system: what must be true before the old system can retire

Gene's bar: the new system does everything the old did, and more.

**A. Code is already one tree (this branch)**
1. Merge `root/reconcile` back into `root/world-engine`, or make it the lead's integration branch. All lanes rebase onto
   it.
2. Keep re-merging main whenever Codex-side fixes land (e.g. OW's hotfix). Follow §7.

**B. Parity**
1. R4: every building, asset type, behaviour, interaction and special feature of Eden, Mars and Little Martians exists
   in the generative system. The coverage matrix is `docs/god/PARITY.md`.
2. mars-two and littlemartians-two on staging, and Gene approves them against the live worlds.
3. Souls:
   - the same CLI (1.9, sha `bb53…`) and skill on old and new worlds;
   - conversations, intents, Eyes and reminders on new worlds;
   - one Join flow (F2).
4. Accounts: the one Clerk registry. New worlds currently use a separate registry
   (`team/runtime/world-launcher/data/accounts.sqlite`). Merging registries needs Gene and Codex's isolation rules:
   never merge by email, never equate provider ids.

**C. History and data**
1. Decide per old world: keep its history (replay-proof on this tree's engine, F4), or convert it into an entity world.
   Converting means a converter from authored scene + history to defs, entities and Souls, with owner, Soul and
   account continuity.
2. Freeze points and rollback: a pinned old release (e8 `e8bcdcd3` + backends `5e478f8a`) stays restorable for a
   window after the switch.

**D. Hosting**
1. One router: today the e8 proxy (:4970) forwards `/worlds/*` to the launcher (:5340). The end state is one launcher
   or router serving every world, or the old worlds as launcher children with their own data and env.
2. Health, backups, supervision (launchd/systemd), and the eden2 deployment path (`tools/world-launcher/deploy/`) in
   place for all worlds.
3. Off-laptop CI that runs the full suite (hosted CI is billing-blocked: Codex receipt
   `PUSH-AND-CI-RECEIPT.json`).

**E. Cutover itself** (needs Gene's go; Codex's promotion/rollback method)
1. Artifact-only frontend promotion first: this tree's web build at the root. It is proven equal to e8 on old worlds
   (§8). This is the first production change on this base, and it should carry OW's fix.
2. Then each backend, one world at a time, with a replay proof, a pinned rollback and a real-input walk at dpr 1 and 2.
3. Retire the old code paths only after all worlds have passed: the `newWorld` gates and the legacy auth projection.

## 7. Re-merging main later

1. Merge into `root/reconcile` (never the reverse) in its worktree. No stash, no push.
2. In each conflicted shared file:
   - start from main's side;
   - re-apply our hunk behind `newWorld` or `worldEngine`;
   - keep main's tests verbatim.
3. Check for silent duplicates: run web and server `tsc`, and grep the merged files for doubled blocks.
4. Run the proofs:
   - web `tsc` and build;
   - focused tests (auth-ui, account-clerk-auth\*, god, engine-mars);
   - the old-world side-by-side walk (§8);
   - the new-world e2es on your own ports.

## 8. Proof (2026-10-11, this branch)

**Old worlds behave as e8 does**
- Local root-path dev worlds eden, mars and littlemartians, built from main `b2e273a2` (ports 5411–5413) and from this
  branch (5401–5403).
- Fake minds, fresh data.
- Real Chrome (GPU), Chrome lease, 1352×780, dpr 1 and 2.
- Real input on each: drag, wheel, hold W, double-click, New Soul click and Escape.
- Result: an identical signature for every world × dpr:
  - canvas geometry;
  - every input moved the camera;
  - one New Soul dialog, closed by Escape;
  - header buttons;
  - no God panel and no `__simEntity`;
  - an identical set of same-origin request paths;
  - no page errors.
- Screenshots compared by eye: same chrome; only live Soul positions differ.
- Evidence: `<team>/lanes/rec-shots/old-worlds/` (`report.json` + PNGs).

**Unit-level**
- web `tsc` passes.
- `auth-ui` 9/9.
- Web node tests: the same pass/fail set as main.
- `.tsx` (bundled): 12/14 on both.
- Server: `account-clerk-auth` 3/3 (main's) + `-worlds` 4/4; god 37/37.

**Engine and CLI**
- engine-mars: 222/222.
- mars/viewer engine (`test:mars`, including the byte-hash determinism tests): 1585 pass, 0 fail.
- CLI/client (`test:client`, main's bytes): 247/247.
- Under port remap:
  - `mars.test` (5445): 4/4;
  - `edge-body-cli` (5446): 1/1;
  - the 39 port-bound server test files: 256/256.

**After the follow-up merges (`34762bbc`)**
- Old worlds against the live `b2f70bf4` (base :5411–13, head :5401–03), dpr 1 and 2:
  - eden and littlemartians: SAME;
  - mars: same geometry, header, New Soul dialog and errors. The only differences were live-Soul nondeterminism: a
    drag or double-click landing on a walking Soul selects it (and fetches its profile) on either build.
  - The comparator now ignores Soul-profile requests.
  - Evidence: `rec-shots/old-worlds-vs-b2f70bf4/`.
- `souls-ux` (Clerk via synthetic issuer, real Chrome): 13/13 at dpr 1 and 13/13 at dpr 2.
- `join` clerk `/worlds`: 15/15. `launcher`: 14/14.
- god + clerk auth + auth-ui: 53/53.
- Web node tests: the same failure set as `b2f70bf4`.
- New world under `/worlds`, dpr 1 and 2: canvas = window, offset 0, inputs move the camera, the header shows "Souls 0"
  and "+ New Soul" plus the account menu, and the Join line appears (`rec-shots/new-world-worlds-prefix-34762bbc/`).

**New worlds green (first merge)**
- Ports 5420–5440:
  - `scenarios.mjs`: 30/30;
  - `party.mjs`: 16/16;
  - `souls-r2.mjs`: 37/37;
  - `join.mjs --mode clerk --base /worlds`: 15/15;
  - `launcher.mjs`: 14/14.
- Real-input walk of a new world under `/worlds` (launcher :5441, a `--base /worlds/` build, dev sign-in), at dpr 1
  and 2:
  - home → New world, by real clicks and typing;
  - arrival;
  - canvas CSS = window, with buffer 1352×780 at dpr 1 and 2704×1560 at dpr 2 (the Retina fix holds);
  - view offset 0,0 (a centred projection);
  - drag, wheel, hold W and double-click each move the camera;
  - God panel → Souls → "Live here yourself" → name → "Join as a Soul" gives the paste line;
  - no page errors and no HTTP ≥ 400.
- Evidence: `<team>/lanes/rec-shots/new-world-worlds-prefix/`.

**Old-world data safety**
- `tools/test-harness/history-boot-compare.mjs`:
  - production Mars (1.4 GB) and LM (308 MB) histories copied read-only;
  - booted check-only on main `b2e273a2` and on this branch.
- Result: identical tick, head, stateHash and rules for both:
  - Mars: tick 2140014, head 1351;
  - LM: tick 2142033, head 3322.
- Both boot from a snapshot with 0 replayed events, so this proves boot compatibility, not stepping. The stepping
  determinism comes from `test:mars` above.
- Eden (14 GB) is left to the one validation (V8).

## 9. Shape for main

- `root/reconcile` contains main `b2e273a2` (the merge's second parent), so **main can fast-forward** to it, or to any
  later integration commit built on it.
- Lanes merge into `root/reconcile`, never into main directly. The lead fast-forwards main once the one validation
  (`tools/test-harness/one-validation.sh`, plan at the top of `team/lanes/rec.md`) passes.

### UXFIX2 (2026-10-11, root/uxfix2 7a7f61be)
- `god-ui/JoinPanel.tsx` is now only the god's Souls tab. On new worlds, visitors get no god-panel card, except on
  `#approve/<id>` links, which show the approval card (and Sign in). As on /w/eden, the header's New Soul (e8 BringAgent) is
  the only join path.
- On new worlds Shell reads the display name from `/v1/god/status` (`WORLD_NAME`) for Explore, the header and the New Soul
  prompt; `BringAgent` takes an optional `worldName`. Old worlds are unchanged.
- The launcher home omits the god line when an owned world has no god name.

### NAV (2026-10-11, root/nav) — Souls walk the whole ground
- Gate: the ground fact `groundV1.nav = 'paged/1'`. Only the god `GroundHost` logs it (`NAV_PAGED=0` turns that off);
  a god world standing on the old window adopts it with one new fact. Worlds without it (eden `+eg/1`, mars,
  littlemartians, every old journal) run the old 384 m grow-only window byte-for-byte.
- `spatial/tiled.ts` + `service.ts`: paged worlds face a set of small windows (body neighbourhoods + walk remainders,
  `clusterRects`), not one window. `level()`/`grids`/`scene` are the *faced* window's: `Runtime` faces the actor of the
  action it plans or steps (`focusOn`, a no-op elsewhere), `bodySpatial` faces the walker, and point queries ask
  `levelAt(level, point)` (invariants, seat approaches, slot layouts, social moves, wander, engine nav/1 reads, pose
  recovery). Non-paged `levelAt` ≡ `level`. Mars-only activity code (construction, carry, paired-walk, group activities)
  still reads `level(0)` = the actor's window — fine for actor-local reads, not for far points; none runs on god worlds.
- Routes on paged worlds are chunks (`route.rest`); `walk.ts` plans the next chunk 6 m before the end. Epoch moves with
  the static world only; single-file passages are named by `narrowIdOf` (window-independent).
- `walk.ts`: the walk_to schema is read per use (`get schema()`); GOD-ENV's `z.lazy` memoised the first world's reach.
- `tiled.ts` composite blocker tables are filled on first read (same values; shared by old ground worlds).
- e2e: `tools/god-skill/e2e/nav-far.mjs` (new); `nav.mjs` (P4) unchanged and 13/13 on paged nav.
