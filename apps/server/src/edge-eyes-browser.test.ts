import test from 'node:test';
import assert from 'node:assert/strict';
import {eyesBrowserLaunch, eyesBrowserModes} from './edge/eyes/browser-config.mjs';

test('CPU Eyes defaults directly to SwiftShader on Linux, with one persistent Chromium worker', () => {
  assert.deepEqual(eyesBrowserModes({}, 'linux'), ['swiftshader']);
  assert.deepEqual(eyesBrowserModes({EDGE_EYES_GPU: 'auto'}, 'linux'), ['swiftshader']);
  const launch = eyesBrowserLaunch('swiftshader', {}, 'linux');
  assert.equal(launch.channel, 'chromium');
  assert.ok(launch.args.includes('--use-angle=swiftshader'));
  assert.ok(launch.args.includes('--enable-unsafe-swiftshader'));
  assert.throws(() => eyesBrowserModes({EDGE_EYES_GPU: 'typo'}, 'linux'), /EDGE_EYES_GPU/);
});
test('shared Mac requires real Chrome with hardware, no software fallback even when explicitly requested', () => {
  assert.deepEqual(eyesBrowserModes({}, 'darwin'), ['metal']);
  assert.deepEqual(eyesBrowserModes({EDGE_EYES_GPU: 'metal'}, 'darwin'), ['metal']);
  for (const mode of ['swiftshader', 'gl']) assert.throws(() => eyesBrowserModes({EDGE_EYES_GPU: mode}, 'darwin'), /real Chrome/);
  assert.deepEqual(eyesBrowserLaunch('metal', {}, 'darwin'), {headless: true, channel: 'chrome', args: ['--ignore-gpu-blocklist', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']});
});
