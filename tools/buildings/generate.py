"""Generate the Little Martians buildings.

    blender -b --factory-startup --python tools/buildings/generate.py -- [--only ID] [--no-render] [--quick]

Writes to worlds/littlemartians/buildings/: <id>.glb, <id>.footprint.json,
textures/, previews/, validation.json. Deterministic for a given Blender version.
"""
import argparse
import json
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build  # noqa: E402
import footprint  # noqa: E402
import geom  # noqa: E402
import glaze  # noqa: E402
import specs  # noqa: E402
import validate  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'worlds', 'littlemartians', 'buildings')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=list(specs.ALL))
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--quick', action='store_true', help='small, fast previews')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args(argv)
    out = args.out
    tex_dir = os.path.join(out, 'textures')
    prev_dir = os.path.join(out, 'previews')
    os.makedirs(prev_dir, exist_ok=True)
    ids = [args.only] if args.only else list(specs.ALL)

    reset()
    tex = {}
    for name in sorted({specs.ALL[i]().glaze for i in ids}):
        c, n, info = glaze.build(name, tex_dir)
        tex[name] = (c, n, info)
        print(f'[glaze] {name}: {info}')

    results = {}
    val_path = os.path.join(out, 'validation.json')
    if os.path.exists(val_path):
        results = json.load(open(val_path)).get('buildings', {})
    built = {}
    for bid in ids:
        t0 = time.time()
        reset()
        b = specs.ALL[bid]()
        col = bpy.context.scene.collection
        scratch = bpy.data.collections.new('scratch')
        col.children.link(scratch)
        c, n, _ = tex[b.glaze]
        mats = {'glaze': geom.glaze_material(f'{b.id}-glaze', c, n),
                'clay': geom.flat_material(f'{b.id}-clay', (0.55, 0.42, 0.28, 1), 0.85)}
        ob = build.build(b, mats, col, scratch)
        glb = os.path.join(out, f'{b.id}.glb')
        build.export_glb(ob, glb)
        reset()
        # footprint bounds come from the exported mesh, as re-imported
        _, stats = validate.load_glb(glb)
        lo, hi = stats['minBlender'], stats['maxBlender']
        bounds = {'min': [round(lo.x, 3), round(lo.z, 3), round(-hi.y, 3)],
                  'max': [round(hi.x, 3), round(hi.z, 3), round(-lo.y, 3)]}
        fp = footprint.build(b, os.path.basename(glb), bounds)
        fp_path = os.path.join(out, f'{b.id}.footprint.json')
        with open(fp_path, 'w') as f:
            json.dump(fp, f, indent=1)
        reset()
        rep = validate.check(glb, fp)
        rep['glbBytes'] = os.path.getsize(glb)
        results[bid] = rep
        built[bid] = (glb, fp)
        print(f"[{bid}] {time.time() - t0:.1f}s ok={rep['ok']} tris={rep['mesh']['triangles']} bytes={rep['glbBytes']} "
              f"portals={len(fp['portals'])} obstacles={len(fp['obstacles'])} failures={rep['failures'][:6]}")

    with open(val_path, 'w') as f:
        json.dump({'blender': bpy.app.version_string, 'buildings': results}, f, indent=1)

    if not args.no_render:
        import previews
        previews.render_all(built, prev_dir, quick=args.quick)


main()
