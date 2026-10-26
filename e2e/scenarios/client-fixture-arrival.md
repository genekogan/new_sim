---
id: client-fixture-arrival
tier: smoke
fixture: tracked-genesis-client-isolated
mocks: []
critical_path: true
---
# Isolated client fixture arrival and interaction

## Preconditions
- The launcher receipt identifies the exact committed server source, own browser bundle, genesis hash, private test flag, fake minds, and owned process IDs.
- Use only the client fixture origin on loopback7830 or its read-only bundle proxies7834/7835, and an explicit scratch Chrome profile. Never product worlds or a signed-in user browser.
- Large Eden, Mars, and Little Martians are separate parameterized runs; record fixture and camera per run.

## Steps
1. Navigate to the isolated fixture and wait for the entity layer and all required assets to settle.
   - expect-url: matches /w/client-(eden|mars|lm)
   - expect: The world canvas is visible and the arrival card completes.
   - expect: Entity layer active, not filling/building; asset queue empty; every currently selected LOD asset per drawn holder done; actual hardware WebGL renderer.
   - expect-console: no application errors
   - screenshot: arrival.png
2. Orbit the camera with real pointer input, then inspect the camera controls UI.
   - expect: Camera pose changes, canvas retains a WebGL context, and viewport does not overflow.
   - expect: Camera controls are available and readable.
   - expect: A real scene click or touch selects visible geometry and opens an object or place panel; the mobile parameter also exercises a touch drag.
   - screenshot: camera.png
   - screenshot: selection.png
3. Leave the world for the isolated origin's health document, then re-enter the same fixture.
   - expect: The previous document is unloaded and its canvas is absent on the health page; reentry has a new timeOrigin, a settled entity layer, all currently selected LOD assets done and exactly one world canvas.
   - expect: This full-document journey proves navigation/reentry. Same-document renderer cleanup is qualified separately by the retained server-epoch remount diagnostic.
   - expect-console: no application errors
   - screenshot: reentry.png
