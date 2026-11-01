// New revisions opt into the native item clock; frozen predecessors keep their bytes.
import { SWITCHABLE_LIGHTS } from './switchable-lights.ts';
import kitchen from './kitchen.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
export const PORTABLE_ITEMS:DefInput[] = [
  {...structuredClone(SWITCHABLE_LIGHTS.find(d=>d.name==='core-lantern')!),version:3},
  {...structuredClone(kitchen.find(d=>d.name==='core-bowl')!) as unknown as DefInput,version:2},
].map(d=>({...d,tags:[...(d.tags??[]),'recorded-item']}));
