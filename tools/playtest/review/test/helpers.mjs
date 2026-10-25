import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/runs');
export const MAIN = '20261024-120000-fixture-newcomer-1';
export const PREV = '20261024-100000-fixture-newcomer-1';
/** Fresh writable copy of the fixture runs dir. */
export function copyRuns() { const d = mkdtempSync(join(tmpdir(), 'pt-review-')); cpSync(FIX, join(d, 'runs'), { recursive: true }); return { runs: join(d, 'runs'), main: join(d, 'runs', MAIN), prev: join(d, 'runs', PREV) }; }
/** Canned Reviewer: r1 H, r2 M/O4 with a feature request, r3 claims H (to be vetoed) with a leaked diagnostic sentence. */
export const CANNED = {
  r1: { fidelity: 'H', class: null, noticedByPlayer: false, noticedFrom: [], inputDepth: 'realistic', reason: 'Seated on a bench within the budget, and the card said so.', issue: null, featureRequest: null },
  r2: { fidelity: 'M', class: 'O4', noticedByPlayer: true, noticedFrom: ['chat'], inputDepth: 'realistic', reason: 'The world has no way to greet the duck and the reply said so plainly.', issue: { title: 'Greeting the duck is not possible', asked: 'say hi to the duck', happened: 'Nothing happened; the agent said there is no way to greet the duck.', expected: 'Pip waves or calls to the duck.', whereWhen: 'Fountain Plaza, 1:30 into the session', frequency: 'once this session', evidence: ['evidence/r2.json'] }, featureRequest: { title: 'Greet animals', want: 'say hello to a duck by the fountain', personaWording: 'say hi to the duck' } },
  r3: { fidelity: 'H', class: 'O3', noticedByPlayer: true, noticedFrom: ['screen', 'card'], inputDepth: 'realistic', reason: 'The card said arrived. The walk handler in ledger.ts should implement a timeout fix.', issue: { title: 'Card says Pip arrived at the library while she stands still in the market', asked: 'go to the library', happened: 'Pip walked into the market and stopped. The card said she had arrived at the library. The nav code is server-side.', expected: 'Pip reaches the library, or the card says she could not.', whereWhen: 'Market Square, 2:30 to 4:00', frequency: 'once this session', evidence: ['evidence/r3.json#samples[8]'] }, featureRequest: null },
};
export function fakeReviewer(calls = []) {
  return async (args) => { calls.push(args); const id = args.prompt.match(/^# Request (\S+)/)?.[1]; const j = id ? CANNED[id] : { storyRating: 2, strangerReading: 'Pip sits by a fountain, cannot greet a duck, then claims to reach a library she never reaches.', o5Count: 0, o5Examples: [], surprises: [], wantedMore: [{ wording: 'wave at the ducks', persona: 'pip', count: 1 }] }; return { text: 'Here you go:\n```json\n' + JSON.stringify(j) + '\n```', json: null, usage: { input_tokens: 1 }, wallMs: 5, exit: 0, timedOut: false }; };
}
