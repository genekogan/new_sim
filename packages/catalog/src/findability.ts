// G5: item words and held-out intents, plus every existing first-hit word and the standing regression eval.
// Held-out text never enters the index. Legacy misses are measured, never silently declared green.
import { buildLexicalIndex, lexical, type Doc } from './embed.ts';
import type { Item1 } from './schema.ts';
import type { GateOutcome } from './gates.ts';

export type Intent = { q: string; any: string[] };
const refOf = (item: Item1) => `${item.id}@${item.major}`;
const docOf = (item: Item1): Doc => ({ id: refOf(item), title: item.text.title, synonyms: item.text.synonyms,
  category: item.text.category, affords: item.affords, first: item.text.first, description: item.text.description });
export function itemFinder(items: Item1[]) {
  const index = buildLexicalIndex([...items].sort((a, b) => refOf(a).localeCompare(refOf(b))).map(docOf));
  return (q: string, k = 3) => lexical(index, q).slice(0, k).map((h) => index.ids[h.i]);
}

export function g5(item: Item1, existing: Item1[], intents: Intent[] = []): GateOutcome {
  const errors: string[] = [], warnings: string[] = [], ref = refOf(item);
  const before = itemFinder(existing), after = itemFinder([...existing.filter((it) => refOf(it) !== ref), item]);
  const required = [item.text.title, ...item.text.synonyms.slice(0, 2)];
  for (const q of required) if (after(q, 1)[0] !== ref) errors.push(`first-hit: ${JSON.stringify(q)} gives ${after(q, 1)[0] ?? 'no result'}, expected ${ref}`);
  if (item.text.synonyms.length < 2) errors.push('findability requires two synonyms');
  if (item.text.heldOut.length < 2) errors.push('findability requires two held-out intents');
  const indexedText = [item.text.title, ...item.text.synonyms, item.text.first, item.text.description].join('\n').toLowerCase();
  for (const q of item.text.heldOut) {
    if (!q.trim() || indexedText.includes(q.trim().toLowerCase())) errors.push(`held-out: ${JSON.stringify(q)} is empty or already in indexed text`);
    if (!after(q).includes(ref)) errors.push(`held-out: ${JSON.stringify(q)} misses ${ref} in the top three`);
  }
  const protectedWords = new Map<string, string>();
  for (const it of existing) for (const word of [it.text.title, ...it.text.synonyms]) {
    const winner = before(word, 1)[0];
    if (winner === refOf(it)) protectedWords.set(word, winner);
  }
  let regressions = 0;
  for (const [word, winner] of protectedWords) if (after(word, 1)[0] !== winner) {
    errors.push(`existing first-hit: ${JSON.stringify(word)} loses ${winner} to ${after(word, 1)[0] ?? 'no result'}`); regressions++;
  }
  let standingBefore = 0, standingAfter = 0;
  const hit = (refs: string[], intent: Intent) => refs.some((r) => intent.any.includes(r.replace(/@\d+$/, '')) || intent.any.includes(r));
  for (const intent of intents) {
    const was = hit(before(intent.q), intent), now = hit(after(intent.q), intent);
    if (was) standingBefore++; if (now) standingAfter++;
    if (was && !now) { errors.push(`standing eval: ${JSON.stringify(intent.q)} loses its top-three hit`); regressions++; }
  }
  if (intents.length && standingAfter / intents.length < 0.9) warnings.push('standing recall@3 below 90%; sentence-model evaluation remains needed');
  return { gate: 'G5', ok: !errors.length, errors, warnings, numbers: { requiredWords: required.length, heldOut: item.text.heldOut.length,
    protectedWords: protectedWords.size, regressions, standingIntents: intents.length, standingBefore, standingAfter,
    recallAt3: intents.length ? standingAfter / intents.length : 0 } };
}
