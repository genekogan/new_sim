import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../db.ts';
import { moderationFor } from '../moderation/store.ts';
import { GodMode } from './god.ts';
import { contextScene, contextTargets } from './context-view-scene.ts';
import { ContextPreparation, prepareContextScene, prepareContextTargets } from './context-preparation.ts';

function fixture(genesis?: unknown) {
    const db = new Db(':memory:');
    const god = new GodMode(db, { worldId: 'context-preparation', ownerId: null, tick: () => 0, emit() {}, assetDir: mkdtempSync(join(tmpdir(), 'context-preparation-')), ...(genesis ? { genesis: genesis as never } : {}) });
    if (!genesis) assert.equal(god.act({ ops: [
        { op: 'place', def: 'core/bench@1', name: 'bench', p: [0, 0] },
        { op: 'place', def: 'core/bird@1', name: 'bird', p: [20, 0] },
    ] }).accepted, true);
    return { god, db };
}
const job = (check = () => {}, signal = new AbortController().signal) => new ContextPreparation(check, signal, 0);

test('cooperative scene and target output preserve exact canonical JSON hash and rows', async () => {
    const { god, db } = fixture();
    try {
        for (const hidden of [new Set<string>(), new Set(['f'.repeat(64)])]) {
            const before = contextScene(god, hidden), after = await prepareContextScene(god, hidden, job());
            assert.equal(after.key, before.key);
            assert.deepEqual(after.snapshot, before.snapshot);
        }
        assert.deepEqual(await prepareContextTargets(god.model, job()), contextTargets(god.model).sort((a, b) => a.ref.localeCompare(b.ref)));
    } finally { db.close(); }
});

test('a captured scene remains coherent when actual engine writes replace rows during a yield', async () => {
    const { god, db } = fixture();
    try {
        const before = contextScene(god, new Set()), old = god.model.get('bench')!;
        const pending = prepareContextScene(god, new Set(), job());
        const moved = god.engineAct([{ op: 'move', id: old.id, mode: 'strict', p: [5, 0] }], 'snapshot replacement regression');
        assert.equal(moved.accepted, true);
        assert.notEqual(god.model.get(old.id), old);
        const prepared = await pending;
        assert.equal(prepared.key, before.key);
        assert.equal(prepared.revision, before.snapshot.seq);
        assert.deepEqual(prepared.snapshot, before.snapshot);
        assert.notEqual(contextScene(god, new Set()).key, before.key);
    } finally { db.close(); }
});

test('authored/moderation supersession and close abort discard preparation before publication', async () => {
    const { god, db } = fixture();
    try {
        const moderation = moderationFor(db.db, god.opts.worldId);
        let revision = god.model.editSeq;
        const unsubscribe = god.onCommit(() => { revision = god.model.editSeq; });
        const token = () => `${revision}:${moderation.version()}`;
        for (const change of [
            () => assert.equal(god.act({ ops: [{ op: 'set', id: god.model.get('bench')!.id, about: { title: 'Changed during preparation' } }] }).accepted, true),
            () => moderation.append({ sha: 'f'.repeat(64), action: 'hide', actor: 'test', role: 'creator' }),
        ]) {
            const frontier = token();
            const pending = prepareContextScene(god, new Set(moderation.hidden()), job(() => { if (token() !== frontier) throw Error('superseded'); }));
            change();
            await assert.rejects(pending, /superseded/);
        }
        unsubscribe();
        const abort = new AbortController();
        const closing = prepareContextTargets(god.model, job(() => {}, abort.signal));
        abort.abort(new Error('closed'));
        await assert.rejects(closing, /closed/);
    } finally { db.close(); }
});

test('unchanged offline Eden preserves exact scene hash under cooperative preparation', async () => {
    const genesis = JSON.parse(readFileSync(new URL('../../../../worlds/templates/eden-2026.json', import.meta.url), 'utf8'));
    const { god, db } = fixture(genesis);
    try {
        assert.equal(god.model.entities.size, 4935);
        const before = contextScene(god, new Set());
        const after = await prepareContextScene(god, new Set(), new ContextPreparation(() => {}, new AbortController().signal));
        assert.equal(after.key, before.key);
        assert.deepEqual(after.snapshot, before.snapshot);
    } finally { db.close(); }
});
