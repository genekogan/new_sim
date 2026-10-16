// W6 viewer side: which faces show what, how makers read on hover, and the shared video lifecycle (no browser).
//   node --test apps/web/src/gen-mesh/art-media.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artOf, hoverText, makerText, mediaKind } from './art-media.ts';

test('media kinds: images, videos by extension, inline images; nothing scriptable', () => {
  assert.equal(mediaKind('https://x.org/a.jpg'), 'image');
  assert.equal(mediaKind('/w/eden/art/abc.webm'), 'video');
  assert.equal(mediaKind('data:image/png;base64,AAAA'), 'image');
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
