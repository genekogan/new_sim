# Autonomous activity camera

A live director that picks shots of running activities. It observes the world and never directs actor behaviour; the Lab
camera controls ([../../../docs/mars/lab.md](../../../docs/mars/lab.md#camera-and-sound)) are its user-facing side. It
builds on the engine camera layer (`../engine/camera/`, [camera.md](../../../docs/mars/camera.md)).

| File | Role |
| --- | --- |
| `types.ts` | Observation, policy, shot, operator intent and decision types |
| `observation.ts`, `activity-observation.ts` | Read-only adapters from engine readouts and activity facts |
| `shots.ts`, `composition.ts`, `physical.ts` | Feasible shots, visual metrics (frontality, foreground), placement and readability checks |
| `director.ts` | Chooses and holds shots under a policy; operator intent takes precedence |
| `provider.ts` | Optional asynchronous advisory provider with a timeout; the render loop never awaits it |
| `jev-client.ts`, `jev-server.ts`, `bridge.mjs` | Optional model-backed advisor over a loopback bridge, run explicitly and budget-capped; server-only code never enters the browser |
| `lab-driver.ts` | Attaches the director to the Lab hook (reads data, applies render poses only) |
| `replay.ts` | Resolved program frames; exact replay needs no lookahead or model |
| `capture*.mjs`, `record-comparison.ts`, `suite-record.ts`, `review.html` | Footage capture and comparison tools |

Tests, from `mars/viewer/`: `node --test cinematography/*.test.ts`. Types: `npx tsc --noEmit -p cinematography/tsconfig.json`
(a gate stage).
