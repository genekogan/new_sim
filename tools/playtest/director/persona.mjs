// One persona = one claude -p session for the whole run (its memory is its session). Repo-blind by construction:
// it gets its sheet, the setting (world name, Soul name), and glances composed by shown.mjs; it may Read only its own
// shown/ folder. Its cwd is a fresh empty dir outside any repo so no project CLAUDE.md is discovered.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callModel as realCallModel, lastJson } from '../lib/claude-p.mjs';
import { appendJsonl, readJson, writeJson } from '../lib/jsonl.mjs';
import { composeShown } from './shown.mjs';

export const PERSONA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../personas');
const JSON_NUDGE = 'Your last answer was not a single JSON object. Answer again with ONE JSON object only, exactly in the contract shape, nothing else.';

/** Sheet text → {meta (JSON frontmatter), body (what the persona reads)}. */
export function parseSheet(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  let meta = {}; try { meta = JSON.parse(m[1]); } catch { /* malformed: no meta */ }
  return { meta, body: text.slice(m[0].length).trim() };
}

/** A sheet name ('newcomer') or path or literal text → {name, text}. */
export function loadSheet(sheet) {
  if (typeof sheet !== 'string') throw new Error('sheet must be a name, a path or text');
  if (!sheet.includes('\n')) {
    const p = sheet.endsWith('.md') ? resolve(sheet) : join(PERSONA_DIR, `${sheet}.md`);
    if (existsSync(p)) return { name: p.split('/').pop().replace(/\.md$/, ''), text: readFileSync(p, 'utf8') };
    throw new Error(`no persona sheet: ${sheet}`);
  }
  return { name: parseSheet(sheet).meta.persona ?? 'custom', text: sheet };
}

const int15 = (v) => (Number.isFinite(Number(v)) ? Math.min(5, Math.max(1, Math.round(Number(v)))) : null);
const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);

/** Validate and normalise a parsed decision; null when it is not a decision at all. */
export function normalizeDecision(j, { creator = false } = {}) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  if (!('say' in j) && !('waitSec' in j) && !('rating' in j)) return null;
  let say = null;
  if (j.say && typeof j.say === 'object' && ['chat', 'card'].includes(j.say.channel) && typeof j.say.text === 'string' && j.say.text.trim()) say = { channel: j.say.channel, text: j.say.text.trim() };
  let rating = null;
  if (j.rating && typeof j.rating === 'object') {
    const r = { fun: int15(j.rating.fun), alive: int15(j.rating.alive) };
    if (creator || j.rating.feltLikeGod != null) r.feltLikeGod = int15(j.rating.feltLikeGod);
    if (Object.values(r).some((x) => x != null)) rating = r;
  }
  const w = Number(j.waitSec);
  return { say, waitSec: Number.isFinite(w) ? Math.min(900, Math.max(1, w)) : 20, thought: typeof j.thought === 'string' ? j.thought : '', rating, desires: strs(j.desires), complaints: strs(j.complaints), quick: j.quick === true, done: j.done === true };
}

const fallback = (extra) => ({ say: null, waitSec: 20, thought: '', rating: null, desires: [], complaints: [], quick: false, done: false, parseError: true, ...extra });

