// Deterministic, deliberately narrow language layer for camera directions.
// It turns stated constraints into CameraDirection; semantic resolution stays in direct.ts.
import { cameraDirectionSchema, type CameraDirection, type MotionVerb } from './direct.ts';

export type ParseVocab = { regions?: string[]; assemblies?: string[]; fixtures?: string[]; groups?: string[] };
export type ParseRefusal = {
  code: 'camera.parse.ambiguous' | 'camera.parse.missing' | 'camera.parse.unknown-verb' | 'camera.parse.deictic' | 'camera.parse.conflict' | 'camera.parse.invalid';
  message: string;
  question?: string;
  candidates?: string[];
  span?: [number, number];
};
export type ParseResult = { ok: true; direction: CameraDirection; notes: string[] } | { ok: false; refusal: ParseRefusal };

type Hit = { text: string; start: number; end: number };
type MotionDraft = { verb: MotionVerb; direction?: 'left' | 'right' | 'up' | 'down' | 'cw' | 'ccw'; degrees?: number; distance?: number; rise?: number };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hit = (text: string, pattern: RegExp): Hit | null => {
  const m = pattern.exec(text);
  return m ? { text: m[0], start: m.index, end: m.index + m[0].length } : null;
};
const fail = (code: ParseRefusal['code'], message: string, h: Hit | null, question?: string, candidates?: string[]): ParseResult =>
  ({ ok: false, refusal: { code, message, ...(question ? { question } : {}), ...(candidates ? { candidates } : {}), span: h ? [h.start, h.end] : [0, 0] } });
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };
const numeric = (s: string): number => numberWords[s] ?? Number(s);
const value = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)';
const boundary = (s: string, phrase: string) => new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i').test(s);

const verbs: { verb: MotionVerb; pattern: RegExp }[] = [
  { verb: 'fly_through', pattern: /\b(?:fly\s+(?:through|into)|go\s+inside|go\s+into|enter)\b/i },
  { verb: 'push_in', pattern: /\b(?:push\s+in|move\s+in|move\s+toward|move\s+towards)\b/i },
  { verb: 'pull_out', pattern: /\b(?:pull\s+out|back\s+away|move\s+back)\b/i },
  { verb: 'orbit', pattern: /\b(?:orbit|revolve|revolution|circle)\b/i },
  { verb: 'crane', pattern: /\b(?:crane|rise|descend|lower)\b/i },
  { verb: 'dolly', pattern: /\b(?:dolly|track\s+(?:left|right|sideways))\b/i },
  { verb: 'tilt', pattern: /\btilt\b/i },
  { verb: 'pan', pattern: /\bpan\b/i },
  { verb: 'hold', pattern: /\b(?:hold|look\s+at|watch)\b/i },
];

const activityWords: Record<string, string> = { eating: 'eat', eat: 'eat', walking: 'walk', walk: 'walk', building: 'build', build: 'build',
  painting: 'paint', paint: 'paint', dancing: 'dance', dance: 'dance', talking: 'talk', talk: 'talk', conversing: 'converse', converse: 'converse',
  serving: 'serve', serve: 'serve', working: 'work', work: 'work', carrying: 'carry', carry: 'carry', cooking: 'cook', cook: 'cook' };

