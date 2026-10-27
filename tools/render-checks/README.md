# Local rendering checks

These diagnostics use one isolated fake-mind world and one local browser. They
do not call a model, modify production or launch Modal. Pass a new absolute output
directory and a reviewed physical genesis file. Port 4994 must be free.

```sh
node tools/render-checks/unified-follow.mjs /absolute/new-proof /absolute/mars-physical.json
node tools/render-checks/unified-temporal.mjs /absolute/new-temporal /absolute/mars-physical.json
```

Build the current web code first. Follow exercises the real UI and native wheel,
drag and touch input, then walks and sits in Chiba and Mimos. Its assertions cover
input response, retained Follow mode, passive stability, bounded automatic camera
motion, visible skinned bodies and foot vertices above their supporting floor
(1 cm tolerance). Camera motion uses RAF timestamps and reports displacement
normalized to 60 fps against the existing 0.35 m/frame glide bar. Scripted native
movement is functional proof; use the separate Soul harness for high-level
interpretation, completion claims and latency/token comparisons.

Temporal captures compare identical fixed framing with moving daylight, a paused
clock and moving daylight without shadows. Raw GPU reads run after drawing and
reject empty/transparent buffers. They are the numerical source; compressed
videos and `temporal-metrics.py` heatmaps are for visual inspection. A still image
is not a flicker test. Retain the initial capture and all diagnosed repair runs.

Run these before reserving a laptop for measured Soul batteries. Both scripts
close their own browser and stop their own server in `finally`.
