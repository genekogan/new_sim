# Speed lane probe

Fresh dev Mars and Little Martians templates, fake minds, no production data. The tools refuse URLs outside localhost ports 5890–5899. The matrix pins the templates’ normal arrival cameras with `eye`/`at` (without shot mode), so an idle resident cannot send Broadcast to different views between runs. Run from this lane's worktree after the offline dependency install and the read-only `.lane/mars-web` overlay described in the tranche rules.

```sh
df -h /System/Volumes/Data
python3 <team>/ops/with-heavy-slot.py --owner speed --purpose speed-build --timeout 1800 -- pnpm --dir <worktrees>/lane-speed build
node <worktrees>/lane-speed/tools/speed/fixtures.mjs
python3 <team>/ops/with-heavy-slot.py --owner speed --purpose speed-before --timeout 1800 -- node <worktrees>/lane-speed/tools/speed/matrix.mjs before
python3 <team>/ops/with-heavy-slot.py --owner speed --purpose speed-after --timeout 1800 -- node <worktrees>/lane-speed/tools/speed/matrix.mjs after
python3 <team>/ops/with-heavy-slot.py --owner speed --purpose speed-phone --timeout 1800 -- node <worktrees>/lane-speed/tools/speed/matrix.mjs phone
node <worktrees>/lane-speed/tools/speed/character-transfer.mjs http://127.0.0.1:5890 <team>/scratch/speed/character-transfer.json
```

Another lane can run the same tools on its own ports: `SPEED_PORTS=6342,6343 SPEED_SCRATCH=<dir>` (fixtures, matrix and probe all honour them; the live 4930–4990 are always refused). Phone-tier parts can be isolated with `?phoneOff=detail,lod,cards,bodies,worker`, and the desktop distance detail with `?desktopDetail=0`.

Fixtures prints the two owned PIDs. Stop those exact processes with SIGTERM when finished. `fixtures.json` contains their public identities and data paths. The fixture starter refuses occupied ports before clearing its own disposable data. It creates one idle resident named Phone probe, slows the clock to 0.1, and never runs an LLM. Keep servers outside the heavy-slot wrapper; only build/probe work takes the slot.

`matrix.mjs all|before|after|phone-before|phone [output-dir]` probes both worlds. `all` runs before, after and phone sequentially under one heavy slot. `before` uses `?loadqueue=0` (legacy deferred loading); `after` uses the nearest-first queue in the same bundle. `phone-before` is useful when investigating a mobile regression. Outputs default to the speed scratch directory.

For a single configuration use `probe.mjs <world-url> --sizes 1440x900 --dprs 1,2 --seconds 4 --settle-max 120 --mbps 60 --out <directory>`. `--mobile` defaults to 390×844, DPR 3, touch input and 4× CPU throttling. The application may cap its actual render pixel ratio below the emulated display DPR; both are reported. Real Chrome uses the speed lease and the hardware GPU. The probe refuses software renderers. It never steals a stale lease.

Measurement definitions:

- `firstEntityFrameMs`: first observed active-entity renderer call, measured from navigation; the instrumentation installs on a 50 ms poll. `cardDoneMs` is the arrival overlay's ready signal.
- `settledMs`: **confirmed complete settling**, including all deferred SHAs, outstanding GLB requests, processing stages, three seconds of stable drawn triangles and seven seconds without GLB activity. That quiet confirmation is included in the number. `settled:false` reports a deadline, never a success. The queue is reported separately.
- Frame p50/p95, renderer CPU time and GPU timer queries are recorded during a still window and a real input orbit. Desktop uses mouse input; phone uses CDP touch input. GPU time is null when the timer extension is unavailable.
- `network.cdpEncodedBytes` and `glbEncodedBytes` count CDP completed-response transfer bytes through loading/still/orbit, from a fresh context with cache disabled. Continuous WebSocket traffic and partial bodies of aborted startup requests are excluded; those requests remain in the failure log. Resource Timing GLB MB is also retained for comparison with older probes.
- `textureStorage` reports scene texture payload storage: RGBA8 image dimensions with mip chains are **estimates**, compressed mip blocks are actual byte lengths. It excludes driver overhead, render targets and unknown texture formats, and can overcount distinct texture objects that share a GPU source. This is a texture budget estimate, **not total resident GPU VRAM**. Counts, hardware renderer and JS heap are reported alongside it.
- Phone checks occur after the timing windows: tap Camera controls, verify the touch help, perform a touch drag, follow the fixture resident, and send explicit fixture speech. Pair credentials stay in memory. The slow fixture playback trails the server by about 15 seconds; the probe allows 30 seconds and records speech/viewer ticks. Bubble boxes/font sizes, clamping and screenshots document readability. Empty/unavailable speech is reported as unverified. A blocked Explore touch button is recorded as a finding; the probe uses the explicitly labeled keyboard shortcut to inspect speech, and UI failures never discard timing results. Error stacks include the phase that triggered them.

Compare equal completed corpora, not triangle plateaus during loading. Keep the hardware, viewport, weather and network settings equal. These are single-run measurements on a shared M3 Max, not device qualification or universal performance guarantees. Chrome mobile emulation throttles CPU, not the physical GPU or available phone RAM.

Focused tests:

```sh
node --test <worktrees>/lane-speed/apps/web/src/gen-mesh/lazy-assets.test.ts <worktrees>/lane-speed/tools/speed/texture-storage.test.mjs
node --test <worktrees>/lane-speed/apps/server/src/world-isolation.test.ts
```
