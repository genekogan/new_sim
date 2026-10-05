import test from 'node:test';
import assert from 'node:assert/strict';
import {INTENT_HISTORY_V1,intentHistoryPageV1Schema,intentHistoryQueryV1Schema} from './intent-history-page-v1.ts';
const cursor='ih1_'+ 'a'.repeat(48);
const base={contract:INTENT_HISTORY_V1,intentContract:'soul-intent/2',worldId:'eden',soulId:'s_A',ownerId:'alice',frontier:{seq:201,tick:50},fromSeq:0};
const partial={...base,state:'page',throughSeq:200,events:[],complete:false,nextCursor:cursor,resumeCursor:null,visibility:'current-owner'};
test('empty bounded progress is not complete, and gaps cannot carry partial facts or cursors',()=>{
  assert.ok(intentHistoryPageV1Schema.safeParse(partial).success);
  for(const bad of [{...partial,complete:true},{...partial,nextCursor:null},{...partial,resumeCursor:cursor},{...partial,throughSeq:202},{...partial,rawJournal:'PRIVATE'}])assert.equal(intentHistoryPageV1Schema.safeParse(bad).success,false);
  const gap={...base,state:'gap',reason:'prefix-missing',expectedSeq:1};assert.ok(intentHistoryPageV1Schema.safeParse(gap).success);
  assert.equal(intentHistoryPageV1Schema.safeParse({...gap,events:[]}).success,false);
  const complete={...partial,throughSeq:201,complete:true,nextCursor:null,resumeCursor:cursor};assert.ok(intentHistoryPageV1Schema.safeParse(complete).success);
});
test('history query is an opaque continuation only; callers cannot choose other private scopes or source frontier',()=>{
  assert.ok(intentHistoryQueryV1Schema.safeParse({}).success);assert.ok(intentHistoryQueryV1Schema.safeParse({cursor}).success);
  for(const bad of [{cursor:'private'},{cursor,ownerId:'bob'},{cursor,worldId:'other'},{cursor,fromSeq:100},{cursor,limit:100}])assert.equal(intentHistoryQueryV1Schema.safeParse(bad).success,false);
});
