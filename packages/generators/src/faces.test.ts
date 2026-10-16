// XP8 faces: schema, side resolution and refusals (the viewer half is apps/web/src/gen-mesh/faces.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kitArgs, kitGen, kitPhysics, kitShapeTriangles } from './kit.ts';
import { expandKitProgram } from './kit-program.ts';
import { decalSchema, faceContentIssues, faceLocalSide, FACE_LIMITS } from './faces.ts';
import { buildingParams, buildingPhysics } from './building.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/faces-kits.json', import.meta.url), 'utf8'));
const board = (faces: unknown[], shape: Record<string, unknown> = {}, v = 2) => kitArgs.safeParse({ v, shapes: [{ kind: 'box', at: [0, 1, 0], size: [1.2, 0.8, 0.05], faces, ...shape }] });
const refusal = (r: ReturnType<typeof board>, path: (string | number)[], message: RegExp) => {
  assert.equal(r.success, false, 'expected refusal');
  if (r.success) return;
  const issue = r.error.issues.find(i => JSON.stringify(i.path.slice(0, path.length)) === JSON.stringify(path)) ?? r.error.issues[0];
  assert.deepEqual(issue.path.slice(0, path.length), path, JSON.stringify(r.error.issues));
  assert.match(issue.message, message); assert.match(issue.message, /fix: /);
};

test('a menu board is one kit with text faces; faces add their triangles and no colliders', () => {
  const args = kitArgs.parse(fixtures.menuBoard.make.args); assert.equal(kitGen.args!.safeParse(fixtures.menuBoard.make.args).success, true);
  const faced = args.shapes[2];
  assert.equal(faced.faces?.length, 3);
  assert.deepEqual(faced.faces?.[1].text, ['Tea\t2', 'Coffee\t3', 'Cake\t4', 'Soup of the day\t6']);
  const plain = kitPhysics({ ...fixtures.menuBoard.make.args, shapes: fixtures.menuBoard.make.args.shapes.map(({ faces: _f, ...s }: Record<string, unknown>) => s) });
  const withFaces = kitPhysics(fixtures.menuBoard.make.args);
  assert.equal(withFaces.tris - plain.tris, 6, 'three box faces are two triangles each');
  assert.deepEqual(withFaces.colliders, plain.colliders); assert.deepEqual(withFaces.box, plain.box);
});

test('a stained-glass window is one face on a pointed extrude panel; the face takes the cap that looks front', () => {
  const expanded = expandKitProgram(fixtures.stainedGlassWindow.make.args);
  const pane = expanded.shapes.find(s => s.faces)!;
  assert.equal(pane.kind, 'extrude'); assert.equal(pane.faces!.length, 1); assert.equal(pane.faces![0].pattern, 'stained-glass');
  assert.deepEqual(faceLocalSide(pane, 'front'), { local: 'bottom', align: faceLocalSide(pane, 'front').align });
  assert.ok(faceLocalSide(pane, 'front').align > 0.99);
  assert.equal(faceLocalSide(pane, 'back').local, 'top');
  const lancet = pane.polygon!.length;
  assert.equal(kitShapeTriangles(pane, expanded.round, 2) - kitShapeTriangles({ ...pane, faces: undefined }, expanded.round, 2), lancet, 'the face is the outline triangulated');
  assert.equal(kitGen.args!.safeParse(fixtures.mosaicMedallion.make.args).success, true);
});

