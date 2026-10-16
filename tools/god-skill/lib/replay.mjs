// RL6: replay recorded CLI transcripts and compare OUTCOME CLASSES (accepted / refusal code / CLI refusal / error),
// never coordinates or wording. Transcript rows are `{at, cmd, ms, out|error}`; rows written since RL6 also carry
// `argv` (exact words). Older rows only have `cmd` = the words joined by one space, so `argvOf` re-splits them with
// the CLI's own reading tables. Nothing here talks to a network: the caller supplies the world's fetch.
import { checkArgs, parseFlags, COMMANDS, CLI_SHAPE } from '../cli.mjs';

const { POS, BOOL, boolsFor } = CLI_SHAPE;
/** Commands a replay cannot reproduce in-process: browsers, engine probes, the shared clock, pairing, waits. */
export const REPLAY_SKIP = { look: 'browser', kit: 'browser', 'look-keeper': 'browser', 'look-shot': 'browser', gallery: 'browser', 'verify-use': 'engine', time: 'engine clock', weather: 'engine clock', strike: 'engine clock', register: 'setup', pair: 'setup', mint: 'setup', doctor: 'local locks', stream: 'stream', follow: 'stream',
  ...Object.fromEntries(['layers', 'hours', 'own', 'access', 'price', 'currency', 'give', 'pay', 'zone', 'zone-suggest', 'relate'].map(c => [c, 'engine (Souls layer)'])) };
/** Commands whose first word may name a file in the run's folder (read with the CLI's readArg). */
export const FILE_COMMANDS = new Set(['define', 'define-kit', 'act', 'dryrun', 'plan', 'preview', 'query', 'import', 'kit']);
/** Ids the server generated in the recorded world (entities, undo, previews, claims, requests) never recur. */
const GENERATED = /\b(?:e_[0-9a-f]{8}|u_[0-9a-f]{10}|c_[0-9a-f]{8}|l_[0-9a-f]{8}|pv_[\w-]{6,})\b/;
const isFlag = w => w.startsWith('--') && w.length > 2;

/** Exact argv when recorded; otherwise the joined `cmd` re-split (positionals first, flag values greedy). */
export function argvOf(row) {
  if (Array.isArray(row.argv)) return row.argv.map(String);
  const words = String(row.cmd ?? '').split(' '), cmd = words.shift() ?? '', bools = boolsFor(cmd), out = [cmd];
  let i = 0; const lead = [];
  while (i < words.length && !isFlag(words[i])) lead.push(words[i++]);
  const pos = POS[cmd] ?? Infinity;
  out.push(...(lead.length > pos && pos >= 1 ? [...lead.slice(0, pos - 1), lead.slice(pos - 1).join(' ')] : lead));
  while (i < words.length) {
    const w = words[i++]; out.push(w);
    if (!isFlag(w) || w.includes('=')) continue;
    const k = w.slice(2);
    if (k === 'between') { for (let n = 0; n < 2 && i < words.length; n++) out.push(words[i++]); continue; }
    if (bools.has(k) || i >= words.length || isFlag(words[i])) continue;
    let value = words[i++];
    while (i < words.length && !isFlag(words[i]) && words[i] !== '') value += ' ' + words[i++];
    out.push(value);
  }
  return out;
}

/**
 * Candidate argvs, most likely first. A joined row whose leading words already exceed the command's positional count
 * was prose (a quoted summary or label), so a later `--word` may belong to that prose: the second candidate keeps the
 * whole tail as the last positional. Callers pick the candidate whose CLI verdict matches the recorded class.
 */
export function argvCandidates(row) {
  const primary = argvOf(row); if (Array.isArray(row.argv)) return [primary];
  const words = String(row.cmd ?? '').split(' '), cmd = words.shift() ?? '', pos = POS[cmd] ?? Infinity;
  let lead = 0; while (lead < words.length && !isFlag(words[lead])) lead++;
  return lead > pos && pos >= 1 && lead < words.length ? [primary, [cmd, ...words.slice(0, pos - 1), words.slice(pos - 1).join(' ')]] : [primary];
}
/** The argv to replay: the first candidate whose CLI verdict (refuse or send) agrees with the recorded class. */
export function chooseArgv(row) {
  const candidates = argvCandidates(row), refusedBefore = (row.recorded ?? outcomeOf(row)) === 'cli';
  return candidates.find(a => !!cliRefusal(a) === refusedBefore) ?? candidates[0];
}

/** The outcome class of one answer, identical for a recorded row and a replayed one. */
export function outcomeOf({ out, error }) {
  if (error !== undefined && error !== null) {
    const e = String(error);
    if (e.startsWith('REFUSED by the CLI')) return 'cli';
    const m = /^REFUSED: ([\w./-]+) \(op/.exec(e);
    return m ? `refused:${m[1]}` : 'error';
  }
  if (out !== null && typeof out === 'object') return objectOutcome(out);
  const s = String(out ?? '');
  const refused = /(?:^|\n)\s*REFUSED: ([\w./-]+) \(op/.exec(s);
  if (refused) return `refused:${refused[1]}`;
  if (s.startsWith('{')) {
    try { return objectOutcome(JSON.parse(s)); } catch { /* truncated at 4000 characters: read the head */ }
    const head = /^\{"(accepted|ok)":false[^]*?"code":"([^"]+)"/.exec(s);
    if (head) return `refused:${head[2]}`;
  }
  return 'ok';
}
function objectOutcome(o) {
  if (o.accepted === false) return `refused:${o.failures?.[0]?.code ?? 'refused'}`;
  if (o.ok === false) return `refused:${o.failures?.[0]?.code ?? o.code ?? o.reason?.code ?? 'refused'}`;
  return 'ok';
}

/** Why a recorded row cannot be compared at all (null: comparable). */
export function unreplayable(row, argv = argvOf(row)) {
  const cmd = argv[0];
  if (row.phase) return 'phase marker';
  if (REPLAY_SKIP[cmd]) return REPLAY_SKIP[cmd];
  if (cmd === 'build' && argv[1] === 'wait') return 'waits for other agents';
  if (['commit', 'request'].includes(cmd) || argv.slice(1).some(w => GENERATED.test(w))) return 'generated id';
  const e = String(row.error ?? '');
  if (!Array.isArray(row.argv) && /several options arrived as ONE argument/.test(e)) return 'argv joined in transcript';
  if (/^(world|token) missing/.test(e)) return 'setup';
  if (/^(EACCES|ENOENT)|timed out|ECONNREFUSED|fetch failed/.test(e)) return 'environment';
  if (!Object.hasOwn(COMMANDS, cmd)) return 'unknown command';
  return null;
}

/** The CLI's own refusal (parse + checkArgs) for an argv, or null when the CLI would send it. */
export function cliRefusal(argv) {
  const [cmd, ...rest] = argv, { flags, rest: words } = parseFlags(rest, boolsFor(cmd));
  try { checkArgs(cmd, flags, words); return null; } catch (e) { return String(e.message ?? e); }
}

/** Run one argv through the real CLI (inside the caller's replay folder and fetch). Returns the transcript form. */
export async function runArgv(argv) {
  const [cmd, ...rest] = argv, { flags, rest: words } = parseFlags(rest, boolsFor(cmd));
  try { checkArgs(cmd, flags, words); } catch (e) { return { error: `REFUSED by the CLI: ${e.message}` }; }
  try { const out = await COMMANDS[cmd](words, flags); return { out: typeof out === 'string' ? out : out ?? null }; }
  catch (e) { return { error: String(e?.message ?? e) }; }
}

export { BOOL };
