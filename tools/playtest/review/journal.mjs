// journal.md: the player's-eye story. Per request: what they asked, what the card said, what the body did (as the
// screen showed it), the persona's own thought and rating, with shot links (relative to the run folder).
import { personaTurnsFor, secsBetween } from './run.mjs';

const fmt = (s) => { if (s == null) return '?'; const m = Math.floor(s / 60), r = Math.round(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };

export function bodySummary(ev) {
  const cut = Date.parse(ev.cutoffAt ?? '9999');
  const s = (ev.samples ?? []).filter((x) => Date.parse(x.t) <= cut);
  if (!s.length) return 'no observation of the body';
  const a = s[0], b = s.at(-1);
  const where = (x) => `${x.posture ?? 'unknown posture'} in ${x.place ?? 'an unnamed place'}`;
  return a.place === b.place && a.posture === b.posture ? `stayed ${where(b)}` : `went from ${where(a)} to ${where(b)}${b.activity ? ` (showing "${b.activity}")` : ''}`;
}

export function renderJournal(run, { title = null } = {}) {
  const L = [`# Journal — ${title ?? run.scenario.name ?? 'session'}`, '', `What each player asked, what they were told, and what they saw. Times are since the session started.`, ''];
  for (const ev of run.evidence) {
    const pts = personaTurnsFor(run, ev);
    const name = run.seats[ev.seat]?.seat?.soulName ?? ev.seat;
    L.push(`## ${fmt(ev.sentMono / 1000)} — ${ev.seat} asked ${name}: "${ev.text}" (${ev.channel})`, '');
    if (ev.ackText) L.push(`- **Card said** (after ${secsBetween(ev.sentAt, ev.ackAt)} s): "${ev.ackText}"`);
    if (ev.resultText) L.push(`- **${ev.channel === 'chat' ? 'Chat replied' : 'Card result'}** (after ${secsBetween(ev.sentAt, ev.resultAt)} s): "${ev.resultText}"`);
    if (!ev.ackText && !ev.resultText) L.push('- **No answer** before the request timed out.');
    L.push(`- **On screen** ${name} ${bodySummary(ev)}.`);
    for (const t of pts) {
      const d = t.decision ?? {};
      const rating = d.rating ? ` — fun ${d.rating.fun}/5, alive ${d.rating.alive}/5` : '';
      if (d.thought) L.push(`- *${ev.seat} thought:* "${d.thought}"${rating}`);
      (d.complaints ?? []).forEach((c) => L.push(`- *complaint:* "${c}"`));
      (d.desires ?? []).forEach((c) => L.push(`- *wished:* "${c}"`));
    }
    const shots = (ev.shots ?? []).slice(0, 3);
    if (shots.length) L.push('', shots.map((p) => `![${ev.requestId} ${p.split('/').slice(-2).join(' ')}](${p})`).join(' '));
    L.push('');
  }
  for (const [seat, p] of Object.entries(run.personas)) {
    const f = p.ratings?.final ?? p.ratings;
    if (f?.fun != null) L.push(`**${seat} at the end:** fun ${f.fun}/5, alive ${f.alive}/5${f.feltLikeGod != null ? `, felt like god ${f.feltLikeGod}/5` : ''}${f.words ? ` — "${f.words}"` : ''}`, '');
  }
  return L.join('\n');
}
