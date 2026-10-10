# R1 — world building (tag `t2-r1`)

For Gene. Release 1 of tranche 2 (plan: `<eden4>/33-OVERNIGHT-PLAN-20261010.md` §7). Branch `root/world-engine`,
local tag only. Not merged, not pushed, not deployed.

## The demo, as it ran (2026-10-10, 18:14–18:40 UTC)

The 33 §7 R1 demo was run on the integration tree with the launcher on :4980.

1. **The world, from the homepage.** In a browser I clicked New world, named it "Hillside R1", picked *Empty plain*
   and pressed Create. The world page opened with the god panel. I then signed in, became its god and ran the
   panel's own pairing commands in a fresh folder: download `eden-god.mjs` and `SKILL.md` from the world, then
   `register` and `pair`. I approved the code in the panel, and the CLI answered `paired: true`.
2. **The agent builds.** A fresh agent was given only that folder and the owner's request ("a hillside village:
   rounded houses you can look inside, a river under a bridge feeding a pond with ducks floating on it, a dog
   trotting around, under a sky you choose; in named groups"). It had no repo access and no hints. In about
   25 minutes it built 103 entities in nine groups:
   - **terrain:** a hill
   - **water:** a river from a spring pond to the village pond
   - **lane:** a cobbled lane that bridges the river by itself, with a welcome sign
   - **houses:** six round, dome-roofed houses facing the lane
   - **interiors:** 49 pieces of furniture and tableware
   - **paths:** six door paths
   - **ducks:** five mallards floating on the pond
   - **dog:** one, wandering
   - **greenery:** 30 trees, reeds and bushes

   It chose a golden-hour sky. Every constraint holds (`resolve`: 78 constrained things).
3. **Undo by group.** The agent built a market of 10 things, then ran `undo --group market`, which answered
   `undid group "market": edits 128…122`. The world went back to 103 entities, and the hash of the sorted
   entities plus ground was identical before and after (`a0e30f13…`). Two earlier groups, `probe` and the first
   `houses` try, undid just as cleanly.
4. **`look` from the entrance**, plus close looks inside two houses. I opened every shot myself, and the live
   page in a browser shows the same village, as a visitor sees it.

Evidence, kept outside the repo: `<team>/lanes/r1-shots/`.
- **Shots:** `entrance.png`, `overview.png`, `inside-house.png`, `inside-house-2.png`, `bridge.png`,
  `ducks-on-pond.png`, `house-door-path-dog.png`, `market-before-undo.png`, `after-undo.png`.
- **The agent's log:** `BUILD-LOG.md`, with every command, refusal and look.

## Gates on the tagged tree

| check | result |
|---|---|
| `tsc --noEmit` (server, web, generators, world-compiler) | clean |
| god tests `apps/server/src/god/*.test.ts` | 27/27 |
| world-compiler / generators / ground | 33/33 · 18/18 · 24/24 |
| solver unit tests | 10/10 |
| shared e2e `scenarios.mjs` | 30/30 |
| lane e2es: terrain, buildings, creatures, parity, launcher, skill | 22/22, 13/13, 10/10, 4/4, 14/14, 37/37 |
| god + Soul e2es (from the handoff, b2e2ca49): souls-ground, souls-entities | 15/15, 22/22 |
| parity matrix `matrix.mjs --check` | complete, 92 rows |

**Not run:** the full server suite and the Mars native suite. On this machine they cancel under load. They are
scheduled for a quiet window before R2, and the earlier load failures listed in MERGES.md will be compared
against base.

## What is in R1 (against 33 §7)

- **L1 core:** the ledger, validated edits with inverses, groups, flags, preview, schema/query, genesis templates,
  and the mesh registry. The L7 lead patches landed in this release:
  - SCHEMA.md and the examples are served.
  - `along` uses the walker's side, end to end.
  - `facing` an area or path aims at its centre.
  - Gen-made defs expose their generator's params.
  - Duplicate names are refused.
