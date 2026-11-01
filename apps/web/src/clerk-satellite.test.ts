import test from 'node:test';
import assert from 'node:assert/strict';
import { clerkSatelliteOptions, startClerkSignIn } from './clerk-satellite.ts';
const satellite = { domain: 'satellite.example.test', signInUrl: 'https://primary.example.test/sign-in' };
test('satellite options activate only on the exact configured HTTPS origin', () => {
  assert.deepEqual(clerkSatelliteOptions(satellite, 'https://satellite.example.test'), { isSatellite: true, ...satellite });
  for (const origin of ['https://primary.example.test', 'https://other.example.test', 'https://satellite.example.test.attacker.test', 'http://satellite.example.test']) assert.deepEqual(clerkSatelliteOptions(satellite, origin), {});
  assert.deepEqual(clerkSatelliteOptions(undefined, 'https://satellite.example.test'), {});
  for (const signInUrl of ['bad', 'javascript:alert(1)', 'https://user@primary.example.test/sign-in', 'https://primary.example.test/sign-in?redirect_url=evil', 'https://satellite.example.test/sign-in']) assert.deepEqual(clerkSatelliteOptions({ ...satellite, signInUrl }, 'https://satellite.example.test'), {});
});
test('SDK receives the full pairing fragment and return query, and its sync URL is navigated unchanged', () => {
  const href = 'https://satellite.example.test/w/eden/?new=1#godpair/ABCD-EFGH';
  const sync = 'https://primary.example.test/sign-in?redirect_url=SDK_ENCODED_SYNC';
  const calls: unknown[] = [];
  const clerk = { buildSignInUrl: (options: unknown) => { calls.push(options); return sync; }, openSignIn: (options: unknown) => { calls.push(['modal', options]); } };
  startClerkSignIn(clerk, satellite, href, url => calls.push(url));
  assert.deepEqual(calls, [{ signInForceRedirectUrl: href, signUpForceRedirectUrl: href }, sync]);
  calls.length = 0;
  startClerkSignIn(clerk, satellite, 'https://primary.example.test/w/eden/#join', url => calls.push(url));
  assert.deepEqual(calls, [['modal', { afterSignInUrl: 'https://primary.example.test/w/eden/#join', afterSignUpUrl: 'https://primary.example.test/w/eden/#join' }]]);
});
