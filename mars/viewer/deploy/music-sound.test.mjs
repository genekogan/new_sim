import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicSound, musicSoundState } from '../app/lab/music-sound.ts';

test('music expression closes a partially allocated audio graph and preserves close failures', async () => {
  const original = {
    AudioContext: globalThis.AudioContext,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  let rejectClose = false,
    closes = 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.AudioContext = class {
    state = 'suspended';
    createOscillator() {
      throw new Error('device graph unavailable');
    }
    close() {
      closes++;
      return rejectClose
        ? Promise.reject(new Error('device close failed'))
        : Promise.resolve();
    }
  };
  try {
    const before = musicSoundState();
    assert.throws(
      () => new MusicSound({}, 'station'),
      /device graph unavailable/,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(musicSoundState(), {
      ...before,
      opened: before.opened + 1,
      closed: before.closed + 1,
    });
    rejectClose = true;
    assert.throws(
      () => new MusicSound({}, 'station'),
      /device graph unavailable/,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const failed = musicSoundState();
    assert.equal(failed.active, before.active + 1);
    assert.match(failed.voices.at(-1).error, /device close failed/);
    assert.equal(failed.voices.at(-1).disposed, true);
    assert.equal(closes, 2);
  } finally {
    Object.assign(globalThis, original);
  }
});
