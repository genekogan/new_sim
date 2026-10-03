// Byte-exact source-era camera geometry; not a claim about the current museum.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashOf } from '../core/hash.ts';
import type { CampusYearFile } from '../campus/history.ts';
export function sourceEra2024File(): CampusYearFile {
  const bytes = readFileSync(new URL('./fixtures/campus-history-pre-review-7648dbf/campus-2024.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'c595c89162caa1d5e552e19ff1ca2670266172294c4e64b2adace09c0b2bb462');
  const file = JSON.parse(bytes.toString()) as CampusYearFile;
  const { contentHash, ...rest } = file;
  assert.equal(hashOf(rest), contentHash);
  return file;
}
