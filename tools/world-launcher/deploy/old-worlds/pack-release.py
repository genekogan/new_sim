#!/usr/bin/env python3
"""Assemble the eden2 old-worlds release from the exact live laptop runtime (read-only on every source).

usage: pack-release.py OUT_PARENT [--runtime DIR] [--proxy-json PATH] [--kit DIR]
  -> OUT_PARENT/so-<source8>-<overlay8>/  (prints its path)

Contents (paths inside are the eden2 release path /srv/sim-old/releases/<name>):
  input/      sealed source (convergence runtime source/, no node_modules; web dist + Soul CLI/skill/guides inside)
  mars-web/   Mars static root (STATIC-MANIFEST)
  artifacts/  Eden places, authored region boundaries, activity spots (the paths Codex's descriptor names)
  manifests/  CONTENT / WEB / STATIC / OVERLAY-WEB manifests + PREPARED/PLAN/PROXY/QUALIFIED/LIVE proof (provenance)
  descriptors/{eden,mars,littlemartians,proxy}.json  = the live descriptors with eden2 paths (ports unchanged;
              bin/port-map.mjs moves them) + accountRegistryPath; every other field byte-for-byte the live value
  bin/        run-world.mjs port-map.mjs parity.py online-backup.py compact-copy.py verify-release.py
  deploy/     sim-old@.service sim-old-proxy.service
  RELEASE.json  name, source, build, sha256 of each descriptor and of the live descriptor it derives from
"""
import json, hashlib, os, shutil, subprocess, sys

argv = sys.argv[1:]
def opt(name, default):
    if name in argv: i = argv.index(name); v = argv[i + 1]; del argv[i:i + 2]; return v
    return default
RT = opt('--runtime', '<team>/runtime/convergence-1080cfa9')
PROXY = opt('--proxy-json', '<team>/reviews/convergence-ops-1080cfa9-001/PROXY.json')
KIT = opt('--kit', os.path.dirname(os.path.abspath(__file__)))
PLAN = '<team>/reviews/convergence-cutover-1080cfa9-001/PLAN.json'
LIVE = '<team>/reviews/SIM-CONVERGENCE-RELEASE-1080CFA9.json'
if len(argv) != 1: sys.exit(__doc__)
sha = lambda b: hashlib.sha256(b).hexdigest()
fsha = lambda p: sha(open(p, 'rb').read())
prep = json.load(open(f'{RT}/PREPARED.json')); proxy = json.load(open(PROXY))
src = prep['source']; ov = proxy['artifactOverlay']['webManifestSha256']
name = f'so-{src[:8]}-{ov[:8]}'
REL = f'/srv/sim-old/releases/{name}'
out = os.path.join(argv[0], name)
if os.path.exists(out): sys.exit(f'{out} exists; remove it first')
os.makedirs(out)
for d in ('artifacts', 'manifests', 'descriptors', 'bin', 'deploy'): os.makedirs(f'{out}/{d}')
rs = lambda a, b, *x: subprocess.run(['rsync', '-a', *x, a, b], check=True)
rs(f'{RT}/source/', f'{out}/input/', '--exclude', 'node_modules')
rs(f'{RT}/mars-web/', f'{out}/mars-web/')
for m in ('CONTENT-MANIFEST.json', 'WEB-MANIFEST.json', 'STATIC-MANIFEST.json', 'PREPARED.json'): shutil.copy2(f'{RT}/{m}', f'{out}/manifests/')
for p in (proxy['artifactOverlay']['webManifest'], PROXY, PLAN, LIVE,
          json.load(open(PLAN))['qualification']['path']): shutil.copy2(p, f'{out}/manifests/')
for f in ('run-world.mjs', 'port-map.mjs', 'parity.py', 'online-backup.py', 'compact-copy.py', 'verify-release.py'): shutil.copy2(f'{KIT}/{f}', f'{out}/bin/')
for f in ('sim-old@.service', 'sim-old-proxy.service'): shutil.copy2(f'{KIT}/{f}', f'{out}/deploy/')

def rebase(v, key):
    """Map one live laptop path to its eden2 release path; refuse anything unmapped."""
    if not isinstance(v, str) or not v.startswith('/Users/'): return v
    if v.startswith(f'{RT}/source'): return REL + '/input' + v[len(f'{RT}/source'):]
    if v.startswith(f'{RT}/mars-web'): return REL + '/mars-web' + v[len(f'{RT}/mars-web'):]
    if key in ('placeData', 'authoredBoundariesFile', 'activitySpots'):
        dst = f'{out}/artifacts/{os.path.basename(v)}'; shutil.copy2(v, dst); return f'{REL}/artifacts/{os.path.basename(v)}'
    if key == 'webManifest': return f'{REL}/manifests/{os.path.basename(v)}'
    raise SystemExit(f'unmapped laptop path in {key}: {v}')

release = {'name': name, 'source': src, 'build': prep['build'], 'sourceManifestSHA256': prep['sourceManifestSHA256'],
           'overlayWebManifestSHA256': ov, 'releasePath': REL, 'descriptors': {}}
for w in ('eden', 'mars', 'littlemartians'):
    live_path = prep['descriptors'][w]['path']; raw = open(live_path, 'rb').read()
    assert sha(raw) == prep['descriptors'][w]['sha256'], f'{w} live descriptor differs from PREPARED pin'
    d = json.loads(raw)
    e = {k: (f'/srv/sim-old-data/{w}' if k == 'dataDir' else rebase(v, k)) for k, v in d.items()}
    e['accountRegistryPath'] = '/srv/sim-old-data/accounts/accounts.sqlite'
    if e.get('authoredBoundariesSHA256'): assert fsha(e['authoredBoundariesFile'].replace(REL, out)) == e['authoredBoundariesSHA256']
    p = f'{out}/descriptors/{w}.json'; open(p, 'w').write(json.dumps(e, indent=2) + '\n')
    release['descriptors'][w] = {'sha256': fsha(p), 'liveDescriptor': live_path, 'liveSHA256': prep['descriptors'][w]['sha256'],
                                 'changedFields': sorted(k for k in e if e.get(k) != d.get(k))}
px = json.loads(json.dumps(proxy)); o = px['artifactOverlay']
for k in ('webDir', 'webManifest', 'cliFile'): o[k] = rebase(o[k], k)
p = f'{out}/descriptors/proxy.json'; open(p, 'w').write(json.dumps(px, indent=2) + '\n')
release['descriptors']['proxy'] = {'sha256': fsha(p), 'liveDescriptor': PROXY, 'liveSHA256': fsha(PROXY)}
assert fsha(o['cliFile'].replace(REL, out)) == o['cliSha256'], 'CLI sha differs'
open(f'{out}/RELEASE.json', 'w').write(json.dumps(release, indent=2) + '\n')
print(out)
