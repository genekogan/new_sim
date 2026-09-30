# Editable campus model and 2027 design workspace

Updated 2026-09-05 following Gene's instructions. This project is private and local.

## Intended result

A dimensioned, modular 3D model, with individually editable structural components, building sections and whole structures. Users must be able to move and rotate sections, duplicate bays, change layouts, and create new structures using the actual Mars building ingredients. A textured photogrammetric surface alone does not satisfy this objective.

The viewer now includes an editable first-pass CAD/photo replica at `/studio`, eight reusable stock/template assets, interior cutaways, photo references, part/building selection, translation, rotation, duplication, JSON save/load and editable GLB export. Details and limitations are in [MODULAR_STATUS.md](MODULAR_STATUS.md).

The accuracy work is still incomplete: source CAD dimensions conflict with nominal rack sizes, the compute room and upstairs position are unresolved, and a stock-constrained as-built bay has not yet been validated. Connector snapping, undo/redo, semantic bay regrouping, verified inventory and dedicated 2027 scenarios remain future work. Do not mistake the saved CAD conversion for a fully measured replica.

## 1. Component library

The initial catalog records Gene's nominal dimensions in feet and their exact metre conversions. These are user-specified stock sizes, not measurements inferred from the scan.

| Part | Height | Frame width | Length | Color/material |
| --- | --- | --- | --- | --- |
| Upright frame | 8 ft | 4 ft | — | Blue pallet rack |
| Upright frame | 12 ft | 4 ft | — | Blue pallet rack |
| Upright frame | 16 ft | 3 ft | — | Blue pallet rack |
| Upright frame | 19 ft | 3 ft | — | Blue pallet rack |
| Horizontal beam | — | — | 12 ft | Orange pallet rack |
| Floor/wall/other panels | To establish per panel | To establish | To establish | Plywood |
| Stairs and other wood construction | To establish per assembly | To establish | To establish | Timber/wood construction |
| Occasional transparent panels | To establish per panel | To establish | To establish | Plexiglass |

Model upright frames as assemblies of posts and bracing once their actual configuration is established. Preserve the supplied frame-width dimension without silently equating it to a bay width. Establish which physical faces define the nominal dimensions before deriving connection coordinates. Beam nominal length is not automatically the clear span or post-center spacing.

Still to establish: post and beam cross-sections, steel thickness, bracing layout, connector geometry, connection offsets, attachment-height increments, panel sizes/thicknesses, and stair construction. Do not silently substitute common catalog dimensions. Preliminary geometry must flag any assumed dimensions.

## 2. Reconstruct the 2026 assemblies

Start with Chiba, working bay by bay, then extend to other structures. Use the component dimensions as geometric constraints; fit the structure's position, orientation and assembly arrangement to multiple camera views rather than stretching stock parts to follow noisy scan surfaces.

Use the March 2026 photos and meshes for the dated layout. Revisit April dismantling footage to study exposed framing, bracing and connections; distinguish that structural evidence from the earlier assembled layout. Inspect archived CAD only as a possible source of part geometry or design intent, verifying any reused content against the as-built footage.

Each placed component needs a stable ID, type, parent assembly, transform, source references, and evidence status. Distinguish directly visible geometry, user-specified dimensions, inferred assembly relationships and unresolved details. Keep unresolved components selectable and visibly marked in an inspection mode. Do not present occluded connections as observed facts.

Use a hierarchy that allows editing at useful scales: campus → structure → section/bay → frame/beam/panel/stair assembly → individual part. Plywood floors and walls must be independent elements, not fused into a textured shell. Group sections without merging their constituent meshes.

## 3. Evaluate the modular reconstruction

Render the component model at the recovered drone camera positions. Compare silhouettes, frame intersections, floor and roof levels, stair landings, major openings and cladding boundaries against photographs from multiple directions. Check across different heights and viewpoints so one pleasing view cannot conceal a wrong depth or alignment.

Retain nominal part dimensions during fitting and report mismatches. Reconcile the close-orbit scale against the identified rack sizes instead of treating its arbitrary photogrammetry units as metres. Keep scan-registration uncertainty separate from exact nominal component dimensions. Review the main structure before multiplying its assembly pattern across the campus.

## 4. Editable design environment

Use Blender for detailed component geometry, materials, object hierarchy and inspection. Use the existing Three.js browser interface for approachable campus layout work. Preserve a local, versioned component-and-scene description so layouts remain reproducible and browser edits can be exported back into an editable Blender scene.

Required browser operations:

- Select a part, bay, section or whole structure.
- Translate and rotate selected assemblies; duplicate and delete placed instances.
- Snap compatible connectors and floor levels using established connection dimensions.
- Add stock components and reusable bay/section assemblies.
- Switch reference scans, modular geometry and photographs on/off independently.
- Undo/redo changes and save/load named local layout scenarios.
- Export component-preserving Blender/GLB scenes and a quantity schedule from placed parts.

Use instanced reusable geometry where convenient, while keeping every placement individually addressable. Do not flatten the final design scene into a single mesh.

## 5. Draft the 2027 campus

Keep a dated 2026 baseline and create separate editable 2027 scenarios. A new section or relocated building belongs to a proposed layout, not the historical reconstruction. Scenarios should support whole-building movement as well as changes inside buildings. Record quantities of each stock upright height, beams, panels and other components as the design changes.

## Delivery sequence

1. A dimensioned component library with clearly marked unknown details.
2. One validated Chiba bay/section demonstrating accurate reusable assembly.
3. The full modular Chiba model and its photograph comparisons.
4. Remaining campus structures and a saved 2026 baseline.
5. Browser editing, named 2027 scenarios, editable exports and component counts.

Accuracy takes priority over decorative detail or filling unknown spaces. Photogrammetry remains a useful reference throughout; the editable structural model is the main next deliverable.
