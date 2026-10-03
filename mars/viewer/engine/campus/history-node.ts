// Node-only helper: read a generated historical campus year from public/engine.
// Kept out of history.ts so the engine core stays fs-free (browser, DO).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CampusYearFile } from './history.ts';

export const campusYearPath = (year: number) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../public/engine/campus-${year}.json`);

const cache = new Map<number, CampusYearFile>();

export function loadCampusFile(year: number): CampusYearFile {
  let f = cache.get(year);
  if (!f) {
    f = JSON.parse(readFileSync(campusYearPath(year), 'utf8')) as CampusYearFile;
    cache.set(year, f);
  }
  return f;
}
