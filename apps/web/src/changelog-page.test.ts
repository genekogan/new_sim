// node --test apps/web/src/changelog-page.test.ts (issue #388: the public changelog page)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changelogHtml, inline, parseChangelog, releaseId, renderChangelog } from './changelog-page.ts';

const SAMPLE = `# Changelog

User-facing changes to Sim, newest first.

## 4.1 (2026-11-02)

### Features

- Souls can paint with \`brush\` colours.
- A long entry that the compiler wrapped
  onto a second line.

### Fixes

- Doors <script>alert(1)</script> & "quotes" stay text.

## 4.0 (2026-10-29)

Rolled back; superseded by 4.1.

## Earlier

Earlier development is recorded in the git history.
`;

await test('releases newest first, with groups, entries, wrapped lines and paragraphs; the intro is dropped', () => {
  const log = parseChangelog(SAMPLE);
  assert.deepEqual(log.releases.map((r) => [r.version, r.date]), [['4.1', '2026-11-02'], ['4.0', '2026-10-29']]);
  assert.deepEqual(log.releases[0]!.blocks, [
    { kind: 'group', title: 'Features', items: ['Souls can paint with `brush` colours.', 'A long entry that the compiler wrapped onto a second line.'] },
    { kind: 'group', title: 'Fixes', items: ['Doors <script>alert(1)</script> & "quotes" stay text.'] },
  ]);
  assert.deepEqual(log.releases[1]!.blocks, [{ kind: 'text', text: 'Rolled back; superseded by 4.1.' }]);
  assert.deepEqual(log.notes, [{ title: 'Earlier', text: ['Earlier development is recorded in the git history.'] }]);
});

await test('rendered HTML escapes entry text, renders `code`, anchors each release and links home', () => {
  const html = renderChangelog(parseChangelog(SAMPLE), { home: '/worlds/' });
  assert.ok(!html.includes('<script>'), 'an entry never becomes markup');
  assert.match(html, /Doors &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot; stay text\./);
  assert.match(html, /paint with <code>brush<\/code> colours/);
  assert.match(html, /<section class="cl-release" id="v4\.1"[^>]*>\s*<h2 id="v4\.1-h"><a class="cl-v" href="#v4\.1">4\.1<\/a> <time datetime="2026-11-02">November 2, 2026<\/time>/);
  assert.ok(html.indexOf('id="v4.1"') < html.indexOf('id="v4.0"'), 'newest first, as the file lists them');
  assert.match(html, /<a href="\/worlds\/">← Worlds<\/a>/);
  assert.match(html, /<h2>Earlier<\/h2>/);
  assert.equal(inline('a `<b>` c'), 'a <code>&lt;b&gt;</code> c');
  assert.equal(releaseId('3.62'), 'v3.62');
});

await test('refused: a CHANGELOG.md without release headings fails the build with a reason; a template without the slot too', () => {
  assert.throws(() => parseChangelog('# Changelog\n\n- a stray entry\n## Earlier\n'), /no release headings/);
  assert.throws(() => parseChangelog(''), /no release headings/);
  assert.throws(() => changelogHtml('<main></main>', SAMPLE, '/'), /no <!--changelog--> slot/);
});

await test('the page template plus the real CHANGELOG.md: every release, no script, nothing fetched, base-aware home link', () => {
  const md = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../changelog.html', import.meta.url), 'utf8');
  const releases = md.split('\n').filter((l) => /^## \S+ \(\d{4}-\d{2}-\d{2}\)$/.test(l)).length;
  assert.ok(releases > 0);
  for (const base of ['/', '/worlds/']) {
    const page = changelogHtml(template, md, base);
    assert.equal((page.match(/<section class="cl-release" id="v/g) ?? []).length, releases, 'one section per release');
    assert.ok(!/<script|<link|<img|<iframe|@import|url\(/i.test(page), 'no script and no subresource: the document is the whole page');
    assert.ok(!/github\.com|\/v1\//.test(page), 'no runtime GitHub or API reference');
    assert.match(page, new RegExp(`<a href="${base}">← Worlds</a>`));
  }
});
