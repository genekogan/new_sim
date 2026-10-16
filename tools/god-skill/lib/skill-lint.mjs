// RL6 skill lint: every command written in SKILL.md (code blocks and inline code) and in the CLI's HELP must pass the
// CLI's own reader (parseFlags + checkArgs). Usage notation is read the way an agent reads it: `[optional]` parts are
// included, `a | b` alternatives are tried one at a time, `(prose)` and `# comments` are dropped, and placeholder
// values (`<ref>`, `m`, `dx,dz`) stand for a valid value of their option's kind.
import { checkArgs, parseFlags, COMMANDS, CLI_SHAPE } from '../cli.mjs';

const { boolsFor, NUMERIC } = CLI_SHAPE;
const notNumber = (v) => !Number.isFinite(Number(v)); // `m`, `n`, `0..1`: placeholders for a numeric option

/** Words of a command line, shell-style: quotes group and are removed; `[optional]` brackets are notation. */
export function words(text) {
  const out = [];
  for (const m of text.matchAll(/'[^']*'|"(?:[^"\\]|\\.)*"|\S+/g)) {
    const w = m[0];
    if (/^['"]/.test(w)) { out.push(w.slice(1, -1)); continue; }
    const bare = w.replace(/^\[+/, '').replace(/\]+$/, '').replace(/^(--[\w-]+):$/, '$1');
    if (bare) out.push(bare);
  }
  return out;
}

/** Drop `# comments` and `(prose)` outside quotes. */
function clean(text) {
  let out = '', quote = null, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = null; if (!depth) out += ch; continue; }
    if ((ch === "'" || ch === '"') && !depth) { quote = ch; out += ch; continue; }
    if (ch === '#' && /\s/.test(text[i - 1] ?? ' ') && /\s/.test(text[i + 1] ?? ' ')) break;
    if (ch === '(' && /\s/.test(text[i - 1] ?? ' ')) { depth++; continue; }
    if (ch === ')' && depth) { depth--; continue; }
    if (!depth) out += ch;
  }
  return out.trim();
}

/** One written line → the concrete command variants it stands for (alternatives split, prose dropped). */
export function variants(line) {
  const text = clean(line.replace(/^\s*(?:\$\s*)?node\s+eden-god\.mjs\s+/, ''));
  const out = [];
  for (let segment of text.split(/\s+·\s+/)) {
    // "only where the world opts in: price <ref> …" — a prose lead-in before a command
    const lead = segment.lastIndexOf(': '); if (lead > 0 && !Object.hasOwn(COMMANDS, segment.split(/\s+/)[0])) segment = segment.slice(lead + 2);
    // `a | b` and `x|--opt` both start an alternative
    const parts = segment.replace(/\|(?=--)/g, ' | ').split(/\s+\|\s+/).map(words), first = parts[0];
    if (!first?.length) continue;
    out.push(first);
    const prefix = first.slice(0, Math.max(1, first.findIndex(w => w.startsWith('--')) === -1 ? first.length : first.findIndex(w => w.startsWith('--'))));
    for (const alt of parts.slice(1)) {
      if (!alt.length) continue;
      if (Object.hasOwn(COMMANDS, alt[0])) out.push(alt);
      else if (alt[0].startsWith('--')) out.push([...prefix, ...alt]);
    }
  }
  return out.filter(v => Object.hasOwn(COMMANDS, v[0]));
}

const OPTIONAL_VALUE = (cmd, k) => (cmd === 'build' && k === 'take') || (cmd === 'undo' && k === 'group') || k === 'free';
const NOTATION = /^(?:…|\.\.\.|<?(?:relations?|options|filters)>?)$/;
/** A written value that stands for one (`m`, `dx,dz`, `WxH`, `<ref>`, `0..1`, `1|-1`), not a literal example. */
const isPlaceholder = (v) => /[A-Za-z<>…|]|\.\./.test(v);
const placeholder = (cmd, k, v) => {
  if (v === undefined) return NUMERIC.has(k) && !(cmd === 'build' && k === 'steps') ? '1' : (k === 'by' || k === 'step') && cmd !== 'land' ? '1,1' : k === 'grid' ? '2x2' : k === 'param' ? 'k=v' : 'x';
  if (!isPlaceholder(v)) return v;
  return NUMERIC.has(k) && notNumber(v) && !(cmd === 'build' && k === 'steps') ? '1'
    : (k === 'by' || k === 'step') && cmd !== 'land' && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(v) ? '1,1'
    : k === 'grid' && !/^\d+[x×]\d+$/.test(v) ? '2x2' : v;
};
/** Placeholder values stand for a valid value of their option's kind; an option shown without a value gets one. */
export function concrete(argv) {
  const [cmd, ...rest] = argv, bools = boolsFor(cmd), out = [cmd];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (!w.startsWith('--') || w.length < 3 || w.includes('=')) { if (!NOTATION.test(w)) out.push(w); continue; }
    const k = w.slice(2); out.push(w);
    if (bools.has(k)) continue;
    const takes = k === 'between' ? 2 : 1;
    for (let n = 0; n < takes; n++) {
      const v = rest[i + 1];
      if (v === undefined || (v.startsWith('--') && v.length > 2)) { if (!OPTIONAL_VALUE(cmd, k)) out.push(placeholder(cmd, k)); break; }
      out.push(placeholder(cmd, k, v)); i++;
    }
  }
  return out;
}

