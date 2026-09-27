import pathlib,json,collections,csv,html
import markdown
P=pathlib.Path('<mars-campus-repo>');O=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/deliverable');m=json.load(open(O/'components.json'));n=len([r for r in m['instances'] if r['kind'] not in ['reference','context_person']])
text=f'''# Mars 2026 — editable component replica

This is a working, evidence-informed replica for design development. It is **not yet a dimensionally verified as-built**. The original aerial reconstruction remains available for visual comparison. The modular model combines archived campus CAD, the user's nominal rack dimensions, drone-derived finish maps, and reviewed 2026 interior photographs.

[Open component studio](http://localhost:4326/studio) · [Open drone reconstruction](http://localhost:4326/)

## What is saved

- **{n:,} editable source pieces**, organized into movable campus assemblies, with stable component IDs and reusable definition IDs. These include recovered rack members, wood components, panels, glazing, equipment, furniture, shelters and vehicles. Pieces are not equivalent to purchased stock items.
- **Eight reusable stock/template assets.** Upright frames: 8′ × 4′, 12′ × 4′, 16′ × 3′ and 19′ × 3′. Orange beam: 12′. Plywood, timber and acrylic blanks are adjustable examples; their dimensions are not confirmed stock sizes.
- A packed Blender project, browser GLBs, source-component manifest, nominal stock catalog, room-evidence record and original texture coordinates.
- Drone photographic atlas and five 4096px orthographic finish projections. Roof surfaces use projected photographic finishes; 182 façade components use coverage-screened wall-only projections. Original and extracted texture sources remain saved. Other surfaces retain source/generic materials. Generic materials can be used independently.
- Eight editable, generic 3D people use three CC0 Quaternius templates. Ground and sky are presentation assets; see [appearance sources](appearance-credits.html).
- Ten curated interior reference images, each with its original path and SHA-256 provenance in `references.json`.

## Files and workflow

| File | Purpose |
|---|---|
| [mars-2026-modular.blend](mars-2026-modular.blend) | Editable campus, source textures, photo projection UVs and asset-marked nominal stock library |
| [campus-components.glb](campus-components.glb) | Full campus with named component objects and metadata |
| [chiba-components.glb](chiba-components.glb) | Chiba component assembly |
| [component-library.glb](component-library.glb) | Reusable stock/template set |
| [components.json](components.json) | Source definitions, instance IDs, geometry provenance and uncertainties |
| [stock-library.json](stock-library.json) | User nominal dimensions and unmeasured profile details |
| [rooms.json](rooms.json) | Interior identification and location confidence |
| [references.json](references.json) | Reviewed ground-photo evidence |
| [textures/photographic-textures.json](textures/photographic-textures.json) | Drone texture provenance, projection cameras and approximate registration |
| [modeled-pieces.csv](modeled-pieces.csv) | Audit of modeled geometry; stock on hand is intentionally blank |
| mars-2026-modular-cad.blend | Preserved first component conversion before photo-informed refinements |

In the browser, choose **Building** or **Part**, select an object, and use Move/Rotate or the numeric inspector. **Save layout** downloads a JSON of object transforms and proposed additions. **Open saved layout** restores that JSON against this version of the base model. **Export edited GLB** saves the edited geometry and textures for other 3D applications. Reloading the page alone does not save unsaved edits.

In Blender, use the named collections and object custom properties. The reusable nominal stock collection is separate from the as-modeled campus and is hidden from renders. Reveal it in the Outliner or append its asset-marked objects into a new design. A stock frame is a reusable object; the recovered CAD may contain its individual posts and braces separately.

## Accuracy and source hierarchy

1. **Nominal dimensions from Gene:** authoritative for the new stock library's overall rack height/width and beam length. Profile sizes, connector geometry, attachment spacing, feet and brace details are illustrative, not measured.
2. **Archived CAD:** `code/godot-mars/Imported Models/Mars Aerial/Mars 2026 - Aerial Located.glb`. Supplies editable shape and layout. Many source component names disagree with their scaled geometry. Imported members are therefore not silently classified as exact nominal stock or normalized by stretching the assembly.
3. **Drone reconstruction:** March 23 close orbit supplies observed exterior finishes; March 19 coverage supplies wider campus comparison. A manual four-roof-corner local similarity gives approximately **0.38 m fitting RMS**. This measures agreement between those selected image/CAD corners only, not independent dimensional accuracy. Registration, roof coverings, date differences and hidden geometry remain uncertain.
4. **Ground photos:** confirm the main hall's tiered seating, central aisle, side galleries, tall projection wall; kitchen counters and window/sink arrangement; and the café's sloped transparent wall, blue uprights and orange beams. The CAD projector has been changed from landscape to portrait proportions; its 3.35 × 4.55 m size is an estimate. Glazing is rendered transparent. Furnishing placement and dimensions are still provisional.

## Important unresolved differences

- The compute room has **not been confidently located**. The electronics-workspace image is a candidate, not a confirmed identification. The upstairs desk/screen photo is useful evidence but not enough to certify its room position.
- The CAD's whole-campus placement uses historical aerial images that are not a surveyed orthomosaic. The attempted automatic global image match was rejected as degenerate. It is not used for geometry.
- Roof photo projection can retain lighting and visible misregistration. Wall-only projections are applied to 182 façade components; hidden surfaces and scan/CAD alignment remain approximate. Some panels, walls, roof coverings and interiors remain generic. The model is not yet an exact visual or measured replica of every finished condition.
- Recovery separates connected source geometry; some custom assemblies remain aggregated, while a rack frame may be split into several members. The **{n:,} pieces are not a bill of materials**.
- No inventory of available wood or racks has been established. Modeled usage and actual stock on hand must be reconciled later against physical counts and confirmed dimensions.

## Review performed

Reviewed all 20 original 2026 drone videos through temporal storyboards in the earlier reconstruction pass, selected orbit/flyover frames, six interior contact sheets, and selected full-resolution room photographs. Compared CAD exterior and cutaway renders against those photos. Removed illustrated CAD people and 159 light-placeholder meshes, separated nearby vehicle pieces from the movable Chiba group, and trimmed 39 CAD wood members that continued below the ground plane. Those trims are visualization corrections, not verified physical cut dimensions. Checked component IDs, exported geometry, library dimensions, texture payloads and browser interactions; detailed machine-readable results are in `verification.json` when present.

![Exterior review](modular-preview.png)

![Interior cutaway review](interior-preview.png)

The next accuracy pass needs confirmed CAD version/room locations and physical reference measurements, especially rack frame types and beam end conventions. The saved modular representation and evidence can be refined without discarding the component library.
'''
(O/'README.md').write_text(text)
(O/'README.html').write_text('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mars component model — evidence and accuracy</title><style>body{max-width:920px;margin:45px auto;padding:0 22px;font:16px/1.6 system-ui;background:#18251e;color:#dce4d7}a{color:#d1dfa8}h1,h2{line-height:1.25;font-weight:500}h2{margin-top:40px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;border:1px solid #4e5e48;text-align:left}img{max-width:100%}code{font-size:12px;overflow-wrap:anywhere}</style></head><body>'+markdown.markdown(text,extensions=['tables'])+'</body></html>')
with open(O/'modeled-pieces.csv','w') as f:
 w=csv.writer(f);w.writerow(['component_id','definition_id','kind','assembly_id','source_mesh','quantity_stock_on_hand','dimension_status'])
 for r in m['instances']:
  if r['kind'] not in ['reference','context_person']:w.writerow([r['id'],r['definition_id'],r['kind'],r['assembly_id'],r['source_mesh'],'','unverified source geometry; not nominal stock count'])
cat=json.load(open(P/'components/catalog.json'));cat['status']='nominal_stock_geometry_built_and_exported';cat['geometry_path']=str(O/'component-library.glb');cat['profile_status']='overall nominal rack dimensions modeled; profiles and bracing illustrative';(P/'components/catalog.json').write_text(json.dumps(cat,indent=2))
(P/'MODULAR_STATUS.md').write_text(text)
