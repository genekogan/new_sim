# Codex brief: group the 2026 CAD rack fragments into catalog frames and beams

Branch `codex/2026-frame-grouping` · worktree per CODEX.md §1 (`TOPIC=2026-frame-grouping`) · ETA (estimate): 6–10 h
of Codex work · report: `docs/engineering/briefs/codex-2026-frame-grouping.REPORT.md`.

## Why

Checkpoint 1 is "2022 complete". Block F's other half is 2026: rebuilding the 2026 campus needs its pallet racks
as the engine's units. An **upright** is the two-column braced frame, carried and raised as one piece; a **beam**
is the orange horizontal member. The 2026 model does not have these units. It is a CAD-derived scene in which
each `rack_member` is a single vertical post (0.09 m section) or a brace fragment. `beam_candidate`s are beams,
plus some panels that are not.

**This brief is the offline half:** a deterministic grouping of those fragments into frames and beams, with seat
heights, as data. The Claude lead then does the integration half: `engine/campus/assembly.ts` reads your JSON,
and Claude builds the year build and the lab overlay from it. You write data and a tool, not engine code.

## Context to read first

1. `docs/engineering/CODEX.md` (all of it: ports, pin rule, ownership, report).
2. `docs/engineering/AUDIT.md` §2.2 (the 2026 GLB and its component model) and §2.4 (rack naming and real
   dimensions). CAD posts measure 4.29 m (76), 4.88 m (54) and 5.97 m (40). The ~0.91–1.25 m pieces are
   bracing. `beam_candidate` pieces are 3.65 m (24) plus ~2.9–3.5 m panels. No 2026 part is mapped to stock.
   4.88 m = 16 ft; 5.97 m ≈ 19 ft plus a base plate?; 4.29 m (~14 ft) is non-nominal.
3. `viewer/engine/campus/types.ts`. The obstacle row is
   `[id, kind, cx, cz, hx, hz, yaw, y0, y1, labelIdx, confidence, assembly, componentId]`.
4. `viewer/engine/campus/extract.ts`: how prisms were fitted. `classify` names 'Rack steel' pieces
   "rack steel member (CAD)" or "rack beam (CAD)". `GROUND_Y = -0.16`. Tall pieces are split into a low prism
   and a `.up` prism (y 1.84 → top).
5. `viewer/engine/campus/assembly.ts`. This is the Kit-side grouping that yours must match in spirit (it is
   Claude-owned; read, do not edit):
   - a **frame** = a crossbar whose two ends sit on two free posts (≤ 0.07 m, same assembly), with the posts
     sharing base and height, matched to a catalog frame def (±2 cm height, ±1 cm depth); bracing is absorbed;
   - a **beam** = both ends on posts of two frames, at a `beam-seat` socket (±5 mm);
   - everything else is a `feature` or is `unclassified` with a reason.

   Its node / edge / `Unclassified` types are the vocabulary to reuse in your JSON.
6. `viewer/engine/world/catalog.ts`:
   - uprights `upright-{8,9,12,16,19}ft`, size `[depth, h, 3 in]`, depth 4 ft for 8/9/12 and 3 ft for 16/19
     (`upright-9ft` is **provisional**);
   - beams `beam-{8,9,12}ft`;
   - `uprightSockets`: `beam-seat` every 6 in from 12 in up to h − 3 in, front / back, columns l / r.

   `world/catalog-stock.ts` has the Kit variants (`upright-<ft>ft-kit`, `kitSeatLevels` 0.22 / 2.48 / h − 0.12).
7. Inputs (read-only):
   - `viewer/public/engine/campus-2026.json`: 982 KB, 7578 obstacle rows. `rack_member` = 660 components in
     907 rows (425 base + 482 `.up`); by assembly: chiba 557 rows, northeast-compound 158, west-rack-building 102,
     north-rack-building 90. `beam_candidate` = 89 rows.
   - `viewer/public/modular/components.json`, the full CAD manifest (6.2 MB): per instance `cad_bounds_m`,
     `position_m` and `source_ancestors`. It is a symlink outside git. **Never write to it.** It is richer than
     the prisms, so prefer it where the prism OBB loses information, and say which source each field came from.
8. `docs/engineering/QUESTIONS_FOR_GENE.md` Q5 (the "9 ft" part) and Q6 (beam heights). Do not resolve them.
   Report what the 2026 data says about them.

## Files owned (create / edit only these)

- `viewer/deploy/group-2026-frames.mjs`: the offline tool. Node, no network. It may `import` read-only from
  `engine/world/catalog.ts`, `engine/campus/types.ts` and `engine/core/math.ts`.
- `viewer/deploy/group-2026-frames.test.mjs`: its tests. They run under `npm test` (`node --test deploy/*.test.mjs`).
- `docs/engineering/data/**`: the output (below).
- `docs/engineering/briefs/codex-2026-frame-grouping.REPORT.md`.

## Files forbidden (Claude-owned; read only)

- `viewer/engine/campus/**`, including `assembly.ts`, `extract.ts` and `types.ts`. Integration is Claude's.
- `viewer/engine/world/**` (catalog), `viewer/engine/construction/**`, `viewer/engine/spatial/**`,
  `viewer/engine/locomotion/**`, `viewer/engine/body/**`, `viewer/engine/take/**`, `viewer/engine/scenarios/**`.
