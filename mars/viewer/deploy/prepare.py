"""Stage an allowlisted public release; never change the source deliverables."""
import hashlib
import json
import pathlib
import re
import shutil

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

for directory in [PUBLIC, LARGE]:
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)

allow = {
    '2020': ['evidence/site-march4.webp', 'evidence/forest-march9.webp',
        'evidence/portal-march17.webp', 'evidence/forest-march30.webp',
        'evidence/portal-depth-march9.webp', 'evidence/climbing-wall-2020.webp',
        'evidence/rv-ring-march9.webp', 'evidence/front-alignment-march17.webp',
        'evidence/side-stairs-march17.webp', 'evidence/portal-screens-2020.webp'],
    'browser': ['campus.glb', 'campus.glb.br'],
    'engine': ['campus-2026.json'],
    'modular': ['README.html', 'components.json', 'references.json', 'rooms.json',
        'stock-library.json', 'appearance-credits.html', 'appearance-sources.json', 'silhouette-replacements.json', 'person_casual.glb', 'person_punk.glb', 'person_woman.glb', 'modeled-pieces.csv', 'camera-checks.json',
        'campus-components.glb', 'chiba-components.glb', 'chiba-photo-reference.glb',
        'component-library.glb', 'mars-2026-modular.blend',
        'upright_frame_8ft_4ft.glb', 'upright_frame_12ft_4ft.glb',
        'upright_frame_16ft_3ft.glb', 'upright_frame_19ft_3ft.glb',
        'horizontal_beam_12ft.glb', 'plywood_panel_template.glb',
        'timber_template.glb', 'acrylic_panel_template.glb',
        'modular-preview.png', 'interior-preview.png', 'camera-comparisons.jpg',
        'camera-check-00.png', 'camera-check-04.png', 'camera-check-08.png'],
    'data': ['manifest.json', 'chiba.glb', 'campus.glb', 'chiba.blend', 'campus.blend',
        'report.html', 'campus-comparison.jpg', 'detail-comparison.jpg', 'raw-comparison.jpg']
}
for folder in ['references', 'textures', 'environment']:
    allow['modular'] += [str(p.relative_to(ROOT / 'public/modular'))
        for p in (ROOT / 'public/modular' / folder).rglob('*') if p.is_file()]
allow['2020'] += [str(p.relative_to(ROOT / 'public/2020'))
    for p in (ROOT / 'public/2020/screens').glob('*.webp')]
allow['history'] = [str(p.relative_to(ROOT / 'public/history')) for p in (ROOT / 'public/history').rglob('*') if p.suffix in ['.webp','.json','.html']]
manifest = json.loads((ROOT / 'public/data/manifest.json').read_text())
allow['data'] += [v['image'].removeprefix('/data/') for m in manifest['models'] for v in m['views']]

records = []
for namespace, names in allow.items():
    for name in sorted(set(names)):
        source = ROOT / 'public' / namespace / name
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
