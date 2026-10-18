# Speed first deliverable — 2026-10-15

Runtime source: `e9b814fa2ac26bd76a43b8ac78520ab9928a2275`, based on `1080cfa9ffc5965c15f22aa1228b0dfaadb5c86c`. Both desktop phases used the same built index SHA256 `04ec61a1f948bea7dc78ecb284f117e4e824902d50f0b7c9347b4e43892bdffd`; only `loadqueue=0/1` changed. The final follow-up changes the measurement tools and documentation only.

Real Chrome, ANGLE Metal Apple M3 Max, fresh contexts/cache disabled, 60 Mbit/s and 40 ms latency. Fixed template arrival cameras, clear weather, fake resident, fixture clock 0.1. Shared-host single samples. All 123 Mars and 119 LM model SHAs finished in every desktop and phone row. Settling includes the seven-second download quiet confirmation; see README for metric definitions.

| World / DPR | First frame before → after | Full settling before → after | Orbit p50/p95 before → after | Calls before → after | Texture payload estimate | Completed transfer before → after |
|---|---|---|---|---|---|---|
| Mars / 1 | 1365 → 1380 ms | 16353 → 14952 ms | 16.7/16.7 → 16.7/16.7 ms | 694 → 691 | 79.51 MB | 23.347 → 23.347 MB |
| Mars / 2 | 1354 → 1351 ms | 16263 → 14938 ms | 16.7/16.8 → 16.7/16.8 ms | 694 → 691 | 79.51 MB | 23.347 → 23.347 MB |
| LM / 1 | 1067 → 1068 ms | 46410 → 23544 ms | 16.7/16.8 → 16.7/16.7 ms | 429 → 429 | 1455.61 MB | 93.785 → 93.776 MB |
| LM / 2 | 1087 → 1069 ms | 46549 → 23275 ms | 16.7/16.8 → 16.7/16.7 ms | 429 → 429 | 1455.61 MB | 93.785 → 93.776 MB |

Nearest-first scheduling holds two unique asset slots through decode/fit/compile/upload/attachment, groups copies and admits background assets after six seconds. LM's final GLB completion moved from 39.3 to 16.3 seconds; confirmed full settling improved about 50%. Mars settling improved 8–9%. Arrival-card completion remained about 4.1 seconds Mars and 4.9 seconds LM. Detail, texture budget and orbit frame rate stayed effectively equal; this is a loading improvement. Small Mars draw-count differences are moving decor, not reduced detail.

The copied character routes now negotiate gzip. Direct HTTP with identical decoded bytes:

| Character | Identity body | Gzip body | Reduction |
|---|---:|---:|---:|
| casual | 1,857,308 B | 503,424 B | 72.89% |
| punk | 1,807,856 B | 499,959 B | 72.35% |
| woman | 1,917,076 B | 515,235 B | 73.12% |

Local gzip response time was about 22–28 ms versus 3–12 ms identity. These are server-response measurements; the world fixture lacks the modular humanoid kit and uses fallback bodies, so no end-to-end character-animation speed claim is made. JSON, byte ranges, HEAD and already encoded responses retain their behavior. Existing compressed URLs stay unchanged.

| Phone emulation | First frame | Settled | Orbit p50/p95 | Calls | Texture payload estimate | Completed transfer |
|---|---:|---:|---|---:|---:|---:|
| Mars | 3607 ms | 18445 ms | 16.8/33.4 ms | 488 | 90.39 MB + one unknown texture | 23.349 MB |
| LM | 2347 ms | 34213 ms | 33.3/50.0 ms | 157 | 1455.61 MB + one unknown texture | 93.781 MB |

390×844, display DPR 3, CPU 4×; application render DPR capped at 2. Touch drag moves the camera and Camera controls opens readable Touch help within the viewport. Explore's touch center is intercepted by the Back to broadcast button in both worlds. Speech inspection uses a recorded keyboard-shortcut workaround.

LM Follow raises repeated `matrixWorld` errors. A targeted `loadqueue=0` phone run reproduced 1,882 exceptions, beginning in `phone-follow`. The stack runs through Sprite raycast → visibility intersect → Follow limit, and Three logs that `Raycaster.camera` is missing. Those product files are unchanged from main. The speech API returns 200, but after 30 seconds viewer tick 11941 still trails speech tick 11988, so no popup appears in broken Follow mode. This is an existing phone-baseline finding, not a loading-queue regression. Evidence: `qualified/phone-legacy-lm/report.json` (first 1,000 detailed stacks retained).

Mobile loading has substantial stalls: Mars max 2117 ms, LM max 867 ms; post-arrival-card stalls over 50 ms were 2 and 18 respectively. Phone emulation retains the M3 GPU and laptop RAM. The 1.46 GB LM scene-texture estimate remains a real-phone memory risk; it is not measured total VRAM. The probe does not qualify a physical phone.

Evidence lives in `<team>/scratch/speed/`: `qualified/{before,after}/{mars,lm}/report.json`, `qualified/phone-complete/{mars,lm}/report.json`, `character-transfer.json`, and the Modal suite logs. Reports include CPU/GPU timers, asset completion, failed/aborted requests, renderer identity, memory estimates and screenshots. Startup remounts abort partial downloads; one missing humanoid-kit request is a known fixture limitation. Completed-download byte totals exclude partial aborted bodies and continuous WebSocket traffic. Invalid unbuilt/unpinned-camera runs are separately marked and excluded.

## Eden 2026 arrival (lane L3e, 2026-10-17): target, written before measuring

Eden 2026 (`worlds/templates/eden-2026.json`, 4748 entities) on the live 3.2 walk in real Chrome: cold 19.3 / 15.4 s, warm
7.5–8.4 s to the arrival card; Mars ~5.7 s, Little Martians ~5.5 s. Target: Eden 2026 warm arrival no slower than Mars's on the
same build and machine, cold at most 10 s on desktop (1440×900), and the phone number (390×844 DPR 3, 4× CPU, 60 Mbit) recorded.
Changes must be output-identical (same entities, frames and shots).
