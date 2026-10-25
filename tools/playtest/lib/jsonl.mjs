import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function appendJsonl(file, obj) { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(obj) + '\n'); }
export function readJsonl(file) { if (!existsSync(file)) return []; return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { _unparsed: l }; } }); }
export function writeJson(file, obj) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(obj, null, 1) + '\n'); }
export function readJson(file, fallback = null) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } }
