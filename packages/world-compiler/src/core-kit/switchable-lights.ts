// Reuse the proven desk-lamp actuator contract; frozen v1 definitions remain byte-identical.
import furniture from './furniture.json' with { type: 'json' };
import props from './props.json' with { type: 'json' };
import vocab from './vocab.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';
const switches = (vocab.find(d => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!;
export const SWITCHABLE_LIGHTS: DefInput[] = [
  [furniture.find(d => d.name === 'core-floor-lamp')!, 'floor lamp', [0, 1.56, 0]],
  [props.find(d => d.name === 'core-lantern')!, 'lantern', [0, .17, 0]],
].map(([input, label, lightAt]) => {
  const def = structuredClone(input) as unknown as DefInput;
  return { ...def, version: 2, description: `${def.description} Souls can switch it on and off.`,
    components: { ...def.components, light: { ...def.components!.light!, at: lightAt as [number, number, number] } },
    actions: switches.map(a => ({ ...structuredClone(a), label: a.label.replace('desk lamp', String(label)) })) };
});
