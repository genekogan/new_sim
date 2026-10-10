import { readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  id: z.enum(['toy', 'mars', 'littlemartians', 'eden']), worldId: z.string(), name: z.string(),
  engine: z.enum(['toy', 'mars']), capabilities: z.array(z.string()), dayTicks: z.literal(72000),
  scene: z.string(), customs: z.array(z.string()),
  cast: z.array(z.object({ name: z.string(), description: z.string() })), cardPack: z.string(),
});
export function worldDefinition(key: string) {
  // Entity worlds (any other slug) start as an empty green field with no cast; their content is placed by the god.
  if (!['toy', 'mars', 'littlemartians', 'eden'].includes(key)) return { id: 'eden' as const, worldId: `${key}-1`, name: key, engine: 'mars' as const, capabilities: ['humanoid'], dayTicks: 72000 as const, scene: 'greenfield', customs: [] as string[], cast: [] as { name: string; description: string }[], cardPack: 'idle' };
  return schema.parse(JSON.parse(readFileSync(new URL(`../../../worlds/${key}/world.json`, import.meta.url), 'utf8')));
}
