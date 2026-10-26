// The live console's line language, a stdin reader and the headless script feeder.
//   <text>                    broadcast to every seat's card
//   <seat>: <text>            one seat's card (seat id or Soul name, case-insensitive)
//   redirect <seat>: <text>   change what that seat does: sent now, and replaces its talk when its turn comes
//   economy <seat|all> <lean|normal|rich>
//   pause | resume | status | end
// Every line is recorded as a director's direction (by: "console").
import { createInterface } from 'node:readline';

export function parseLine(line, { seats = [] } = {}) {
  const s = String(line ?? '').trim();
  if (!s || s.startsWith('#')) return { cmd: 'noop' };
  const bare = s.toLowerCase();
  if (['pause', 'resume', 'status', 'end'].includes(bare)) return { cmd: bare };
  const seatOf = (w) => { const k = String(w ?? '').trim().toLowerCase(); return seats.find((x) => x.id === k || String(x.soulName ?? '').toLowerCase() === k)?.id ?? null; };
  let m = s.match(/^redirect\s+([^:]+):\s*(.+)$/is);
  if (m) { const seat = seatOf(m[1]); return seat ? { cmd: 'redirect', seat, text: m[2].trim() } : { cmd: 'error', error: `unknown seat "${m[1].trim()}"` }; }
  m = s.match(/^economy\s+(\S+)\s+(\S+)$/i);
  if (m) { const all = m[1].toLowerCase() === 'all'; const seat = all ? null : seatOf(m[1]); return all || seat ? { cmd: 'economy', seat, level: m[2].toLowerCase() } : { cmd: 'error', error: `unknown seat "${m[1]}"` }; }
  m = s.match(/^([A-Za-z][\w-]*)\s*:\s*(.+)$/s);
  if (m && seatOf(m[1])) return { cmd: 'say', seat: seatOf(m[1]), text: m[2].trim() };
  return { cmd: 'broadcast', text: s };
}

/** Lines typed on stdin → onLine(line). Returns {close}. */
export function stdinConsole(onLine, { input = process.stdin } = {}) {
  const rl = createInterface({ input, terminal: false });
  rl.on('line', (l) => { try { onLine(l); } catch { /* the orchestrator logs its own errors */ } });
  return { close: () => rl.close() };
}

/** Headless script: [{atSec, line} | {at: "go:<seat>"|"prepare:<seat>"|"phase:<name>", line, expect?}] → due(event, elapsedSec) */
export function scriptFeeder(script = []) {
  const pending = script.map((e, i) => ({ ...e, i }));
  return {
    /** Entries due now: by time, or triggered by an orchestrator event key ("go:doc", "phase:turns"). */
    due({ elapsedSec = 0, events = new Set() } = {}) {
      const out = [];
      for (const e of [...pending]) {
        const hit = e.at != null ? events.has(e.at) : Number.isFinite(e.atSec) && elapsedSec >= e.atSec;
        if (hit) { out.push(e); pending.splice(pending.indexOf(e), 1); }
      }
      return out;
    },
    get left() { return pending.length; },
  };
}

/** A text file of console lines (one per line, `+<sec> line` or `@go:<seat> line`) or a JSON array. */
export function parseScript(text) {
  const t = String(text ?? '').trim();
  if (t.startsWith('[')) return JSON.parse(t);
  return t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    let m = l.match(/^\+(\d+(?:\.\d+)?)\s+(.+)$/); if (m) return { atSec: Number(m[1]), line: m[2] };
    m = l.match(/^@(\S+)\s+(.+)$/); if (m) return { at: m[1], line: m[2] };
    return { atSec: 0, line: l };
  });
}
