// SCHEMA.md from GET /v1/god/schema (pure; the CLI's `schema --md` and the server's /god/SCHEMA.md use it).
export function schemaMarkdown(s) {
  const L = ['# SCHEMA — the vocabulary of this world (generated from GET /v1/god/schema)', '', `contract ${s.contract}. Regenerate: \`node eden-god.mjs schema --md > SCHEMA.md\`.`, '', '## Conventions', ...Object.entries(s.conventions).map(([k, v]) => `- **${k}**: ${v}`), ''];
  L.push('## Generators (what defs are made of; `params` with range and default)');
  for (const g of s.generators) { L.push(`### ${g.id} (${g.form}${g.owner ? `, ${g.owner}` : ''})`, g.doc); const ps = Object.entries(g.params); if (ps.length) L.push(...ps.map(([k, f]) => `- \`${k}\` ${f.type}${f.values ? ` ${f.values.join('|')}` : ''}${f.min !== undefined ? ` ${f.min}…${f.max}` : ''}${f.default !== undefined ? ` = ${typeof f.default === 'object' ? JSON.stringify(f.default) : f.default}` : ''}${f.doc ? ` — ${f.doc}` : ''}`)); L.push(''); }
  L.push('## Kit primitives (define-kit shapes)', `kinds: ${s.kit.primitives.join(', ')}`, `roles (animation pivots): ${s.kit.roles.join(', ')}`, '');
  const shapeProps = s.kit.args?.properties?.shapes?.items?.properties; if (shapeProps) L.push('shape fields: ' + Object.entries(shapeProps).map(([k, f]) => `\`${k}\`${f.enum ? '' : f.type ? ` (${f.type})` : ''}`).join(', '), '');
  const gaits = s.kit.args?.properties?.gait?.enum; if (gaits) L.push(`gaits: ${gaits.join(', ')}`, '');
  L.push('## Ops', ...(s.ops.oneOf ?? s.ops.anyOf ?? []).map((o) => `- \`${o.properties?.op?.const}\`: ${Object.keys(o.properties ?? {}).filter((k) => k !== 'op').join(', ')}`), '');
  L.push('## Constraints (persistent relations on entities)', ...(s.constraints.oneOf ?? s.constraints.anyOf ?? []).map((o) => `- \`${o.properties?.kind?.const}\`: ${Object.keys(o.properties ?? {}).filter((k) => k !== 'kind').join(', ') || '—'}`), '');
  L.push('## Components', s.components.join(', '), '', '## Slot kinds', s.slotKinds.join(', '), '', '## Materials', s.materials.join(', '), '', '## Refusal codes', s.refusals.join(', '), '');
  L.push('## Endpoints', ...Object.entries(s.endpoints).map(([k, v]) => `- ${k}: ${v.join(' · ')}`), '');
  return L.join('\n');
}

