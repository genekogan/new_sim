// Manual check (uses the signed-in claude CLI, one real model call): one persona step on a fixture glance.
// node tools/playtest/director/real-step.mjs [sheet=newcomer] [fixture=fixtures/shown-newcomer-1.json] [runDir]
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersonaSession } from './persona.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const [sheet = 'newcomer', fixture = join(here, 'fixtures/shown-newcomer-1.json'), runDirArg] = process.argv.slice(2);
const runDir = runDirArg ? resolve(runDirArg) : mkdtempSync(join(tmpdir(), 'pt-real-step-'));
const shown = JSON.parse(readFileSync(fixture, 'utf8'));
shown.screenshotPath = resolve(dirname(fixture), shown.screenshotPath);
const p = PersonaSession({ runDir, seat: 'pip', sheet, model: process.env.PERSONA_MODEL ?? 'opus', setting: { worldName: 'Pttest', soulName: 'Pip' } });
const t0 = Date.now();
const d = await p.step({ shown });
console.log(JSON.stringify({ runDir, wallMs: Date.now() - t0, sessionId: p.sessionId, decision: d }, null, 1));
