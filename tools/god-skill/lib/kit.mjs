// Shared conversion: the workbench and define-kit must admit exactly the same definition.
export function kitDefinition(k) {
  if (k?.schema === 'def/1') return k;
  if (!k?.name || !Array.isArray(k.shapes)) throw Error('kit needs {name, shapes:[…]} or a def/1 definition');
  // K2 programs and endpoint shapes are expanded and bounded on the server.
  if (!k.box && k.shapes.some(s => s.kind === 'arch.pointed' || ['repeat', 'radial', 'mirror', 'from', 'to', 'outline'].some(key => s[key] !== undefined) || JSON.stringify(s).includes('$'))) throw Error('define-kit programs need box:[width,height,depth] in metres; the server validates the expanded geometry');
  const ext = sh => { const [x, y, z] = sh.at; const sz = sh.size ?? [2 * (sh.r ?? .5), sh.h ?? 2 * (sh.r ?? .5), 2 * (sh.r ?? .5)]; return [x - sz[0] / 2, y - (['box', 'rbox', 'sphere', 'capsule'].includes(sh.kind) ? sz[1] / 2 : 0), z - sz[2] / 2, x + sz[0] / 2, y + sz[1], z + sz[2] / 2]; };
  const e = k.box ? [] : k.shapes.map(ext);
  const box = k.box ?? [Math.max(...e.map(b => b[3])) - Math.min(...e.map(b => b[0])), Math.max(...e.map(b => b[4])), Math.max(...e.map(b => b[5])) - Math.min(...e.map(b => b[2]))].map(v => Math.max(.05, Math.round(v * 100) / 100));
  const args = { shapes: k.shapes };
  for (const key of ['v', 'footprint', 'gait', 'slots', 'round', 'surfaces']) if (k[key] !== undefined) args[key] = k[key]; // Y1: + surfaces
  const def = { schema: 'def/1', name: k.name, version: k.version ?? 1, description: k.description ?? '', tags: k.tags ?? [], form: 'point', layer: k.layer ?? 'solid', make: { kind: 'gen', gen: 'kit/2', args }, size: { box, scale: k.scale ?? [.5, 2] } };
  for (const key of ['components', 'anchor', 'state', 'params']) if (k[key] !== undefined) def[key] = k[key];
  return def;
}
