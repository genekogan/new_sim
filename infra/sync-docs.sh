#!/usr/bin/env bash
# Refresh selected public references. Never writes either source tree.
# --check compares the selected mirror without changing files.
set -euo pipefail
cd "$(dirname "$0")/.."
export EDEN4_DIR="${EDEN4_DIR:-<eden4>}"
export MARS_DIR="${MARS_DIR:-$PWD/mars}"
python3 - "$@" <<'PY'
from pathlib import Path
import hashlib, json, os, re, subprocess, sys, urllib.parse
if sys.argv[1:] not in ([], ['--check']):
    sys.exit('usage: infra/sync-docs.sh [--check]')
check = bool(sys.argv[1:])
docs = Path('docs').resolve()
eden = Path(os.environ['EDEN4_DIR']).resolve()
mars = Path(os.environ['MARS_DIR']).resolve()
assert docs != eden and docs != mars and docs not in eden.parents and docs not in mars.parents
selected = {}
def add(source, relative, transform=None):
    if not source.is_file(): return
    raw = source.read_bytes()
    body = transform(raw.decode()).encode() if transform else raw
    selected[relative] = (source, raw, body)
def strategy(text):
    # Mirror users have STATUS, while the unabridged operational log stays local.
    return text.replace('(MERGE-LOG.md)', '(../STATUS.md)').replace('(../MERGE-LOG.md)', '(../../STATUS.md)')
for source in sorted(eden.glob('*.md')):
    if source.name == 'README.md' or re.match(r'^\d{2}-', source.name):
        add(source, 'eden4/'+source.name, strategy)
add(eden/'report/eden4.html', 'eden4/report/eden4.html')
for source in sorted((eden/'research').glob('*.md')):
    if source.name == 'RESUME.md' or re.match(r'^R\d', source.name):
        add(source, 'eden4/research/'+source.name, strategy)
for name in ['R1-ontology-prior-art.html','R2-agent-worlds-landscape.html','EDEN4-COMPENDIUM.html','EDEN4-BLUEPRINT-STE.html']:
    add(eden/'research'/name, 'eden4/research/'+name)
names = 'SIMULATION_FRONTIER SIMULATION_FRONTIER_APPLICATIONS SIMULATION_VISION ACTIVE_ROADMAP ENGINEERING ENGINE_GUIDE SPEC HANDOFF TAKES_AND_PLANS CAMERA BODY_MODEL POSES MOVEMENT SOCIAL ITEMS CARRY VEHICLES PLANNING_BUDGET LAB_GUIDE LIB_EVAL OWNER_DECISIONS AUDIT RESEARCH'.split()
def inherited(text, source):
    # Preserve labels and anchors; resolve source-relative links into the fork.
    # Missing source evidence stays explicit text rather than a broken link.
    def link(match):
        label, target = match.groups()
        if re.match(r'\w+:|^#|^/', target): return match.group(0)
        path, marker, anchor = target.partition('#')
        if (docs/'mars'/urllib.parse.unquote(path)).exists(): return match.group(0)
        actual=(source.parent/urllib.parse.unquote(path)).resolve()
        if actual.is_file() or actual.is_dir():
            relative=os.path.relpath(actual,docs/'mars')
            return '['+label+']('+relative+(marker+anchor if marker else '')+')'
        return label+' (source reference `'+target+'`; unavailable in the filtered fork)'
    text=re.sub(r'\[([^\]\n]+)\]\(([^\n)]+)\)',link,text)
    first, sep, rest = text.partition('\n')
    return first+'\n\n> Inherited native reference: source dates, release IDs and operating instructions\n> retain their original scope. For the current Eden fork use [the index](README.md),\n> [STATUS](../STATUS.md) and the Sim runbook; this file is not production authority.\n'+sep+rest
for name in names:
    source=mars/'docs/engineering'/f'{name}.md'
    add(source, 'mars/'+name+'.md', lambda text, source=source: inherited(text,source))
for source, name in [('README.md','MARS-README.md'),('ROADMAP.md','MARS-ROADMAP.md'),('viewer/simulation/README.md','SIMULATION-SERVER-README.md'),('viewer/app/lab/README.md','LAB-README.md'),('viewer/public/simulation-agent-guide.md','SIMULATION-AGENT-GUIDE.md')]:
    path=mars/source
    add(path, 'mars/'+name, lambda text, source=path: inherited(text,source))
# INTEGRATION_BOUNDARY is a retained exact original publication receipt, not
# part of the earlier filtered fork. Do not replace it with an inferred boundary.
manifest = {}
for relative, (source, raw, body) in selected.items():
    home = eden if relative.startswith('eden4/') else mars
    manifest[relative] = {'source':str(source.relative_to(home)), 'source_sha256':hashlib.sha256(raw).hexdigest(), 'mirror_sha256':hashlib.sha256(body).hexdigest()}
for name in ['SIMULATION_FRONTIER.md','SIMULATION_FRONTIER_APPLICATIONS.md']:
    retained_frontier=docs/'mars'/name
    if retained_frontier.is_file() and 'mars/'+name not in manifest:
        digest=hashlib.sha256(retained_frontier.read_bytes()).hexdigest()
        manifest['mars/'+name]={'source':'original snapshot 4ddeea2, copied 2026-10-01','source_sha256':digest,'mirror_sha256':digest}
retained = docs/'mars/INTEGRATION_BOUNDARY.md'
if retained.is_file():
    digest=hashlib.sha256(retained.read_bytes()).hexdigest()
    manifest['mars/INTEGRATION_BOUNDARY.md']={'source':'original published integration boundary, retained exact copy','source_sha256':digest,'mirror_sha256':digest}
revision = subprocess.check_output(['git','-C',str(mars),'log','-1','--format=%H %cI','--','.'],text=True).strip()
source_tree = subprocess.check_output(['git','-C',str(mars),'rev-parse','HEAD:mars'],text=True).strip() if mars == Path('mars').resolve() else 'external reference override'
metadata = 'Native references copied from the in-repo fork unless MARS_DIR was explicitly overridden.\nLast native-tree commit: '+revision+'\nNative Git tree: '+source_tree+'\nSelected source/mirror content digests: ../mirror-manifest.json\nInherited links are resolved into the fork; unavailable source evidence is labeled.\nDates and instructions inside inherited references remain historical.\n'
selected['mars/SNAPSHOT.txt'] = (None, b'', metadata.encode())
selected['mirror-manifest.json'] = (None,b'',(json.dumps({'schema':'sim-doc-mirrors/1','files':manifest},indent=2,sort_keys=True)+'\n').encode())
changed = []
for relative, (_, _, body) in selected.items():
    target=docs/relative
    if not target.is_file() or target.read_bytes()!=body:
        changed.append(relative)
        if not check:
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(body)
print(('stale' if check else 'refreshed')+f' selected mirror files: {len(changed)}')
for name in changed: print(name)
if check and changed: sys.exit(1)
PY
