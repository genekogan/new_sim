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
    year: z.number().int().min(2020).max(2026).optional(),
    units: z.literal('metres').optional(),
    up: z.literal('Y').optional(),
    edits: z.array(editSchema).max(20000),
  })
  .strict();
export function validateLayout(
  data: unknown,
  baseline: Set<string>,
  stock: Set<string>,
  year = 2026,
) {
  const layout = layoutSchema.parse(data),
    ids = new Set<string>();
  if ((layout.year ?? 2026) !== year) throw Error(`This layout belongs to Mars ${layout.year ?? 2026}, not ${year}`);
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
