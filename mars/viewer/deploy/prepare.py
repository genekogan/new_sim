"""Stage an allowlisted public release; never change the source deliverables."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / '.cloudflare'
PUBLIC = OUT / 'public'
LARGE = OUT / 'large'
LIMIT = 25 * 1024 * 1024

def scrub(value):
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        if value.startswith('/Users/'):
            return pathlib.Path(value).name
        return value.replace('http://localhost:4326/', '/')
    return value

# Release allowlist. Directory rules are globs relative to public/ (`**` = any depth,
# `*` = within one path segment); a whole asset namespace that the app loads by
# convention (engine/**) must be a glob, not a per-file list, so new files ship
# without edits here. deploy/prepare-allowlist.test.mjs scans app/ and engine/ for
# /engine|modular|browser|data|models/ URL literals (the Mars archive photos under /history and /2020 are not
# distributed, so they are never staged) and fails if one is not
# covered by `python3 deploy/prepare.py --list`.
GLOBS = [
    'engine/**',
    'modular/references/**', 'modular/textures/**', 'modular/environment/**',
]
FILES = {
    'browser': ['campus.glb'],
    # Only the selected workstation and its attribution; never publish the model archive.
    'models': ['retro-computer-monitor.glb', 'retro-computer-monitor.credit.json'],
    'modular': ['README.html', 'components.json', 'references.json', 'rooms.json',
        'stock-library.json', 'appearance-credits.html', 'appearance-sources.json', 'silhouette-replacements.json', 'person_casual.glb', 'person_punk.glb', 'person_woman.glb', 'modeled-pieces.csv', 'camera-checks.json',
        'campus-components.glb', 'chiba-components.glb', 'chiba-photo-reference.glb',
        'component-library.glb',
        'upright_frame_8ft_4ft.glb', 'upright_frame_12ft_4ft.glb',
        'upright_frame_16ft_3ft.glb', 'upright_frame_19ft_3ft.glb',
        'horizontal_beam_12ft.glb', 'plywood_panel_template.glb',
        'timber_template.glb', 'acrylic_panel_template.glb',
        'modular-preview.png', 'interior-preview.png', 'camera-comparisons.jpg',
        'camera-check-00.png', 'camera-check-04.png', 'camera-check-08.png'],
    'data': ['manifest.json', 'chiba.glb', 'campus.glb']
}

def glob_regex(pattern):
    out = ''
    i = 0
    while i < len(pattern):
        if pattern.startswith('**/', i):
            out += '(?:.*/)?'; i += 3
        elif pattern.startswith('**', i):
            out += '.*'; i += 2
        elif pattern[i] == '*':
            out += '[^/]*'; i += 1
        else:
            out += re.escape(pattern[i]); i += 1
    return re.compile(out + r'\Z')

def resolve():
    """Every public/ path (relative, posix) the release stages, sorted."""
    paths = {f'{ns}/{name}' for ns, names in FILES.items() for name in names}
    # The legacy photo page loads reference photographs from their original
    # public origin. Never stage source photographs or reconstruction projects.
    for pattern in GLOBS:
        rule = glob_regex(pattern)
        # walk only the glob's literal directory prefix; os.walk follows the
        # public/modular and public/data symlinks (pathlib.rglob does not)
        base = ROOT / 'public' / pattern.split('*', 1)[0].rsplit('/', 1)[0]
        for folder, _, names in os.walk(base, followlinks=True):
            for name in names:
                rel = (pathlib.Path(folder) / name).relative_to(ROOT / 'public').as_posix()
                if not name.startswith('.') and rule.match(rel):
                    paths.add(rel)
    missing = sorted(p for p in paths if not (ROOT / 'public' / p).is_file())
    if missing:
        raise SystemExit(f'allowlisted files missing from public/: {missing}')
    return sorted(paths)

if '--list' in sys.argv:
    print(json.dumps({'globs': GLOBS, 'files': resolve()}))
    raise SystemExit(0)

for directory in [PUBLIC, LARGE]:
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)

records = []
for rel in resolve():
    namespace, name = rel.split('/', 1)
    source = ROOT / 'public' / rel
    payload = source.read_bytes()
    if source.suffix == '.json':
        payload = json.dumps(scrub(json.loads(payload)), ensure_ascii=False).encode()
    elif source.suffix == '.html':
        html = payload.decode().replace('http://localhost:4326/', '/')
        html = html.replace('A private, local reconstruction', 'A reconstruction')
        html = html.replace('each with its original path and SHA-256 provenance',
            'each with its source filename and SHA-256 provenance')
        html = re.sub(r'<p><a href="SOURCE_REVIEW.md">.*?</p>',
            '<p>Full source manifests and original media are retained in the local archive.</p>', html)
        html = re.sub(r'<h2>Reproducibility and local files</h2>.*?(?=<p>Method references:)',
            '<h2>Reproducibility</h2><p>Reconstruction ran locally. This published release includes '
            'selected models, textures, reference images and validation evidence. Original media, '
            'intermediate reconstructions and full provenance remain in the local archive.</p>', html, flags=re.S)
        html = re.sub(r'<tr>\s*<td>mars-2026-modular-cad.blend</td>.*?</tr>', '', html, flags=re.S)
        payload = html.encode()
    target = (LARGE if len(payload) > LIMIT else PUBLIC) / namespace / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    records.append({'path': f'/{namespace}/{name}', 'bytes': len(payload),
        'sha256': hashlib.sha256(payload).hexdigest(),
        'storage': 'r2' if len(payload) > LIMIT else 'static'})

shutil.copy2(ROOT / 'public/favicon.svg', PUBLIC / 'favicon.svg')
shutil.copy2(ROOT / 'public/simulation-agent-guide.md', PUBLIC / 'simulation-agent-guide.md')
(PUBLIC / 'robots.txt').write_text('User-agent: *\nDisallow: /\n')
(PUBLIC / '_headers').write_text('/*\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n/index.html\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n')
(OUT / 'release.json').write_text(json.dumps(records, indent=2))
large_assets = {r['path']: {
    'key': r['sha256'] + '/' + r['path'].lstrip('/'), 'bytes': r['bytes'],
    'type': 'model/gltf-binary' if r['path'].endswith('.glb') else 'application/octet-stream'
} for r in records if r['storage'] == 'r2'}
large_assets['/browser/campus.glb']['br'] = large_assets['/browser/campus.glb.br']
(OUT / 'large-assets.json').write_text(json.dumps(large_assets, indent=2))
print(json.dumps({'files': len(records), 'MiB': round(sum(r['bytes'] for r in records)/1024**2, 1),
    'large_files': [r['path'] for r in records if r['storage'] == 'r2']}))
