// Reviewer (spec §2.4, §2.7): QA/product triage. One model call per request plus one session call. It raises issues and
// feature requests in product language; it never names a cause, a code area, a fix or a plan (stripped + flagged here).
// Writes oracles.jsonl, reviews.jsonl, ledger.tsv, issues.{md,json}, feature-requests.{md,json}, desires.tsv, emergence.json.
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callModel as realCall, lastJson } from '../lib/claude-p.mjs';
import { appendJsonl, readJson, writeJson } from '../lib/jsonl.mjs';
import { sha256 } from '../lib/hash.mjs';
import { loadRun, projectEvidence, personaTurnsFor, chatExcerpt } from './run.mjs';
import { runOracles, oracleVetoes } from './oracles.mjs';
import { providerPolicy } from '../lib/provider-policy.mjs';
import { scrub } from './filter.mjs';
import { gather, computeEmergence } from './emergence.mjs';
import { renderJournal } from './journal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RUBRIC_PATH = join(HERE, 'RUBRIC.md');
export const rubricText = () => readFileSync(RUBRIC_PATH, 'utf8');
export const rubricHash = () => sha256(rubricText());
const SCORES = new Set(['H', 'P', 'M', 'W']);
const CLASSES = new Set(['O1', 'O2', 'O3', 'O4', 'O5']);

export const REVIEWER_ROLE = `You are the QA lead and product owner triaging one playtest session of Eden Sim, a shared 3D world in which each
player's own AI agent (a chat assistant) controls the player's character, called a Soul. Players ask their Soul for
things on two channels: the Soul's card on the world page, and the chat with their agent.

You review; you never diagnose. You may conclude exactly these things and nothing else:
1. fidelity: one of H, P, M, W for the request, strictly per the rubric below;
2. class: O1..O5 when the request was not a clean hit, else null;
3. noticedByPlayer: whether the player would have noticed the problem, and from what (screen, card, chat);
4. inputDepth: "realistic" when the problem is visible from the screen, the card or the chat alone (what a real user
   would see and could report); "debug" only when it needs positions, receipts, tool output or oracle results;
5. issue: when something failed, in the player's terms: what was asked, what happened, what was expected, where and
   when, how often, with evidence pointers;
6. featureRequest: when the player wanted something the world has no way to do, carrying the player's own wording.

You must never write a cause in the software, a component or area of the software, a file or function name, a fix,
a suggestion of what to build or change, a plan or a brief. Describe what happened, never why inside the software.
Do not use the words "code", "fix", "implement" or "server-side". Write plain product language a player would follow.

Oracle results are deterministic checks. A failing physical oracle means there is no physical evidence for a hit.
"unknown" means the check could not decide; it is never a pass. Facts after the cutoff are late diagnostics only.`;

export const REQUEST_CONTRACT = `Answer with one JSON object only, no prose around it:
{"fidelity":"H"|"P"|"M"|"W","class":"O1"|"O2"|"O3"|"O4"|"O5"|null,"noticedByPlayer":true|false,"noticedFrom":["screen"|"card"|"chat"],
 "inputDepth":"realistic"|"debug","reason":"one or two sentences",
 "issue":null|{"title":"in the player's terms","asked":"the exact request","happened":"…","expected":"…","whereWhen":"…","frequency":"…","evidence":["pointer",…]},
 "featureRequest":null|{"title":"short","want":"what the player wanted to do","personaWording":"their own words"}}`;

export const SESSION_CONTRACT = `Answer with one JSON object only:
{"storyRating":1-5,"strangerReading":"one paragraph: how this journal reads to a stranger (coherence, surprise, stakes)",
 "o5Count":n,"o5Examples":["…"],"surprises":["coherent things that happened that nobody asked for"],
 "wantedMore":[{"wording":"in the player's words","persona":"seat id","count":n}]}`;

export function requestPrompt(run, ev, oracles, { earlierTitles = [] } = {}) {
  const pts = personaTurnsFor(run, ev).map((t) => ({ turn: t.turn, atSec: Math.round((t.mono - ev.sentMono) / 1000), screenshot: t.shown ? join(run.runDir, 'personas', ev.seat, t.shown.replace(/\.json$/, '.png')) : null, ...t.decision }));
  const shots = (ev.shots ?? []).slice(0, 3).map((p) => join(run.runDir, p));
  return [
    `# Request ${ev.requestId} (seat ${ev.seat}, channel ${ev.channel})`, '', `The player asked: "${ev.text}"`, '',
    '## Realistic depth: what the player saw, said and felt',
    'The player\'s own turns (thought, rating, complaints, desires) after sending the request:', '```json', JSON.stringify(pts, null, 1), '```',
    'What the player could read in the chat with their agent:', '```', chatExcerpt(run, ev) || '(nothing in chat for this request)', '```',
    `Card ack: ${JSON.stringify(ev.ackText)} · Card/chat result: ${JSON.stringify(ev.resultText)}`,
    shots.length ? `Screenshots you may Read (what the screen showed): ${shots.join(' , ')}` : '',
    '', '## Debug depth (label any finding that needs this as inputDepth "debug")',
    'Evidence projection (times in seconds since the request was sent):', '```json', JSON.stringify(projectEvidence(run, ev)), '```',
    'Oracle results:', '```json', JSON.stringify(oracles.map(({ id, status, detail }) => ({ id, status, detail }))), '```',
    earlierTitles.length ? `Issues raised in earlier sessions of this scenario (for frequency): ${earlierTitles.map((t) => JSON.stringify(t)).join('; ')}` : '',
    '', REQUEST_CONTRACT,
  ].filter((x) => x !== '').join('\n');
}

