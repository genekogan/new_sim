#!/usr/bin/env python3
"""Verify an old-worlds release dir byte-for-byte against the live laptop seals (runs on eden2 or the laptop).

usage: verify-release.py RELEASE_DIR   (RELEASE_DIR may be the local assembly; paths in descriptors are rewritten to it)
Checks: CONTENT-MANIFEST over input/ (every sealed source file), WEB-MANIFEST over input/apps/web/dist,
OVERLAY-WEB-MANIFEST (the proxy's served frontend), STATIC-MANIFEST over mars-web/, the Soul CLI/skill/instructions
pins from PLAN.json, the authored boundaries pin, descriptor sha256s in RELEASE.json, and that every path a
descriptor names exists. Prints one JSON line; exit 1 on any difference.
"""
import json, hashlib, os, sys
R = os.path.abspath(sys.argv[1]); rel = json.load(open(f'{R}/RELEASE.json')); REL = rel['releasePath']
loc = lambda p: p.replace(REL, R, 1) if isinstance(p, str) and p.startswith(REL) else p
fsha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
bad = []; counts = {}
def manifest(mpath, root, label):
    m = json.load(open(mpath)); files = m.get('files', m); n = 0
    for path, e in files.items():
        if not isinstance(e, dict) or 'sha256' not in e: continue
        p = os.path.join(root, path)
        if not os.path.isfile(p) or fsha(p) != e['sha256']: bad.append(f'{label}:{path}')
        n += 1
    counts[label] = n
manifest(f'{R}/manifests/CONTENT-MANIFEST.json', f'{R}/input', 'source')
manifest(f'{R}/manifests/WEB-MANIFEST.json', f'{R}/input/apps/web/dist', 'web')
manifest(f'{R}/manifests/OVERLAY-WEB-MANIFEST.json', f'{R}/input/apps/web/dist', 'overlay')
manifest(f'{R}/manifests/STATIC-MANIFEST.json', f'{R}/mars-web', 'static')
plan = json.load(open(f'{R}/manifests/PLAN.json'))
for w, item in plan['worlds'].items():
    d = json.load(open(f'{R}/descriptors/{w}.json'))
    if fsha(f'{R}/descriptors/{w}.json') != rel['descriptors'][w]['sha256']: bad.append(f'descriptor:{w}')
    for field, pin in item.get('artifacts', {}).items():
        if fsha(loc(d[field])) != pin['sha256']: bad.append(f'{w}:{field}')
    if d.get('authoredBoundariesSHA256') and fsha(loc(d['authoredBoundariesFile'])) != d['authoredBoundariesSHA256']: bad.append(f'{w}:boundaries')
    for k, v in d.items():
        if isinstance(v, str) and v.startswith('/') and k not in ('dataDir', 'accountRegistryPath') and not os.path.exists(loc(v)): bad.append(f'{w}:{k} missing')
px = json.load(open(f'{R}/descriptors/proxy.json'))['artifactOverlay']
if fsha(loc(px['webManifest'])) != px['webManifestSha256']: bad.append('proxy:webManifest')
if fsha(loc(px['cliFile'])) != px['cliSha256']: bad.append('proxy:cli')
print(json.dumps({'release': rel['name'], 'ok': not bad, 'files': counts, 'bad': bad[:20]}))
sys.exit(1 if bad else 0)
