import { createHash, randomBytes } from 'node:crypto';
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newIdentity = () => 'agent-' + randomBytes(12).toString('hex');
/** Deterministic PRNG (mulberry32) so a seeded scenario replays the same choices. */
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
