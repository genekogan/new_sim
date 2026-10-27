// One `here` payload is one body observation. Never attach a new posture/seat to an older public position.
export function withKinematics(publicSample, here, { startedAt, endedAt, mono } = {}) {
  const me = here?.me ?? {}, raw = me.pos;
  const valid = Array.isArray(raw) && [2,3].includes(raw.length) && raw.every(Number.isFinite);
  return { ...publicSample, t: endedAt, mono,
    pos: valid ? {x:raw[0],z:raw.at(-1),region:null,src:'here'} : null,
    tick: Number.isFinite(here?.tick) ? here.tick : null,
    place: me.place ?? null, placePath: me.placePath ?? null,
    posture: me.posture ?? null, activity: me.activity ?? null,
    heading: Number.isFinite(me.heading) ? me.heading : null, seat: me.seat ?? null,
    level: Number.isFinite(me.level) ? me.level : null,
    perceptionSampleStartedAt:startedAt, perceptionSampleAt:endedAt,
  };
}
