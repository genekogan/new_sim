import { z } from 'zod';
const finite = z.number();
const position = z.tuple([
  finite.min(-10000).max(10000),
  finite.min(-1000).max(10000),
  finite.min(-10000).max(10000),
]);
const transformSchema = z.object({
  position,
  quaternion: z
    .tuple([finite, finite, finite, finite])
    .refine(
      (q) => Math.abs(Math.hypot(...q) - 1) < 0.01,
      'Quaternion must be normalized',
    ),
  scale: z.tuple([
    finite.min(0.001).max(1000),
    finite.min(0.001).max(1000),
    finite.min(0.001).max(1000),
  ]),
});
export const editSchema = transformSchema
  .extend({
    id: z.string().min(1).max(180),
    added: z.string().min(1).max(180).optional(),
    children: z
      .array(
        transformSchema
          .extend({
            path: z.array(z.number().int().min(0).max(20000)).min(1).max(100),
          })
          .strict(),
      )
      .max(20000)
      .optional(),
  })
  .strict();
export type Edit = z.infer<typeof editSchema>;
const layoutSchema = z
  .object({
    schema_version: z.literal(1),
    base_model: z.literal('mars-campus-modular-v1'),
    year: z.number().int().min(2020).max(2027).optional(),
    units: z.literal('metres').optional(),
    up: z.literal('Y').optional(),
    edits: z.array(editSchema).max(20000),
  })
  .strict();
/** Frozen legacy→stable id table (app/history/id-migration.json, HISTORY_IDS.md). */
export type IdMigration = {
  schema: 'mars-history-id-migration/1';
  years: Record<string, Record<string, { start: number; ids: (string | null)[] }>>;
};
/** Stable id for a legacy build-order id `${assembly}-${serial}` in `year`, if known. */
export function legacyId(table: IdMigration, year: number, id: string) {
  const m = /^(.*)-(\d+)$/.exec(id),
    run = m && table.years[String(year)]?.[m[1]];
  if (!m || !run) return undefined;
  const suffix = run.ids[Number(m[2]) - run.start];
  return suffix ? `${m[1]}-${suffix}` : null;
}
/**
 * Rewrites legacy historical ids in place. Ids already in the baseline are kept; a
 * legacy-shaped id that cannot be mapped to a baseline component is dropped with a
 * warning so old layouts still load. Anything else is left for validation to reject.
 */
export function migrateLayoutIds(
  layout: { edits: Edit[] },
  year: number,
  baseline: Set<string>,
  table: IdMigration,
  warn: (message: string) => void = console.warn,
) {
  const mapped = (id: string) => {
    if (baseline.has(id)) return id;
    const next = legacyId(table, year, id);
    if (next === undefined) return id;
    if (next && baseline.has(next)) return next;
    warn(`Layout: legacy Mars ${year} component id ${id} has no stable equivalent; edit dropped`);
    return null;
  };
  layout.edits = layout.edits.flatMap((e) => {
    if (e.added?.startsWith('copy:')) {
      const source = mapped(e.added.slice(5));
      return source ? [{ ...e, added: `copy:${source}` }] : [];
    }
    if (e.added) return [e];
    const id = mapped(e.id);
    return id ? [{ ...e, id }] : [];
  });
  return layout;
}
export function validateLayout(
  data: unknown,
  baseline: Set<string>,
  stock: Set<string>,
  year = 2026,
  migration?: IdMigration,
  warn?: (message: string) => void,
) {
  const layout = layoutSchema.parse(data),
    ids = new Set<string>();
  if ((layout.year ?? 2026) !== year) throw Error(`This layout belongs to Mars ${layout.year ?? 2026}, not ${year}`);
  if (migration) migrateLayoutIds(layout, year, baseline, migration, warn);
  let additions = 0;
  for (const e of layout.edits) {
    if (ids.has(e.id)) throw Error(`Duplicate layout ID: ${e.id}`);
    ids.add(e.id);
    if (e.children && !e.added)
      throw Error('Nested transforms are only valid for additions');
    if (e.added) {
      if (++additions > 300)
        throw Error('A layout can contain at most 300 proposed additions');
      if (baseline.has(e.id))
        throw Error('An addition cannot replace a baseline component ID');
      if (
        !stock.has(e.added) &&
        !(e.added.startsWith('copy:') && baseline.has(e.added.slice(5)))
      )
        throw Error(`Unknown component definition: ${e.added}`);
    } else if (!baseline.has(e.id))
      throw Error(`Unknown baseline component: ${e.id}`);
  }
  return layout;
}
