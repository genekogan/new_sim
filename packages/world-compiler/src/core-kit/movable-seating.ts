import furniture from './furniture.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';

/** New opt-in revisions reuse native upright transport; frozen @1 seats stay fixed. */
export const MOVABLE_SEATING: DefInput[] = [
  {name:'core-chair', mass:8},
  {name:'core-armchair', mass:22},
].map(({name,mass}) => {
  const def=structuredClone(furniture.find(d=>d.name===name)!) as unknown as DefInput;
  return {...def,version:2,tags:[...(def.tags??[]),'upright-carry','front-seat'],
    description:`${def.description} Movable with two hands when unoccupied; still a usable seat wherever safely placed.`,
    components:{...def.components,carryable:{mass,grips:2}}};
});
