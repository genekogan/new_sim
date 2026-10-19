// Shared conversion: the workbench and define-kit must admit exactly the same definition.
// Kit keys kitDefinition reads: into make.args, into the def itself, or to build the def's name/size/layer.
const ARG_KEYS = ['v', 'footprint', 'gait', 'slots', 'round', 'surfaces'];
const DEF_KEYS = ['components', 'anchor', 'state', 'params', 'actions', 'category', 'synonyms', 'material', 'palette', 'tilt', 'overlaps', 'contents', 'layers'];
const OWN_KEYS = ['schema', 'name', 'version', 'description', 'tags', 'layer', 'shapes', 'box', 'scale'];
/** Top-level kit keys that kitDefinition does not carry into the def (reported, never silently dropped). */
export function kitIgnoredKeys(k) {
  if (!k || typeof k !== 'object' || k.schema === 'def/1') return [];
  return Object.keys(k).filter(key => ![...ARG_KEYS, ...DEF_KEYS, ...OWN_KEYS].includes(key));
}
export function kitDefinition(k) {
  if (k?.schema === 'def/1') return k;
  if (!k?.name || !Array.isArray(k.shapes)) throw Error('kit needs {name, shapes:[…]} or a def/1 definition');
  // K2 programs and endpoint shapes are expanded and bounded on the server; without a box the server measures them (kitlenient).
  const program = !k.box && k.shapes.some(s => s?.kind === 'arch.pointed' || ['repeat', 'radial', 'mirror', 'from', 'to', 'outline'].some(key => s?.[key] !== undefined) || JSON.stringify(s).includes('$'));
  const ext = sh => { const [x, y, z] = sh.at; const sz = sh.size ?? [2 * (sh.r ?? .5), sh.h ?? 2 * (sh.r ?? .5), 2 * (sh.r ?? .5)]; return [x - sz[0] / 2, y - (['box', 'rbox', 'sphere', 'capsule'].includes(sh.kind) ? sz[1] / 2 : 0), z - sz[2] / 2, x + sz[0] / 2, y + sz[1], z + sz[2] / 2]; };
  const e = k.box || program ? [] : k.shapes.map(ext);
  const box = k.box ?? (program ? undefined : [Math.max(...e.map(b => b[3])) - Math.min(...e.map(b => b[0])), Math.max(...e.map(b => b[4])), Math.max(...e.map(b => b[5])) - Math.min(...e.map(b => b[2]))].map(v => Math.max(.05, Math.round(v * 100) / 100)));
  const args = { shapes: k.shapes };
  for (const key of ARG_KEYS) if (k[key] !== undefined) args[key] = k[key]; // Y1: + surfaces
  const def = { schema: 'def/1', name: k.name, version: k.version ?? 1, description: k.description ?? '', tags: k.tags ?? [], form: 'point', layer: k.layer ?? 'solid', make: { kind: 'gen', gen: 'kit/2', args }, size: { ...(box ? { box } : {}), scale: k.scale ?? [.5, 2] } };
  for (const key of DEF_KEYS) if (k[key] !== undefined) def[key] = k[key]; // kitlenient: actions and other def/1 fields were dropped
  return def;
}
