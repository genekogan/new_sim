import test from 'node:test';
import assert from 'node:assert/strict';
import {eyesBrowserLaunch, eyesBrowserModes, eyesWorkerProblem, EYES_UA_TAG, isEyesAgent, eyesNice} from './edge/eyes/browser-config.mjs';

test('CPU Eyes defaults directly to SwiftShader on Linux, with one persistent Chromium worker', () => {
  assert.deepEqual(eyesBrowserModes({}, 'linux'), ['swiftshader']);
  assert.deepEqual(eyesBrowserModes({EDGE_EYES_GPU: 'auto'}, 'linux'), ['swiftshader']);
  const launch = eyesBrowserLaunch('swiftshader', {}, 'linux');
  assert.equal(launch.channel, 'chromium');
  assert.ok(launch.args.includes('--use-angle=swiftshader'));
  assert.ok(launch.args.includes('--enable-unsafe-swiftshader'));
  assert.throws(() => eyesBrowserModes({EDGE_EYES_GPU: 'typo'}, 'linux'), /EDGE_EYES_GPU/);
});
test('persistent service refuses the shared Mac before taking a Chrome lease or launching a browser', () => {
  assert.equal(eyesWorkerProblem('linux'),null);
  assert.match(eyesWorkerProblem('darwin')!,/disabled on the shared Mac/);
  for (const mode of ['auto','metal','swiftshader', 'gl']) assert.throws(() => eyesBrowserModes({EDGE_EYES_GPU: mode}, 'darwin'), /disabled on the shared Mac/);
  assert.throws(()=>eyesBrowserLaunch('metal',{},'darwin'),/disabled on the shared Mac/);
});

test('the Eyes worker is marked by its user agent and runs at a low priority', () => {
  assert.equal(EYES_UA_TAG, 'EdenEyes/1');
  assert.equal(isEyesAgent('Mozilla/5.0 HeadlessChrome EdenEyes/1'), true);
  assert.equal(isEyesAgent('Mozilla/5.0'), false); assert.equal(isEyesAgent(undefined), false);
  assert.equal(eyesNice({}), 10); assert.equal(eyesNice({EDGE_EYES_NICE: '0'}), 0); assert.equal(eyesNice({EDGE_EYES_NICE: '19'}), 19);
  assert.equal(eyesNice({EDGE_EYES_NICE: '25'}), 10); assert.equal(eyesNice({EDGE_EYES_NICE: 'x'}), 10);
});
