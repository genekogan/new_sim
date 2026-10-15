# Stage B starting line — 2026-10-15

Audit of **main `1080cfa9`**, against [31 §3–4](<eden4>/31-UNIFICATION-STAGE-B-20261010.md). Existing code and historical test receipts establish implementation scope, **not fresh qualification**. “Not started” is stale; two engine paths remain. Estimates below are remaining agent-days including focused proof.

| Package | Baseline evidence | Missing work; estimate |
|---|---|---|
| **B1 Ground** | `engine-mars/src/ground-bridge.ts`, `god/ground-host.ts`: recipe facts, tile heights, walk/wade/swim (`687db318`, `e30779a9`). `spatial/tiled.ts`: coarse/fine grids, 64 m tiles/LRU; paging (`a2c904c6`). `ground.test.ts` covers terrain/media/isolation; `ground-paged.test.ts` covers restore. | Per-body slope, non-walk root support, runtime-scoped bounds and tile/seam/water qualification. L3 owns navigation. **1–2 d**. |
| **B2 Physics** | `god/engine-bridge.ts`, `entity-physics.ts`, `fold.ts`: incremental `world-edit/1`, openings/floors/links (`20b3af88`, `730754cd`); door/stair/replay tests. | Qualify materials/media; measure 1,000 edits at p95 ≤20 ms. **0.5–1 d**. |
| **B3 One entity** | `catalog-adapter.ts` and bridge: shared IDs, trusted moves, birth/retire, held/occupied refusals (`20b3af88`, `c2e70e6e`); chair/bowl/replay tests. | Contents/paint writeback, BYO-def agreement, occupied-seat removal and bidirectional hashes. **1–1.5 d**. |
| **B4 Perception** | `god/places.ts`, `perceive.ts`, `nav.ts`: hierarchy, enclosed rooms, map/here/names/prayers (`701c75a3`, `46e3ba53`); places tests. | Qualify hearing/privacy, collider-derived Eyes and component capabilities; capacity uses seats. **0.5–1 d**. |
| **B5 Activities** | Adapter/bridge support seats, surfaces, carry, readable/display/chess, beds and actuators (`57c8c480`, `31d6f88e`, `3acb14f3`). `soulfix2.test.ts`: 167 rooms; Mars receipt `3b6f9037`: 17 steps. | Generic work/instrument/container/ride/sport/construction, slot fidelity and full hamlet/Mars gates. **2–3 d**. |
| **B6 Conversion** | `templates/mars-two.json`, `littlemartians-two.json` (`93a18685`, `bbd15885`); Eden has `eden-district.json`. `fork-world.mjs` preserves histories using the old engine. | Full Eden content, continuity converter/cutover boundary, exact terrain, IDs/owners/tokens/takes/paid rows and rollback rehearsal. **3–4 d** after mechanism. |
| **B7 Viewer** | `LiveWorld.tsx`, `WorldEntityLayer.ts`, `world-env.ts`: existing people/camera, carried items, roofs/weather/lights (`6acb442f`, `b9dc9753`). | Eden fidelity/night windows, tours/interiors/LM qualification; retire legacy rendering after parity. **1–1.5 d**. |
| **B8 Contract/skills** | Public `god/routes.ts` `/v1/world/*`, bridge occupants/prayers, actuator openings and shared Soul/God skills (`31d6f88e`, `c2e70e6e`). | Complete activity/room contract, occupied selection/refusals and cross-path CLI/Join proof. **0.5 d**. |
| **B9 Determinism** | `ground-host.test.ts`, `engine-bridge.test.ts`, `entity-physics.test.ts`: restore/genesis hashes; `history-policy.test.ts`: incompatible-crossing guard (`96ca22cc`). | Joint journal/log/entity frontier and snapshot/suffix proofs for actual conversions. **0.5–1 d**. |
| **B10 Release** | Launcher/pool, deployment/rollback tools, history-boot gate and Modal harness (`fd9feca9`, `82a2370b`). | Contract/shared-path review, converted-world soak, per-world cutover/rollback and real-input walks; retire scenes last. **1–2 d**, plus soak. |

| Readiness check | Baseline verdict; remaining gate |
|---|---|
| **Content parity W3** | **Incomplete.** `PARITY.md` establishes expressiveness, with stale rows. Refresh full content inventory; close Eden/courtyard/windows/heightfield/sport/construction gaps and walk them. Estimates: B5–B7. |
| **Same Soul features** | **Partial.** Shared edge/CLI/conversations/intents/reminders exist; arbitrary components, Eyes/privacy and same Join journey remain unqualified. Estimates: B4/B5/B8. |
| **One account registry** | **Incomplete.** `launcher.mjs:229–231` deliberately separates old forks from new-world accounts. `account-clerk-auth-worlds.test.ts` proves opaque binding. L9: continuity without email/provider-ID equivalence, two-person isolation; **1–2 d extra**. |
| **History per world** | **Open cutover policy.** History guards/forks exist; entity converter does not. Current brief requires preserving data, superseding historical wipe allowance. Record keep/convert/rollback per world; B6/B9. |
| **One router/off-laptop tests** | **Partial.** Launcher handles `/worlds`; `tools/core/multiworld/*` handles old roots. `REMOTE-SUITE.md` provides Modal V1–V6. Unify routing; record converted-candidate SUMMARY.tsv against baseline; B10. |

**Revised remaining: 12–18 agent-days**, plus account work, navigation dependencies and soak. The lane's reclaim fix is **post-baseline** and closes only that B1 defect; B1 remains partial. Next: fill/qualify B1, without rebuilding its existing bridge or starting B2–B10.
