import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, CORE_KIT, applyBatch, type Failure } from './index.ts';

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
  const f: Failure = r.failures[0]; assert.equal(f.code, 'params.invalid', JSON.stringify(f)); assert.equal(f.field, 'state.media'); assert.match(f.fix!, /Upload.*this world.*\/assets\//);
  assert.deepEqual(w.snapshot(), before, 'no partial edit on media refusal');
}

test('sign admission refuses external, inline, malformed, missing and wrong-extension media', () => {
  for (const media of ['https://example.invalid/image.png', '//example.invalid/image.png', 'data:image/png;base64,abc', 'javascript:alert(1)', '/other.png', `/assets/${'b'.repeat(64)}.png`, `/assets/${sha}.jpg`, image + '?redirect=x', '/assets/../other.png', '/w/other' + image]) {
    refused(world(), [{ op: 'place', def: 'core/picture-frame@1', state: { media } }]);
  }
});

test('sign media can use this world image, update, clear and undo; state-only set cannot bypass admission', () => {
  const w = world(); assert.equal(act(w, [{ op: 'place', def: 'core/picture-frame@1', name: 'frame', state: { media: image } }]).accepted, true);
  refused(w, [{ op: 'set', id: 'frame', state: { media: 'https://example.invalid/tracker.png' } }]);
  const r = applyBatch(w, { ops: [{ op: 'set', id: 'frame', state: { media: '' } }] }, 'god', 2);
  assert.equal(r.result.accepted, true); assert.equal(w.get('frame')!.state!.media, '');
  assert.equal(applyBatch(w, { ops: r.inverse! }, 'god', 3, { trusted: true }).result.accepted, true);
  assert.equal(w.get('frame')!.state!.media, image);
});

test('a sign definition cannot smuggle an external media default into instances', () => {
  refused(world(), [{ op: 'define', def: { schema: 'def/1', name: 'unsafe-sign', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, .5, 0], size: [1, 1, .1] }], faces: [{ at: [0, .5, .06], w: .9, h: .9, media: true }] } }, size: { box: [1, 1, .2] }, state: { media: { type: 'string', max: 500, default: 'https://example.invalid/tracker.png' } } } }]);
});