test('side names are in the kit frame after the shape turns; scale is ignored so mirrored copies carry faces to the mirror side', () => {
  assert.equal(faceLocalSide({ kind: 'box' }, 'front').local, 'front');
  assert.equal(faceLocalSide({ kind: 'box', yaw: Math.PI / 2 }, 'front').local, 'left');
  assert.equal(faceLocalSide({ kind: 'box', yaw: Math.PI }, 'right').local, 'left');
  assert.equal(faceLocalSide({ kind: 'box', pitch: -Math.PI / 2 }, 'top').local, 'front', 'pitch -π/2 turns +z up');
  assert.equal(faceLocalSide({ kind: 'extrude' }, 'top').local, 'top');
  assert.ok(faceLocalSide({ kind: 'extrude', pitch: -Math.PI / 2 }, 'top').align < 0.5, 'edge-on');
  const mirrored = expandKitProgram({ v: 2, box: [3, 1, 1], shapes: [{ kind: 'box', at: [1, 0.5, 0], size: [0.5, 0.5, 0.5], mirror: 'x', faces: [{ side: 'right', text: 'R' }] }] });
  assert.equal(mirrored.shapes.length, 2);
  for (const s of mirrored.shapes) assert.deepEqual(s.faces, [{ side: 'right', text: 'R' }]);
  assert.equal(mirrored.shapes[1].scale?.[0], -1, 'the copy is reflected; the viewer draws its +x side at kit −x');
});

test('faces refuse at their field with a fix: legacy contract, wrong primitive, two contents, inert and unknown fields', () => {
  refusal(kitGen.args!.safeParse({ v: 1, shapes: [{ kind: 'box', at: [0, 1, 0], size: [1.2, 0.8, 0.05], faces: [{ text: 'Hi' }] }] }) as ReturnType<typeof board>, ['shapes', 0, 'faces'], /requires kit contract 2/);
  refusal(board('not a list' as never), ['shapes', 0, 'faces'], /faces: .*fix: give faces as a list/);
  refusal(board([{ text: 'Hi' }], { kind: 'cyl', size: undefined, r: 0.5, h: 1 }), ['shapes', 0, 'faces'], /no effect on cyl/);
  refusal(board([{ text: 'Hi', pattern: 'mosaic' }]), ['shapes', 0, 'faces', 0, 'pattern'], /one thing/);
  refusal(board([{ side: 'front' }]), ['shapes', 0, 'faces', 0, 'text'], /needs text, image or pattern/);
  refusal(board([{ text: 'Hi', seed: 3 }]), ['shapes', 0, 'faces', 0, 'seed'], /no effect without pattern/);
  refusal(board([{ pattern: 'mosaic', ink: '#ffffff' }]), ['shapes', 0, 'faces', 0, 'ink'], /no effect without text/);
  refusal(board([{ text: 'Hi', media: true }]), ['shapes', 0, 'faces', 0, 'media'], /not a face field/);
  refusal(board([{ text: 'Hi', url: 'https://example.invalid/a.png' }]), ['shapes', 0, 'faces', 0, 'url'], /not a face field/);
  refusal(board([{ text: Array.from({ length: 13 }, (_, i) => `line ${i}`).join('\n') }]), ['shapes', 0, 'faces', 0, 'text'], /13 lines/);
  refusal(board([{ text: 'x'.repeat(65) }]), ['shapes', 0, 'faces', 0, 'text'], /exceeds 64/);
  refusal(board([{ text: 'bell\u0007' }]), ['shapes', 0, 'faces', 0, 'text'], /control characters/);
  assert.equal(board(Array.from({ length: 7 }, () => ({ text: 'x' }))).success, false, 'at most six faces per shape');
});

test('images are only this world\'s /assets/<sha>.png|jpg paths; everything else refuses with an upload fix', () => {
  const sha = 'c'.repeat(64);
  for (const image of [`/assets/${sha}.png`, `/assets/${sha}.jpg`]) assert.equal(board([{ image }]).success, true, image);
  for (const image of ['https://example.invalid/a.png', '//example.invalid/a.png', 'data:image/png;base64,AAAA', 'blob:x', `/w/other/assets/${sha}.png`, `/assets/${sha}.svg`, `/assets/${sha}.png?x=1`, `/assets/../${sha}.png`, 'javascript:alert(1)']) {
    refusal(board([{ image }]), ['shapes', 0, 'faces', 0, 'image'], /POST \/v1\/god\/assets/);
  }
});

