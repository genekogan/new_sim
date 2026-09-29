import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraDirectionSchema } from '../camera/direct.ts';
import { parseSentence, parseSentences, type ParseVocab } from '../camera/parse.ts';

const region = (ref = 'chiba') => ({ kind: 'region', ref });
const racks = { kind: 'assembly', ref: 'rack bay' };
const group = (ref = 'eat') => ({ kind: 'group', ref });
type Case = { sentence: string; direction: unknown; vocab?: ParseVocab; notes?: string[] };

const ownerCases: Case[] = [
  { sentence: 'do a pan across Chiba with the sunset in the background', direction: { subject: region(), motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } } },
  { sentence: 'do a 270° revolution around the main pallet racks over 2 minutes', direction: { subject: racks, motion: { verb: 'orbit', degrees: 270 }, duration: 120 } },
  { sentence: 'go inside the kitchen and face the sink', direction: { subject: region('kitchen-interior'), motion: { verb: 'fly_through' }, context: { interior: 'kitchen-interior', lookAt: 'sink' } } },
];

const cases: Case[] = [
  { sentence: 'pan across Chiba', direction: { subject: region(), motion: { verb: 'pan' } } },
  { sentence: 'pan left across Chiba', direction: { subject: region(), motion: { verb: 'pan', direction: 'left' } } },
  { sentence: 'pan 45° across Chiba', direction: { subject: region(), motion: { verb: 'pan', degrees: 45 } } },
  { sentence: 'pan 45 degrees across Chiba', direction: { subject: region(), motion: { verb: 'pan', degrees: 45 } } },
  { sentence: 'tilt up over Chiba', direction: { subject: region(), motion: { verb: 'tilt', direction: 'up' } } },
  { sentence: 'tilt down 30 degrees over Chiba', direction: { subject: region(), motion: { verb: 'tilt', direction: 'down', degrees: 30 } } },
  { sentence: 'dolly left past the racks', direction: { subject: racks, motion: { verb: 'dolly', direction: 'left' } } },
  { sentence: 'dolly right 5 meters past the racks', direction: { subject: racks, motion: { verb: 'dolly', direction: 'right', distance: 5 } } },
  { sentence: 'orbit 270° around the racks', direction: { subject: racks, motion: { verb: 'orbit', degrees: 270 } } },
  { sentence: 'revolve 90 degrees around the racks', direction: { subject: racks, motion: { verb: 'orbit', degrees: 90 } } },
  { sentence: 'do a full circle around the racks', direction: { subject: racks, motion: { verb: 'orbit', degrees: 360 } } },
  { sentence: 'do a revolution around the racks', direction: { subject: racks, motion: { verb: 'orbit', degrees: 360 } } },
  { sentence: 'orbit three quarters of a turn around the racks', direction: { subject: racks, motion: { verb: 'orbit', degrees: 270 } } },
  { sentence: 'orbit 90° clockwise around the racks', direction: { subject: racks, motion: { verb: 'orbit', degrees: 90, direction: 'cw' } } },
  { sentence: 'orbit 90° counterclockwise around the racks', direction: { subject: racks, motion: { verb: 'orbit', degrees: 90, direction: 'ccw' } } },
  { sentence: 'crane up over Chiba', direction: { subject: region(), motion: { verb: 'crane', direction: 'up' } } },
  { sentence: 'crane down 2 meters over Chiba', direction: { subject: region(), motion: { verb: 'crane', direction: 'down', rise: 2 } } },
  { sentence: 'rise over Chiba', direction: { subject: region(), motion: { verb: 'crane' } } },
  { sentence: 'push in on Chiba', direction: { subject: region(), motion: { verb: 'push_in' } } },
  { sentence: 'move in toward Chiba', direction: { subject: region(), motion: { verb: 'push_in' } } },
  { sentence: 'pull out from Chiba', direction: { subject: region(), motion: { verb: 'pull_out' } } },
  { sentence: 'back away from Chiba', direction: { subject: region(), motion: { verb: 'pull_out' } } },
  { sentence: 'fly through the kitchen', direction: { subject: region('kitchen-interior'), motion: { verb: 'fly_through' }, context: { interior: 'kitchen-interior' } } },
  { sentence: 'fly into the kitchen and look at the sink', direction: { subject: region('kitchen-interior'), motion: { verb: 'fly_through' }, context: { interior: 'kitchen-interior', lookAt: 'sink' } } },
  { sentence: 'hold on Chiba', direction: { subject: region(), motion: { verb: 'hold' } } },
  { sentence: 'watch the crowd of people eating', direction: { subject: group(), motion: { verb: 'hold' } } },
  { sentence: 'pan across Chiba over 2 minutes', direction: { subject: region(), motion: { verb: 'pan' }, duration: 120 } },
  { sentence: 'pan across Chiba for 30 s', direction: { subject: region(), motion: { verb: 'pan' }, duration: 30 } },
  { sentence: 'pan across Chiba in ten seconds', direction: { subject: region(), motion: { verb: 'pan' }, duration: 10 } },
  { sentence: 'pan 45° across Chiba at 10 deg/s', direction: { subject: region(), motion: { verb: 'pan', degrees: 45 }, speed: 10 } },
  { sentence: 'tilt 45° over Chiba at 5 degrees per second', direction: { subject: region(), motion: { verb: 'tilt', degrees: 45 }, speed: 5 } },
  { sentence: 'orbit 90° around the racks at 5 deg/s', direction: { subject: racks, motion: { verb: 'orbit', degrees: 90 }, speed: 5 } },
  { sentence: 'dolly across Chiba at 2 m/s', direction: { subject: region(), motion: { verb: 'dolly' }, speed: 2 } },
  { sentence: 'crane up over Chiba at 1 m/s', direction: { subject: region(), motion: { verb: 'crane', direction: 'up' }, speed: 1 } },
  { sentence: 'push in on Chiba at 1 m/s', direction: { subject: region(), motion: { verb: 'push_in' }, speed: 1 } },
  { sentence: 'pull out from Chiba at 1 m/s', direction: { subject: region(), motion: { verb: 'pull_out' }, speed: 1 } },
  { sentence: 'go inside the kitchen at 1 m/s', direction: { subject: region('kitchen-interior'), motion: { verb: 'fly_through' }, speed: 1, context: { interior: 'kitchen-interior' } } },
  { sentence: 'orbit 90° around the racks at 1:30', direction: { subject: racks, motion: { verb: 'orbit', degrees: 90 }, at: 90 } },
  { sentence: 'pan across Chiba wide shot', direction: { subject: region(), motion: { verb: 'pan' }, framing: { size: 'wide' } } },
  { sentence: 'pan across Chiba medium framing', direction: { subject: region(), motion: { verb: 'pan' }, framing: { size: 'medium' } } },
  { sentence: 'hold on Chiba close-up', direction: { subject: region(), motion: { verb: 'hold' }, framing: { size: 'close' } } },
  { sentence: 'pan across Chiba rule of thirds left', direction: { subject: region(), motion: { verb: 'pan' }, framing: { thirds: 'left' } } },
  { sentence: 'pan across Chiba rule of thirds right', direction: { subject: region(), motion: { verb: 'pan' }, framing: { thirds: 'right' } } },
  { sentence: 'hold on Chiba from the north-east', direction: { subject: region(), motion: { verb: 'hold' }, framing: { side: 'north-east' } } },
  { sentence: 'pan across Chiba with the sun behind', direction: { subject: region(), motion: { verb: 'pan' }, context: { sunBehind: true } } },
  { sentence: 'pan across Chiba fov 50', direction: { subject: region(), motion: { verb: 'pan' }, fov: 50 } },
  { sentence: 'hold on Chiba 35° fov', direction: { subject: region(), motion: { verb: 'hold' }, fov: 35 } },
  { sentence: 'hold on Chiba with a wide lens', direction: { subject: region(), motion: { verb: 'hold' } }, notes: ['wide lens has no numeric fov; lens choice left to the engine'] },
  { sentence: 'hold on Venus', vocab: { regions: ['Venus'] }, direction: { subject: region('Venus'), motion: { verb: 'hold' } } },
  { sentence: 'pan across the north rack building', vocab: { assemblies: ['north rack building'] }, direction: { subject: { kind: 'assembly', ref: 'north rack building' }, motion: { verb: 'pan' } } },
  { sentence: 'watch the crowd of people eating', vocab: { groups: ['eat'] }, direction: { subject: group(), motion: { verb: 'hold' } } },
  { sentence: 'go inside the kitchen and face the sink', vocab: { regions: ['kitchen-interior'], fixtures: ['sink'] }, direction: ownerCases[2].direction },
];

