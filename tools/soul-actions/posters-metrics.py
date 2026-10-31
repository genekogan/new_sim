#!/usr/bin/env python3
"""Entry 38 real-client metrics from posters-proof.mjs samples (proof.json).

Per hand-actuator stroke (poster, unposter, and the wanted board's one-hand strokes):
 1. hands on the sheet: while operating (reach end .. release start) each drawn palm within 0.04 m of its engine hand point
    (two-hand strokes: both palms; one-hand strokes: the operating palm)
 2. no pops: body-frame palm step <= 0.08 m / 50 ms within +-0.5 s of reach start and release (pairs with walk weight 0 at
    both ends; others reported), and <= 0.15 m / 50 ms throughout the operation
 3. no knee bend: posture drop/bend/kneel 0 while operating; hip height range <= 0.01 m
Usage: posters-metrics.py <visual-dir>  -> writes metrics.json there and prints a summary.
"""
import json, math, sys
REACH, RELEASE = 0.65, 0.7
d = sys.argv[1]; P = json.load(open(d + '/proof.json'))
S = [s for s in P['samples'] if s]
def local(b, q):
    dx, dy, dz = q[0] - b['p'][0], q[1] - b['p'][1], q[2] - b['p'][2]; c, s = math.cos(b['yaw']), math.sin(b['yaw'])
    return (dx * c + dz * s, dy, -dx * s + dz * c)
strokes = {}
for i, s in enumerate(S):
    for b in s['bodies']:
        m = b.get('motion')
        if m and m.get('stroke'):
            k = (b['id'], m['startTick']); strokes.setdefault(k, {'id': b['id'], 'start': m['startTick'], 'kind': m['stroke']['kind'], 'seconds': m['stroke']['seconds'], 'target': m['target']})
out = []
for k, st in sorted(strokes.items(), key=lambda kv: kv[0][1]):
    rows = []
    for s in S:
        b = next((x for x in s['bodies'] if x['id'] == st['id']), None)
        if not b: continue
        el = (s['tick'] - st['start']) * s['dt']
        if -1.5 <= el <= REACH + st['seconds'] + RELEASE + 1.5: rows.append((el, s['tick'], s['dt'], b))
    two = st['kind'] in ('poster', 'unposter')
    rel = REACH + st['seconds']
    err_max, err_n, boundary, boundary_walk, op_max, posture_bad, hips = 0.0, 0, [], [], 0.0, 0, []
    for (el0, t0, dt, b0), (el1, t1, _, b1) in zip(rows, rows[1:]):
        if t1 == t0: continue
        span = (t1 - t0) * dt; scale = 0.05 / span if span > 0 else 0
        for side in ('left', 'right'):
            a0 = next((a for a in b0['bones']['arms'] if a['side'] == side), None); a1 = next((a for a in b1['bones']['arms'] if a['side'] == side), None)
            if not a0 or not a1: continue
            p0, p1 = local(b0, a0['palm']), local(b1, a1['palm']); step = math.dist(p0, p1) * scale
            near = lambda e: abs(el0 - e) <= .5 or abs(el1 - e) <= .5
            if near(0) or near(rel) or near(rel + RELEASE):
                w0, w1 = b0['bones'].get('walkW') or 0, b1['bones'].get('walkW') or 0
                (boundary if w0 == 0 and w1 == 0 else boundary_walk).append({'el': round(el0, 2), 'side': side, 'step': round(step, 4), 'walkW': [w0, w1]})
            if REACH <= el0 and el1 <= rel: op_max = max(op_max, step)
    for el, t, dt, b in rows:
        if REACH + .05 <= el <= rel - .05:
            hands = b.get('hands') or {}
            for side in (('left', 'right') if two else tuple(x for x in ('left', 'right') if hands.get(x))):
                h = hands.get(side); a = next((a for a in b['bones']['arms'] if a['side'] == side), None)
                if h and a: err_max = max(err_max, math.dist(h, a['palm'])); err_n += 1
            pose = b['bones'].get('pose') or {}
            if any((pose.get(x) or 0) > 1e-3 for x in ('drop', 'bend', 'kneel')): posture_bad += 1
            if b['bones'].get('hipY') is not None: hips.append(b['bones']['hipY'])
    bmax = max([x['step'] for x in boundary] or [0]); bwmax = max([x['step'] for x in boundary_walk] or [0])
    r = {'body': st['id'], 'kind': st['kind'], 'startTick': st['start'], 'seconds': st['seconds'], 'samples': len(rows),
         'palmToHandMax': round(err_max, 4), 'palmSamples': err_n, 'boundaryMax': bmax, 'boundaryWalkMax': bwmax, 'operatingMax': round(op_max, 4),
         'postureBadSamples': posture_bad, 'hipRange': round(max(hips) - min(hips), 4) if hips else None,
         'boundaryWorst': sorted(boundary, key=lambda x: -x['step'])[:3], 'boundaryWalkWorst': sorted(boundary_walk, key=lambda x: -x['step'])[:3]}
    r['pass'] = (r['palmToHandMax'] <= .04 or not two and r['palmSamples'] == 0) and bmax <= .08 and op_max <= .15 and posture_bad == 0 and (r['hipRange'] is None or r['hipRange'] <= .01)
    out.append(r)
json.dump({'strokes': out, 'pass': all(r['pass'] for r in out)}, open(d + '/metrics.json', 'w'), indent=1)
for r in out: print(f"{r['body']} {r['kind']:9s} tick {r['startTick']}: palm-hand {r['palmToHandMax']:.3f} ({r['palmSamples']}), boundary {r['boundaryMax']:.3f} (walk {r['boundaryWalkMax']:.3f}), operating {r['operatingMax']:.3f}, posture {r['postureBadSamples']}, hip {r['hipRange']}  {'PASS' if r['pass'] else 'FAIL'}")
print('ALL', 'PASS' if all(r['pass'] for r in out) else 'FAIL')