/** PersonaSession({runDir, seat, sheet, model, setting:{worldName, soulName}, skillPath?, callModel?, maxWallSec?, effort?}) */
export function PersonaSession({ runDir, seat, sheet, model = 'opus', setting = {}, skillPath = null, callModel = realCallModel, maxWallSec = 240, effort = null, clock = null }) {
  const { name, text } = loadSheet(sheet);
  const { meta, body } = parseSheet(text);
  const creator = meta.role === 'creator';
  const dir = join(runDir, 'personas', seat);
  const shownDir = resolve(dir, 'shown');
  mkdirSync(shownDir, { recursive: true });
  writeFileSync(join(dir, 'sheet.md'), text);
  // Claude Code permission rules want '//' for an absolute path; '/x' is read relative to the project (probed 2026-10-24).
  const allowedTools = [`Read(/${shownDir}/**)`];
  const prior = readJson(join(dir, 'session.json'));
  const cwd = prior?.cwd && existsSync(prior.cwd) ? prior.cwd : mkdtempSync(join(tmpdir(), `pt-persona-${seat}-`));
  let sessionId = prior?.sessionId ?? null;
  let started = !!prior?.started;
  let n = prior?.steps ?? 0;
  let skillShownPath = null;
  if (skillPath && meta.maySeeSkill && existsSync(skillPath)) { skillShownPath = join(shownDir, 'skill.md'); copyFileSync(skillPath, skillShownPath); }
  const saveSession = () => writeJson(join(dir, 'session.json'), { seat, persona: name, model, cwd, sessionId, started, steps: n, allowedTools, setting });
  saveSession();

  function intro() {
    const s = [`You are about to play. Stay in character for the whole session.\n\n${body}`, '## Today',
      creator ? `Your world is called "${setting.worldName ?? 'your world'}".`
        : `The world is called "${setting.worldName ?? 'this world'}". Your Soul is called "${setting.soulName ?? 'your Soul'}".`];
    if (skillShownPath) s.push(`The game's instructions file is at ${skillShownPath}; you may read it with your Read tool.`);
    s.push('Here is your first glance.');
    return s.join('\n\n');
  }

  async function call(prompt) {
    const resume = started;
    const r = await callModel({ model, prompt, cwd, allowedTools, sessionId: sessionId ?? undefined, resume, maxWallSec, effort });
    if (r.exit === 0 && !r.timedOut) { started = true; sessionId = r.sessionId ?? sessionId; }
    else if (!started) sessionId = null; // first call never landed: start fresh next time
    saveSession();
    return r;
  }

  async function ask(prompt, kind, logExtra) {
    let r = await call(prompt);
    let decision = normalizeDecision(r.json ?? lastJson(r.text), { creator });
    let retried = false;
    if (!decision && started) { retried = true; r = await call(JSON_NUDGE); decision = normalizeDecision(r.json ?? lastJson(r.text), { creator }); }
    const out = decision ?? fallback({ waitSec: 20 });
    appendJsonl(join(dir, 'turns.jsonl'), { n, kind, t: new Date().toISOString(), mono: clock?.now?.() ?? null, ...logExtra, prompt, rawText: String(r.text ?? '').slice(0, 4000), decision: out, parseError: !decision, retried, exit: r.exit, timedOut: !!r.timedOut, wallMs: r.wallMs, usage: r.usage ?? null, costUsd: r.costUsd ?? null, sessionId });
    return out;
  }

  return {
    seat, name, meta, dir, shownDir, allowedTools, get sessionId() { return sessionId; }, get steps() { return n; },
    /** shown = {elapsedSec, screenshotPath, legible, cardView, chatRendered, lastRequests} → decision */
    async step({ shown }) {
      n += 1;
      const png = join(shownDir, `${n}.png`);
      let screenshotPath = null;
      if (shown?.screenshotPath && existsSync(shown.screenshotPath)) { copyFileSync(shown.screenshotPath, png); screenshotPath = png; }
      const bundle = { ...shown, sourceScreenshotPath: shown?.screenshotPath ?? null, screenshotPath };
      writeJson(join(shownDir, `${n}.json`), bundle);
      const glance = composeShown(bundle);
      const prompt = started ? glance : `${intro()}\n\n${glance}`;
      return ask(prompt, 'step', { shownFile: join(shownDir, `${n}.json`), png: screenshotPath, elapsedSec: shown?.elapsedSec ?? null });
    },
    async finalRating() {
      const fields = creator ? 'fun, alive and feltLikeGod' : 'fun and alive';
      const prompt = `The session is over; you are closing the tab. Give your final judgement of the whole session as the same JSON object: say null, waitSec 0, done true, a rating with ${fields} for the whole session, and in desires and complaints list ALL of them from the whole session, in your own words. JSON only.`;
      if (!started) return fallback({ waitSec: 0, done: true, noSession: true });
      return ask(prompt, 'final', {});
    },
  };
}
