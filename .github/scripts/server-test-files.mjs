// PR CI and its latency job must cover the complete recursive server test inventory.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const LATENCY_TEST = 'owner-response-milestones.test.ts';

export function serverTestFiles(src = 'apps/server/src') {
  const files = [];
  function visit(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(join(dir, entry.name), relative + '/');
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(relative);
    }
  }
  visit(src);
  return files.sort();
}

export function serverShardFiles(all, shard) {
  if (![0, 1].includes(shard)) throw Error('Invalid server shard');
  if (!all.includes(LATENCY_TEST)) throw Error('Expected latency test is missing');
  const files = all.filter(f => f !== LATENCY_TEST).filter((_, i) => i % 2 === shard);
  if (!files.length) throw Error('Empty server shard');
  return files.map(f => `src/${f}`);
}
