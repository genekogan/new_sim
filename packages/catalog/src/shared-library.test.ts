// Lane C16 `library`: the shared object library across worlds (publish → find from another world → place),
// version pinning, author + licence, restricted art never offered, the moderation seam, yank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldModel, applyBatch, coreLibrary, type StoredDef } from '@sim/world-compiler';
import { SharedLibrary, LibraryError, restrictedCoreAssets, openLicence, portableName, type WorldSource } from './shared-library.ts';
import { validateUpload, LibraryUploadRejected, type UploadGate } from './library-gate.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'shared-lib-'));
type Blob = { bytes: Uint8Array; ext: string; license?: string; source?: string; name?: string };
/** A minimal valid GLB (header + JSON chunk) whose bytes differ by `tag`. */
function glb(tag: string): Uint8Array {
  let json = JSON.stringify({ asset: { version: '2.0', generator: tag } });
  while (json.length % 4) json += ' ';
  const j = new TextEncoder().encode(json), out = new Uint8Array(20 + j.length), v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true); v.setUint32(12, j.length, true); v.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20); return out;
}
const sha = async (b: Uint8Array) => (await import('node:crypto')).createHash('sha256').update(b).digest('hex');

/** A world as a god sees it: a WorldModel on the core library, plus its own uploaded models. */
function world(slug: string) {
  const blobs = new Map<string, Blob>();
  const model = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: slug, assets: (h) => blobs.has(h) || restrictedCoreAssets().has(h) ? { tris: 12, bytes: blobs.get(h)?.bytes.length ?? 1000, textures: 0, box: [1, 1, 1] } : undefined });
  model.library = coreLibrary();
  let tick = 0;
  const act = (ops: unknown[]) => { const r = applyBatch(model, { ops } as never, 'god', ++tick); assert.ok(r.result.accepted, JSON.stringify(r.result)); return r; };
  const src: WorldSource = {
    world: slug,
    def: async (ref) => model.def(ref) as StoredDef | undefined,
    asset: async (h) => blobs.get(h) ?? (restrictedCoreAssets().has(h) ? { bytes: glb('core-' + h), ext: 'glb', license: restrictedCoreAssets().get(h) } : undefined),
  };
  const upload = async (b: Blob) => { const h = await sha(b.bytes); blobs.set(h, b); return h; };
  return { slug, model, act, src, upload, blobs };
}
/** Run a placement in a target world the way the CLI does: upload models, then one batch. */
async function placeInto(lib: SharedLibrary, w: ReturnType<typeof world>, spec: string, name: string, p: [number, number, number] = [0, 0, 0]) {
  const plan = lib.placement(spec, { world: w.slug, name, p, existing: (ref) => w.model.owns(ref) ? w.model.def(ref) : undefined });
  for (const a of plan.assets) await w.upload({ bytes: lib.assetBytes(a), ext: a.ext, license: a.licence });
  return { plan, result: w.act(plan.ops) };
}

const bench = { schema: 'def/1', name: 'garden-seat', version: 1, description: 'A carved garden seat for two, with a back. Sit on it to watch the pond.', tags: ['seat', 'garden'], form: 'point', make: { kind: 'parts', parts: [{ id: 'b', def: 'core-bench@1', at: [0, 0, 0] }, { id: 'l', def: 'core-lamp-post@1', at: [1.5, 0, 0] }] }, size: { box: [3, 2, 1] }, layer: 'solid', anchor: 'base' } as const;
const plinth = { schema: 'def/1', name: 'plinth', version: 1, description: 'A stone plinth.', form: 'point', make: { kind: 'parts', parts: [{ id: 'p', def: 'core-bench@1', at: [0, 0, 0] }] }, size: { box: [1, 0.5, 1] }, layer: 'solid', anchor: 'base' } as const;
const statue = { schema: 'def/1', name: 'pond-statue', version: 1, description: 'A heron statue on a plinth.', tags: ['statue'], form: 'point', make: { kind: 'parts', parts: [{ id: 'base', def: 'plinth@1', at: [0, 0, 0] }, { id: 'seat', def: 'garden-seat@1', at: [2, 0, 0] }] }, size: { box: [4, 2, 2] }, layer: 'solid', anchor: 'base' } as const;
const CC0 = { spdx: 'CC0-1.0' as const };

