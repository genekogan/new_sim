import type { Scenario } from './scenarios.ts';
import { Runtime } from '../../engine/runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../../engine/api/registry.ts';
import { gardenCareWorld, gardenCareScene } from '../../engine/scenarios/garden-care.ts';
import { musicGatheringRuntime } from '../../engine/scenarios/music-gathering.ts';
import { READING_SCENE } from '../../engine/scenarios/reading.ts';
const checks: Scenario['expect'] = rt => [{ok: rt.violations.length === 0, message: `authoritative invariant violations: ${rt.violations.length}`}];
export const LIVING_OBJECT_SCENARIOS: Scenario[] = [
  {name:'garden-care',title:'Garden care · finite water (hypothetical)',description:'Choose either planter and request care. Play watches approach, actual water deposits and return of the same bowl. Pause safely, resume retained deposits or direct the carer elsewhere. Two cycles per planter exhaust the finite supply; no growth or automatic refill.',scene:gardenCareScene,humans:()=>[],build:()=>{const w=gardenCareWorld();return new Runtime(w,createRegistry(),servicesFor({[w.base.campus]:gardenCareScene()})(w),ENGINE_INVARIANTS);},start:()=>{},continuous:true,maxTicks:36000,focus:[0,0,10,70],expect:checks},
  {name:'music-dance',title:'Music and grounded dancing (hypothetical)',description:'Start the gathering, invite a late dancer, withdraw individual participants, pause and resume the same digital score. Planted-foot dance gestures use reserved clear floor positions. No locomoting dance, imported music or arbitrary choreography.',scene:()=>READING_SCENE,humans:()=>[],build:()=>musicGatheringRuntime(),start:()=>{},continuous:true,maxTicks:36000,focus:[-1,0,10,65],expect:checks},
];
