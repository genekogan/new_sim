// Regression: nav source selection must not grow merely because yesterday's nav widened the raster.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld,CN5_PLACES,CN5_SPOTS,CN5_DISTRICT_SOLIDS,SOUTH_GROUND} from '../test/eden-nav-fixture.ts';
import {CN5_DISTRICT_GROUND} from './edge/ledger/districts.ts';
import {loadSpots} from './edge/ledger/activities.ts';
import {navSpecFromPlaces} from './edge/ledger/nav.ts';
import {accept} from '../test/native-owner-fixture.ts';
import {WorldHost} from './world.ts';

test('nav bootstrap source is invariant across installation and snapshot replay', {timeout:120000}, async t=>{
  const w=await edenNavWorld(0);t.after(()=>{w.f.host.stop();w.f.db.close();});
  const spots=loadSpots(CN5_SPOTS).data,extra=loadSpots(CN5_DISTRICT_SOLIDS).data.solids;
  const native=new Set([...Object.entries(w.engine.world.regions).filter(([,r])=>!String((r as {provenance?:{note?:string}}).provenance?.note??'').includes('placeRegionsV1')).map(([id])=>id),...CN5_PLACES.places.filter(p=>(p.occupiers??[]).length).map(p=>p.id)]);
  const build=(engine:any)=>navSpecFromPlaces(CN5_PLACES,{native,ground:[...SOUTH_GROUND,...CN5_DISTRICT_GROUND],area:[engine.nativeGroundBoundsV1()],extraSolids:[...spots.solids,...extra],rings:spots.rings,interiors:spots.interiors,platforms:spots.platforms});
  const before=build(w.engine),bounds=w.engine.nativeGroundBoundsV1();
  await accept(w.f.host,w.f.host.installNavV1(before));
  assert.notDeepEqual(w.engine.groundBoundsV1(),bounds,'raster expands for admitted ground');
  assert.deepEqual(build(w.engine),before,'source selection does not grow after expansion');
  const ruleCount=()=>w.f.db.db.prepare("SELECT count(*) AS n FROM events WHERE kind='rules' AND json_type(payload,'$.navV1')='object'").get() as {n:number};
  const count=ruleCount().n;
  assert.deepEqual(await accept(w.f.host,w.f.host.installNavV1(build(w.engine))),{installed:false});
  assert.equal(ruleCount().n,count,'no extra geometry event on second install');
  w.f.host.saveSnapshot(true);
  const restored=new WorldHost(w.f.db,w.fac,w.f.host.seed,1e9,w.f.host.worldId,{durableClockV1:true});t.after(()=>restored.stop());restored.boot();
  assert.deepEqual(build(restored.engine),before,'same immutable source after snapshot replay');
  assert.deepEqual(await accept(restored,restored.installNavV1(build(restored.engine))),{installed:false});
  assert.equal(ruleCount().n,count,'no extra geometry event after restart');
});
