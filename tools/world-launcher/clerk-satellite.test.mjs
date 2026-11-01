import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { satelliteSettings, satelliteReturnUrl, primaryReturnTarget, primarySignInPage } from './clerk-satellite.mjs';
const domain = 'satellite.example.test', origin = `https://${domain}`, signInUrl = 'https://primary.example.test/sign-in';
const auth = { clerkPublishableKey: 'pk_live_' + Buffer.from('clerk.example.test$').toString('base64'), clerkIssuer: 'https://clerk.example.test', clerkSatellite: { domain, signInUrl } };
test('launcher satellite settings require paired safe configuration, exact canonical origin, and separate primary', () => {
  assert.equal(satelliteSettings(undefined, undefined, origin), undefined);
  assert.deepEqual(satelliteSettings(domain, signInUrl, origin), { domain, signInUrl });
  for (const [d, u, o] of [[domain, undefined, origin], [undefined, signInUrl, origin], ['https://'+domain, signInUrl, origin], [domain, 'http://primary.example.test/sign-in', origin], [domain, 'https://user@primary.example.test/sign-in', origin], [domain, signInUrl+'#x', origin], [domain, signInUrl+'?x=1', origin], [domain, origin+'/sign-in', origin], [domain, signInUrl, 'https://other.example.test']]) assert.throws(() => satelliteSettings(d, u, o));
});
test('primary return allowlist retains SDK sync, queries and pairing fragment, refuses query and hash open redirects', () => {
  const target = origin+'/w/eden/?__clerk_synced=false#godpair/ABCD-EFGH';
  assert.equal(satelliteReturnUrl(target, domain), target);
  assert.equal(primaryReturnTarget('?redirect_url='+encodeURIComponent(target), '', domain), target);
  assert.equal(primaryReturnTarget('', '#/?redirect_url='+encodeURIComponent(target), domain), target);
  for (const value of ['https://attacker.test/', origin+'.attacker.test/', 'javascript:alert(1)', 'https://user@'+domain, '//'+domain, 'http://'+domain]) {
    assert.equal(satelliteReturnUrl(value, domain), null);
    assert.equal(primarySignInPage(auth, '?redirect_url='+encodeURIComponent(value)), null);
    assert.equal(primaryReturnTarget('', '#/?sign_in_force_redirect_url='+encodeURIComponent(value), domain), null);
  }
});
async function runPage({ session = null, hash = '', search = '', currentOrigin = 'https://primary.example.test', fail = false } = {}) {
  const page = primarySignInPage(auth, search), calls = [], root = { textContent: '' };
  // This is our generated fixture, not an HTML sanitizer: extract its one inline bootstrap exactly.
  const start = page.html.indexOf('<script>') + '<script>'.length;
  const script = page.html.slice(start, page.html.lastIndexOf('</script>'));
  assert.ok(page.csp.includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));
  const context = { URL, URLSearchParams, document: { getElementById: () => root }, location: { origin: currentOrigin, hash, search, replace: url => calls.push(['replace', url]) }, Clerk: { session, load: async opts => { calls.push(['load', opts]); if (fail) throw Error('failed'); }, mountSignIn: (_root, opts) => calls.push(['mount', opts]) } };
  await vm.runInNewContext(script, context);
  return { calls: JSON.parse(JSON.stringify(calls)), root };
}
test('primary bridge loads on configured primary only; signed-out form and existing session preserve the satellite target', async () => {
  const target = origin+'/w/eden/?__clerk_synced=false#approve/example';
  const query = '?redirect_url='+encodeURIComponent(target);
  const signedOut = await runPage({ search: query });
  assert.equal(signedOut.calls[0][0], 'load');
  assert.deepEqual(signedOut.calls[0][1].allowedRedirectOrigins, [origin]);
  assert.deepEqual(signedOut.calls[1], ['mount', { routing: 'hash', forceRedirectUrl: target, signUpForceRedirectUrl: target }]);
  const signedIn = await runPage({ hash: '#/'+query, session: {} });
  assert.deepEqual(signedIn.calls[1], ['replace', target]);
  assert.deepEqual((await runPage({ currentOrigin: origin })).calls, []);
  assert.deepEqual((await runPage({ hash: '#/?redirect_url=https://attacker.test' })).calls, []);
  assert.match((await runPage({ fail: true })).root.textContent, /could not load/);
});
test('primary bridge escapes untrusted-looking attribute bytes rather than making HTML', () => {
  const page = primarySignInPage({ ...auth, clerkIssuer: 'https://clerk.example.test" onload="bad' }, '');
  assert.ok(page.html.includes('&quot; onload=&quot;bad'));
  assert.equal(page.html.includes('src="https://clerk.example.test" onload='), false);
});
