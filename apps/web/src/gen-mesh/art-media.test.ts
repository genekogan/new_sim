// W6 viewer side: which faces show what, how makers read on hover, and the shared video lifecycle (no browser).
//   node --test apps/web/src/gen-mesh/art-media.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artOf, brokenLinkLines, coverUv, hoverText, imageBroken, imageFailed, imageLoaded, makerText, mediaKind, whenImageFails } from './art-media.ts';

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

test('a link the page cannot load says so instead of staying black (no CORS header, gone)', async () => {
  assert.deepEqual(brokenLinkLines('https://www.example.org/logo.png'), ["Can't show this link here", 'www.example.org']);
  assert.deepEqual(brokenLinkLines('/w/eden/art/abc.png'), ["Can't show this link here", 'not found']);
  const calls: string[] = [];
  whenImageFails('https://a.invalid/x.png', () => calls.push('face1'));
  whenImageFails('https://a.invalid/x.png', () => calls.push('face2'));
  whenImageFails('https://ok.invalid/y.png', () => calls.push('never'));
  imageLoaded('https://ok.invalid/y.png');
  imageFailed('https://a.invalid/x.png');
  assert.deepEqual(calls, ['face1', 'face2'], 'every face waiting on the link is told once');
  assert.equal(imageBroken('https://a.invalid/x.png'), true);
  whenImageFails('https://a.invalid/x.png', () => calls.push('later'));   // a face built after the failure
  whenImageFails('https://ok.invalid/y.png', () => calls.push('never'));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ['face1', 'face2', 'later']);
});
