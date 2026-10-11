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
  - drops `BringAgent` "New Soul" (Join lives in the God panel; lane S adds `SoulsHeader`);
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

### Engine (`mars/viewer/engine`, `packages/engine-mars`, `packages/protocol`, `packages/engine-contract`)

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

Later fixes, in the second commit:
- `base-path.ts` became robust outside Vite. Main's `soul-context-render.test.mjs` bundles the client with esbuild and
  failed on `import.meta.env`.
- god tests: `god-clerk.test.ts` configs say `worldEngine: true`.

## 4. Flags (decide or carry)

**F1. Retina canvas on old worlds**
- Today: gated to new worlds, so old worlds are e8 including e8's 2× canvas defect at dpr 2 (seen in the walk: canvas
  2704×1560 in a 1352×780 window, on both builds).
- Lane OW is fixing old worlds through Codex's artifact path (`root/e8-hotfix`).
- When that reaches main, re-merge main and delete the `if (newWorld)` around the canvas style in `LiveWorld.tsx`.

**F2. Join on new worlds**
- e8's "New Soul" (`BringAgent`) and `AccountApproval` are hidden on new worlds, where the God panel's Join and
  `#approve` card serve.
- One system eventually needs one Join flow. Converge on e8's `BringAgent` + `AccountApproval` when the God panel's
  Join matches it. Both drive the same `/v1/account/approvals` routes.

**F3. Explore and MySouls on new worlds**
- e8 moved MySouls into the explore group, which shows when `viewerHandle.frameLocation` exists.
- New worlds have no authored places yet: check that the explore group is useful there, or hide it, in R4.

**F4. Ungated server/engine deltas that reach old worlds if their backends ever move to this tree**
- `world.ts`: edge recovery, narrowest plan and pose restore.
- `social/actions.ts`: `sitDuration`.
- `pose.ts` seat fit: inert for default bodies.
- These are intended engine fixes and stay. **Before any old-world backend runs this tree, prove a replay** of each
  production history on a read-only copy: `tools/core/multiworld/replay-proof.mjs`, copied with `copy-sqlite.mjs`
  `VACUUM INTO`, run on ports outside 4930–4970.

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

**Full server suite (`pnpm test`)**
- Several of the above are still defaults.
- **Never run it on the laptop.** Run it off the laptop (debt: Modal or a remapped harness), or with both env vars set
  plus a port audit (`grep -rn "49[3-7][0-9]" apps/server/src/*.test.ts`).

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

**New worlds green**
- See lane REC status (`team/lanes/rec.md`) for scenarios, party, souls-r2, join clerk `/worlds` and launcher results
  on ports 5420–5440.
