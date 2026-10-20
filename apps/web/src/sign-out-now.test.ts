import test from 'node:test'; import assert from 'node:assert/strict';
import { signedOutView, signingOut } from './sign-out-now.ts';
import { authIdentity } from './auth-projection.ts';

test('pressing Sign out reads signed-out at once: no account, token, picture or identity', async () => {
  const auth = { ready: true, authed: true, label: 'dev:gene', avatarUrl: 'https://x/p.png', login() {}, logout() {}, getToken: async () => 'dev:gene', debug: { privyUserId: null, accountIdentity: 'acct_1', wallet: null, linked: [] } };
  const out = signedOutView(auth);
  assert.equal(out.authed, false); assert.equal(out.label, null); assert.equal(out.avatarUrl, null); assert.equal(out.ready, true);
  assert.equal(await out.getToken(), null); assert.equal(authIdentity(out), null);
  assert.equal(auth.authed, true, 'the provider\'s own session object is untouched');
});

test('the override lasts only while the provider still reports the account that pressed Sign out', () => {
  assert.equal(signingOut(undefined, true, 'acct_1'), false, 'nothing pressed');
  assert.equal(signingOut('acct_1', true, 'acct_1'), true, 'provider has not caught up yet');
  assert.equal(signingOut('acct_1', false, null), false, 'provider signed out');
  assert.equal(signingOut('acct_1', true, 'acct_2'), false, 'another account signed in');
  assert.equal(signingOut(null, true, null), true, 'an account without a resolved identity yet');
});
