# Codex 2026 frame grouping report

## 2026-09-28, 16:38 UTC

- Branch: `codex/2026-frame-grouping`; rebased onto `main` at `a98c0b37ac95e1c55f15c9294b11d1b34c725626` (`git merge-base HEAD main`).
- Feature commit: `9736f83 Group 2026 CAD rack fragments into auditable frame data`. This report is the following commit.
- `viewer/deploy/group-2026-frames.mjs`: deterministic, offline manifest/scene grouping and `--check`; explicit reasons for refused pieces. CAD bounds supply heights and horizontal spans; scene prisms supply world x/z and yaw. Source mapping and tolerances are in the JSON.
- `viewer/deploy/group-2026-frames.test.mjs`: six tests, including every-input-once, determinism, check mode, a valid beam, and deliberately invalid lone, mismatched, missed-end, same-frame and non-nominal cases.
- `docs/engineering/data/campus-2026-frames.json`: sorted groups and per-end seat evidence; `campus-2026-frames-unclassified.md`: detailed dimensional and refusal report; `campus-2026-frames.svg`: top-down overlay with one rack-assembly panel each.

### Counts and evidence

```json
{
  "rackMemberComponents": 667,
  "sceneRackMemberComponents": 660,
  "beamCandidates": 89,
  "frames": 81,
  "beams": 12,
  "unclassified": 92,
  "byAssembly": {
    "chiba": { "frames": 47, "beams": 0, "unclassified": 21 },
    "north-rack-building": { "frames": 9, "beams": 12, "unclassified": 15 },
    "north-workshops": { "frames": 0, "beams": 0, "unclassified": 28 },
    "northeast-compound": { "frames": 16, "beams": 0, "unclassified": 9 },
    "west-rack-building": { "frames": 9, "beams": 0, "unclassified": 19 }
  },
  "byCatalogDef": { "unmatched-frame": 81, "beam-12ft": 12 },
  "byReason": { "beam-end-miss": 12, "panel-not-beam": 65, "coincident-post": 8, "no-scene-prism": 7 }
}
```

Post-height histogram from the manifest: 4.292 m × 76, 4.877 m × 54, 5.971 m × 40. None is a full catalog frame fit: all measured post-pair depths are about 1.02 m, not the stock 0.914 m; the 4.292 m and 5.971 m heights are also non-nominal. These frames retain their CAD dimensions and `catalogDef: null`; no stock snap was made. The 12 classified beams are 3.65 m candidates with both ends on distinct paired frames. Their CAD beam-centre seat heights are 3.251 and 4.052 m above the frame bases, with nearest 6-in stock-seat offsets +0.050 and −0.063 m. Twelve other beam-length candidates miss paired posts by about 0.21 m; the tool refuses them at the stated 0.12 m tolerance. The remaining 65 candidates have broad panel dimensions. No 2.743 m post or 9 ft beam candidate appears, so this source does not resolve Q5.

### Verification on the reported rebase

- `cd viewer && npm run test:engine`: **372 pass, 0 fail, 3 skip** of 375. All pinned tests pass unchanged; no pin was edited.
- `cd viewer && npx tsc --noEmit -p .`: clean.
- `cd viewer && npm test`: **62 pass, 0 fail, 0 skip**, including six new grouping tests.
- `cd viewer && node deploy/group-2026-frames.mjs --check`: byte-identical JSON, Markdown and SVG.
- `cd viewer && E2E_VITE_PORT=5491 E2E_RUN=codex-2026-frames-3 npx playwright test -c e2e/playwright.config.ts lab-years.spec.ts -g 'year-2026'`: **1 pass, 0 fail**.

### Visual review and integration limits

I looked at `docs/engineering/data/campus-2026-frames.svg` via `viewer/e2e/artifacts/codex-2026-frames-1/grouping-preview.png` and the rebased lab capture `viewer/e2e/artifacts/codex-2026-frames-3/lab-year-2026-end-top-prisms.png`. In the SVG the 81 purple frame pairs lie along repeated rack prism lines; 12 orange beams join the north-rack-building pairs. The Chiba pairs form two distinct groups, as do the rack rows in the lab's wider campus view. Red unclassified points concentrate where posts overlap or a beam endpoint misses. The lab capture shows the full 2026 scene and engine prisms, while the SVG isolates rack assemblies; they agree at the level of rack arrangement, but a pixel-level registration or live in-scene grouping overlay is not yet possible. The lab still shows raw prisms, not these frame units.

Claude-owned integration needed: `viewer/engine/campus/assembly.ts` (or its 2026 adapter) should read `frames`, `beams` and `unclassified` from the JSON, use `posts`/`members` as one frame unit, and use each beam end's `frame`, `post`, `col`, `face`, `height`, `seatSourceDef`, `nearestCatalogSeat` and signed `offset`. It must retain `catalogDef: null` and the measured `base`/`height`/`depth` for all 81 frames rather than silently treating them as stock. A catalog definition or deliberate dimension mapping would be needed before those units can be constructed with current stock actions. A live lab/studio overlay would require a Claude-owned app edit. I made neither edit.

Approximate effort: 26 minutes wall-clock; about 31k model tokens. The CAD is an evidence-informed replica, so these are geometric groupings, not verified as-built dimensions or historical claims.
