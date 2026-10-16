# Integration rehearsal: 25 of 26 lanes on release 2 (`cloud/integration-20261016`)
Base `release/2-20261016` @ `dc6595a2`. One `--no-ff` merge per lane in INTEGRATION.md order; eden-god.mjs rebuilt each time (`build.mjs --check` fresh). Head: see the last commit on this branch. Nothing was deployed, no browser was used, and no live service was touched.

| # | branch | merged? | conflicts → resolution | tests |
|---|---|---|---|---|
| 1 | lane/walk | yes | slots.ts message (release slot gaps + walk clearance); engine-bridge hooks (both). Later fixes, see **W** below | 5 lane files + mars social 32 |
| 2 | lane/polish | yes | — | 4 files; polish-walk/header are browser probes |
| 3 | lane/fixes2 | yes | — (body-URL fix already identical in release 2) | 7 files |
| 4 | lane/welcome | yes | — | 3 files |
| 5 | lane/safety | yes | preview read: release 2's view-key design kept (routes, GodPanel); `WorldPreviewGhost.show` takes release's access or safety's loader + stale-request guard; safety's owner-only gating dropped (would block view-key visitors) | 8 files (attach-historical needs `SAFETY_SCRATCH`) + release ghost test |
| 6 | lane/worldops | yes | GodPanel open state; LauncherHome card (both sides) | worldops + all launcher tests |
| 7 | lane/bodies | yes | — (Eyes still off unless `EDGE_EYES`) | 4 files |
| 8 | lane/downtime | yes | launcher.mjs ×4: handover + safety policy + worldops claim lock + release `closing` | keeper 5; keeper "reload…" flaked 1 of ~25 runs |
| 9 | lane/moderation | yes | http imports; WorldEntityLayer heartbeat; assets upload = release admission, then G8 intake. **Gene:** truncated GLB now `asset.invalid`, not `upload.invalid` (1 moderation assertion changed) | moderation 9, god/assets 15 |
| 10 | lane/inbox | yes | http mounts; cli/state/remote-look union (release retry/deadline + inbox notice). `requireInvited`: inbox authorizes by world/Soul ownership only; a revoked invite keeps inbox access (left as is) | 4 files + 16 god-skill tests |
| 11 | lane/gate | yes | one-validation.sh (gate's tap + full launcher suite) | 13 files (web loader; harness needs non-shallow clone) |
| 12 | lane/quality | yes | — | 8 files + cli.test 98 |
| 13 | lane/phones | yes | LiveWorld: phone tier feeds release `worldResolution` (shot mode 1×) | 3 files |
| 14 | lane/speed | yes | mesh.mesh.ts: moderation hidden-asset skip before deferred load | 3 files |
| 15 | lane/events | yes | layers.ts imports + `active()` | 2 files + layers 9 |
| 16 | lane/todo | yes | vocabulary.ts: todo's offer-aware refusals; quality NOWHERE only where no world offers it. **Gene:** quality test now expects todo wording for swings/punts/bikes. **Hash pins NOT refreshed** (sandbox refused editing the pin file): `eden-data-descriptor-pair.json` activity-spots → `17efd76e…b3b7da`, south.ts → `fced5d58…01fae7` | 13 files |
| 17 | lane/catarchive | yes | registry paths dropped, `coreLibrary()` kept, Godmode kept. Kept minimal `@sim/catalog` (measure + release's EF4 conformance used by god-gate); parts.test registry cases removed; ARCHIVED.md notes it | god 362/0, conformance |
| W | walk × release 2 | fix | found at #17: bed refusal now yields to construction/private; XP5 walkable kits keep the slot approach; 2 release tests nap on the ground (walk E2#10 refuses core-bed sleep) | god suite, 31 edge-ledger files |
| 18 | lane/cdn2 | yes | — | 3 files; 1 world-scoped + 2 cdn cases need laptop `SOURCES.csv` (same on base) |
| 19 | lane/bugs | yes | motion/kit/world-env/LiveWorld (both); no #2 versioned-policy commit present | 7 files, generators, world-compiler |
| 20 | lane/artsound | **skipped** | Conflicts with release 2 V4 `sign-media.ts` (only `/assets/<sha>.png\|jpg`, no URLs/data/video): 5/7 art.test refused, own `/art/<sha>` uploads too; `/v1/art/media` skips G8 moderation. **Gene:** extend sign-media + moderate art uploads, or keep V4 | trial only |
| 21 | lane/mars | yes | WorldAtmosphere (bugs E2#8 pacing + dust); patch.test fixture binds via `defRefs` | 9 files |
| 22 | lane/kit | yes | — | syntax checks on 14 deploy scripts (no tests) |
| 23 | lane/parity | yes | — | 4 files; visual.test needs laptop chrome-lease |
| 24 | godmode/faces | yes | — | 3 files + generators/world-compiler |
| 25 | godmode/districts | yes | schema endpoints; cli flags | 3 files + cli.test |
| 26 | edge/capability-stall | yes | — (adds root `REPORT.md` + evidence JSON) | 2 files + mars navigation |

**Typecheck:** tsc clean for server, world-compiler, generators, web, catalog, engine-mars, mars/viewer.
**Godmode gate (`node tools/god-gate.mjs`, headless): 11/12 suites PASS.** god 380/0 (7 skipped), world-compiler 119, generators 68, kit-mesh 11, faces 10, gallery-diff 2, CLI-lib 243, tsc server/world-compiler/generators, skill-build. **catalog FAIL (1 case):** bugs' E2 #3 `flee` made a new `core-badger@1` revision (`47ba41ee…`). Its 7 > 4 gallery draws finding is already documented under the old hash `d6e2414e…` in `known-20261015.json`; that record needs review (left untouched). gallery-pixels not run (needs recorded galleries).
**Needs `pnpm install`** (esbuild + meshoptimizer added by gate/phones). **To do locally:** browser/visual proofs (polish, phones, bugs E2, parity visual), laptop-path tests above, descriptor-pair pins + proof rerun, badger conformance record, artsound decision.