test('publish → find from another world → place: the item, its local dependencies and its core parts arrive', async () => {
  const root = tmp(); try {
    const lib = new SharedLibrary(root);
    const a = world('alpha'), b = world('beta');
    a.act([{ op: 'define', def: plinth }, { op: 'define', def: bench }, { op: 'define', def: statue }]);
    const { entry, created } = await lib.publish(a.src, 'pond-statue@1', { by: 'god:alpha-owner', licence: CC0, authorName: 'Ana' });
    assert.ok(created);
    assert.equal(entry.id, 'alpha/pond-statue'); assert.equal(entry.version, 1); assert.equal(entry.ref, 'lib-alpha-pond-statue@1');
    assert.deepEqual(entry.author, { world: 'alpha', by: 'god:alpha-owner', name: 'Ana' });
    assert.equal(entry.licence.spdx, 'CC0-1.0'); assert.equal(entry.licence.redistribute, true);
    assert.equal(entry.defs.length, 3, 'two local dependencies + the item'); assert.equal(entry.defs.at(-1)!.ref, entry.ref);
    assert.deepEqual(entry.core, ['core-bench@1', 'core-lamp-post@1']);
    // find, from the other world
    const hits = lib.find('heron statue', { forWorld: 'beta' });
    assert.equal(hits[0]?.id, 'alpha/pond-statue'); assert.equal(hits[0].mine, false); assert.ok(hits[0].why.length >= 1);
    assert.equal(lib.find('submarine', { forWorld: 'beta' }).length, 0);
    // place
    const { result } = await placeInto(lib, b, 'alpha/pond-statue', 'statue', [10, 0, 10]);
    const e = b.model.get('statue')!;
    assert.equal(e.def, 'lib-alpha-pond-statue@1');
    assert.equal(b.model.def(e.def)!.hash, entry.hash, 'the target computes the hash the library promised');
    assert.ok(result.diff!.upserts.length > 3, 'parts expanded (plinth, seat, bench, lamp)');
    assert.equal(b.model.owns('plinth@1'), false, 'no clash with local names: dependencies are renamed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('version-pinned: a republish is a new version; worlds keep the version they placed; publishing unchanged is idempotent', async () => {
  const root = tmp(); try {
    const lib = new SharedLibrary(root);
    const a = world('alpha'), b = world('beta');
    a.act([{ op: 'define', def: bench }]);
    const v1 = (await lib.publish(a.src, 'garden-seat@1', { by: 'god:a', licence: CC0 })).entry;
    assert.equal((await lib.publish(a.src, 'garden-seat@1', { by: 'god:a', licence: CC0 })).created, false);
    await placeInto(lib, b, 'alpha/garden-seat', 'seat-old');
    // the creator changes the seat (same name@v in their world) and publishes again
    a.act([{ op: 'define', def: { ...bench, description: 'A wider carved garden seat for three.', size: { box: [4, 2, 1] } } }]);
    const v2 = (await lib.publish(a.src, 'garden-seat@1', { by: 'god:a', licence: CC0 })).entry;
    assert.equal(v2.version, 2); assert.notEqual(v2.hash, v1.hash); assert.equal(v2.ref, 'lib-alpha-garden-seat@2');
    await placeInto(lib, b, 'alpha/garden-seat', 'seat-new', [8, 0, 0]);
    assert.equal(b.model.def(b.model.get('seat-old')!.def)!.hash, v1.hash, 'the old placement still resolves to v1');
    assert.equal(b.model.def(b.model.get('seat-new')!.def)!.hash, v2.hash);
    assert.deepEqual(b.model.resolvedDef(b.model.get('seat-old')!.def)!.size.box, [3, 2, 1]);
    // an explicit older version stays placeable; find shows both
    await placeInto(lib, b, 'alpha/garden-seat@1', 'seat-v1-again', [16, 0, 0]);
    assert.deepEqual(lib.find('garden seat', { forWorld: 'beta' })[0].versions, [1, 2]);
    // entries are write-once
    assert.deepEqual(readdirSync(join(root, 'entries/alpha/garden-seat')).sort(), ['1.json', '2.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('restricted art is never offered: Little Martians models, LM/Mars core parts, restrictive upload licences are refused and leave no trace', async () => {
  const root = tmp(); try {
    const lib = new SharedLibrary(root);
    const a = world('alpha');
    const lmAsset = [...restrictedCoreAssets()].find(([, l]) => /Little Martians/.test(l))![0];
    const lmDef = coreLibrary().all().find((d) => d.name.startsWith('core-lm-') && d.make.kind === 'mesh')!;
    a.act([
      { op: 'define', def: { schema: 'def/1', name: 'my-martian', version: 1, description: 'Mine now.', form: 'point', make: { kind: 'mesh', asset: lmAsset }, size: { box: [1, 1, 1] }, layer: 'solid', anchor: 'base' } },
      { op: 'define', def: { schema: 'def/1', name: 'lm-corner', version: 1, description: 'A corner with an LM thing.', form: 'point', make: { kind: 'parts', parts: [{ id: 'x', def: lmDef.ref, at: [0, 0, 0] }] }, size: { box: [2, 2, 2] }, layer: 'solid', anchor: 'base' } },
      { op: 'define', def: { schema: 'def/1', name: 'lm-kid', version: 1, description: 'Extends an LM def.', extends: lmDef.ref, form: 'point', make: { kind: 'none' }, size: { box: [1, 1, 1] }, layer: 'solid', anchor: 'base' } },
    ]);
    for (const ref of ['my-martian@1', 'lm-corner@1', 'lm-kid@1']) await assert.rejects(lib.publish(a.src, ref, { by: 'god:a', licence: CC0 }), (e: LibraryError) => e.code === 'library.restricted', ref);
    // an uploaded model whose licence forbids redistribution
    const nc = await a.upload({ bytes: glb('nc'), ext: 'glb', license: 'CC-BY-NC-4.0', source: 'someone' });
    a.act([{ op: 'define', def: { schema: 'def/1', name: 'nc-vase', version: 1, description: 'A vase.', form: 'point', make: { kind: 'mesh', asset: nc }, size: { box: [1, 1, 1] }, layer: 'solid', anchor: 'base' } }]);
    await assert.rejects(lib.publish(a.src, 'nc-vase@1', { by: 'god:a', licence: CC0 }), (e: LibraryError) => e.code === 'library.restricted');
    // a restricted licence can't be declared either
    a.act([{ op: 'define', def: bench }]);
    await assert.rejects(lib.publish(a.src, 'garden-seat@1', { by: 'god:a', licence: { spdx: 'third-party-restricted' } as never }), (e: LibraryError) => e.code === 'library.licence');
    assert.equal(existsSync(join(root, 'entries')), false, 'nothing stored');
    assert.equal(lib.find('', { forWorld: 'beta' }).length, 0);
    assert.ok(lib.ledger().filter((l) => l.op === 'refuse').length >= 5, 'refusals are on the ledger');
    assert.ok(restrictedCoreAssets().size > 300 && !openLicence('Vanessa Rosa (Little Martians); private') && openLicence('CC0 1.0') && openLicence('CC-BY-4.0') && !openLicence('CC-BY-NC-4.0'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a model of your own (CC0 or CC-BY) travels: stored once by sha, licence recorded, uploaded to the target before the define', async () => {
  const root = tmp(); try {
    const lib = new SharedLibrary(root);
    const a = world('alpha'), b = world('beta');
    const h = await a.upload({ bytes: glb('teapot'), ext: 'glb', license: 'CC-BY-4.0', source: 'https://example.org/teapot' });
    a.act([{ op: 'define', def: { schema: 'def/1', name: 'teapot', version: 1, description: 'A teapot.', tags: ['tea'], form: 'point', make: { kind: 'mesh', asset: h }, size: { box: [0.3, 0.2, 0.2] }, layer: 'decor', anchor: 'base' } }]);
    await assert.rejects(lib.publish(a.src, 'teapot@1', { by: 'god:a', licence: CC0 }), (e: LibraryError) => e.code === 'library.licence', 'a CC-BY model cannot be relabelled CC0');
    const { entry } = await lib.publish(a.src, 'teapot@1', { by: 'god:a', licence: { spdx: 'CC-BY-4.0', attribution: 'Teapot by Example', source: 'https://example.org/teapot' } });
    assert.deepEqual(entry.assets.map((x) => [x.sha, x.licence]), [[h, 'CC-BY-4.0']]);
    assert.ok(existsSync(join(root, `assets/${h}.glb`)));
    await placeInto(lib, b, 'alpha/teapot', 'pot');
    assert.ok(b.blobs.has(h)); assert.equal(b.model.def(b.model.get('pot')!.def)!.hash, entry.hash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('moderation: every def body and model passes the one gate; a refusal stores nothing; a stripping gate re-points the def', async () => {
  const root = tmp(); try {
    const a = world('alpha');
    const h = await a.upload({ bytes: glb('lamp'), ext: 'glb', license: 'CC0 1.0' });
    a.act([{ op: 'define', def: { schema: 'def/1', name: 'lamp', version: 1, description: 'A lamp.', form: 'point', make: { kind: 'mesh', asset: h }, size: { box: [0.4, 1, 0.4] }, layer: 'solid', anchor: 'base' } }]);
    const seen: string[] = [];
    const refusing: UploadGate = (bytes, policy) => { seen.push(policy.formats.join()); throw new LibraryUploadRejected('moderation.rejected', 'refused by the content check'); };
    await assert.rejects(new SharedLibrary(root, { gate: refusing }).publish(a.src, 'lamp@1', { by: 'god:a', licence: CC0 }), (e: Error) => /moderation.rejected/.test(e.message));
    assert.equal(existsSync(join(root, 'entries')), false); assert.equal(existsSync(join(root, 'assets')), false);
    // a gate that strips metadata (new bytes, new sha): the portable def points at what the gate kept
    const calls: string[] = [];
    const stripping: UploadGate = (bytes, policy) => { calls.push(policy.formats.join()); const g = validateUpload(bytes, policy); if (g.format !== 'glb') return g; const out = glb('lamp-stripped'); return validateUpload(out, policy); };
    const lib = new SharedLibrary(root, { gate: stripping, gateName: 'test-strip' });
    const { entry } = await lib.publish(a.src, 'lamp@1', { by: 'god:a', licence: CC0 });
    assert.equal(calls.length, 2, 'one model + one def body');
    assert.equal(entry.moderation.gate, 'test-strip'); assert.equal(entry.moderation.checked.length, 2);
    const kept = entry.assets[0].sha; assert.notEqual(kept, h); assert.equal(entry.assets[0].from, h);
    assert.equal((lib.defBody(entry.hash).make as { asset: string }).asset, kept);
    const b = world('beta'); await placeInto(lib, b, 'alpha/lamp', 'lamp'); assert.ok(b.blobs.has(kept));
    // the local stand-in gate's own refusals
    assert.throws(() => validateUpload(new TextEncoder().encode('<html>'), { formats: ['json'], maxBytes: 100 }), /upload.format/);
    assert.throws(() => validateUpload(new Uint8Array(200).fill(0x7b), { formats: ['json'], maxBytes: 100 }), /upload.size/);
    const ext = (() => { let j = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://x/y.bin', byteLength: 4 }] }); while (j.length % 4) j += ' '; const t = new TextEncoder().encode(j), o = new Uint8Array(20 + t.length), v = new DataView(o.buffer); v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, o.length, true); v.setUint32(12, t.length, true); v.setUint32(16, 0x4e4f534a, true); o.set(t, 20); return o; })();
    assert.throws(() => validateUpload(ext, { formats: ['glb'], maxBytes: 1e6 }), /upload.external/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('yank: gone from find and new placement; a world that placed it keeps it; a name clash in the target is refused', async () => {
  const root = tmp(); try {
    const lib = new SharedLibrary(root);
    const a = world('alpha'), b = world('beta'), c = world('gamma');
    a.act([{ op: 'define', def: bench }]);
    const { entry } = await lib.publish(a.src, 'garden-seat@1', { by: 'god:a', licence: CC0 });
    await placeInto(lib, b, 'alpha/garden-seat', 'seat');
    lib.yank('alpha/garden-seat@1', 'admin', 'test');
    assert.equal(lib.find('garden seat', { forWorld: 'gamma' }).length, 0);
    await assert.rejects(placeInto(lib, c, 'alpha/garden-seat@1', 'x'), (e: LibraryError) => e.code === 'library.yanked');
    assert.equal(b.model.def(b.model.get('seat')!.def)!.hash, entry.hash, 'the placed seat stays');
    // clash: the target already holds a different def under the library's ref
    const lib2 = new SharedLibrary(join(root, 'second'));
    const { entry: e2 } = await lib2.publish(a.src, 'garden-seat@1', { by: 'god:a', licence: CC0 });
    c.act([{ op: 'define', def: { ...bench, name: 'lib-alpha-garden-seat', description: 'An impostor.' } }]);
    await assert.rejects(placeInto(lib2, c, e2.id, 'y'), (e: LibraryError) => e.code === 'library.conflict');
    assert.equal(portableName('a-very-long-world-name-for-tests', 'an-equally-long-object-name-that-goes-on').length <= 48, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
