// Reuse the proven desk-lamp actuator contract; frozen v1 definitions remain byte-identical.
import furniture from './furniture.json' with { type: 'json' };
import props from './props.json' with { type: 'json' };
import vocab from './vocab.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';
const switches = (vocab.find(d => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!;
export const SWITCHABLE_LIGHTS: DefInput[] = [
  [furniture.find(d => d.name === 'core-floor-lamp')!, 'floor lamp'],
  [props.find(d => d.name === 'core-lantern')!, 'lantern'],
].map(([input, label]) => {
  const def = structuredClone(input) as unknown as DefInput;
  return { ...def, version: 2, description: `${def.description} Souls can switch it on and off.`,
    actions: switches.map(a => ({ ...structuredClone(a), label: a.label.replace('desk lamp', String(label)) })) };
});