- **L2 buildings v1:** enterable rooms, doors, stairs, roofs, interior cut-away and furnish recipes.
- **L3 terrain:** hills, ranges, lakes and ponds that carve and fill, rivers that snap into ponds, roads that bridge
  rivers by themselves, waterfalls, piers and palettes.
- **L4 library:** 263 defs (179 kit, 84 mesh) with creature roles and gaits (ducks swim, the dog wanders).
- **L5 asset store:** packs and catalogue search. The lane is resuming now to finish verifying in the browser.
- **L6 launcher:** homepage, the New-world dialog with templates, sign-in/claim/pair/approve in the panel, Edits
  undo/redo, flags, preview ghosts, and auto-restart.
- **L7 god skill v1:** library-first, the solver, `look`, six examples, and server-side `furnish`.
- **L11 parity:** the matrix and three demonstrator templates (eden-district, mars-camp, littlemartians-garden).
  It is proof in principle, not a rebuild.

Two fixes went in during the R1 cut (`cee1f441`). Preview ghosts drew nothing, because the world page replaced the
panel's ghost. The launcher e2e's last step also raced the panel's switch to the Edits tab.

## Honest limits (what a stranger would hit)

**The houses**
- There is no real round cottage. The agent's round houses are the library's lighthouse cut down to one floor,
  so each house has one room, with the lamp column in the middle. `roof=dome` on a cottage only puts a
  hemisphere on a flat roof.
- `look --inside` does not cut away the lighthouse's ceiling. Interior shots were taken by aiming at a piece of
  furniture.
- Custom floor `plan`s are effectively unusable: the format for doors and the exterior is undocumented.
- `furnish` had nothing for a one-room round house, so the agent placed all 49 pieces by hand.

**Furniture placement**
- Hand placement ignores doorways: `bed --wall n` landed in front of a north-facing door.
- `--wall` and `--corner` are world compass directions, not the room's own.
- In round rooms, `--corner` points outside the wall.
- `move <room item> --near <other item>` sent a lamp 39 m into the hillside. The server accepted it as
  "inside the room".
- `move <thing on a table> --by` crashes the CLI.

**Overlaps the server accepts**
- Two cups placed with `--count 2` on a table land on the same point.
- A lamp went through a headboard, because the lamp's collider is only its pole.
- Tables went through the lighthouse's lamp column.

**Sky and weather**
- `sky` and `weather` overwrite each other's settings.
- An unknown palette is accepted and echoed back.
- There is no list of palettes.
- The golden-hour sky reads grey in renders and on the live page.

**Other CLI rough edges**
- `--near <area> --count n` scatters things to the corners of the area's bounding box, not around its rim.
- `place footpath --from house --to lane` runs from the house's side to the lane's first point, not from the
  door to the nearest point of the lane.
- A `--row`'s items (`stall-1…3`) cannot be referred to as one group by their row name.
- The CLI silently ignores arguments it cannot parse.
- `defs <full ref>` returns a fuzzy search, not that one def.

**Process**
- Local sign-in uses `window.prompt()`, which embedded browsers do not show. To get past it I set the stored
  dev name the prompt would have stored. Privy sign-in under the launcher is still not exercised.
- Undoing a group that later groups depend on (`houses` under `interiors`) probably conflicts. The owner has to
  undo the dependants first; this is not yet surfaced in the panel.
- L10 humanoid diversity is not in R1. It waits for Gene's look approval (`team/lanes/GENE-DECISIONS.md` §1).

What worked well, in the agent's words: the solver's relations (`--along --side`, `--facing`, `--inside --wall`),
the auto-bridge, the river snapping into the pond, `--float`, precise refusals, and group undo.

## Next: R2

R2 is reunified with Souls, with terrain first-class. Lane A-souls is building the single god + Soul scenario on a
fresh world (`souls-r2.mjs`). In it, a Soul born through the normal flow:
- walks built terrain (steep slopes refused, wading, swimming)
- goes through a god-built door and up the stairs
- sits, carries a bowl and prays

God edits that would bury or unseat it are refused, with the body named. Also planned for R2:
- L7's blind run 2.
- The fixes for the limits above, where small.
- The full suites in a quiet window.
- eden-two with fresh Souls.
