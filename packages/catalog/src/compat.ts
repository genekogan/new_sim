import type { Def2 } from './schema.ts';

/** Mechanical major-version rules from CATALOG-PROGRAM (a). Existing worlds always retain their pinned hashes. */
export function compatibility(previous: Def2, next: Def2) {
  const breaks: string[] = [];
  for (const [name, old] of Object.entries(previous.params)) {
    const field = next.params[name];
    if (!field) { breaks.push(`param removed: ${name}`); continue; }
    if (field.type !== old.type) breaks.push(`param type: ${name}`);
    if ((old.type === 'number' || old.type === 'int') && (field.type === 'number' || field.type === 'int') && (field.min > old.min || field.max < old.max)) breaks.push(`param range narrowed: ${name}`);
    if (old.type === 'enum' && field.type === 'enum' && old.values.some((value) => !field.values.includes(value))) breaks.push(`param enum narrowed: ${name}`);
  }
  const removed = (label: string, old: string[], values: string[]) => { for (const name of old) if (!values.includes(name)) breaks.push(`${label} removed: ${name}`); };
  removed('slot', previous.slots.map((s) => s.id), next.slots.map((s) => s.id));
  removed('state', Object.keys(previous.state), Object.keys(next.state));
  removed('action', previous.actions.map((a) => a.name), next.actions.map((a) => a.name));
  removed('actuator', previous.actuators.map(([name]) => name), next.actuators.map(([name]) => name));
  for (let i = 0; i < 3; i++) if (Math.abs(next.size.box[i] - previous.size.box[i]) > Math.abs(previous.size.box[i]) * 0.1 + 1e-9) breaks.push(`box changed >10%: ${['x', 'y', 'z'][i]}`);
  if (previous.anchor !== next.anchor) breaks.push('anchor changed');
  if (previous.form !== next.form) breaks.push('form changed');
  return { compatible: !breaks.length, requiresMajor: !!breaks.length, breaks };
}
