// VOCAB-MECH authoring: one call per catalogue type. kitDef (dsl.mjs) + the catalogue's category, synonyms,
// parameter conventions, variants and actuators. Guide: docs/god/VOCAB.md. Checked by build.mjs (vocab lint).
//
//   vocabDef({ name, category, synonyms, description, shapes, palette,
//              conventions: ['stretch', 'paint', 'wear'],          // default; add 'warp' for organic things
//              ranges: { sx: [0.7, 1.6] },                          // narrow a convention's range
//              variants: ['panel', 'glazed'],                       // `variant` enum; shapes carry when: 'variant=glazed'
//              actuators: ['door', 'lock'], label: 'the door',      // state + actions Souls can take
//              slots, components, params, state, tags, … })        // anything kitDef takes
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitDef } from './dsl.mjs';
import { actuators as makeActuators, conventions as conv, variant, CATEGORIES } from '../../vocab/index.ts';

export { conv as conventions, variant };
export function vocabDef({ category, synonyms = [], conventions = ['stretch', 'paint', 'wear'], ranges, variants, actuators, label, params = {}, state = {}, actions = [], tags = [], ...rest }) {
  if (!CATEGORIES.has(category)) throw new Error(`${rest.name}: category ${category} is not in vocab/taxonomy.json`);
  const a = actuators?.length ? makeActuators(actuators, { label: label ?? `the ${rest.name.replace(/-/g, ' ')}` }) : { state: {}, actions: [] };
  const def = kitDef({
    ...rest, tags: [...new Set([...category.split('.'), ...tags])],
    params: { ...conv(...conventions, ...(ranges ? [ranges] : [])), ...(variants ? variant(variants) : {}), ...params },
    state: { ...a.state, ...state }, actions: [...a.actions, ...actions].length ? [...a.actions, ...actions] : undefined,
  });
  def.category = category;
  if (synonyms.length) def.synonyms = synonyms;
  return def;
}
/** A def that is a configuration of an existing generator def (a building style, a road type): extends + new defaults. */
const kitDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let baseDefs;
const baseDef = (ref) => {
  baseDefs ??= readdirSync(kitDir).filter((f) => f.endsWith('.json') && f !== 'vocab.json').flatMap((f) => JSON.parse(readFileSync(resolve(kitDir, f), 'utf8')));
  const name = ref.replace(/^core\//, 'core-').replace(/@\d+$/, ''), d = baseDefs.find((x) => x.name === name);
  if (!d) throw new Error(`preset base ${ref} not found in core-kit/*.json`); return d;
};
/** `defaults` = { param: newDefault } (the base's field spec is kept, only its default changes); `size` defaults to the base's. */
export function presetDef({ name, base, category, synonyms = [], description, tags = [], defaults = {}, size, components, slots }) {
  const b = baseDef(base), params = {};
  for (const [k, v] of Object.entries(defaults)) { if (!b.params?.[k]) throw new Error(`${name}: ${base} has no param ${k}`); params[k] = { ...b.params[k], default: v }; }
  return { schema: 'def/1', name: `core-${name}`, version: 1, extends: base, description, tags: [...new Set([...category.split('.'), ...tags])], category, ...(synonyms.length ? { synonyms } : {}),
    form: b.form ?? 'point', make: { kind: 'none' }, params, ...(components ? { components } : {}), ...(slots ? { slots } : {}), size: size ?? b.size };
}
/** A set: several defs placed together as one (a café terrace, a bus stop with its bench and bin). Parts are entities. */
export function setDef({ name, category, synonyms = [], description, tags = [], parts, size, params = {} }) {
  return { schema: 'def/1', name: `core-${name}`, version: 1, description, tags: [...new Set([...category.split('.'), 'set', ...tags])], category, ...(synonyms.length ? { synonyms } : {}),
    form: 'point', make: { kind: 'parts', parts }, params, size };
}
