"""Negative test: the validator must reject a footprint that lies about the GLB.

    blender -b --factory-startup --python tools/buildings/selftest.py

Slides a door into solid wall and shrinks it, and adds a wall where there is
none; exits non-zero unless every one of those faults is reported.
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import validate  # noqa: E402

OUT = os.path.join(HERE, '..', '..', 'worlds', 'littlemartians', 'buildings')
fp = json.load(open(os.path.join(OUT, 'ceramic-tower.footprint.json')))
bad = copy.deepcopy(fp)
door = bad['portals'][0]
door['center'][0] += 2.5
door['width'] = 1.0
bad['obstacles'].append({'id': 'phantom', 'kind': 'wall', 'obb': {'c': [0, 0], 'half': [1, 0.3], 'yaw': 0},
                         'y0': 3, 'y1': 4})
rep = validate.check(os.path.join(OUT, 'ceramic-tower.glb'), bad)
expect = ['below', 'rays through the opening hit geometry', 'head sphere clearance', 'cover the opening', 'phantom']
missed = [e for e in expect if not any(e in f for f in rep['failures'])]
print('selftest failures reported:', *rep['failures'], sep='\n  ')
print('selftest', 'PASS' if not missed and not rep['ok'] else f'FAIL (not detected: {missed})')
sys.exit(1 if missed or rep['ok'] else 0)