test('Gene’s four sentences yield the exact documented objects or a deictic question', () => {
  for (const { sentence, direction } of ownerCases) {
    const r = parseSentence(sentence);
    assert.equal(r.ok, true, sentence);
    if (r.ok) assert.deepEqual(r.direction, direction, sentence);
  }
  const r = parseSentence('look at this crowd of people having this activity');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.refusal.code, 'camera.parse.deictic');
    assert.match(r.refusal.question ?? '', /which activity/i);
    assert.deepEqual(r.refusal.span, [8, 12]);
  }
  const named = parseSentence('look at the crowd of people eating');
  assert.deepEqual(named, { ok: true, direction: { subject: group(), motion: { verb: 'hold' } }, notes: [] });
});

test('52 sentence → direction examples cover all verbs, units, framing, context and vocabulary', () => {
  assert.ok(cases.length >= 30);
  for (const { sentence, direction, vocab, notes } of cases) {
    const r = parseSentence(sentence, vocab);
    assert.equal(r.ok, true, `${sentence}: ${JSON.stringify(r)}`);
    if (!r.ok) continue;
    assert.deepEqual(r.direction, direction, sentence);
    assert.deepEqual(r.notes, notes ?? [], sentence);
    assert.deepEqual(cameraDirectionSchema.parse(r.direction), r.direction, sentence);
    assert.deepEqual(parseSentence(sentence, vocab), r, `determinism: ${sentence}`);
  }
});

