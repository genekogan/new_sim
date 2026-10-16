# REPORT — travel (M3), cloud session D, 2026-10-16

Branch `cloud/travel-20261016` (from `lane/travel-20261016` @ edae4018). Head: see the last commit on the branch
(the code head is `e856b7b`; this report is the commit after it).

## Done (no browser needed)
- **Soul CLI `travel`** (`tools/edge-skill/client-travel.mjs`, wired in `eden-agent.mjs`):
  `travel` (status) · `travel <world slug or name>` · `travel home`. On success `.eden-agent.json` follows the Soul
  (world base, Soul id, Soul token; edge mode re-detected) and keeps the **home grant** (home world + Soul + token).
  `travel home` asks home directly when the current world answers `travel.away`/unavailable or is down.
  Refused while `live` runs. Account-auth folders also record the new grant in `delegations`. Never prints a token.
- Skill paragraph + command row (`tools/edge-skill/SKILL.md`), help line (`client-help.mjs`).
- **Rebuilt + re-pinned** the served CLI: `node tools/edge-skill/build-cli.mjs` at source `4d9e5995` →
  `tools/world-launcher/soul/eden-agent.mjs` sha `18ff81e2…`, manifest `soul/builds/cli-4d9e5995.manifest.json`,
  `soul/skill.md`, `SOURCES.json`. Version stays 1.9 (additive, like lane LOOKS' `body look`).
- **Unit tests for the travel module**: `apps/server/src/travel/travel.test.ts` (16 tests; two in-memory worlds on a
  fake relay: passport, carried/uploaded body, closed world, always leave, home never refuses, return visit keeps the
  same local Soul, recall incl. unreachable world + reconcile, unreachable destination, name-taken, idempotent arrival,
  site-key check, siblingBase). CLI module: `tools/edge-skill/client-travel.test.mjs` (8 tests).
- e2e `tools/world-launcher/travel.e2e.mjs --cli` fixed (C1 copied the unbundled source; now the pinned bundle) and
  tightened (runs `observe` in Birch, checks folder world + kept home grant, no token printed).

## Tests (all in this sandbox)
- `node --test apps/server/src/travel/travel.test.ts` — 16/16 pass
- `node --test tools/edge-skill/client-travel.test.mjs tools/edge-skill/client-help.test.mjs` — 9/9 pass
- `pnpm -C apps/server exec tsc --noEmit -p .` — clean
- `node tools/world-launcher/travel.e2e.mjs --cli --out <scratch>` (ports 6110–6114, fake minds) — **PASS 14/14**, headless

## To do locally / left
- Web (needs browser): owner's Soul card "Travel to…" + visitors line, web build, real-Chrome shot of Ana arriving in Birch.
- Modal suite vs main (step 5 of the brief) — not run here (no Modal from cloud).
- Not done: per-world `.eden-client/` runtime files (queue, perception, memory) are folder-wide, not per world; a
  mind restarted after travel starts in the new world but keeps the same local memory folder. Fine for now; flag if
  memories should be split per world.
- Godmode CLI `visitors open|close` (mentioned in TRAVEL.md) is not in `tools/god-skill/cli.mjs` yet; the route
  `POST /v1/god/visitors` works (e2e G1). Left out to avoid touching the shared god CLI from this lane.
