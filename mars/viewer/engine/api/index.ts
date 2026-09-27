// Public engine API: registry, controller facade, op schemas and MCP tool descriptors.
import { opDescriptions, opSchemas, type OpName } from './schemas.ts';
export * from './registry.ts';
export * from './schemas.ts';
export * from './controller.ts';
export * from './seeds.ts';

export const ENGINE_TOOL_PREFIX = 'engine_';

/** MCP tool descriptors generated from the controller op registry (name, description, zod input schema). */
export function engineTools() {
  return (Object.keys(opSchemas) as OpName[]).map((op) => ({
    op,
    name: `${ENGINE_TOOL_PREFIX}${op}`,
    description: `[engine preview] ${opDescriptions[op].description}`,
    inputSchema: opSchemas[op],
    readOnly: opDescriptions[op].readOnly,
  }));
}
