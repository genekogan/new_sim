// Node-only helper: read the generated campus scene from public/engine.
// Kept out of load.ts/world.ts so the engine core stays fs-free (browser, DO).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CampusSceneFile } from './types.ts';

export const CAMPUS_2026_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/engine/campus-2026.json');

let cached: CampusSceneFile | undefined;

export function readCampus2026File(file = CAMPUS_2026_PATH): CampusSceneFile {
  if (file === CAMPUS_2026_PATH && cached) return cached;
  const f = JSON.parse(readFileSync(file, 'utf8')) as CampusSceneFile;
  if (file === CAMPUS_2026_PATH) cached = f;
  return f;
}
