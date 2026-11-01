import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { defaultCommand, forkCommand } from './children.mjs';
import { authorizedPartiesOverride } from './clerk-public-env.mjs';
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

test('public override passes validation and both child envs without inheriting unrelated parent settings', t => {
  const dir = mkdtempSync(join(tmpdir(), 'clerk-override-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, 'fixture.env');
  const bytes = `CLERK_PUBLISHABLE_KEY=${key}\nCLERK_ISSUER_URL=https://clerk.example.test\nCLERK_AUTHORIZED_PARTIES=https://old.example.test\n`;
  writeFileSync(envFile, bytes);
  const parties = origin+','+primary+',https://old.example.test';
  const oldValue = process.env.CLERK_AUTHORIZED_PARTIES;
  t.after(() => { if(oldValue === undefined) delete process.env.CLERK_AUTHORIZED_PARTIES; else process.env.CLERK_AUTHORIZED_PARTIES=oldValue; });
  process.env.CLERK_AUTHORIZED_PARTIES = parties;
  const auth = clerkAuth(envFile, dir, origin, options);
  assert.equal(auth.child.authorizedParties, parties);
  assert.equal(auth.public.clerkIssuer, 'https://clerk.example.test');
  assert.equal(auth.public.clerkPublishableKey, key);
  assert.equal(readFileSync(envFile,'utf8'), bytes);
  const w = { slug:'proof', dataDir:dir, fork:{ accounts:join(dir,'accounts.sqlite'), descriptor:join(dir,'descriptor.json') } };
  for (const command of [defaultCommand, forkCommand]) {
    const spec = command(w, 5991, { auth:auth.child, publicOrigin:origin });
    assert.equal(spec.env.CLERK_AUTHORIZED_PARTIES, parties);
    assert.equal(spec.env.CLERK_ISSUER_URL, undefined);
    assert.equal(spec.env.CLERK_PUBLISHABLE_KEY, undefined);
    assert.equal(spec.env.OPENAI_API_KEY, '');
    assert.ok(spec.args.includes('--env-file='+envFile));
  }
  for (const bad of ['', '*', 'http://wrong.test', 'https://wrong.test/', 'https://user@wrong.test', 'https://wrong.test/path', 'https://wrong.test#x', 'https://wrong.test,']) assert.throws(()=>authorizedPartiesOverride(bad));
});
