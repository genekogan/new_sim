import type { ActionDef } from '../actions/types.ts';
import { raiseUpright } from './raise.ts';
import { connectBeam, releaseSupport } from './beam.ts';
export { RULES_VERSION } from './rules.ts';
export { uprightsSupported } from './invariants.ts';
export const CONSTRUCTION_ACTIONS: ActionDef[] = [raiseUpright, connectBeam, releaseSupport];
