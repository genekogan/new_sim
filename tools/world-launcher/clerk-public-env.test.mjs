import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';
import { verifiedCreator } from './creator-auth.mjs';
const root = resolve(new URL('../..', import.meta.url).pathname);
test('creator verifier accepts explicit new and retained origins, refuses unknown, preserves account identity', async t => {
  const dir=mkdtempSync(join(tmpdir(),'clerk-public-env-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const canonical='https://soul.example.test', old='https://souls.example.test', primary='https://primary.example.test';
  const keys=await clerkKeys(canonical);
  writeFileSync(join(dir,'jwks.json'), JSON.stringify({keys:[keys.jwk]}));
  const envFile=join(dir,'fixture.env');
  const preload=new URL('../../apps/server/test/clerk-jwks-preload.mjs',import.meta.url).pathname;
  writeFileSync(envFile,`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}\nCLERK_ISSUER_URL=${ISSUER}\nCLERK_AUTHORIZED_PARTIES=${old}\nSIM_TEST_JWKS_FILE=${join(dir,'jwks.json')}\nNODE_OPTIONS=--import=${preload}\n`);
  const auth={envFile,registryPath:join(dir,'accounts.sqlite'),authorizedParties:[canonical,old,primary].join(',')};
  let id;
  for (const azp of [canonical,old,primary]) {
    const token=await keys.sign('user_fixture',{azp});
    const actual=await verifiedCreator('Bearer '+token,auth,canonical,root);
    assert.match(actual,/^acct_/); if(id)assert.equal(actual,id);id=actual;
  }
  assert.equal(await verifiedCreator('Bearer '+await keys.sign('user_fixture',{azp:'https://unknown.example.test'}),auth,canonical,root),null);
  assert.equal(await verifiedCreator('Bearer '+await keys.sign('user_fixture'),{envFile,registryPath:auth.registryPath},canonical,root),null);
});