function subjectOf(sentence: string, lower: string, verb: MotionVerb, vocab?: ParseVocab): { subject: CameraDirection['subject']; interior?: string; lookAt?: string } | ParseResult {
  const people = hit(lower, /\b(?:crowd|group|crew|people)\b/);
  if (people) {
    const activities = Object.entries(activityWords).filter(([word]) => boundary(lower, word)).map(([, stem]) => stem);
    const unique = [...new Set(activities)].sort();
    if (!unique.length) return fail('camera.parse.missing', `people in "${sentence}" have no named activity`, people, 'Which activity are the people doing?');
    if (unique.length > 1) return fail('camera.parse.ambiguous', `people have multiple activities: ${unique.join(', ')}`, people, 'Which activity is the camera following?', unique);
    const stem = unique[0];
    const matches = vocab?.groups?.filter((g) => norm(g) === stem || activityWords[norm(g)] === stem) ?? [];
    if (matches.length > 1) return fail('camera.parse.ambiguous', `activity "${stem}" names multiple groups`, people, 'Which group?', matches.sort());
    return { subject: { kind: 'group', ref: matches[0] ?? stem } };
  }
  const interiorHit = hit(lower, /\b(?:inside|into|through|in)\s+(?:the\s+)?kitchen\b/);
  if (interiorHit && verb === 'fly_through') {
    // Documented lexical rule: kitchen names the kitchen-interior region.
    const interior = vocab?.regions?.find((r) => norm(r) === 'kitchen-interior') ?? 'kitchen-interior';
    const facing = /\b(?:and\s+)?(?:face|facing|look\s+at|look\s+toward)\s+(?:the\s+)?([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)?)/i.exec(sentence);
    const lookAt = facing?.[1] ? norm(facing[1]).replace(/\s+(?:over|with|for|at|in)$/, '') : undefined;
    return { subject: { kind: 'region', ref: interior }, interior, ...(lookAt ? { lookAt } : {}) };
  }
  const matching: { kind: CameraDirection['subject']['kind']; ref: string }[] = [];
  for (const [kind, names] of [['region', vocab?.regions], ['assembly', vocab?.assemblies], ['fixture', vocab?.fixtures], ['group', vocab?.groups]] as const) {
    for (const name of names ?? []) if (boundary(lower, norm(name))) matching.push({ kind, ref: name });
  }
  matching.sort((a, b) => b.ref.length - a.ref.length || compare(a.kind, b.kind) || compare(a.ref, b.ref));
  if (matching.length) {
    const top = matching.filter((m) => m.ref.length === matching[0].ref.length);
    if (top.length > 1) return fail('camera.parse.ambiguous', `"${top[0].ref}" names several subject kinds`, hit(lower, new RegExp(top[0].ref, 'i')),
      'Which subject did you mean?', top.map((m) => `${m.kind}:${m.ref}`));
    return { subject: top[0] };
  }
  const racks = hit(lower, /\b(?:main\s+)?(?:pallet\s+)?racks?\b|\brack\s+bay\b|\bbay\b/);
  if (racks) {
    const ref = vocab?.assemblies?.find((a) => norm(a) === 'rack bay') ?? 'rack bay';
    return { subject: { kind: 'assembly', ref } };
  }
  const chiba = hit(lower, /\bchiba\b/);
  if (chiba) return { subject: { kind: 'region', ref: 'chiba' } };
  const kitchen = hit(lower, /\bkitchen\b/);
  if (kitchen) return { subject: { kind: 'region', ref: 'kitchen-interior' } };
  const target = hit(lower, /\b(?:across|around|over|past|on|at|from|inside|into|through|of)\s+(?:(?:the|a|an)\s+)?([a-z][a-z0-9-]*)\b/);
  const word = target?.text.split(/\s+/).at(-1);
  // A short fixture query may name several components (sink bowl + sink rim). The semantic
  // resolver decides whether they touch or are ambiguous; explicit vocabulary precedes capitalised-place rules.
  if (word && vocab?.fixtures?.some((name) => boundary(norm(name), word))) return { subject: { kind: 'fixture', ref: word } };
  const place = /\b(?:across|around|over|past|on|at|from|inside|into|through|of)\s+(?:(?:the|a|an)\s+)?([A-Z][a-zA-Z0-9-]*)\b/.exec(sentence);
  if (place) return { subject: { kind: 'region', ref: norm(place[1]) } };
  if (target && word) {
    if (/^(?:room|hall|courtyard|campus|house|garden|building)$/.test(word)) return { subject: { kind: 'region', ref: word } };
    return fail('camera.parse.ambiguous', `"${word}" could name more than one kind of subject`, target, 'Is this a region, assembly, fixture, or entity?', [`region:${word}`, `assembly:${word}`, `fixture:${word}`, `entity:${word}`]);
  }
  return fail('camera.parse.missing', `"${sentence}" does not name a subject`, hit(lower, verbs.find((v) => v.verb === verb)!.pattern), 'What should the camera frame?');
}