const normTitle = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'not', 'was', 'with'].includes(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
const STOP = new Set(['i','a','an','the','to','and','or','but','he','she','it','him','her','his','its','my','me','just','so','at','in','on','of','for','was','is','be','that','this','there','then','even','still','when','not','no','never','like','wanted','want','asked','said','says','did','do','does','him','them','they','you','your','with','all','up','out','into','have','has','had','been','get','got','one','once','time','only','also','any','anything','something','nothing','pip','mira','rook','tam','ori','vex']);
const keywords = (t) => new Set(normTitle(t).filter((w) => w.length > 2 && !STOP.has(w)));
/** Two wishes are the same wish when their content words overlap enough (Jaccard ≥ 0.34, or ≥ 0.5 of the smaller set). */
export function similar(a, b) { const A = keywords(a), B = keywords(b); if (!A.size || !B.size) return false; let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); const j = n / (A.size + B.size - n); return j >= 0.34 || n / Math.min(A.size, B.size) >= 0.5 && n >= 2; }

/** Earlier runs of the same scenario in the runs dir (sorted by folder name, before this run). */
export function earlierRuns(runDir) {
  const parent = dirname(runDir), me = basename(runDir);
  const name = readJson(join(runDir, 'scenario.json'), {}).name;
  if (!existsSync(parent)) return [];
  return readdirSync(parent).filter((d) => d < me && readJson(join(parent, d, 'scenario.json'), {}).name === name).sort().map((d) => join(parent, d));
}

export function reproScenario(run, ev) {
  const s = run.scenario ?? {};
  return { name: `repro-${s.name ?? 'session'}-${ev.requestId}`, version: 1, world: s.world, durationSec: (ev.budgetSec ?? 180) + 30, seats: (s.seats ?? []).filter((x) => x.id === ev.seat), god: null, director: { mode: 'scripted', script: [{ seat: ev.seat, atSec: 5, channel: ev.channel, text: ev.text, budgetSec: ev.budgetSec ?? 180 }] }, observer: s.observer, review: s.review, rails: s.rails };
}

/** Coerce + scrub + veto one Reviewer answer. */
export function normalizeReview(raw, ev, oracles) {
  const j = raw && typeof raw === 'object' ? raw : {};
  const { value, leaked, hits } = scrub(j);
  const r = { requestId: ev.requestId, seat: ev.seat, channel: ev.channel, text: ev.text, fidelity: SCORES.has(value.fidelity) ? value.fidelity : 'unresolved', class: CLASSES.has(value.class) ? value.class : null, noticedByPlayer: !!value.noticedByPlayer, noticedFrom: Array.isArray(value.noticedFrom) ? value.noticedFrom : [], inputDepth: value.inputDepth === 'realistic' ? 'realistic' : 'debug', reason: value.reason ?? '', issue: value.issue ?? null, featureRequest: value.featureRequest ?? null, leaked, leakedHits: hits };
  const vetoes = oracleVetoes(oracles);
  if (r.fidelity === 'H' && vetoes.length) { r.vetoed = { by: vetoes, reviewerSaid: 'H' }; r.fidelity = 'P'; }
  if (!raw) r.harness = 'reviewer returned no JSON';
  return r;
}

const tsvCell = (v) => String(v ?? '').replace(/[\t\n]+/g, ' ');
export const LEDGER_COLS = ['requestId', 'seat', 'channel', 'text', 'fidelity', 'class', 'noticedByPlayer', 'inputDepth', 'vetoed', 'leaked', 'reason', 'evidence'];
export function ledgerTsv(reviews) {
  return [LEDGER_COLS.join('\t'), ...reviews.map((r) => [r.requestId, r.seat, r.channel, r.text, r.fidelity, r.class ?? '', r.noticedByPlayer, r.inputDepth, r.vetoed ? `H→P by ${r.vetoed.by.join(',')}` : '', r.leaked, r.reason, `evidence/${r.requestId}.json`].map(tsvCell).join('\t'))].join('\n') + '\n';
}

