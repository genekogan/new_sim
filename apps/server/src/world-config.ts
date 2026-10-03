import { readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  id: z.enum(['toy', 'mars', 'littlemartians', 'eden']), worldId: z.string(), name: z.string(),
  engine: z.enum(['toy', 'mars']), capabilities: z.array(z.string()), dayTicks: z.literal(72000),
  scene: z.string(), customs: z.array(z.string()),
  cast: z.array(z.object({ name: z.string(), description: z.string() })), cardPack: z.string(),
});
export function worldDefinition(key: string) {
  if (!['toy', 'mars', 'littlemartians', 'eden'].includes(key)) throw new Error('unknown world');
  return schema.parse(JSON.parse(readFileSync(new URL(`../../../worlds/${key}/world.json`, import.meta.url), 'utf8')));
}
