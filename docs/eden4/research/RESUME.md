# Research resume — current pointers and historical October 2 handoff

## Current resume authority — 2026-10-03

This file preserves the October 2 research/audit handoff below. It no longer
identifies the canonical checkout or deployed release. Use `<repo>` and
[MERGE-LOG](../../STATUS.md); the authorized merge/48-day qualification are
delivered, with the elapsed live checkpoint due October 4 13:27 UTC.
F1–F8 now have successor regression repairs; F9 is intentional frontier behavior.
F10–F16 and L3–L14 were not thereby established fixed: consult the verified audit
and current code for any separate follow-up. Do not restart old fixes solely
because the historical list below says “none fixed.” Protected originals stay
read-only. External research reports retain their dates, not current pricing or
service guarantees. R9-SPAWN is an additional dated report.

## Historical October 2 handoff

Everything needed to continue is on disk in this folder. Nothing depends on a
running session. Handoff notes and scripts are in `_handoff/`.

## Code (Sim repo, `<old-sim-repo>`)

- All fixes are committed and pushed; `main` is at `4597ddf` ("Fixes from the
  server and web-client audits"), 54 tests passing.
- `4597ddf` is deployed and healthy on sim.eden.art (confirmed 2026-10-02).
- Earlier the same day: `eae71cd` fixed the "database is locked" crashes
  (about fifteen restarts a day against Litestream). Confirm with
  `ssh root@eden2 'systemctl show sim -p NRestarts'` staying flat.

## Research and probes

| File | State | To finish |
|---|---|---|
| `R1-ONTOLOGY-PRIOR-ART.md` | **final** | — |
| `R1-ontology-prior-art.html` | **final** (14 systems, 17 images; Talk of the Town and Concordia have no image, Versu only a portrait, stated on the page) | — |
| `R2-LANDSCAPE-AGENT-WORLDS.md` | **final** | — |
| `R2-agent-worlds-landscape.html` | **final** (26 systems, 31 images; a few systems have no real screenshot, stated on the page) | — |
| `R3-LEDGER-ON-CHAIN-OPTIONS.md`, `R4-CHEAP-DIALOGUE.md` | **final** | — |
| `R5-MARS-CAMPUS-PROBE.md` | **final** (crowd run on the cropped scene not run: `_handoff/campus-scripts/g3c-crowd-crop.ts`) | — |

Written separately by another agent the same afternoon (complete; do not redo):
`R6-SPORE-GAMEPLAY.md`, `R7-THE-SIMS-GAMEPLAY.md`, `R8-SECOND-LIFE.md`.

Images in the HTML reports are referenced by URL, not saved locally.

## Audits

| Audit | State |
|---|---|
| Server security (`_handoff/A1-server-audit.md`) | complete; confirmed findings fixed in `4597ddf` |
| Web client (`_handoff/A3-web-audit.md`) | complete; confirmed findings fixed in `4597ddf` |
| Replay and state (`_handoff/A2-replay-audit-verified.md`) | **9 of 16 findings reproduced with scripts (`_handoff/audit-a2-scripts/`), none fixed yet.** This is the first thing to do next session. F10–F16 and leads L3–L14 not yet examined |

### Reproduced and not yet fixed (do these first)

1. **F1** replay divergence: lapsed links are swept only in the live broadcast path (`world.ts:398`), changing link order, so a card with a derived slot can bind a different Soul live than in replay (`cards.ts:43`).
2. **F6** replay divergence: a thing made by a card shares the card's own `states` object (`cards.ts:122`, `kernel.ts:85`); a look-ahead for another Soul can overwrite live state without any event.
3. **F2** decks and manners dealt at birth come from code constants, not the world's pinned vocabulary (`fold.ts:48`).
4. **F3** a play waiting in the queue at shutdown is lost; the snapshot already marks it applied (`world.ts:216`, `main.ts:70`).
5. **F4** a program that fails during its approach sets no `avoid`; the reflex repeated one impossible decision 1,355 times in 15 simulated minutes (`world.ts:225-234`).
6. **F5** the plan-blocked timer is computed before the avoid filter, so a plan is never given up (`brain.ts:203-208`).
7. **F7** Mars adapter: a refused decision leaves the old walk running while the host cleared `pending` (`engine-mars/engine.ts:310`).
8. **F8** a plan step with `of` whose card removes its target never advances (`world.ts:294`).
9. **F9** a blocked step is skipped when a later one is playable (`deck.ts:81`): intended, but confirm it is what you want.

Left open on purpose (decisions, not bugs): per-owner share of the wish budget;
client IP handling if a CDN is added; pairing approval still carries the code in
the link; the toy-world assumptions in the web map and director
(`_handoff/A3-web-audit.md` section 2).

## Questions waiting for Gene

`19-MARS-BRIDGE.md` section 9 (where the engine lives, scenes, furnishing) and
`18-KERNEL-CARDS-AND-SELF-CHANGE.md` section 10.
