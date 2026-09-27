import type { ActionDef } from '../actions/types.ts';
import { raiseUpright } from './raise.ts';
import { connectBeam, releaseSupport } from './beam.ts';
import { installJoist, installPlywood } from './deck.ts';
import { installStairFlight, installTread } from './stairs.ts';
export { RULES_VERSION } from './rules.ts';
export { uprightsSupported } from './invariants.ts';
export { progressiveContributor, progressiveSupported } from './contributor.ts';
export const CONSTRUCTION_ACTIONS: ActionDef[] = [raiseUpright, connectBeam, releaseSupport, installJoist, installPlywood, installStairFlight, installTread];
