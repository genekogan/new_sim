# Mixed outfit seams — WIP, visually rejected

Entry11, base da5269cd089a98627d231e72e739245598ed2a93. This branch is **not an accepted product change** and must not be integrated as-is.

Original kit Feet sometimes own calf skin. Day9 medieval trousers plus classic boots omit119.6mm of leg; flats omit161.3mm. These are actual absent triangles, not controller state or animation timing.

Candidate1 clipped existing beach skin to fill the gap. CPU coverage/cache/weight checks passed, but the actual seated view showed an obvious radial collar where calf widths differ. Candidate2 (this source) replaces exposed shoe skin with the complete coherent donor surface below the hem. It removes that collar, but the donor foot protrudes through the selected shoe. Both are visually rejected. Four body meshes and unchanged chosen shoe clothing triangles do not guarantee fit.

Source tests: node apps/web/test/humanoid-leg-seams.cpu.mjs;14 look/API golden checks; full web tsc; web build. Scoped CPU checks establish232 gap pairs and11136 ray samples, unchanged coherent geometry, normalized weights, caching and selected garment preservation. They do NOT establish visually correct seams/shoe fit.

Actual-client evidence and hypothesis trail: <team>/soul-actions/day-11/{visual-01,seated-angles,visual-02,run.md}. Owned worlds used7866/fake minds/fresh data; CLI seats were ordinary paired seats. No controller/schema change, per-frame scans, source asset edits, merge or ship. Donor cost97296bytes/frame, once/frame, remains candidate-only.

Parked after2 visual rejections by scope judgment: proper skin/garment boundary fitting deserves a separately bounded task; do not grow it into an unreviewed body-system foundation. Before a third full-client attempt, the e2e skill requires fresh independent read-only diagnosis. Do not rerun or relax checks merely to obtain a passing label.
