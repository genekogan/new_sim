# Mars College campus — reconstruction and modular design

Private, local project. Source media is never modified. Generated datasets, intermediate models, and validation evidence live at `../../docs/media/reconstruction/2026-campus/`.

## Objective
Reconstruct the built campus from actual overlapping drone images, preserve observation provenance, and evaluate against images withheld from reconstruction. Do not invent unobserved structures or call an unconstrained model survey accurate.

The photogrammetric meshes are the reference layer, not the final design tool. An editable first-pass campus replica is now saved and available at `/studio`, with a nominal component library, source textures and interior evidence. Its dimensions and hidden interiors remain provisional. A separate 2027 workspace and verified inventory will follow. See [MODULAR_STATUS.md](MODULAR_STATUS.md). See [ROADMAP.md](ROADMAP.md) and [components/catalog.json](components/catalog.json).

## Working method
1. Search the existing media catalog, probe candidates, and inspect temporal storyboards.
2. Group footage by capture date and campus state. Exclude dismantling, night scenes, unrelated footage, duplicates, and edited historical clips from the built-campus solve.
3. Begin with the March 23 4K orbit. Keep camera samples and geometry from native Apple RealityKit photogrammetry; independently solve sparse geometry with COLMAP for diagnostics.
4. Add compatible wide/overhead views after evaluating change and registration.
5. Export the textured mesh to GLB and retain USDZ plus original reconstruction data.
6. Compare renders to held-out source frames. Report holes, thin-structure losses, registration residuals, and scale uncertainty.
7. View locally in Three.js. No publication or upload of private archive media.

## Commands
- `python3 scripts/inventory.py`: metadata + contact sheets
- `python3 scripts/storyboards.py`: temporal review sheets
- `swiftc -parse-as-library scripts/reconstruct.swift -o scripts/reconstruct`: native local photogrammetry
- `scripts/reconstruct IMAGE_FOLDER OUTPUT_FOLDER`: textured USDZ, camera poses, sparse cloud

## Interpretation
Video photogrammetry can recover visible exterior geometry. It cannot establish hidden interiors, fine dimensions, or absolute scale without independent constraints. A low pixel residual is an image-consistency diagnostic, not a centimetre accuracy certificate.

## Open the local viewer
Run `./scripts/start_viewer.sh`, then open http://localhost:4326/studio for the component model or http://localhost:4326/ for aerial references.
The `viewer/public/data` symlink points to the canonical generated deliverables. No archive images are uploaded. The server binds to loopback only.

## Files
- `docs/media/reconstruction/2026-campus/inventory/SOURCE_REVIEW.md` (under the Mars root): dated source-selection audit.
- `docs/media/reconstruction/2026-campus/deliverable/`: browser assets, GLB meshes, packed Blender projects, and report.
- `docs/media/reconstruction/2026-campus/models/`: original USDZ reconstructions, camera poses, sparse clouds, and independent COLMAP solutions.
- `docs/media/reconstruction/2026-campus/validation/`: withheld photographs, calibrated renders, and diagnostic residuals.

The two dated reconstructions are separate observations of a changing campus, with separate coordinate systems. Do not superimpose their movable objects or use the files as construction drawings.
