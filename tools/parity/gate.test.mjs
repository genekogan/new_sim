import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './gate.mjs';
test('missing, unknown and failed evidence cannot move a world', () => {
  assert.equal(verdict({}).mayMove, false);
  const frames=[['overview','overview'],['inside-a','interior'],['inside-b','interior'],['dusk','time'],['night','time']];
  const state={datetime:'2026-10-03T14:00:00'};
  const visual={status:'PASS',errors:[],coverage:{expectedPairs:10,actualPairs:10},pairs:frames.flatMap(([name,kind])=>[1,2].map(dpr=>({name,kind,dpr,status:'PASS',changedPixels:0,meanAbsoluteError:0,old:{state},candidate:{state}}))),hourly:Array.from({length:24},(_,hour)=>({hour,status:'PASS',old:state,candidate:state}))};
  const all = {content:{status:'PASS'},visual,behaviour:{status:'PASS'},provenance:{liveSourceAndHistory:true}};
  assert.equal(verdict(all).mayMove, true);
  for (const key of ['content','visual','behaviour']) {
    assert.equal(verdict({...all,[key]:{status:'UNKNOWN'}}).mayMove, false);
    assert.equal(verdict({...all,[key]:{status:'FAIL'}}).mayMove, false);
  }
  assert.equal(verdict({...all,provenance:{}}).mayMove, false);
  assert.equal(verdict({...all,visual:{status:'PASS'}}).mayMove,false);
  assert.equal(verdict({...all,visual:{...visual,hourly:visual.hourly.slice(0,23)}}).mayMove,false);
  assert.equal(verdict({...all,visual:{...visual,pairs:visual.pairs.filter(p=>p.dpr===1)}}).mayMove,false);
});
