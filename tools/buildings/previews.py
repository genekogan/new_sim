"""Preview pictures of the exported GLBs (the files themselves, re-imported) and SVG plans."""
import math
import os

import bpy

import render

HEAD = (0.85, 0.42, 0.18)


def _import(glb, dx=0.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    obs = [o for o in bpy.data.objects if o not in before]
    for o in obs:
        if o.parent is None:
            o.location.x += dx
    return [o for o in obs if o.type == 'MESH']


def _B(p, dx=0.0):
    return (p[0] + dx, -p[2], p[1])


def _heads(fp, col, dx=0.0, kinds=('door',)):
    """Scale heads: one floating in each room, one at the front door."""
    for r in fp['rooms']:
        render.head(f"head-{r['id']}", (dx + 1.5, 1.5, r['y0'] + 1.2), col)
    for pt in fp['portals']:
        if pt['kind'] in kinds and pt['normal'][2] > 0.5 and abs(pt['center'][0]) < 0.1:
            c = pt['center']
            render.head(f"head-{pt['id']}", (c[0] + dx, -(c[2] + 2.2), pt['y0'] + 0.95), col)
            break


def render_all(built, out, quick=False):
    res = (640, 480) if quick else (1280, 960)
    paths = []
    for bid, (glb, fp) in built.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        render.setup_scene(res)
        col = bpy.context.scene.collection
        obs = _import(glb)
        _heads(fp, col)
        top = fp['bounds']['max'][1]
        mid = top * 0.45
        D = top * 1.55
        paths.append(render.shot(os.path.join(out, f'{bid}-front.jpg'), (-0.55 * D, -0.95 * D, top * 0.35), (0, 0, mid), lens=40))
        paths.append(render.shot(os.path.join(out, f'{bid}-back.jpg'), (0.7 * D, 0.85 * D, top * 0.55), (0, 0, mid), lens=40))
        # interiors: from the back of each room towards its front, then up a shaft
        for r in fp['rooms']:
            y = r['y0']
            depth = max(abs(p[1]) for p in r['polygon'])
            paths.append(render.shot(os.path.join(out, f"{bid}-inside-{r['id'].split('-')[-1]}.jpg"),
                                     (0.0, depth - 0.9, y + 1.6), (0.0, -depth, y + 2.4), lens=14))
        shafts = [p for p in fp['portals'] if p['kind'] == 'shaft']
        if shafts:
            y = fp['rooms'][0]['y0']
            paths.append(render.shot(os.path.join(out, f'{bid}-up-shaft.jpg'), (-0.9, -1.2, y + 0.9), (0.0, 0.0, y + 20), lens=12))
        # cutaway: the half nearest the camera removed
        for o in obs:
            cut = render.cutaway(o, col)
            o.hide_render = True
        paths.append(render.shot(os.path.join(out, f'{bid}-section.jpg'), (0.95 * D, -0.25 * D, top * 0.45), (0, 0, mid), lens=40))
        write_plan(fp, os.path.join(out, f'{bid}-plan.svg'))
        paths.append(os.path.join(out, f'{bid}-plan.svg'))

    if len(built) == 2:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        render.setup_scene(res)
        col = bpy.context.scene.collection
        tops = []
        for (bid, (glb, fp)), dx in zip(built.items(), (-15.0, 15.0)):
            _import(glb, dx)
            _heads(fp, col, dx)
            tops.append(fp['bounds']['max'][1])
        top = max(tops)
        paths.append(render.shot(os.path.join(out, 'both.jpg'), (-22, -78, top * 0.3), (0, 0, top * 0.42), lens=40))
    return paths


def write_plan(fp, path, scale=14):
    """Plan per level: rooms, terraces, wall obstacles, solids, portals, shafts (engine x right, z down)."""
    levels = fp['levels']
    lo, hi = fp['bounds']['min'], fp['bounds']['max']
    w = (hi[0] - lo[0] + 4) * scale
    h = (hi[2] - lo[2] + 4) * scale
    cols = len(levels)
    W, H = w * cols, h + 40

    def P(x, z, i):
        return (i * w + (x - lo[0] + 2) * scale, 30 + (z - lo[2] + 2) * scale)

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" '
           f'font-family="sans-serif" font-size="12"><rect width="100%" height="100%" fill="#fbfaf6"/>']
    for i, lv in enumerate(levels):
        out.append(f'<text x="{i * w + 8:.0f}" y="18">L{lv["id"]} · {lv["label"]} · y={lv["y"]} m</text>')
        for t in fp['terraces']:
            if t['level'] == lv['id']:
                pts = ' '.join('%.1f,%.1f' % P(x, z, i) for x, z in t['polygon'])
                hole = ' '.join('%.1f,%.1f' % P(x, z, i) for x, z in t['hole'])
                out.append(f'<polygon points="{pts}" fill="#e7efe4"/><polygon points="{hole}" fill="#fbfaf6"/>')
        for r in fp['rooms']:
            if r['level'] == lv['id']:
                pts = ' '.join('%.1f,%.1f' % P(x, z, i) for x, z in r['polygon'])
                out.append(f'<polygon points="{pts}" fill="#dbe9f2" stroke="#8aa" stroke-dasharray="3 3"/>')
        y = lv['y'] + 1.0  # the plan cuts each level 1 m above its floor
        for ob in fp['obstacles']:
            if ob['y0'] <= y <= ob['y1'] and ob.get('level', lv['id']) == lv['id']:
                c, (hx, hz), a = ob['obb']['c'], ob['obb']['half'], ob['obb']['yaw']
                cs, sn = math.cos(a), math.sin(a)
                pts = ' '.join('%.1f,%.1f' % P(c[0] + px * cs - pz * sn, c[1] + px * sn + pz * cs, i)
                               for px, pz in ((hx, hz), (-hx, hz), (-hx, -hz), (hx, -hz)))
                fill = '#4b5d66' if ob['kind'] == 'wall' else '#9a7b5a'
                out.append(f'<polygon points="{pts}" fill="{fill}"/>')
        for pt in fp['portals']:
            if pt['kind'] == 'shaft' and pt['level'] in (lv['id'], lv['id'] - 1):
                cx, cy = P(pt['center'][0], pt['center'][2], i)
                out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{pt["diameter"] / 2 * scale:.1f}" '
                           f'fill="none" stroke="#c0392b" stroke-width="2"/>')
            elif pt['kind'] != 'shaft' and pt['level'] == lv['id'] and pt['y0'] <= y + 2.5:
                cx, cy = P(pt['center'][0], pt['center'][2], i)
                col = '#27ae60' if pt['kind'] == 'door' else '#2e86c1'
                out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4" fill="{col}"/>')
    out.append(f'<text x="8" y="{H - 8:.0f}">{fp["name"]} — grey walls / brown solids cut 1 m above each floor; '
               f'green doors, blue windows, red shafts; 1 m = {scale}px; front (+z) is down</text></svg>')
    with open(path, 'w') as f:
        f.write('\n'.join(out))
