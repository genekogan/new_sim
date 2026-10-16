# eden-freeze (engine P4): Eden 2026 first capabilities call blocks the server — cloud session A, 2026-10-16
Branch `cloud/eden-freeze-20261016`, code head `268a76c` (this report is in the commit after it). Base `lane/engine-20261015` d4d0845.

**Measured** with `apps/server/test/eden-capabilities-timing.ts`. It boots the eden-2026 genesis in memory as `main.ts` does for a launcher entity world (green-field engine, GodMode genesis, ground host with paged nav, entity bridge, world env, edge ledger), with fake minds. It creates one Soul through the owner flow and times `L.capabilities()`. That call is synchronous, so its wall time is how long the event loop is blocked. This 4-core box ran the baseline 2.3× slower than Gene's laptop (192 s here vs 82 s there).
| step (this box) | first call | after a 200-tick walk |
|---|---|---|
| baseline d4d0845 | 192 s (225 s when run alongside another job) | 199 s (264 s) |
| eab73b7 upper floors cropped to their surfaces | 86 s | 91 s |
| 92c8f13 + floor memo, single-level far `levelAt`, failed-search memo, faster raster | 7.1–8.6 s | 3.0–6.4 s |
| final 268a76c | **8.2–8.7 s** (≈3.5 s on the laptop by that ratio) | **2.3–3.3 s** |

**Same capabilities:** all 572 entries are byte-identical to baseline, on the first call and after the walk (JSON compared against a baseline worktree).

**Cause:** `GodNav.capabilities` asks for `standableNearV1` and `reachV1` at every far place and room. Each built a fresh paged window that rasterised and distance-transformed every upper floor over the whole window: 174 windows over 36 distinct rects, up to 12 levels each. Rooms that a building's stairs do not reach (levels 18/19 at (-1,-74)) then ran up to 14 exhaustive A* searches each, about 0.8 s apiece.

**Fixes** (all bit-identical; L3 nav files, so route through L3 before merging):
1. `grid.ts buildGridsOverFloors`: a level is stamped and transformed only over its floors' cells. The exact EDT reads the same distances there.
2. `tiled.ts`: upper floors are memoised per (rect, level) until `setSolids`/`setFloors`, i.e. until the static world changes (192 MB LRU). `levelOver` builds only the level a far point asks for. Obstacle boxes and tile keys are memoised per obstacle list. Paged fine LRU is now ≥40 tiles; a sweep reads about 30, which thrashed the old 24.
3. `path.ts`: an exhausted A* remembers its start's side, keyed by grid content or identity, start cell, radius and link edges. A later goal outside it returns the same `null` without searching, unmasked and without `nameObstacles` only.
4. `math.ts obbOverlapAt`: the conservative raster's separating-axis test now precomputes the obstacle's corners and axes, with the same float operations in the same order.
5. The requested LRU-16 patch is superseded: `levelOver` plus the floor memo cover it, and also survive window moves.

**Tests** (focused, all pass):
- engine: grid-floor-crop (new) 2/2; ground-window-memo (new) 2/2; grid-incremental, planning, navigation, static-grid-read-cache: 35/35 together with the new ones.
- engine-mars: ground-paged, ground, ground-reclaim, retained-shore 39/39.
- server: god nav, engine-bridge, ground-host, soulfix2, places, held, edge-ledger-nav 13/13; eden-capabilities-budget (new: first call < 40 s, later call < 20 s with no tile rebuilt, memo hit counts) 1/1, 33 s.
- `tsc --noEmit` clean in apps/server, mars/viewer and packages/engine-mars.
- Not run, per the cloud rules: whole suites, `pnpm check`, the Mars release gate.

**Left / for Gene:**
- The first call is still 8 s on this box. Remaining cost: about 29 fine tiles of terrain sampling (~2.5 s, ground `areaMask`), the successful room-reach A* (~2 s), and places re-derive (P3).
- Next steps if needed: compact floor storage; warming caches off the request path. Keying `nav.ts` goal and room caches on the static epoch instead of the bridge version would be a behaviour change, which needs a decision.
- Memory: up to about 192 MB of floors, about 116 MB of fine tiles and ≤48 MB of search memo stay resident. RSS during the first call was 372 → ~760 MB, mostly transient. Check against the server's limits.
- **Local, needs a browser:** time a real HTTP `GET /v1/edge/capabilities` on the laptop (`./start.sh all 5830`). Rerun `http-proof.mjs` for the swim, upstairs, pray and sit proofs, and take a Follow screenshot.
