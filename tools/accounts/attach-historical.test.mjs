import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hashOf } from '../../packages/engine-contract/src/hash.ts';
import { attachHistorical, verifyClerkIdentity, validateManifest, sha } from './attach-historical.mjs';
const require=createRequire(new URL('../../apps/server/package.json',import.meta.url));
const { generateKeyPair, SignJWT }=await import(pathToFileURL(require.resolve('jose')).href);
const {privateKey,publicKey}=await generateKeyPair('RS256');
process.env.ATTACH_EXPECTED_EMAIL='owner@example.test';
function fixture(t) {
  const scratch=process.env.SAFETY_SCRATCH??tmpdir();mkdirSync(scratch,{recursive:true});
  const dir=realpathSync(mkdtempSync(join(scratch,'safety-attach-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'world.sqlite'),registryPath=join(dir,'accounts.sqlite'),db=new DatabaseSync(path),registry=new DatabaseSync(registryPath);
  registry.exec('CREATE TABLE provider_accounts_v1(account_id TEXT,issuer TEXT,subject TEXT)');
  registry.prepare('INSERT INTO provider_accounts_v1 VALUES(?,?,?)').run('acct_fixture','https://clerk.example.test','user_owner');registry.close();
  db.exec(`CREATE TABLE worlds(id TEXT); INSERT INTO worlds VALUES('fixture-world');
    CREATE TABLE souls(id TEXT,world_id TEXT,entity_id TEXT,owner TEXT,native INTEGER,retired_at INTEGER,token_hash TEXT);
    CREATE TABLE events(world_id TEXT,seq INTEGER,tick INTEGER,kind TEXT,author TEXT,payload TEXT,at INTEGER);
    CREATE TABLE account_identities_v1(account_id TEXT PRIMARY KEY,issuer TEXT,subject TEXT,verified_at INTEGER);
    CREATE TABLE account_soul_memberships_v1(world_id TEXT,soul_id TEXT,account_id TEXT,attribution TEXT,evidence_hash TEXT,created_at INTEGER,current_grant_id TEXT,PRIMARY KEY(world_id,soul_id));
    CREATE TABLE account_legacy_authority_v1(world_id TEXT,soul_id TEXT,legacy_owner_id TEXT,revoked_at INTEGER);
    CREATE TABLE account_agent_grants_v1(id TEXT,token_hash TEXT,revoked_at INTEGER);
    INSERT INTO account_agent_grants_v1 VALUES('old-grant','synthetic-grant-hash',NULL);`);
  const owner='dev:agent-0123456789abcdef01234567',birth={seq:1,tick:0,kind:'birth',author:'soul:s_0123456789',payload:{soulId:'s_0123456789',entityId:'h_0123456789',owner},at:1234};
  db.prepare('INSERT INTO souls VALUES(?,?,?,?,?,?,?)').run('s_0123456789','fixture-world','h_0123456789',owner,0,null,'synthetic-valid-token-hash');
  db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('fixture-world',birth.seq,birth.tick,birth.kind,birth.author,JSON.stringify(birth.payload),birth.at);
  db.prepare('INSERT INTO account_legacy_authority_v1 VALUES(?,?,?,NULL)').run('fixture-world','s_0123456789',owner);
  const m={contract:'sim-reviewed-historical-attachment/1',reviewedBy:'fixture-reviewer',reviewEvidenceSHA256:'b'.repeat(64),expectedEmail:'owner@example.test',issuer:'https://clerk.example.test',subject:'user_owner',accountId:'acct_fixture',registryPath,authorizedParty:'https://sim.example.test',worlds:[{worldId:'fixture-world',dbPath:path,entries:[{approved:true,soulId:'s_0123456789',entityId:'h_0123456789',birthSeq:1,birthHash:hashOf(birth),recordedOwnerSHA256:sha(owner),retired:false,evidenceSHA256:'c'.repeat(64)}]}]};
  const protectedTables=['souls','events','account_legacy_authority_v1','account_agent_grants_v1'];
  const snapshot=()=>Object.fromEntries(protectedTables.map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
  t.after(()=>db.close());return {m,db,path,registryPath,snapshot};
}
async function proof(m,options={}) {
  const token=await new SignJWT({sid:'sess_fixture',azp:m.authorizedParty,...options.claims}).setProtectedHeader({alg:'RS256'}).setIssuer(m.issuer).setSubject(options.subject??m.subject).setIssuedAt().setNotBefore('0s').setExpirationTime('5m').sign(privateKey);
  return verifyClerkIdentity(m,{token,backendKey:'sk_live_fixture',keySet:publicKey,fetchImpl:async url=>({ok:true,json:async()=>url.includes('/sessions/')?{id:'sess_fixture',user_id:m.subject,status:options.sessionStatus??'active'}:{id:options.profileId??m.subject,email_addresses:[{email_address:options.email??m.expectedEmail,verification:{status:options.status??'verified'}}]}})});
}
test('default dry-run is byte-preserving; apply is audited/idempotent and preserves history and delegated authority',async t=>{
  const f=fixture(t),p=await proof(f.m),before=readFileSync(f.path),protectedBefore=f.snapshot();
  const dry=attachHistorical(f.m,{registryPath:f.registryPath,proof:p});
  assert.equal(dry.mode,'dry-run');assert.equal(dry.worlds[0].entries[0].action,'attach');assert.deepEqual(readFileSync(f.path),before);
  attachHistorical(f.m,{registryPath:f.registryPath,proof:p,apply:true});
  assert.deepEqual(f.snapshot(),protectedBefore);assert.equal(f.db.prepare('SELECT count(*) AS n FROM account_historical_attachments_v1').get().n,1);
  assert.equal(attachHistorical(f.m,{registryPath:f.registryPath,proof:p,apply:true}).worlds[0].entries[0].action,'already-attached');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM account_historical_attachments_v1').get().n,1);assert.deepEqual(f.snapshot(),protectedBefore);
});
test('caller identity, wrong signed subject, unverified/mismatching provider email are refused',async t=>{
  const f=fixture(t);
  assert.throws(()=>attachHistorical(f.m,{registryPath:f.registryPath,proof:{id:f.m.accountId,issuer:f.m.issuer,subject:f.m.subject,verifiedAt:Date.now(),expiresAt:Date.now()+300000}}),/in-process/);
  for (const option of [{subject:'user_other'},{email:'other@example.test'},{status:'unverified'},{profileId:'user_other'},{sessionStatus:'revoked'},{claims:{azp:'https://other.example.test'}}]) await assert.rejects(proof(f.m,option));
});
test('no email/provider merging or binding allocation; empty manifest cannot activate',async t=>{
  const f=fixture(t),p=await proof(f.m),registry=new DatabaseSync(f.registryPath);registry.prepare('UPDATE provider_accounts_v1 SET account_id=?').run('acct_other');registry.close();
  assert.throws(()=>attachHistorical(f.m,{registryPath:f.registryPath,proof:p,apply:true}),/binding differs/);
  assert.throws(()=>validateManifest({...f.m,worlds:[]}),/No approved entries/);assert.throws(()=>validateManifest({...f.m,expectedEmail:'other@example.test'}),/restricted/);assert.throws(()=>validateManifest(f.m,{}),/Set ATTACH_EXPECTED_EMAIL/);
});
test('birth, native status, owner, membership and revoked legacy authority fail closed without changing data',async t=>{
  for (const mutation of ["UPDATE events SET payload='{}'","UPDATE souls SET native=1","UPDATE souls SET owner='somebody-else'","UPDATE account_legacy_authority_v1 SET revoked_at=1234","INSERT INTO account_soul_memberships_v1 VALUES('fixture-world','s_0123456789','acct_other','different','different',0,NULL)"]) {
    const f=fixture(t),p=await proof(f.m);f.db.exec(mutation);const before=f.snapshot();
    assert.throws(()=>attachHistorical(f.m,{registryPath:f.registryPath,proof:p,apply:true}),/Accepted birth differs|Soul identity|legacy authority|membership cannot/);assert.deepEqual(f.snapshot(),before);assert.equal(f.db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name=?').get('account_historical_attachments_v1').n,0);
  }
});
test('retired historical membership never resurrects a resident',async t=>{
  const f=fixture(t);f.db.exec('UPDATE souls SET retired_at=1234');f.m.worlds[0].entries[0].retired=true;const before=f.snapshot(),p=await proof(f.m);
  attachHistorical(f.m,{registryPath:f.registryPath,proof:p,apply:true});assert.deepEqual(f.snapshot(),before);
});
