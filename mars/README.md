# mars/ — the Mars world engine

A vendored, deterministic world and activity engine (pure TypeScript, fixed 1/20 s tick) with a three.js viewer, built
for a model of a desert campus and its pallet-rack buildings. Sim runs it behind the engine contract through
`packages/engine-mars` (`ENGINE=mars`). It is slated for deprecation: useful parts are being generalized into Sim.

Docs: [../docs/mars/README.md](../docs/mars/README.md). Invariants and test commands: [AGENTS.md](AGENTS.md).

## Layout

| Path | Contents |
| --- | --- |
| `viewer/engine/` | The engine: runtime, world model, spatial planning, verbs, sequences, takes, camera ([engine guide](../docs/mars/engine-guide.md)) |
| `viewer/app/` | React + three.js app: `/studio` (campus scenes by year, take replay), `/lab` (live engine sandbox) |
| `viewer/simulation/` | Cloudflare Worker + Durable Object host with MCP tools ([README](viewer/simulation/README.md)) |
| `viewer/cinematography/` | Autonomous activity camera ([README](viewer/cinematography/README.md)) |
| `viewer/e2e/` | Playwright browser tests and visual baselines ([README](viewer/e2e/README.md)) |
| `viewer/deploy/` | Build, gate, take recording, scene extraction and other Node tools |
| `viewer/public/engine/` | Generated campus scenes (`campus-<year>.json`) |
| `components/catalog.json` | Nominal stock dimensions of the rack building components |
| `scripts/` | Python/Blender asset-preparation scripts; they expect source media that is not in this repository |

## Run

```sh
pnpm install
pnpm --filter mars-campus-viewer dev     # Vite dev server: /studio, /lab
pnpm test:mars                           # engine tests
```

3D models and other media are not stored in git; they are served from assets.eden.art. The building names used in the
scenes (Chiba and the other assemblies) are scene data.

## Credits

- People: Quaternius animated characters, CC0.
- Electric unicycle: Thingiverse model 3001166 by Qwertzu1029, CC BY 4.0 (assembled, scaled and recoloured).
- Retro computer and monitor: JasperTobias on Sketchfab, CC BY 4.0 (`viewer/public/models/retro-computer-monitor.credit.json`).
