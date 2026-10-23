import test from 'node:test';import assert from 'node:assert/strict';
import {mergeSoulGuide,SOUL_GUIDE_START,SOUL_GUIDE_END} from './client-folder-guide.mjs';
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