- `viewer/app/**` (lab, studio, history, engine-view), `viewer/e2e/**`, `viewer/public/**` (inputs only).
- `viewer/deploy/engine-scene.mjs` and every other existing `deploy/` file.
- All `docs/engineering/*.md` other than your REPORT. In particular, never PROGRESS.md, HANDOFF.md,
  NEXT_SESSION_PROMPT.md or OWNER_DECISIONS.md.

**Pin rule (CODEX.md §4):** never edit a pinned hash. If one moves, STOP, REVERT, REPORT. This brief should move
none, because it touches no engine code. `campus-2026.json`'s `contentHash` is an input and must stay unchanged.

## Deliverables

1. **`docs/engineering/data/campus-2026-frames.json`**, deterministic: sorted ids, fixed decimals (mm and mrad),
   and byte-identical across runs. Suggested shape (adjust with a stated reason):
   ```jsonc
   { "schema": "mars-2026-frames/1",
     "source": { "scene": "viewer/public/engine/campus-2026.json", "sceneContentHash": "…", "manifest": "viewer/public/modular/components.json" },
     "generator": "viewer/deploy/group-2026-frames.mjs", "tolerances": { /* every threshold used, named */ },
     "frames": [ { "id": "frame-2026-<assembly>-<nnn>", "assembly": "chiba",
                   "posts": ["rack_member-0002", "…"], "members": ["…bracing ids…"],
                   "base": [x, y, z], "yaw": 0.0, "height": 4.877, "depth": 0.914,
                   "catalogDef": "upright-16ft" /* or null */, "fit": { "heightErr": 0.001, "depthErr": 0.002 },
                   "confidence": "inferred" /* or "provisional" for non-nominal heights, e.g. 4.29 m */ } ],
     "beams":  [ { "id": "beam-2026-<assembly>-<nnn>", "component": "beam_candidate-…", "frames": ["frame-…", "frame-…"],
                   "length": 3.658, "catalogDef": "beam-12ft",
                   "seats": [ { "frame": "frame-…", "col": "l", "face": "front", "height": 2.480,
                                "nearestCatalogSeat": "front-l-8", "offset": 0.012 } ] } ],
     "counts": { "rackMemberComponents": 660, "beamCandidates": 89, "frames": 0, "beams": 0, "unclassified": 0,
                 "byAssembly": { }, "byCatalogDef": { }, "byReason": { } },
     "unclassified": [ { "component": "…", "assembly": "…", "reason": "lone post (no partner within 0.07 m)" } ] }
   ```
   - **Every** `rack_member` component and every `beam_candidate` is accounted for exactly once: a frame post, a
     frame member, a beam, or unclassified with a reason.
   - Frames and beams carry the catalog def they match within the stated tolerances, or `null` with the misfit.
   - **Seat heights:** give each beam end's height on its frame, the nearest catalog `beam-seat` socket, and the
     offset from it. This is the 2026 evidence for QUESTIONS_FOR_GENE Q6.
2. **`docs/engineering/data/campus-2026-frames-unclassified.md`**: a human report with:
   - counts per assembly and per reason;
   - the height histogram of posts (4.29 / 4.88 / 5.97 m and others), with what each maps to or why not;
   - which `beam_candidate`s are panels, not beams, and why;
   - any evidence on the "9 ft" question (a 2.74 m part anywhere?);
   - the ten hardest cases, with component ids.
3. **`docs/engineering/data/campus-2026-frames.svg`**: a top-down overlay of the scene's prisms (grey), grouped
   frames coloured by catalog def with their ids, beams (orange) and unclassified pieces (red), at a stated
   scale, one panel per rack assembly.
4. **`--check` mode:** `node deploy/group-2026-frames.mjs --check` re-derives everything and exits non-zero if
   the committed JSON differs. The same idea as `deploy/engine-scene.mjs --check`.

## Tests (acceptance)

- `deploy/group-2026-frames.test.mjs` (`npm test`):
  - the counts invariant (every input component exactly once);
  - determinism (two runs byte-identical);
  - `--check` passes on the committed JSON;
  - deliberately invalid cases, each giving the named `unclassified` reason and never a guess:
    - a lone post;
    - two posts of different heights;
    - a beam whose end misses every post by > tolerance;
    - a beam seated between posts of one frame;
    - a non-nominal post height (it must come out `provisional`, not snapped to 16 ft).
- `npm run test:engine` and `npx tsc --noEmit -p .` green and unchanged: no pin moves. You add no engine test.
- **Overlay review:** look at your SVG. Then capture the lab's 2026 top-down prisms with the existing spec
  (`E2E_VITE_PORT=5491 E2E_RUN=codex-2026-frames-1 npx playwright test -c e2e/playwright.config.ts
  lab-years.spec.ts -g "year-2026"`, which writes `e2e/artifacts/codex-2026-frames-1/lab-year-2026-end-top-prisms.png`).
  Compare the two side by side in your REPORT: where grouped frames sit over the rack prisms, and where they do
  not. A live in-scene overlay in the lab or studio is Claude's integration half. **Do not edit `app/lab/**`.**

## Report format

CODEX.md §8, plus:
- the `counts` object;
- the post-height histogram;
- the unclassified reasons table;
- the SVG path and what you saw in it;
- the side-by-side comparison;
- the interface Claude's `assembly.ts` integration should expect: any field you think the JSON is missing.