/** The CLI's verdict on one written command: null when it reads. */
export function lintArgv(argv) {
  const [cmd, ...rest] = concrete(argv), { flags, rest: positional } = parseFlags(rest, boolsFor(cmd));
  try { checkArgs(cmd, flags, positional); return null; } catch (e) { return String(e.message ?? e); }
}

/** Command lines in SKILL.md: fenced blocks (not json) and inline code that starts with a command. */
export function skillCommands(md) {
  const found = [], lines = md.split('\n');
  let fence = null, pending = null;
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (/^```/.test(raw)) { fence = fence === null ? raw.slice(3).trim() : null; pending = null; return; }
    if (fence !== null) {
      if (fence && fence !== 'sh' && fence !== 'bash') return;
      // a quoted argument may continue on the next lines (define-kit '{… \n …}')
      const text = pending ? `${pending.text} ${raw.trim()}` : raw;
      if (((text.match(/'/g) ?? []).length % 2) === 1) { pending = { text, line: pending?.line ?? n }; return; }
      found.push({ line: pending?.line ?? n, text, where: 'block' }); pending = null; return;
    }
    for (const m of raw.matchAll(/`([^`]+)`/g)) {
      const text = m[1].trim().replace(/^node\s+eden-god\.mjs\s+/, '');
      const first = text.split(/\s+/)[0];
      // `act buy:<id>`-style spans are the Soul CLI, documented beside the god's
      if (Object.hasOwn(COMMANDS, first) && /\s/.test(text) && !/^act \w+:/.test(text)) found.push({ line: n, text, where: 'inline' });
    }
  });
  return found;
}

/**
 * Command lines in HELP: `label:  cmd args · cmd args`, or a bare `cmd …` line whose indented continuation lines are
 * its sub-verbs (LAND_HELP: `  raise|lower --at …      cliff --path …`, columns three or more spaces apart).
 */
export function helpCommands(help) {
  const found = []; let parent = null;
  help.split('\n').forEach((raw, i) => {
    const line = i + 1, m = /^[\w-]+:\s+(.*)$/.exec(raw), first = raw.trim().split(/\s+/)[0];
    if (m) { parent = null; found.push({ line, text: m[1], where: 'help' }); return; }
    if (/^\S/.test(raw) && Object.hasOwn(COMMANDS, first)) { parent = first; found.push({ line, text: raw.trim(), where: 'help' }); return; }
    if (/^\s+\S/.test(raw) && parent) for (const piece of raw.trim().split(/\s{3,}/)) found.push({ line, text: `${parent} ${piece}`, where: 'help' });
  });
  return found;
}

/** Lint a whole document; returns the commands checked and the failures. */
export function lint(entries) {
  const failures = []; let checked = 0;
  for (const e of entries) for (const argv of variants(e.text)) { checked++; const error = lintArgv(argv); if (error) failures.push({ ...e, argv, error }); }
  return { checked, failures };
}

/** Files SKILL.md tells an agent to fetch from the world (`<world-url>/god/…`, example scripts it names). */
export function servedPaths(md, examples = {}) {
  const paths = new Set(['/god/SKILL.md', '/god/eden-god.mjs', '/god/SCHEMA.md']);
  for (const m of md.matchAll(/<world[\w-]*>(\/god\/[\w./-]+)/g)) if (!m[1].endsWith('/')) paths.add(m[1]);
  for (const m of md.matchAll(/\*\*\d+\.[^*]+\*\*\s*\(`([a-z0-9-]+\.mjs)`\)/g)) paths.add(`/god/examples/${m[1]}`);
  for (const name of Object.keys(examples)) { paths.add(`/god/examples/${name}.log`); paths.add(`/god/examples/${name}.mjs`); }
  return [...paths].sort();
}
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** The examples heading's count ("## Six recorded examples") must equal the listed examples. */
export function examplesHeadingCount(md) { const m = /^##\s+(\w+)\s+recorded examples/im.exec(md); return m ? NUMBER_WORDS.indexOf(m[1].toLowerCase()) : null; }
