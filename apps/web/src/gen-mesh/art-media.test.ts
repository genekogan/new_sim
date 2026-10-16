// W6 viewer side: which faces show what, how makers read on hover, and the shared video lifecycle (no browser).
//   node --test apps/web/src/gen-mesh/art-media.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artOf, coverUv, hoverText, makerText, mediaKind } from './art-media.ts';

test('media kinds: images, videos by extension; nothing scriptable or inline', () => {
  assert.equal(mediaKind('https://x.org/a.jpg'), 'image');
  assert.equal(mediaKind('/w/eden/art/abc.webm'), 'video');
  assert.equal(mediaKind('data:image/png;base64,AAAA'), null);
  assert.equal(mediaKind('//evil.invalid/a.png'), null);
  assert.equal(mediaKind('javascript:alert(1)'), null);
  assert.equal(mediaKind('a b.png'), null);
});

test('a gallery face reads its own line; a plain frame reads line 0', () => {
  const st = { media: 'https://x.org/a.png\n\n/art/b.mp4', title: 'A\n\nB', maker: 'creator:u:world creator\n\nsoul:s1:Ana' };
  assert.equal(artOf('g', st, 1), null, 'an empty slot shows nothing');
  assert.deepEqual(artOf('g', st, 2), { frame: 'g', slot: 2, url: '/art/b.mp4', kind: 'video', title: 'B', maker: 'soul:s1:Ana' });
  assert.equal(artOf('f', st, undefined)!.url, 'https://x.org/a.png');
});

test('hover text: title and maker in words', () => {
  assert.equal(makerText('soul:s1:Ana'), 'by Ana (a resident)');
  assert.equal(makerText('creator:u:Gene'), 'by Gene (world creator)');
  assert.equal(makerText('creator:u:'), "by the world's creator");
  assert.equal(hoverText({ title: 'Tide', maker: 'soul:s1:Ana', kind: 'video' }), 'Tide — by Ana (a resident)');
  assert.equal(hoverText({ title: '', maker: '', kind: 'video' }), 'Untitled video');
});

test('cover fit: a landscape video in a portrait frame is cropped at the sides, never stretched', () => {
  const [u0, v0, u1, v1] = coverUv(640 / 480, 0.74 / 0.94);
  assert.equal(v0, 0); assert.equal(v1, 1);
  assert.ok(Math.abs((u1 - u0) * (640 / 480) - 0.74 / 0.94) < 1e-9 && Math.abs(u0 + u1 - 1) < 1e-9);
  assert.deepEqual(coverUv(1, 1), [0, 0, 1, 1]);
  const t = coverUv(0.5, 2); assert.equal(t[0], 0); assert.ok(Math.abs(t[3] - t[1] - 0.25) < 1e-9);
});
