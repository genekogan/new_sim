// catalog-contract/1: what the engine understands, pinned (CATALOG-PROGRAM (c) "a pinned contract"). The catalogue
// depends on this, not on engine internals; an item that needs anything outside it fails G1 with capability.unknown and
// waits as blocked:capability for the engine trunk. `catalog contract --write` regenerates contract.json from the
// engine; contract.test.ts fails when the committed file drifts from the engine (so a change is a reviewed diff).
import { readFileSync } from 'node:fs';
import { GENERATORS, slotKind, materialEnum } from '@sim/generators';
import { componentsSchema, vocab } from '@sim/world-compiler';
import { ACTUATOR_KINDS } from './schema.ts';

export type Contract = {
  schema: 'catalog-contract/1';
  defSchemas: string[];
  generators: string[];
  components: string[];
  slotKinds: string[];
  actuators: string[];
  materials: string[];
  categories: number;
  triClasses: Record<string, number>;
  classLimits: { drawsBelowBuilding: number; materials: number; defBytes: number; glbBytes: number; lod1AboveTris: number };
};

/** Budgets that are policy, not engine facts (CATALOG-PROGRAM (b) "Runtime cost per placed thing"). */
export const CLASS_LIMITS: Contract['classLimits'] = { drawsBelowBuilding: 4, materials: 4, defBytes: 16_384, glbBytes: 2_000_000, lod1AboveTris: 5_000 };
const BIG = ['building', 'public', 'transport', 'terrain', 'water'];
/** Categories exempt from the per-item draw/material cap (whole buildings, roads, landforms). */
export const bigClass = (cat: string) => BIG.some((c) => cat === c || cat.startsWith(c + '.'));

export function engineContract(): Contract {
  const tri: Record<string, number> = {};
  for (const c of ['living', 'building', 'vehicle', 'public', 'transport', 'terrain', 'water', 'utility', 'component', 'vegetation', 'furniture', 'object', 'layer']) tri[c] = vocab.triBudget(c);
  return {
    schema: 'catalog-contract/1',
    defSchemas: ['def/1', 'def/2'],
    generators: Object.keys(GENERATORS).sort(),
    components: Object.keys(componentsSchema.shape).sort(),
    slotKinds: [...slotKind.options].sort(),
    actuators: [...ACTUATOR_KINDS],
    materials: [...materialEnum.options].sort(),
    categories: vocab.TAXONOMY.length,
    triClasses: tri,
    classLimits: CLASS_LIMITS,
  };
}
export const CONTRACT_FILE = new URL('../contract.json', import.meta.url);
export function loadContract(): Contract { return JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract; }
