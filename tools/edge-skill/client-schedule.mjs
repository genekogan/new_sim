import { createHash } from 'node:crypto';
import { parseWorldRoutine } from './client-cadence.mjs';

const id = (kind, line) => `${kind}-${createHash('sha256').update(line.trim()).digest('hex').slice(0, 24)}`;
const offsets = { UTC: 0, Z: 0, EDT: -240, EST: -300 };
const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const formatters = new Map();
function parts(ms, zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (formatters.size >= 16) formatters.delete(formatters.keys().next().value);
    formatters.set(zone, f);
  }
  return Object.fromEntries(f.formatToParts(ms).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function dateParts(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Explicit date and HH:MM required');
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const value = Date.UTC(year, month - 1, day, hour, minute), d = new Date(value);
  if (year < 1970 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw new Error('Invalid real date');
  return { year, month, day, hour, minute, value };
}
const wall = p => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
function fixedOffset(zone) {
  if (Object.hasOwn(offsets, zone)) return offsets[zone];
  if (!/^[+-]\d{2}:\d{2}$/.test(zone)) return undefined;
  const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
  if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) throw new Error('Invalid timezone offset');
  return (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
}
/** EDT/EST are explicit fixed offsets; use America/New_York for seasonal rules.
 * Ambiguous or nonexistent local times refuse; an explicit UTC offset resolves them. */
export function realTimeForLocal(date, time, zone) {
  const p = dateParts(date, time);
  const offset = fixedOffset(zone);
  if (offset !== undefined) return p.value - offset * 60000;
  if (typeof zone !== 'string' || !zone.includes('/')) throw new Error('Timezone must be UTC, EDT, EST, explicit offset or IANA name');
  let candidate = p.value;
  for (let i = 0; i < 4; i++) candidate += p.value - wall(parts(candidate, zone));
  const matches = [...new Set([0, -120, -90, -60, -30, 30, 60, 90, 120].map(m => candidate + m * 60000).filter(ms => wall(parts(ms, zone)) === p.value))];
  if (matches.length !== 1) throw new Error('Local time is ambiguous or nonexistent; supply an explicit offset');
  return matches[0];
}

/** Parsing does not execute prose. The mind compiles instructions into validated
 * queue steps once; recurring occurrences reuse those persisted bindings. */
export function parseSchedule(markdown) {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > 32768) throw new Error('Schedule exceeds 32 KiB');
  const result = { routines: [], commitments: [], reviews: [] };
  let section = null;
  for (const [index, raw] of markdown.split('\n').entries()) {
    const line = raw.trim();
    if (/^## /.test(line)) { section = /^## Routines\b/.test(line) ? 'routines' : /^## Commitments\b/.test(line) ? 'commitments' : /^## Reviews\b/.test(line) ? 'reviews' : null; continue; }
    if (!line.startsWith('- ') || !section) continue;
    if (result.routines.length + result.commitments.length + result.reviews.length >= 64) throw new Error('Too many schedule entries');
    try {
      if (section === 'routines') result.routines.push(parseWorldRoutine(line, id('routine', line)));
      if (section === 'commitments') {
        const m = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) (\S+) \(real\)\s*·\s*(.+?)(?:\s*·\s*(.+))?$/.exec(line);
        if (!m) throw new Error('Commitment requires YYYY-MM-DD HH:MM timezone (real) · instruction');
        result.commitments.push({ id: id('commitment', line), atRealMs: realTimeForLocal(m[1], m[2], m[3]), zone: m[3], instruction: m[4], evidence: m[5] ?? null });
      }
      if (section === 'reviews') {
        const pieces = line.slice(2).split(/\s*·\s*/);
        if (pieces.length % 2) throw new Error('Review entries require cadence · instruction pairs');
        for (let i = 0; i < pieces.length; i += 2) {
          const m = /^(daily|weekly (sun|mon|tue|wed|thu|fri|sat)) (\d{2}:\d{2}) (\S+)$/.exec(pieces[i]);
          if (!m) throw new Error('Review requires daily|weekly weekday HH:MM timezone');
          dateParts('2026-01-01', m[3]); realTimeForLocal('2026-01-01', m[3], m[4]);
          if (result.routines.length + result.commitments.length + result.reviews.length >= 64) throw new Error('Too many schedule entries');
          result.reviews.push({ id: id('review', `${pieces[i]} · ${pieces[i + 1]}`), weekday: m[2] ? weekdays.indexOf(m[2]) : null, time: m[3], zone: m[4], instruction: pieces[i + 1] });
        }
      }
    } catch (error) { throw new Error(`Schedule line ${index + 1}: ${error.message}`); }
  }
  for (const entries of Object.values(result)) {
    if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Duplicate schedule entry');
    if (entries.some(e => !e.instruction.trim() || e.instruction.length > 500)) throw new Error('Schedule instructions require 1–500 characters');
  }
  return result;
}

export function nextReview(review, afterRealMs) {
  if (!Number.isFinite(afterRealMs)) throw new Error('Invalid real clock');
  const offset = fixedOffset(review.zone);
  const local = offset === undefined ? parts(afterRealMs, review.zone) : parts(afterRealMs + offset * 60000, 'UTC');
  const today = Date.UTC(local.year, local.month - 1, local.day);
  for (let day = 0; day < 8; day++) {
    const date = new Date(today + day * 86400000);
    if (review.weekday !== null && date.getUTCDay() !== review.weekday) continue;
    const atRealMs = realTimeForLocal(date.toISOString().slice(0, 10), review.time, review.zone);
    if (atRealMs > afterRealMs) return { key: `${review.id}@${atRealMs}`, atRealMs, instruction: review.instruction };
  }
  throw new Error('No next review found');
}