export function parseSentence(sentence: string, vocab?: ParseVocab): ParseResult {
  if (!sentence.trim()) return fail('camera.parse.missing', 'camera direction is empty', null, 'What should the camera do?');
  const lower = sentence.toLowerCase();
  const deictic = hit(lower, /\b(?:this|that|these|those)\b/);
  if (deictic) return fail('camera.parse.deictic', `"${deictic.text}" has no referent in the sentence`, deictic,
    /\bactivity\b/.test(lower) ? 'Which activity are the people doing?' : `What does "${deictic.text}" refer to?`);
  const foundRaw = verbs.map(({ verb, pattern }) => ({ verb, h: hit(lower, pattern) })).filter((x) => x.h);
  const fly = foundRaw.find((f) => f.verb === 'fly_through');
  const found = foundRaw.filter((f) => f.verb !== 'hold' || !fly || !f.h || !fly.h || f.h.start < fly.h.end ||
    !/\bkitchen\b/.test(lower) || !/\blook\s+at\b/.test(f.h.text));
  if (!found.length) {
    const first = hit(lower, /\b[a-z]+\b/);
    return fail('camera.parse.unknown-verb', `no supported camera motion in "${sentence}"`, first, 'Which camera move do you mean?', verbs.map((v) => v.verb));
  }
  if (found.length > 1) return fail('camera.parse.ambiguous', `more than one camera motion is named: ${found.map((f) => f.verb).join(', ')}`,
    found[1].h, 'Which one move should this direction use?', found.map((f) => f.verb));
  const { verb } = found[0];
  const motion: MotionDraft = { verb };
  const dirText = lower.replace(/rule\s+of\s+thirds\s+(?:left|center|right)|(?:left|center|right)\s+third|close-up/g, '');
  const left = hit(dirText, /\bleft\b/), right = hit(dirText, /\bright\b/), up = hit(dirText, /\bup\b/), down = hit(dirText, /\bdown\b/);
  if ((verb === 'pan' || verb === 'dolly') && left && right) return fail('camera.parse.conflict', 'both left and right are specified', right, 'Should the camera move left or right?', ['left', 'right']);
  if ((verb === 'tilt' || verb === 'crane') && up && down) return fail('camera.parse.conflict', 'both up and down are specified', down, 'Should the camera move up or down?', ['up', 'down']);
  const cw = hit(lower, /\b(?:clockwise|cw)\b/), ccw = hit(lower, /\b(?:counterclockwise|anti-clockwise|ccw)\b/);
  if (verb === 'orbit' && cw && ccw) return fail('camera.parse.conflict', 'both clockwise and counterclockwise are specified', ccw, 'Which orbit direction?', ['cw', 'ccw']);
  const wrongDirection = ['pan', 'dolly'].includes(verb) ? up ?? down ?? cw ?? ccw :
    ['tilt', 'crane'].includes(verb) ? left ?? right ?? cw ?? ccw : verb === 'orbit' ? left ?? right ?? up ?? down : left ?? right ?? up ?? down ?? cw ?? ccw;
  if (wrongDirection) return fail('camera.parse.invalid', `"${wrongDirection.text}" is not a direction for ${verb}`, wrongDirection,
    `Which direction is intended for ${verb}?`);
  if (verb === 'pan' || verb === 'dolly') { if (left || right) motion.direction = left ? 'left' : 'right'; }
  if (verb === 'tilt' || verb === 'crane') { if (up || down) motion.direction = up ? 'up' : 'down'; }
  if (verb === 'orbit') { if (cw || ccw) motion.direction = ccw ? 'ccw' : 'cw'; }

  const speedPattern = new RegExp(`\\b${value}\\s*(deg(?:rees?)?|°|m|met(?:er|re)s?)\\s*(?:\\/\\s*s|per\\s+second)\\b`, 'i');
  const speedMatch = speedPattern.exec(lower);
  const durationPattern = new RegExp(`\\b(?:over|for|in)\\s+${value}\\s*(minutes?|mins?|min|seconds?|secs?|s)\\b`, 'i');
  const durationMatch = durationPattern.exec(lower);
  const secondSpeed = speedMatch && speedPattern.exec(lower.slice(speedMatch.index + speedMatch[0].length));
  if (secondSpeed) return fail('camera.parse.conflict', 'two speeds are specified', { text: secondSpeed[0], start: speedMatch!.index + speedMatch![0].length + secondSpeed.index, end: speedMatch!.index + speedMatch![0].length + secondSpeed.index + secondSpeed[0].length }, 'Which speed should apply?', [speedMatch![0], secondSpeed[0]]);
  const secondDuration = durationMatch && durationPattern.exec(lower.slice(durationMatch.index + durationMatch[0].length));
  if (secondDuration) return fail('camera.parse.conflict', 'two durations are specified', { text: secondDuration[0], start: durationMatch!.index + durationMatch![0].length + secondDuration.index, end: durationMatch!.index + durationMatch![0].length + secondDuration.index + secondDuration[0].length }, 'Which duration should apply?', [durationMatch![0], secondDuration[0]]);
  if (speedMatch && durationMatch) return fail('camera.parse.conflict', `"${durationMatch[0]}" and "${speedMatch[0]}" specify both duration and speed`,
    { text: speedMatch[0], start: speedMatch.index, end: speedMatch.index + speedMatch[0].length }, 'Give a duration or a speed, not both.', ['duration', 'speed']);
  const direction: CameraDirection = { subject: { kind: 'region', ref: '' }, motion: motion as CameraDirection['motion'] };
  if (speedMatch) {
    if (verb === 'hold') return fail('camera.parse.invalid', `"${speedMatch[0]}" cannot set speed for a hold`, { text: speedMatch[0], start: speedMatch.index, end: speedMatch.index + speedMatch[0].length }, 'Should this be a moving shot?');
    const angular = speedMatch[2].startsWith('deg') || speedMatch[2].startsWith('°');
    if (angular !== ['pan', 'tilt', 'orbit'].includes(verb)) return fail('camera.parse.invalid', `"${speedMatch[0]}" has the wrong speed unit for ${verb}`,
      { text: speedMatch[0], start: speedMatch.index, end: speedMatch.index + speedMatch[0].length }, 'Use degrees per second for pan, tilt or orbit; metres per second for moves.');
    direction.speed = numeric(speedMatch[1]);
  }
  if (durationMatch) direction.duration = numeric(durationMatch[1]) * (durationMatch[2].startsWith('m') ? 60 : 1);
  const atMatch = /\bat\s+(\d+):(\d{2})\b/.exec(lower);
  if (atMatch) {
    if (Number(atMatch[2]) >= 60) return fail('camera.parse.invalid', `"${atMatch[0]}" has an invalid seconds field`, { text: atMatch[0], start: atMatch.index, end: atMatch.index + atMatch[0].length }, 'What start time in minutes:seconds did you mean?');
    direction.at = Number(atMatch[1]) * 60 + Number(atMatch[2]);
  }
  const fovMatch = /\b(?:fov|field\s+of\s+view)\s*(?:of|=)?\s*(\d+(?:\.\d+)?)\s*(?:°|degrees?)?\b|\b(\d+(?:\.\d+)?)\s*(?:°|degrees?)\s+(?:vertical\s+)?(?:fov|field\s+of\s+view)\b/i.exec(lower);
  if (fovMatch) direction.fov = Number(fovMatch[1] ?? fovMatch[2]);
  const angleText = lower.replace(speedPattern, ' ').replace(/\b(?:fov|field\s+of\s+view)\s*(?:of|=)?\s*\d+(?:\.\d+)?\s*(?:°|degrees?)?/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:°|degrees?)\s+(?:vertical\s+)?(?:fov|field\s+of\s+view)\b/g, ' ');
  const angleMatch = new RegExp(`${value}\\s*(?:°|degrees?\\b|deg\\b)`, 'i').exec(angleText);
  let degrees = angleMatch ? numeric(angleMatch[1]) : undefined;
  if (degrees === undefined && /\bthree\s+quarters\s+of\s+a\s+turn\b/.test(lower)) degrees = 270;
  if (degrees === undefined && /\b(?:a\s+)?full\s+(?:circle|revolution|turn)\b|\ba\s+revolution\b/.test(lower)) degrees = 360;
  if (verb === 'orbit' && degrees === undefined) return fail('camera.parse.missing', 'orbit has no stated angle', found[0].h, 'How many degrees should the camera orbit, or is it a full circle?');
  if ((verb === 'pan' || verb === 'tilt' || verb === 'orbit') && degrees !== undefined) motion.degrees = degrees;
  if (!['pan', 'tilt', 'orbit'].includes(verb) && degrees !== undefined) return fail('camera.parse.invalid', `"${angleMatch?.[0] ?? 'turn'}" is not an angle for ${verb}`, hit(lower, /\b(?:°|degrees?|turn)\b/));
  const distanceText = lower.replace(speedPattern, ' ');
  const distance = new RegExp(`${value}\\s*(?:m|met(?:er|re)s?)\\b`, 'i').exec(distanceText);
  if (distance && verb !== 'dolly' && verb !== 'crane') return fail('camera.parse.invalid', `"${distance[0]}" is not a distance field for ${verb}`,
    { text: distance[0], start: distance.index, end: distance.index + distance[0].length }, 'Should this be a dolly or crane move?');
  if (distance) {
    if (verb === 'dolly') motion.distance = numeric(distance[1]);
    else motion.rise = numeric(distance[1]);
  }
  const subject = subjectOf(sentence, lower, verb, vocab);
  if ('ok' in subject) return subject;
  direction.subject = subject.subject;
  if (subject.interior || subject.lookAt) direction.context = { ...(subject.interior ? { interior: subject.interior } : {}), ...(subject.lookAt ? { lookAt: subject.lookAt } : {}) };
  if (/\bsunset\b/.test(lower) && /\b(?:behind|background)\b/.test(lower)) direction.context = { ...direction.context, sunBehind: { sunset: true } };
  else if (/\bsun\s+behind\b|\bbacklit\b/.test(lower)) direction.context = { ...direction.context, sunBehind: true };
  const framing: NonNullable<CameraDirection['framing']> = {};
  const sizeMatch = /\b(wide|medium|close)(?:\s+(?:shot|framing)|-up)\b/.exec(lower);
  if (sizeMatch) framing.size = sizeMatch[1] as NonNullable<CameraDirection['framing']>['size'];
  const thirds = /\brule\s+of\s+thirds\s+(left|center|right)\b|\b(left|center|right)\s+third\b/.exec(lower);
  if (thirds) framing.thirds = (thirds[1] ?? thirds[2]) as NonNullable<CameraDirection['framing']>['thirds'];
  const side = /\bfrom\s+the\s+(north(?:-east|-west)?|south(?:-east|-west)?|east|west)\b/.exec(lower);
  if (side) framing.side = side[1] as NonNullable<CameraDirection['framing']>['side'];
  if (Object.keys(framing).length) direction.framing = framing;
  const notes: string[] = [];
  if (/\bwide\s+lens\b/.test(lower) && !fovMatch) notes.push('wide lens has no numeric fov; lens choice left to the engine');
  const parsed = cameraDirectionSchema.safeParse(direction);
  if (!parsed.success || (direction.duration !== undefined && direction.speed !== undefined)) {
    const detail = parsed.success ? 'duration and speed cannot both be set' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return fail('camera.parse.invalid', `"${sentence}": ${detail}`, found[0].h, 'Which numeric constraint should be changed?');
  }
  return { ok: true, direction: parsed.data, notes };
}

export function parseSentences(text: string, vocab?: ParseVocab): ParseResult[] {
  return text.split(/\s*,?\s*\bthen\b\s*|[.!?]\s+/i).map((s) => s.trim()).filter(Boolean).map((s) => parseSentence(s, vocab));
}
