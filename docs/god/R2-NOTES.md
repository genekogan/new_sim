# R2: reunified with Souls, terrain first-class (tag `t2-r2`)

For Gene. Branch `root/world-engine`. The tag is local only: nothing is merged, pushed or deployed. R1 notes:
`R1-NOTES.md`. Evidence and merge log: `<team>/lanes/MERGES.md`.

## What R2 proves (33 §7)

One scenario (`tools/god-skill/e2e/souls-r2.mjs`, 37/37) plays both the god and a Soul. The Soul, Ana, is born through
the normal invite → create → pair flow and acts only through `/v1/edge`.

1. **The god builds:**
   - a knoll;
   - a mesa steeper than 30°;
   - a wadable pond, and a deep lake fed by a stream;
   - a pier;
   - a two-storey house with a door and stairs;
   - a chair upstairs and a bowl.
2. **Ana uses it:**
   - she climbs the knoll and is refused the mesa (`ground.steep`) and the deep water;
   - she wades the pond, swims the lake and walks onto the pier;
   - she goes in through the god's door, up its stairs, and sits on its chair;
   - she picks up the bowl, which is drawn in her hand, and prays; the god answers.
3. **The god's edits are refused, naming her,** when they would unseat or bury her (moving the chair, removing or
   reshaping the house, raising a hill under it, dropping a crate on her). A harmless edit nearby still goes through.

**eden-two runs with fresh Souls.** By your §9, eden-two is the representative `eden-district` template.
`district-souls.mjs` (24/24) puts three Souls in it:
- each walks to a named place;
- Cleo goes upstairs in a house and sits;
- Ben sits on a bench the god just added, and prays;
- edits that would unseat any of them are refused, naming them.

## Since R1 (25 commits)

- **Round cottage.** There is now a real round cottage, `core/roundhouse`, and `look --inside` opens round buildings.
- **Assets (L5).** Pack animals draw and move; 84 thumbnails; library-first search.
- **Souls (A-souls):**
  - bury/unseat refusals;
  - bridge decks are walkable;
  - swimming works under decks.
- **God skill (L7):** every R1 limit is fixed in the CLI and SKILL.md. Blind run 2 finished 5/5 prompts with
  0 unresolved refusals. Server patches:
  - `world` edits merge, so a weather edit no longer resets the sky;
  - sky palettes are a fixed list;
  - `slot.outside` is refused;
  - the lighthouse lamp has a collider.
  
  Lead fixes on top: overlap suggestions are given in the child's own frame, and nudge works inside buildings.
- **Polish (E):**
  - Fault recovery restores the last valid pose, never the origin, and sets aside only the faulting decision.
  - Sitting at a café table no longer trips the per-tick limit.
  - Rocks block movement.
  - Each god batch is planned once while a Soul is seated.
  - Still water no longer z-fights its rim.

## Gates on the tagged tree

| check | result |
|---|---|
| e2e (integration tree) | scenarios 30/30 · souls-r2 37/37 · district-souls 24/24 · souls-ground 15/15 · souls-entities 22/22 · terrain 22/22 · buildings 13/13 · creatures 10/10 · skill 37/37 · r1-limits 24/24 · assets 27/27 · launcher 14/14 · parity 4/4 |
| unit | god 27/27 · world-compiler 33/33 · generators 18/18 · solver 10/10 · engine-mars 211/211 |
| Mars native | 1574 pass, 0 fail (6 skipped, 11 todo) |
| server suite | 967/969 at R2's base (28ba3d21): the 2 failures are a test that hard-codes production's port 4950, and they pass on a free port. At the tag: 717/717 of files a–n, then stopped under your port rule |

Creatures and parity each failed one step in the first full pass, while three new lanes were starting. Both passed
when rerun alone. That was load, not code.

## Honest limits

- **The full server suite can't run on this laptop any more.** It hard-codes ports in Codex's range 4930–4970,
  including production's 4950. It ran against production Eden once tonight: two dev-token writes were refused by Clerk
  (recorded in MERGES.md). It moves to cloud compute or a port-remapped harness.
- **Named places need flags.** A fresh Soul can't reach a template's named places without them. Templates need
  way-marks, or Souls need `walk:<place>`.
- **The viewer has small faults:**
  - roof-top things aren't hidden when roofs are off;
  - the L3 footpath tee is drawn offset;
  - flag labels show through walls;
  - seated humanoids hold their hands clawed (L10 is still gated on your look approval);
  - carried items while walking are unverified.
- **Lane E noticed one possible problem:** a Soul upstairs after a snapshot boot got `route.goal-blocked` for every
  outdoor goal. It was seen once and is not reproduced in any e2e.
- **Two-storey roundhouses are off:** the spiral stair leaves no room for a bed.

## Next

Your LAN-party plan (GENE-DECISIONS §3):
- a Clerk port;
- "Join as a Soul" and one install skill per world;
- the launcher as a service on eden2, staging first, beside the existing release.

Merge prep, the R3+ porting, and the mechanism come after the party.
