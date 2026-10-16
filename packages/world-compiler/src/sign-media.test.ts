import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, CORE_KIT, applyBatch, frameMediaKind, type Failure } from './index.ts';

// Gene 2026-10-16: frames may show web links (http/https) and video; no moderation for now. Still never data:,
// javascript:, blob: or protocol-relative links, and no spaces/quotes/angle brackets that could break out of a URL.
const sha = 'a'.repeat(64), image = `/assets/${sha}.png`;
function world() {
  const w = new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'sign-media-test', assets: hash => hash === sha ? { tris: 0, bytes: 80, textures: 1, box: [1, 1, 0], image: { ext: 'png' } } : undefined });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  return w;
}
const act = (w: WorldModel, ops: unknown[]) => applyBatch(w, { ops }, 'god', 1).result;
function refused(w: WorldModel, ops: unknown[]) {
  const before = w.snapshot(), r = act(w, ops);
  assert.equal(r.accepted, false, JSON.stringify(r)); if (r.accepted) throw Error('expected refusal');
  const f: Failure = r.failures[0]; assert.equal(f.code, 'params.invalid', JSON.stringify(f)); assert.equal(f.field, 'state.media'); assert.match(f.fix!, /https:\/\/.*\/v1\/art\/media/);
  assert.deepEqual(w.snapshot(), before, 'no partial edit on media refusal');
}

test('frame media kinds: web links and same-site paths, videos by extension; nothing scriptable or inline', () => {
  assert.equal(frameMediaKind('https://example.org/a.png'), 'image');
  assert.equal(frameMediaKind('http://example.org/loop.webm?v=2'), 'video');
  assert.equal(frameMediaKind('https://example.org/stream#video'), 'video');
  assert.equal(frameMediaKind(image), 'image');
  assert.equal(frameMediaKind(`/w/eden/art/${sha}.mp4`), 'video');
  for (const bad of ['', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:image/png;base64,abc', 'blob:https://x.org/1', '//example.invalid/a.png', 'ftp://x.org/a.png', 'https://x.org/a b.png', 'https://x.org/"onerror', 'https://u:p@x.org/a.png', 'https:/x.org', 'x.png', '/a\\b.png', 'https://x.org/' + 'a'.repeat(480), 42, null]) assert.equal(frameMediaKind(bad), null, String(bad));
});

test('frames take web links and videos, one per slot line', () => {
  for (const media of ['https://example.org/image.png', 'http://example.org/clip.mp4', image, `/w/eden/art/${sha}.webm`, 'https://example.org/a.png\n\nhttps://example.org/b.mp4']) {
    const w = world(); assert.equal(act(w, [{ op: 'place', def: 'core/picture-frame@1', name: 'frame', state: { media } }]).accepted, true, media);
    assert.equal(w.get('frame')!.state!.media, media);
  }
});

test('frame admission still refuses scriptable, inline, protocol-relative and malformed media', () => {
  // a /assets/ path is still this world's own uploaded image (release 2 rule)
  for (const media of [`/assets/${'b'.repeat(64)}.png`, `/assets/${sha}.jpg`, '/assets/../other.png']) {
    const w = world(), r = act(w, [{ op: 'place', def: 'core/picture-frame@1', state: { media } }]);
    assert.equal(r.accepted, false, media); if (!r.accepted) assert.match(r.failures[0].fix!, /Upload.*this world/);
  }
  for (const media of ['javascript:alert(1)', 'data:image/png;base64,abc', '//example.invalid/image.png', 'blob:https://x.org/1', 'other.png', 'https://example.org/a b.png', 'https://x.org/a.png\njavascript:alert(1)', Array(9).fill('https://x.org/a.png').join('\n')]) {
    refused(world(), [{ op: 'place', def: 'core/picture-frame@1', state: { media } }]);
  }
});

test('frame media can update, clear and undo; a state-only set cannot bypass admission', () => {
  const w = world(); assert.equal(act(w, [{ op: 'place', def: 'core/picture-frame@1', name: 'frame', state: { media: image } }]).accepted, true);
  refused(w, [{ op: 'set', id: 'frame', state: { media: 'javascript:alert(1)' } }]);
  const r = applyBatch(w, { ops: [{ op: 'set', id: 'frame', state: { media: '' } }] }, 'god', 2);
  assert.equal(r.result.accepted, true); assert.equal(w.get('frame')!.state!.media, '');
  assert.equal(applyBatch(w, { ops: r.inverse! }, 'god', 3, { trusted: true }).result.accepted, true);
  assert.equal(w.get('frame')!.state!.media, image);
});

test('a sign definition cannot smuggle a scriptable media default into instances', () => {
  refused(world(), [{ op: 'define', def: { schema: 'def/1', name: 'unsafe-sign', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, .5, 0], size: [1, 1, .1] }], faces: [{ at: [0, .5, .06], w: .9, h: .9, media: true }] } }, size: { box: [1, 1, .2] }, state: { media: { type: 'string', max: 500, default: 'javascript:alert(1)' } } } }]);
});