export function buildIssues(run, reviews, oraclesBy, earlier = []) {
  const issues = [];
  for (const r of reviews.filter((x) => x.issue)) {
    const ev = run.evidence.find((e) => e.requestId === r.requestId);
    const ptrs = [...new Set([...(r.issue.evidence ?? []), ...oraclesBy[r.requestId].filter((o) => o.status === 'fail').flatMap((o) => o.pointers), ...(ev.shots ?? [])])];
    const same = issues.find((i) => similar(i.title, r.issue.title));
    if (same) { same.requestIds.push(r.requestId); same.sessionCount++; same.evidence = [...new Set([...same.evidence, ...ptrs])]; continue; }
    const prior = earlier.filter((e) => e.issues.some((i) => similar(i.title, r.issue.title))).map((e) => basename(e.dir));
    issues.push({ id: `I-${issues.length + 1}`, title: r.issue.title, asked: r.issue.asked ?? ev.text, happened: r.issue.happened, expected: r.issue.expected, whereWhen: r.issue.whereWhen, frequency: r.issue.frequency, requestIds: [r.requestId], seat: r.seat, fidelity: r.fidelity, class: r.class, inputDepth: r.inputDepth, noticedByPlayer: r.noticedByPlayer, sessionCount: 1, earlierSessions: prior, evidence: ptrs, repro: reproScenario(run, ev), leaked: r.leaked });
  }
  return issues;
}

export function buildFeatureRequests(run, reviews) {
  const groups = [];
  const add = (title, want, wording, persona, requestId) => { const g = groups.find((x) => similar(x.title, title) || similar(x.want, want)); if (g) { g.count++; if (wording && !g.wordings.includes(wording)) g.wordings.push(wording); if (!g.personas.includes(persona)) g.personas.push(persona); if (requestId) g.requestIds.push(requestId); return; } groups.push({ id: `F-${groups.length + 1}`, title, want, wordings: wording ? [wording] : [], personas: [persona], requestIds: requestId ? [requestId] : [], count: 1 }); };
  reviews.filter((r) => r.featureRequest).forEach((r) => add(r.featureRequest.title, r.featureRequest.want, r.featureRequest.personaWording, r.seat, r.requestId));
  for (const [seat, p] of Object.entries(run.personas)) for (const d of p.desires) { const g = groups.find((x) => similar(x.want, d.text) || similar(x.title, d.text) || x.wordings.some((w) => similar(w, d.text))); if (g) { if (!g.wordings.includes(d.text)) g.wordings.push(d.text); if (!g.personas.includes(seat)) g.personas.push(seat); g.desireCount = (g.desireCount ?? 0) + 1; } else add(d.text, d.text, d.text, seat, null); }
  return groups.sort((a, b) => b.count - a.count);
}

export function issuesMd(issues) {
  const L = ['# Issues', '', 'Raised by the Reviewer (QA/product). Product language only: what was asked, what happened, what was expected. No causes, no fixes.', ''];
  if (!issues.length) L.push('None raised.');
  for (const i of issues) L.push(`## ${i.id}: ${i.title}`, '', `- **Asked:** "${i.asked}"`, `- **Happened:** ${i.happened}`, `- **Expected:** ${i.expected}`, `- **Where / when:** ${i.whereWhen}`, `- **How often:** ${i.frequency} (this session: ${i.sessionCount}; earlier sessions: ${i.earlierSessions.length ? i.earlierSessions.join(', ') : 'none'})`, `- **Score / class:** ${i.fidelity} / ${i.class ?? '—'} · noticed by the player: ${i.noticedByPlayer ? 'yes' : 'no'} · input depth: ${i.inputDepth}`, `- **Evidence:** ${i.evidence.map((p) => `\`${p}\``).join(', ')}`, `- **Repro:** scripted scenario in issues.json (\`${i.repro.name}\`)`, '');
  return L.join('\n');
}
export function featureRequestsMd(frs) {
  const L = ['# Feature requests', '', 'What players wanted that the world has no way to do, grouped, in their words.', ''];
  if (!frs.length) L.push('None.');
  for (const f of frs) L.push(`## ${f.id}: ${f.title} (×${f.count + (f.desireCount ?? 0)})`, '', `- **Want:** ${f.want}`, `- **In their words:** ${f.wordings.map((w) => `"${w}"`).join(' · ')}`, `- **Who:** ${f.personas.join(', ')}${f.requestIds.length ? ` · requests ${f.requestIds.join(', ')}` : ''}`, '');
  return L.join('\n');
}