// LM-010 public refusal contract: deliberate language boundaries, not pending synonyms.
// unknown-verb: no zoom; missing: supply orbit angle / subject / activity; deictic: no implicit selection;
// ambiguous: ask before choosing; conflict: contradictory constraints; invalid: unsupported units / ranges.
const refusalContract = [
  ['orbit the racks', 'camera.parse.missing', 'question'],
  ['pan left across Chiba to the right', 'camera.parse.conflict', 'candidates'],
  ['orbit 90° around the racks over 2 minutes at 10 deg/s', 'camera.parse.conflict', 'candidates'],
  ['zoom in on Chiba', 'camera.parse.unknown-verb', 'question'],
  ['look at that', 'camera.parse.deictic', 'question'],
  ['look at the crowd of people', 'camera.parse.missing', 'question'],
  ['hold on a sculpture', 'camera.parse.ambiguous', 'candidates'],
  ['pan and tilt over Chiba', 'camera.parse.ambiguous', 'candidates'],
  ['orbit 2000° around the racks', 'camera.parse.invalid', 'question'],
  ['pan 200° across Chiba', 'camera.parse.invalid', 'question'],
  ['dolly past the racks at 10 deg/s', 'camera.parse.invalid', 'question'],
  ['orbit 90° clockwise and counterclockwise around the racks', 'camera.parse.conflict', 'candidates'],
  ['tilt up and down over Chiba', 'camera.parse.conflict', 'candidates'],
  ['pan up across Chiba', 'camera.parse.invalid', 'question'],
  ['pan 2 meters across Chiba', 'camera.parse.invalid', 'question'],
  ['hold on Chiba at 2 m/s', 'camera.parse.invalid', 'question'],
  ['hold on Chiba at 1:90', 'camera.parse.invalid', 'question'],
  ['pan across Chiba over 2 minutes for 30 seconds', 'camera.parse.conflict', 'candidates'],
  ['pan across Chiba at 10 deg/s and 5 deg/s', 'camera.parse.conflict', 'candidates'],
  ['', 'camera.parse.missing', 'question'],
] as const;

test('LM-010 refusal contract: unsupported or incomplete phrases ask instead of guessing', () => {
  for (const [sentence, code, detail] of refusalContract) {
    const r = parseSentence(sentence);
    assert.equal(r.ok, false, sentence);
    if (r.ok) continue;
    assert.equal(r.refusal.code, code, sentence);
    assert.ok(r.refusal[detail], `${sentence}: ${JSON.stringify(r.refusal)}`);
    assert.equal(r.refusal.span?.length, 2, sentence);
    assert.ok((r.refusal.span?.[1] ?? -1) >= (r.refusal.span?.[0] ?? 0), sentence);
    assert.deepEqual(parseSentence(sentence), r, `determinism: ${sentence}`);
  }
});

test('multi-direction text splits at then and sentence boundaries', () => {
  const r = parseSentences('Pan across Chiba, then orbit 90° around the racks. Hold on Chiba');
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => x.ok));
  assert.deepEqual(r.map((x) => x.ok ? x.direction.motion.verb : 'refused'), ['pan', 'orbit', 'hold']);
  assert.deepEqual(parseSentences('Pan across Chiba, then orbit 90° around the racks. Hold on Chiba'), r);
});

test('LM-010 wide lens is an explicit note, never an invented field of view', () => {
  const r = parseSentence('hold on Chiba with a wide lens');
  assert.ok(r.ok);
  assert.equal(r.direction.fov, undefined);
  assert.deepEqual(r.notes, ['wide lens has no numeric fov; lens choice left to the engine']);
  const explicit = parseSentence('hold on Chiba with a wide lens fov 70');
  assert.ok(explicit.ok);
  assert.equal(explicit.direction.fov, 70);
  assert.deepEqual(explicit.notes, []);
});
