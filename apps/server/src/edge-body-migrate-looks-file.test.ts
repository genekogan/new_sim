// Looks v2: the per-world one-shot legacy-looks.env (launcher children cannot be given per-world environment).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {legacyLookBootHook,legacyLooksOptions} from './edge/body/migrate-looks.ts';

test('legacy-looks.env: allowlisted keys only; the process env wins',()=>{
  const read=(text:string|null)=>()=>text;
  assert.deepEqual(legacyLooksOptions('/d',{},read('LEGACY_LOOKS_MODE=plan\nLEGACY_LOOKS_SOCIAL_PRESETS=1\n# note\n')).options,{LEGACY_LOOKS_MODE:'plan',LEGACY_LOOKS_SOCIAL_PRESETS:'1'});
  assert.equal(legacyLooksOptions('/d',{},read(null)).file,null);
  assert.throws(()=>legacyLooksOptions('/d',{},read('NODE_OPTIONS=--inspect\n')),/only LEGACY_LOOKS_MODE/);
  assert.deepEqual(legacyLooksOptions('/d',{LEGACY_LOOKS_MODE:'apply',LEGACY_LOOKS_SOCIAL_PRESETS:'0'},read('LEGACY_LOOKS_MODE=plan')).options,{LEGACY_LOOKS_MODE:'apply',LEGACY_LOOKS_SOCIAL_PRESETS:'0'});
});
test('boot hook: plan then apply from the file, result files written, file consumed, ordinary boot untouched',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'legacy-file-')),f=fixture(join(dir,'sim.db'),factory,{durableClockV1:true});f.brain.quiesce();
  const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false});t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<2;i++){await invite(f,'lf'+i);await accept(f.host,f.souls.create('dev:lf'+i,{name:'File '+i,description:'migration file fixture'}));}
  const lines:string[]=[],log=(l:string)=>lines.push(l);
  assert.equal(await legacyLookBootHook(f.host,f.db,ledger,dir,{},log),null,'no file, no env: nothing runs');
  writeFileSync(join(dir,'legacy-looks.env'),'LEGACY_LOOKS_MODE=plan\nLEGACY_LOOKS_SOCIAL_PRESETS=0\n');
  const plan=await legacyLookBootHook(f.host,f.db,ledger,dir,{},log) as any;assert.equal(plan.planned.length,2);assert.equal(plan.migrated.length,0);
  assert.ok(!existsSync(join(dir,'legacy-looks.env')),'plan consumed the file');
  writeFileSync(join(dir,'legacy-looks.env'),'LEGACY_LOOKS_MODE=apply\nLEGACY_LOOKS_SOCIAL_PRESETS=0\n');
  const run=legacyLookBootHook(f.host,f.db,ledger,dir,{},log);const pump=setInterval(()=>f.host.drainInputs(),5);const applied=await run as any;clearInterval(pump);
  assert.equal(applied.migrated.length,2);assert.equal(applied.deferred.length,0);
  const files=readdirSync(dir);assert.ok(files.some(n=>/^legacy-looks-plan-.*\.json$/.test(n))&&files.some(n=>/^legacy-looks-apply-.*\.json$/.test(n)),files.join(' '));
  assert.ok(files.some(n=>n.startsWith('legacy-looks.env.done-apply-'))&&!files.includes('legacy-looks.env'));
  const result=JSON.parse(readFileSync(join(dir,files.find(n=>/^legacy-looks-apply-/.test(n))!),'utf8'));assert.equal(result.result.migrated.length,2);assert.equal(result.socialPresets,'0');
  assert.ok(lines.every(l=>l.startsWith('[legacy-looks] ')));
  assert.equal(await legacyLookBootHook(f.host,f.db,ledger,dir,{},log),null,'the next ordinary boot runs nothing');
});
