import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aboutValue, missingAbout, exactAboutTarget } from './lib/about.mjs';
import { about, set, checkArgs, parseFlags, COMMANDS } from './cli.mjs';
import { invalidate } from './lib/mirror.mjs';

const m = { rows: [{id:'a',path:'hall',name:'hall',def:'hall@1'},{id:'b',path:'hall/chair',name:'chair',def:'chair@1'},{id:'c',path:'other/chair',name:'chair',def:'chair@1'}], snapshot:{ entities:[{id:'a',about:{title:'Hall'}},{id:'b',about:{title:'Seat',what:'A study seat'}},{id:'c'}], defs:[{ref:'hall@1',components:{place:{kind:'building'}}},{ref:'chair@1',components:{seat:{height:0.4}}}], library:[] } };
test('about missing reports missing purpose, filters kinds, bounds output and refuses ambiguous names', () => {
  assert.deepEqual(missingAbout(m,{kind:'building'}).rows[0].missing,['what']);
  assert.equal(missingAbout(m,{limit:1}).remaining,1);
  assert.equal(missingAbout(m).total,2);
  assert.throws(()=>missingAbout(m,{limit:0}),/limit/);
  assert.throws(()=>exactAboutTarget(m,'chair'),/ambiguous/);
  assert.equal(exactAboutTarget(m,'hall/chair').id,'b');
  assert.throws(()=>exactAboutTarget(m,'missing'),/unknown/);
});
test('about parsing preserves anchored parts and only explicit set permits null', () => {
  const value={title:'Hall',parts:[{id:'desk',title:'Desk',anchor:{kind:'entity',ref:'chair',slot:'seat'}}]};
  assert.deepEqual(aboutValue(JSON.stringify(value)),value);
  assert.equal(aboutValue('null',{clear:true}),null);
  for(const bad of ['null','[]','1','true','oops']) assert.throws(()=>aboutValue(bad));
  assert.throws(()=>aboutValue(true));
});
test('about edits are exact replacement journaled operations, and set exposes clearing', async t => {
  const cwd=process.cwd(), fetchBefore=globalThis.fetch, dir=mkdtempSync(join(tmpdir(),'about-test-')), calls=[];
  process.chdir(dir); invalidate();
  writeFileSync('.eden-god.json',JSON.stringify({world:'https://world.invalid',token:'fixture-only'}));
  globalThis.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return Response.json({accepted:true});};
  t.after(()=>{process.chdir(cwd);globalThis.fetch=fetchBefore;invalidate();rmSync(dir,{recursive:true,force:true});});
  await about('hall',{set:'{"title":"Lecture hall"}'});
  await about('hall',{clear:true});
  await about('world',{set:'{"tour":"Walk from the square to the shore."}'});
  await set('hall',{about:'null'});
  assert.deepEqual(calls.map(c=>c.body.ops[0]),[
    {op:'set',id:'hall',about:{title:'Lecture hall'}}, {op:'set',id:'hall',about:null},
    {op:'world',state:{about:{tour:'Walk from the square to the shore.'}}}, {op:'set',id:'hall',about:null}
  ]);
  assert.ok(calls.every(c=>c.url.endsWith('/v1/god/act')));
  await assert.rejects(about('hall',{set:'{}',clear:true}),/choose/);
  await assert.rejects(about('hall',{missing:true}),/combined/);
  assert.equal(calls.length,4);
});
test('about flags and help are discoverable without opening a world', () => {
  checkArgs('about',{set:'{}'},['hall']);checkArgs('about',{missing:true,kind:'water',limit:'10'},[]);
  checkArgs('place',{about:'{}'},['hall']);checkArgs('set',{about:'null'},['hall']);
  assert.deepEqual(parseFlags(['--missing','--kind','building']),{rest:[],flags:{missing:true,kind:'building'}});
  assert.match(COMMANDS.help(),/about <ref\|world>/);
});

test('missing meaning recognizes generated water but skips arbitrary decoration', () => {
  const snapshot={entities:[{id:'water'},{id:'decor'}],defs:[{ref:'pond@1',make:{kind:'gen',gen:'lake/1'},layer:'volume',tags:['water'],components:{}},{ref:'bowl@1',layer:'decor'}]};
  const rows=[{id:'water',path:'pond',def:'pond@1'},{id:'decor',path:'bowl',def:'bowl@1'}];
  assert.deepEqual(missingAbout({snapshot,rows},{kind:'water'}).rows.map(r=>r.path),['pond']);
  assert.equal(missingAbout({snapshot,rows}).total,1);
});
