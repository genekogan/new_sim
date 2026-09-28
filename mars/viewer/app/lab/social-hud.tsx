// On-canvas HUD for social presets (campfire-evening): the HYPOTHETICAL label, the rendering
// legend (only Idle/Walk clips exist), the timed script with each action's live status/phase,
// slot occupancy per fixture and the expected diagnostics. Reads state only.
import type { LabSim } from './sim.ts';
import { EVENTS, scriptOf } from './campfire-evening.ts';
import { slotStates, SLOT_COLORS } from './overlay-slots.ts';

const fmt = (tick: number) => `${(tick / 20).toFixed(1)} s`;

export function SocialHud({ sim }: { sim: LabSim }) {
  const s = scriptOf(sim.rt);
  if (!s) return null;
  const slots = slotStates(sim.rt);
  const owners = [...new Set(slots.map((q) => q.id.slice(0, q.id.lastIndexOf('#'))))];
  const status = (id: string) => {
    const f = s.fired.find((x) => x.id === id);
    if (!f) return null;
    return f.recs.map((r) => `${r.verb} ${r.status}${r.phase && r.status === 'executing' ? `·${r.phase}` : ''}${r.status === 'failed' ? ` ${r.diagnostic?.code}` : ''}`).join(' · ');
  };
  return (
    <div className="lab-hud lab-social" data-testid="social-hud">
      <div className="lab-hud-head">
        HYPOTHETICAL · illustrative inhabited scene · t {fmt(sim.rt.tick)}
        {sim.rt.violations.length ? ` · ${sim.rt.violations.length} VIOLATIONS` : ' · 0 violations'}
      </div>
      <div className="lab-social-legend">
        only <b>Idle</b> + Walk clips exist: sit = Idle + procedural seated pose, warm = Idle + hands out, talk/watch = Idle
      </div>
      <ol className="lab-social-events">
        {EVENTS.map((e) => {
          const st = status(e.id);
          const bad = st?.includes('failed');
          return (
            <li key={e.id} className={st ? (bad ? 'warn' : 'on') : 'todo'}>
              <span>{e.at.toFixed(0)} s</span> {e.label}
              {st ? ` — ${st}` : ''}
            </li>
          );
        })}
      </ol>
      <div className="lab-social-slots">
        {owners.map((o) => {
          const mine = slots.filter((q) => q.id.startsWith(`${o}#`));
          return (
            <span key={o}>
              {o}{' '}
              {mine.map((q) => (
                <i key={q.id} style={{ background: SLOT_COLORS[q.state] }} title={`${q.id} ${q.state}${q.claimant ? ` by ${q.claimant}` : ''}`} />
              ))}{' '}
              {mine.filter((q) => q.claimedBy).length}/{mine.length}
            </span>
          );
        })}
      </div>
      {s.notes.length > 0 && (
        <div className="lab-social-notes">
          {s.notes.length} scripted diagnostic{s.notes.length > 1 ? 's' : ''} ({[...new Set(s.notes.map((n) => n.text.match(/failed (\S+)/)?.[1]))].join(', ')}) — amber banners + log
        </div>
      )}
    </div>
  );
}
