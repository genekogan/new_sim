import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clerkAuth } from './launcher.mjs';
const key = 'pk_live_' + Buffer.from('clerk.example.test$').toString('base64');
const origin = 'https://satellite.example.test', primary = 'https://primary.example.test';
const options = { clerkSatellite: 'satellite.example.test', clerkSignInUrl: primary+'/sign-in' };
test('Clerk configuration preserves unconfigured public shape and refuses missing satellite authorized parties', t => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-config-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = join(dir, 'fixture.env');
  const write = (parties, issuer = 'https://clerk.example.test') => writeFileSync(env, `CLERK_PUBLISHABLE_KEY=${key}\nCLERK_ISSUER_URL=${issuer}\nCLERK_AUTHORIZED_PARTIES=${parties}\nUNRELATED_PRIVATE_VALUE=not-public\n`);
  write(origin);
  assert.equal(clerkAuth(undefined, dir, origin), null);
  assert.throws(() => clerkAuth(undefined, dir, origin, options), /requires --auth-env/);
  assert.deepEqual(clerkAuth(env, dir, origin).public, { provider: 'clerk', clerkPublishableKey: key, clerkIssuer: 'https://clerk.example.test', authenticationOrigin: origin });
  assert.throws(() => clerkAuth(env, dir, origin, options), /AUTHORIZED_PARTIES/);
  write(origin+','+primary);
  const auth = clerkAuth(env, dir, origin, options);
  assert.deepEqual(auth.public.clerkSatellite, { domain: options.clerkSatellite, signInUrl: options.clerkSignInUrl });
  assert.deepEqual(auth.child.satellite, auth.public.clerkSatellite);
  assert.equal(JSON.stringify(auth.public).includes('not-public'), false);
  for (const issuer of ['https://user@clerk.example.test', 'https://clerk.example.test/path', 'https://clerk.example.test"']) {
    write(origin+','+primary, issuer);
    assert.throws(() => clerkAuth(env, dir, origin, options), /https origin/);
  }
});