/** reviewRun({runDir}) → step 5. `call` is injectable for tests (defaults to the signed-in claude -p). */
export async function reviewRun({ runDir, model, call = realCall, maxWallSec = 300, log = (m) => process.stderr.write(m + '\n') }) {
  const run = loadRun(runDir);
  const { deterministic } = providerPolicy(run.scenario);
  model = model ?? run.scenario?.review?.reviewerModel ?? 'opus';
  const earlier = earlierRuns(runDir).map((dir) => ({ dir, issues: readJson(join(dir, 'issues.json'), []) }));
  const earlierTitles = earlier.flatMap((e) => e.issues.map((i) => i.title)).slice(0, 10);
  const system = `${REVIEWER_ROLE}\n\n# Rubric\n\n${rubricText()}`;
  for (const f of ['oracles.jsonl', 'reviews.jsonl']) writeFileSync(join(runDir, f), '');
  const oraclesBy = {}; const reviews = [];
  for (const ev of run.evidence) {
    const rows = runOracles(ev, { run }); oraclesBy[ev.requestId] = rows;
    rows.forEach((r) => appendJsonl(join(runDir, 'oracles.jsonl'), r));
    const prompt = requestPrompt(run, ev, rows, { earlierTitles });
    const allowed = [`Read(${runDir}/shots/**)`, `Read(${runDir}/personas/${ev.seat}/shown/**)`];
    log(`review ${ev.requestId}: ${deterministic ? 'deterministic oracles only' : `calling ${model}`}`);
    const res = deterministic ? { json: { fidelity: 'unresolved', reason: 'Deterministic oracle results only; no subjective model score.', inputDepth: 'debug' }, wallMs: 0 } : await call({ model, prompt, appendSystem: system, cwd: runDir, allowedTools: allowed, maxWallSec });
    const r = normalizeReview(res.json ?? lastJson(res.text), ev, rows);
    appendJsonl(join(runDir, 'reviews.jsonl'), { ...r, model: deterministic ? null : model, mode: deterministic ? 'deterministic' : 'model', wallMs: res.wallMs, usage: res.usage, exit: res.exit, timedOut: res.timedOut, rawText: String(res.text ?? '').slice(0, 4000) });
    reviews.push(r);
  }
  writeFileSync(join(runDir, 'ledger.tsv'), ledgerTsv(reviews));
  const issues = buildIssues(run, reviews, oraclesBy, earlier);
  const frs = buildFeatureRequests(run, reviews);
  writeJson(join(runDir, 'issues.json'), issues); writeFileSync(join(runDir, 'issues.md'), issuesMd(issues));
  writeJson(join(runDir, 'feature-requests.json'), frs); writeFileSync(join(runDir, 'feature-requests.md'), featureRequestsMd(frs));
  writeFileSync(join(runDir, 'desires.tsv'), ['seat\tt\tturn\twording', ...Object.entries(run.personas).flatMap(([s, p]) => p.desires.map((d) => [s, d.t, d.turn, d.text].map(tsvCell).join('\t')))].join('\n') + '\n');
  // session call: story rating + narrative part of emergence
  const g = gather(run);
  const metric = computeEmergence({ ...g, requests: run.evidence, binSec: run.scenario?.observer?.sampleSec ?? 5, seed: run.scenario?.seed ?? 1 });
  const finals = Object.fromEntries(Object.entries(run.personas).map(([s, p]) => [s, { final: p.ratings?.final ?? p.ratings, desires: p.desires.map((d) => d.text) }]));
  const sprompt = ['# Whole session', '', 'Read this journal as a stranger would, then rate it as a story.', '', renderJournal(run), '', 'Players\' final ratings and wishes:', '```json', JSON.stringify(finals), '```', 'Measured social facts (for context only; do not restate them as numbers):', '```json', JSON.stringify({ souls: metric.souls, sharedActivities: metric.sharedActivities, conversations: metric.conversations.started }), '```', '', SESSION_CONTRACT].join('\n');
  if (!deterministic) log(`review session: calling ${model}`);
  const sres = deterministic ? { json: {}, wallMs: 0 } : await call({ model, prompt: sprompt, appendSystem: system, cwd: runDir, allowedTools: [], maxWallSec });
  const sj = scrub(sres.json ?? lastJson(sres.text) ?? {});
  const narrative = { storyRating: Number.isInteger(sj.value.storyRating) ? Math.min(5, Math.max(1, sj.value.storyRating)) : null, strangerReading: sj.value.strangerReading ?? null, o5Count: Number(sj.value.o5Count ?? 0) || 0, o5Examples: sj.value.o5Examples ?? [], surprises: sj.value.surprises ?? [], wantedMore: sj.value.wantedMore ?? [], leaked: sj.leaked, leakedHits: sj.hits, model: deterministic ? null : model, mode: deterministic ? 'deterministic' : 'model', wallMs: sres.wallMs };
  const emergence = { version: 1, metric, narrative };
  writeJson(join(runDir, 'emergence.json'), emergence);
  return { reviews, issues, featureRequests: frs, emergence, oracles: oraclesBy };
}