test('a stored contract-1 kit with a stray `faces` still parses, bakes and counts as before; only admission refuses it', () => {
  // Before XP8 a v1 shape skipped unknown fields; stored defs may carry any value there.
  for (const stray of [[{ text: 'Hi' }], 'legacy', { side: 'front' }, [{ bogus: 1 }]]) {
    const def = { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 0.2], faces: stray }] }, plain = { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 0.2] }] };
    assert.equal(kitArgs.safeParse(def).success, true, JSON.stringify(stray));
    assert.deepEqual(kitPhysics(def), kitPhysics(plain), 'the bake ignores it (tris and colliders as before)');
    assert.equal(expandKitProgram(def).shapes.length, 1);
    refusal(kitGen.args!.safeParse(def) as ReturnType<typeof board>, ['shapes', 0, 'faces'], /requires kit contract 2/);
  }
});

test('box faces fit their side; extrude faces take the outline; an edge-on side refuses', () => {
  assert.equal(board([{ text: 'Hi', w: 1, h: 0.5, at: [0.05, 0.1] }]).success, true);
  refusal(board([{ text: 'Hi', w: 1.3 }]), ['shapes', 0, 'faces', 0, 'w'], /does not fit the front side/);
  refusal(board([{ text: 'Hi', at: [0, 0.5] }]), ['shapes', 0, 'faces', 0, 'at'], /does not fit/);
  assert.equal(board([{ text: 'Hi', side: 'right' }]).success, false, 'a 5 cm edge is all bevel');
  assert.equal(board([{ text: 'Hi', side: 'right' }], { round: 0 }).success, true, 'a sharp 5 cm edge can carry a face');
  const panel = (face: Record<string, unknown>, pitch = -Math.PI / 2) => kitArgs.safeParse({ v: 2, shapes: [{ kind: 'extrude', at: [0, 0, 0], pitch, h: 0.05, polygon: [[-0.5, 0], [0.5, 0], [0.5, 1.5], [-0.5, 1.5]], faces: [face] }] });
  assert.equal(panel({ pattern: 'stained-glass' }).success, true);
  refusal(panel({ pattern: 'stained-glass', w: 0.5 }), ['shapes', 0, 'faces', 0, 'w'], /outline/);
  refusal(panel({ pattern: 'stained-glass', side: 'top' }), ['shapes', 0, 'faces', 0, 'side'], /edge-on/);
});

test('a kit carries at most 32 faces after programs expand', () => {
  const kit = (n: number, face: Record<string, unknown> = { text: 'x' }) => ({ v: 2, box: [40, 1, 1], shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [0.5, 0.5, 0.5], repeat: { n, step: [1, 0, 0] }, faces: [face] }] });
  assert.equal(expandKitProgram(kit(FACE_LIMITS.perKit)).shapes.length, FACE_LIMITS.perKit);
  assert.throws(() => expandKitProgram(kit(FACE_LIMITS.perKit + 1)), /33 faces after expansion exceed 32/);
  assert.throws(() => expandKitProgram(kit(2, { text: 'x', bogus: 1 })), /not a face field/, 'program shapes keep face field checks');
});

test('building decals are an optional json param with today\'s look by default; the physics ignore them', () => {
  assert.equal(buildingParams.decals.type, 'json');
  const shop = { style: 'shop', w: 8, d: 9, floors: 2 }, plain = buildingPhysics(shop), decorated = buildingPhysics({ ...shop, decals: fixtures.shopDecals });
  assert.deepEqual(decorated, plain);
  for (const d of fixtures.shopDecals) { assert.equal(decalSchema.safeParse(d).success, true); assert.deepEqual(faceContentIssues(d, true), []); assert.ok(plain.slots.some(s => s.id === d.slot && s.kind === 'wall'), d.slot); }
  assert.match(faceContentIssues({ slot: 'facade-f0-s-1', w: 1, h: 1, text: 'x', side: 'front' }, true)[0].message, /not a face field/);
});
