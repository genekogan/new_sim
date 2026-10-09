import test from 'node:test';
import assert from 'node:assert/strict';
import {CandidateStationV1} from './station.ts';
import {generateCommonsCohort} from '../test/fixtures/commons-cohort/generate.ts';

test('actual commons fixture releases DB-reading maintenance before closing its SQLite connection',async t=>{
  const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
  const pending=new Map<ReturnType<typeof setInterval>,()=>void>();
  t.mock.method(globalThis,'setInterval',(callback:(...args:any[])=>void,ms?:number,...args:any[])=>{
    const handle=originalSet(callback,ms,...args);if(ms===60000)pending.set(handle,()=>callback(...args));return handle;
  });
  t.mock.method(globalThis,'clearInterval',(handle:ReturnType<typeof setInterval>)=>{pending.delete(handle);originalClear(handle);});
  const trace=await generateCommonsCohort(0,true,true,true);
  assert.equal(trace.residents,24);assert.equal(trace.reconstruction,'exact');assert.equal(trace.genesisReconstruction,'exact');
  // Execute the actual remaining callbacks, not a simulated DB exception. The
  // harmless pairing expiry may remain; no callback may use the closed DB.
  for(const callback of pending.values())callback();
});

test('commons fixture drains and releases maintenance on an actual setup rejection while preserving the error',async t=>{
  const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
  const pending=new Map<ReturnType<typeof setInterval>,()=>void>();
  t.mock.method(globalThis,'setInterval',(callback:(...args:any[])=>void,ms?:number,...args:any[])=>{const handle=originalSet(callback,ms,...args);if(ms===60000)pending.set(handle,()=>callback(...args));return handle;});
  t.mock.method(globalThis,'clearInterval',(handle:ReturnType<typeof setInterval>)=>{pending.delete(handle);originalClear(handle);});
  const failure=new Error('intentional station setup rejection');
  t.mock.method(CandidateStationV1.prototype,'record',async()=>{throw failure;});
  await assert.rejects(generateCommonsCohort(0,true,true,true),error=>error===failure);
  for(const callback of pending.values())callback();
});
