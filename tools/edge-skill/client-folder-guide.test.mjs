import test from 'node:test';import assert from 'node:assert/strict';
import {mergeSoulGuide,SOUL_GUIDE_START,SOUL_GUIDE_END,writeSoulGuides,SOUL_PARENT_GUIDE_START} from './client-folder-guide.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,linkSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const guide='# My Soul\nRun `node eden-agent.mjs status`, then `node eden-agent.mjs tell "<my words>" --wait`.\n';
test('empty and existing project guides receive a discoverable Soul block without losing existing text',()=>{
 for(const old of ['', '# Project notes\nKeep my rules.\n', '# Project notes\r\nKeep these bytes.', 'Unrelated instructions without a final newline']){
  const merged=mergeSoulGuide(old,guide);assert.ok(merged.startsWith(old));assert.ok(merged.includes(guide.trimEnd()));assert.equal(merged.split(SOUL_GUIDE_START).length-1,1);assert.equal(merged.split(SOUL_GUIDE_END).length-1,1);assert.equal(mergeSoulGuide(merged,guide),merged,'repeat does not duplicate or rewrite instructions');
 }
});
test('updating a managed Soul block preserves the exact surrounding owner instructions',()=>{
 const prefix='# Owner instructions\nKeep this.\n\n',suffix='\n\n# More owner instructions\nKeep that too.\n';
 const old=prefix+SOUL_GUIDE_START+'\nold generated Soul guide\n'+SOUL_GUIDE_END+suffix;
 const updated=mergeSoulGuide(old,guide);assert.equal(updated,prefix+SOUL_GUIDE_START+'\n'+guide.trimEnd()+'\n'+SOUL_GUIDE_END+suffix);assert.equal(mergeSoulGuide(updated,guide),updated);
});
test('an incomplete marker never consumes owner text and a later refresh remains stable',()=>{
 const old='Project rule\n'+SOUL_GUIDE_START+'\nOwner text must survive.\n';const first=mergeSoulGuide(old,guide);assert.ok(first.startsWith(old));assert.equal(mergeSoulGuide(first,guide),first);
});
test('conventional eden-soul installs one parent pointer and preserves all four project guide setups',()=>{
 for(const kind of ['empty','readme','claude','both']){
  const parent=mkdtempSync(join(tmpdir(),'eden-parent-guide-')),child=join(parent,'eden-soul');mkdirSync(child);
  const original='# Existing project rules\r\nKeep these exact bytes.';
  if(kind==='readme')writeFileSync(join(parent,'README.md'),original);
  if(['claude','both'].includes(kind))writeFileSync(join(parent,'CLAUDE.md'),original);
  if(kind==='both')writeFileSync(join(parent,'AGENTS.md'),original);
  writeSoulGuides(child,guide);
  for(const name of ['CLAUDE.md','AGENTS.md']){
   const first=readFileSync(join(parent,name),'utf8');assert.ok(first.includes('cd eden-soul && node eden-agent.mjs status'));assert.equal(first.split(SOUL_PARENT_GUIDE_START).length-1,1);
   if(kind==='both'||kind==='claude'&&name==='CLAUDE.md')assert.ok(first.startsWith(original));
   writeSoulGuides(child,guide);assert.equal(readFileSync(join(parent,name),'utf8'),first);
  }
  if(kind==='readme')assert.equal(readFileSync(join(parent,'README.md'),'utf8'),original);
  assert.ok(readFileSync(join(child,'CLAUDE.md'),'utf8').includes(SOUL_GUIDE_START));
 }
});
test('Soul guide parent writes are limited to the real conventional child and skip linked guide files',()=>{
 const root=mkdtempSync(join(tmpdir(),'eden-parent-boundary-'));
 const named=join(root,'ordinary-soul');mkdirSync(named);writeSoulGuides(named,guide);assert.equal(existsSync(join(root,'CLAUDE.md')),false);
 const alias=join(root,'eden-soul');symlinkSync(named,alias);writeSoulGuides(alias,guide);assert.equal(existsSync(join(root,'CLAUDE.md')),false,'a conventional symlink name cannot enable ancestor writes');
 for(const kind of ['symlink','dangling','hardlink','directory']){
  const parent=join(root,kind),child=join(parent,'eden-soul');mkdirSync(child,{recursive:true});
  const target=join(parent,'public-original.md');writeFileSync(target,'Untouched owner text.');
  const path=join(parent,'CLAUDE.md');
  if(kind==='symlink')symlinkSync(target,path);else if(kind==='dangling')symlinkSync(join(parent,'missing.md'),path);else if(kind==='hardlink')linkSync(target,path);else mkdirSync(path);
  writeSoulGuides(child,guide);assert.equal(readFileSync(target,'utf8'),'Untouched owner text.');
  assert.ok(lstatSync(path).isSymbolicLink()||lstatSync(path).isDirectory()||lstatSync(path).nlink===2);
  assert.ok(readFileSync(join(parent,'AGENTS.md'),'utf8').includes(SOUL_PARENT_GUIDE_START));
 }
});
