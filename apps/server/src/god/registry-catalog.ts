// Opt-in registry delivery for entity worlds. The native old-world path never constructs GodMode.
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Registry, RegistryCatalog, type Channel } from '@sim/catalog';

const shared = new Map<string, RegistryCatalog>();
export function registryCatalog(owner: string | null, dir = process.env.CATALOG_REGISTRY_DIR): RegistryCatalog | null {
  if (!dir) return null;
  const root = resolve(dir), channel = process.env.CATALOG_CHANNEL ?? 'stable';
  if (!['stable', 'candidate'].includes(channel)) throw new Error('CATALOG_CHANNEL must be stable or candidate');
  if (!existsSync(join(root, 'channels.json'))) throw new Error('CATALOG_REGISTRY_DIR must contain a published registry');
  // A specific verified owner id is an operator setting. Admin/dev roles alone never grant restricted art.
  const ownerIsGene = !!process.env.CATALOG_GENE_OWNER_ID && owner === process.env.CATALOG_GENE_OWNER_ID;
  const key = JSON.stringify([root, channel, ownerIsGene]);
  let catalog = shared.get(key);
  if (!catalog) {
    catalog = new RegistryCatalog(new Registry(root), { channel: channel as Channel, ownerIsGene, pollMs: 5000 });
    shared.set(key, catalog);
  }
  return catalog;
}
