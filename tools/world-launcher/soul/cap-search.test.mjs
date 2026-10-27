import test from 'node:test';
import assert from 'node:assert/strict';
import {rankCapabilities} from './eden.mjs';
test('phrase and all terms beat unrelated west noise before truncation, retaining partial fallback',()=>{
 const noise=Array.from({length:90},(_,i)=>({id:`sit:west-library-${i}`,verb:'sit',label:'West library chair'}));
 const bound={id:'sit:land-harbour-west-pier/part-sea-view-seat',verb:'sit',label:'Sit at Sea-View Bench'};
 const allTerms={id:'walk:other',verb:'walk',label:'Pier on the west waterfront'};
 const ranked=rankCapabilities([...noise,allTerms,bound],'west pier');
 assert.equal(ranked[0],bound);assert.equal(ranked[1],allTerms);assert.equal(ranked.length,92);
 assert.equal(rankCapabilities([...noise,bound],'west.pier|pier.bench').length,0,'literal matching does not pretend to support regex');
 assert.equal(rankCapabilities([bound],'sea view')[0],bound);
});
