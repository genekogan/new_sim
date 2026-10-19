import test from 'node:test'; import assert from 'node:assert/strict';
import { offerFullscreen, type FullscreenEnv } from './fullscreen.ts';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};
const env = (o: Partial<FullscreenEnv>): FullscreenEnv => ({ ua: UA.androidChrome, api: true, installed: false, iosStandalone: false, fullscreen: false, ...o });

test('Android Chrome in a tab with the Fullscreen API: offered', () => { assert.equal(offerFullscreen(env({})), true); });
test('iPhone, iPad and desktop: never offered, even where the API exists', () => {
  for (const ua of [UA.iphone, UA.ipad, UA.macChrome, UA.windows]) assert.equal(offerFullscreen(env({ ua })), false, ua);
});
test('no redundant control: hidden while full screen, when installed, in iOS standalone, or without the API', () => {
  assert.equal(offerFullscreen(env({ fullscreen: true })), false);
  assert.equal(offerFullscreen(env({ installed: true })), false);
  assert.equal(offerFullscreen(env({ iosStandalone: true })), false);
  assert.equal(offerFullscreen(env({ api: false })), false);
});
