// Dedicated extension of the existing five-case fixture. The caller supplies the
// shared fixture/binder; this lane does not copy or edit those owner's files.
export const PHOTOGRAPHER_FIXTURE_VERSION = 'photographer-fixture/1';
export const PHOTOGRAPHER_LIMITS = Object.freeze({ images: 10, results: 11, evaluations: 8, jobStarts: 22, wallSeconds: 240 });
const BASE_IDS = ['landmark', 'enclosed-room', 'interior-seat', 'lake', 'wall-artwork'];

const roofCover = {
  schema: 'def/1', name: 'photographer-roof-cover', version: 1,
  description: 'A low, opaque roof cover used only in the disposable photographer fixture.',
  tags: ['building'], size: { box: [14, 2.4, 12], scale: [.5, 1] },
  make: { kind: 'gen', gen: 'building/1', args: { style: 'shed' } },
  params: { w: { type: 'number', default: 14 }, d: { type: 'number', default: 12 },
    floorHeight: { type: 'number', default: 2.4 }, floors: { type: 'int', default: 1, min: 1, max: 1 },
    roof: { type: 'enum', values: ['flat'], default: 'flat' }, windows: { type: 'number', default: 0 } },
  components: { foundation: { kind: 'none' } },
};
const unknownCover = {
  schema: 'def/1', name: 'photographer-opaque-cover', version: 1,
  description: 'An opaque unclassified slab, not evidence of a wall or roof.',
  tags: ['fixture'], size: { box: [7, .16, 6] }, anchor: 'base',
  make: { kind: 'gen', gen: 'box/1' },
  params: { w: { type: 'number', default: 7 }, h: { type: 'number', default: .16 }, d: { type: 'number', default: 6 } },
};

export function photographerFixture(base) {
  if (base.cases.map(c => c.id).join() !== BASE_IDS.join()) throw Error('photographer requires the unchanged five-case fixture');
  return { version: PHOTOGRAPHER_FIXTURE_VERSION, genesis: structuredClone(base.genesis),
    cases: structuredClone(base.cases), limits: PHOTOGRAPHER_LIMITS,
    steps: [
      ...BASE_IDS.map(id => ({ id: `base:${id}`, binding: id, expected: 'ordinary-or-honest-unavailable' })),
      { id: 'declared-front-rotation', binding: 'interior-seat', expected: 'declared-front' },
      { id: 'entrance-occluder', binding: 'hall-exterior', expected: 'ordinary-facade-preserved' },
      { id: 'classified-roof', binding: 'interior-seat', expected: 'useful-labelled-cutaway-required' },
      { id: 'transformed-authored', binding: 'interior-seat', expected: 'authored' },
      { id: 'unclassified-obstruction', binding: 'interior-seat', expected: 'unavailable-no-cutaway' },
      { id: 'invalid-authored', binding: 'interior-seat', expected: 'unavailable', optional: true },
    ] };
}

export function bindPhotographerFixture(fixture, entities, targets, bindCases) {
  const bindings = bindCases(fixture.cases, entities, targets);
  const room = bindings.find(b => b.id === 'enclosed-room');
  if (!room?.slot || room.slot === 'ground' || !room.ref.startsWith(`${room.entity}/slot/`))
    throw Error('photographer must bind the actual published room, not a guessed floor');
  const exterior = targets.find(t => t.ref === room.entity);
  if (!exterior) throw Error('missing published hall exterior');
  return [...bindings, { id: 'hall-exterior', target: 'hall', entity: room.entity, ref: exterior.ref,
    title: exterior.title, point: exterior.point }];
}

// Each edit is a separate variant of the original fixture, not cumulative tuning.
// Entity about is replaced by set; preserve all authored semantics explicitly.
export function photographerEdit(id, entities) {
  const named = name => { const e = entities.find(e => e.name === name); if (!e) throw Error(`missing fixture entity ${name}`); return e; };
  const seat = named('podium'), hall = named('hall');
  const about = patch => ({ op: 'set', id: seat.id, about: { ...structuredClone(seat.about ?? {}), ...patch } });
  if (id === 'declared-front-rotation') return [
    { op: 'move', id: hall.id, r: 90 }, { op: 'move', id: seat.id, r: 90 }, about({ front: [0, 1] }),
  ];
  if (id === 'entrance-occluder') return [
    { op: 'place', def: 'core/wall@1', name: 'photographer-entrance-screen', p: [0, 8],
      params: { w: 16, h: 6, d: .25 }, about: { title: 'Entrance screen', what: 'An actual opaque wall in front of the lecture hall.' } },
  ];
  if (id === 'classified-roof') return [
    { op: 'define', def: structuredClone(roofCover) },
    { op: 'place', def: 'photographer-roof-cover@1', name: 'photographer-roof-cover',
      in: { parent: hall.id, slot: 'ground' }, p: [0, 0, -1], s: .5 },
  ];
  if (id === 'transformed-authored') return [
    { op: 'move', id: hall.id, p: [1, 1], r: 90 }, { op: 'move', id: seat.id, p: [0, 0, -1.5], r: 90 },
    about({ front: [1, 0], viewpoint: { eye: [2, 1.05, 1], at: [0, .45, 0] } }),
  ];
  if (id === 'unclassified-obstruction') return [
    { op: 'define', def: structuredClone(unknownCover) },
    { op: 'place', def: 'photographer-opaque-cover@1', name: 'photographer-opaque-cover',
      in: { parent: hall.id, slot: 'ground' }, p: [0, 1.2, -1] },
  ];
  if (id === 'invalid-authored') return [about({ viewpoint: { eye: [0, 1.5, -3], at: [0, .45, 0] } })];
  throw Error(`unknown photographer edit ${id}`);
}

// No geometry/visibility is inferred by this manifest. A runner must retain every
// unavailable result and independently inspect actual PNGs before qualifying it.
export function assertPhotographerBudget(results) {
  if (results.length > PHOTOGRAPHER_LIMITS.results) throw Error('photographer result ceiling');
  if (results.filter(r => r.url || r.imageSha).length > PHOTOGRAPHER_LIMITS.images) throw Error('photographer image ceiling');
  // Real manifests persist PhotoChoice as photo. presentation describes fixed
  // daylight/source policy and must never substitute for candidate evidence.
  for (const r of results) if ((r.photo?.scores ?? r.photo?.diagnostics ?? []).length > PHOTOGRAPHER_LIMITS.evaluations)
    throw Error('photographer evaluation ceiling');
}
