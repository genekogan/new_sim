import { contextStage } from './context-timing.ts';
import { ContextPreparation, prepareContextTargets, prepareContextScene, captureContextFrontier } from './context-preparation.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Context, Hono } from 'hono';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import type { GodMode } from './god.ts';
import { ApiError } from '../souls.ts';
import { moderationFor } from '../moderation/store.ts';
import { ContextViewCache, CONTEXT_LIMITS, contextHash, type ContextInput } from './context-view-cache.ts';
import { contextScene, contextTargets, contextEnclosed, contextRoom, contextVisibleEntityIds, contextFront, type ContextTarget } from './context-view-scene.ts';
import { renderContextSheet } from './context-sheet-job.ts';
import { hostRenderSlot } from './host-render-slot.ts';
import { renderLook } from './look-renderer.ts';
import { lookSchema } from './look.ts';
import { supportY } from './nav.ts';
import { contextRegionsOverlap } from './context-view-access.ts';
import { PlaceIndex, type Place } from '../edge/ledger/places.ts';
export const CONTEXT_PRESENTATION = { source: 'architectural-context', lighting: 'fixed clear late morning (2026-06-21 10:30)', doors: 'definition default', omitted: ['Souls', 'carried and carryable items', 'live wildlife', 'live simulation clock'], live: false } as const;
const live = new Map<ContextViewCache, () => Promise<void>>();
/** Pending rows already live in SQLite. Bound cleanup even if a renderer fails to honor abort. */
export async function closeContextViews(timeoutMs = 3000) {
    const closing = Promise.allSettled([...live.values()].map(close => close()));
    live.clear();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([closing, new Promise<void>(r => { timer = setTimeout(r, timeoutMs); })]);
    }
    finally {
        clearTimeout(timer);
    }
}
type Deps = {
    god: GodMode;
    edge: EdgeLedger;
    worldUrl: string;
    build?: string;
    levelAt?: (x: number, z: number, y: number) => number;
    contextReady?: () => boolean;
    waitForContext?: (signal: AbortSignal) => Promise<void>;
    soul(c: Context): string | null;
    limit(c: Context): void;
    renderer?: (input: ContextInput, signal: AbortSignal) => Promise<{
        png?: Uint8Array;
        reason?: string;
    }>;
};
type Selection = {
    ref: string;
    detail: boolean;
};
type Tile = Selection & {
    key: string;
};
const searchText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const imageRef = (r: Selection) => r.ref + (r.detail ? ':detail' : '');
const sheetRef = (refs: Selection[]) => 'sheet:' + JSON.stringify(refs.map(({ ref, detail }) => ({ ref, detail })));
const sheetKey = (refs: Tile[]) => contextHash(['context-sheet/2', refs.map(({ ref, detail, key }) => ({ ref, detail: detail === true, key }))]);
export function mountContextViews(app: Hono, d: Deps) {
    const { god, edge } = d, moderation = moderationFor(god.db.db, god.opts.worldId);
    let committedRevision = god.model.editSeq, stamp = '';
    let scene: ReturnType<typeof contextScene> | undefined;
    let targets: ContextTarget[] = [];
    let byRef = new Map<string, ContextTarget>(), visibleEntities = new Set<string>();
    let textByRef = new Map<string, string>();
    let cache: ContextViewCache;
    const lifetime = new AbortController();
    let preparing: Promise<void> | null = null, sceneStamp = '';
    let preparedModel: typeof god.model | undefined;
    const semanticUpdates = new Map<string, typeof god.model.entities extends Map<string, infer E> ? E : never>();
    let previousEntities = new Map(god.model.entities);
    let sceneRows = new Map<string, number>();
    const token = () => `${committedRevision}:${moderation.version()}`;
    const current = () => {
        if (stamp !== token()) throw new ApiError(503, 'context.pending', 'World context preparation is pending');
        return { revision: committedRevision };
    };
    const waitPreparation = (pending: Promise<void>, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
        const abort = () => { cleanup(); reject(signal.reason); };
        const cleanup = () => signal.removeEventListener('abort', abort);
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        pending.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    });
    const prepareWork = async (needsScene: boolean, callerSignal: AbortSignal) => {
        const signal = AbortSignal.any([callerSignal, lifetime.signal, AbortSignal.timeout(3000)]);
        for (;;) {
            signal.throwIfAborted();
            const wanted = token();
            if (stamp === wanted && (!needsScene || sceneStamp === wanted && scene)) return;
            if (!preparing) {
                const jobSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000)]);
                const guard = () => { if (token() !== wanted) throw new Error('context preparation superseded'); };
                const job = new ContextPreparation(guard, jobSignal);
                preparing = (async () => {
                    const capturesScene = needsScene && (sceneStamp !== wanted || !scene);
                    const reusePhysical = !!scene && sceneStamp === wanted && !!preparedModel;
                    const captured = reusePhysical
                        ? { model: contextStage('prepare.model-fork', () => preparedModel!.fork()), snapshot: undefined }
                        : captureContextFrontier(god, capturesScene);
                    if (reusePhysical) for (const entity of semanticUpdates.values()) {
                        const old = captured.model.entities.get(entity.id);
                        if (old) {
                            captured.model.delete(old.id);
                            captured.model.insert({ ...old, name: entity.name, about: entity.about, v: entity.v, by: entity.by, born: entity.born });
                        }
                        const pause = job.step(); if (pause) { await pause; job.guard(); }
                    }
                    // A new visual scene needs its own target/camera frontier, even if
                    // metadata was prepared earlier and engine-only writes intervened.
                    const rebuildTargets = stamp !== wanted || capturesScene;
                    const nextTargets = rebuildTargets ? await prepareContextTargets(captured.model, job) : targets;
                    job.guard();
                    const nextByRef = new Map<string, ContextTarget>(), nextText = new Map<string, string>();
                    for (const target of nextTargets) {
                        nextByRef.set(target.ref, target);
                        nextText.set(target.ref, searchText(`${target.title} ${target.what ?? ''} ${(target.aliases ?? []).join(' ')}`));
                        const pause = job.step(); if (pause) { await pause; job.guard(); }
                    }
                    const visible = contextStage('metadata.visibility', () => contextVisibleEntityIds(god, new Set(moderation.hidden())));
                    const nextScene = capturesScene ? await prepareContextScene(god, new Set(moderation.hidden()), job, captured) : scene;
                    job.guard();
                    targets = nextTargets; byRef = nextByRef; textByRef = nextText; visibleEntities = visible;
                    preparedModel = captured.model; stamp = wanted; semanticUpdates.clear();
                    if (capturesScene && nextScene) {
                        scene = nextScene; sceneStamp = wanted;
                        sceneRows = new Map(scene.snapshot.entities.map((entity, i) => [entity.id, i]));
                    }
                    job.finish();
                })().finally(() => { preparing = null; });
            }
            try { await waitPreparation(preparing, signal); }
            catch (error) { if (token() === wanted) throw error; }
            // Every await returns through the token test at the top. A partially
            // prepared revision is never interpreted as a missing/deleted target.
        }
    };
    const prepare = async (needsScene: boolean, signal: AbortSignal) => {
        try { await prepareWork(needsScene, signal); }
        catch { throw new ApiError(503, 'context.pending', 'World context preparation is catching up; retry shortly'); }
    };
    const renderScene = () => {
        current();
        if (!scene || sceneStamp !== token()) throw new ApiError(503, 'context.pending', 'Picture preparation is pending');
        return scene;
    };
    const resolvePreparedTarget = (ref: string) => {
        const target = byRef.get(ref);
        if (target?.stand && target.level !== undefined && d.levelAt && d.levelAt(target.stand[0], target.stand[2], target.stand[1]) !== target.level)
            return null;
        return target && visibleEntities.has(target.entity) ? target : null;
    };
    const resolveTarget = (ref: string) => { current(); return resolvePreparedTarget(ref); };
    const cameraFor = (target: ContextTarget, forCapture = false) => {
        const model = preparedModel!;
        const { title, what, original, aliases, kind, role, ...camera } = target;
        const interior = contextEnclosed(model, target);
        const viewpoint = target.viewpoint ?? (interior ? { eye: [target.point[0] + Math.min(2, target.radius), target.point[1] + 1, target.point[2] + Math.min(3, target.radius * 1.5)], at: target.point } : undefined);
        return { ...camera, ...(forCapture ? { room: contextRoom(model, target), subjectKind: target.original ? 'wall-image' : target.slot && model.slotsOf(model.entities.get(target.entity)!).some(slot => slot.id === target.slot && slot.kind === 'room') ? 'room' : target.part || interior ? 'part' : target.region ? 'landscape' : 'exterior' } : {}), front: target.front ?? (forCapture ? contextFront(model, model.entities.get(target.entity)!) : undefined), viewpoint, interior, fixedCamera: !!target.viewpoint };
    };
    const input = (request: string): ContextInput | null => {
        if (request.startsWith('sheet:')) {
            const refs = JSON.parse(request.slice(6)) as Selection[], records = refs.map(r => cache.peek(imageRef(r)));
            if (records.some(r => !r || r.status !== 'ready'))
                return null;
            const tiles = refs.map((r, i) => ({ ...r, key: records[i]!.key }));
            return { key: sheetKey(tiles), revision: Math.max(...records.map(r => r!.revision)), payload: { sheet: tiles } };
        }
        const detail = request.endsWith(':detail'), ref = detail ? request.slice(0, -7) : request, target = resolveTarget(ref);
        if (!target)
            return null;
        const s = renderScene(), renderTarget = contextStage('capture.camera', () => cameraFor(target, true));
        return { key: contextStage('capture.key', () => contextHash(['context-render/2', 'context-photo/3', d.build ?? 'dev', s.key, renderTarget, detail])), revision: s.revision, payload: { snapshot: s.snapshot, target: renderTarget, detail } };
    };
    const capture = d.renderer ?? (async (i: ContextInput, signal: AbortSignal) => {
        const payload = i.payload as {
            target: ContextTarget;
            detail: boolean;
        }, at = payload.target.point, r = payload.target.radius;
        const shot = lookSchema.parse({ eye: payload.target.viewpoint?.eye ?? [at[0] + r * 1.5, at[1] + r, at[2] + r * 1.5], at, width: payload.detail ? 640 : 320, height: payload.detail ? 448 : 224 });
        let photo: Record<string, unknown> | undefined;
        try {
            const png = await renderLook(d.worldUrl, shot, 0, signal, i.payload, metadata => { photo = metadata; });
            return { png, photo };
        } catch (error) {
            if (photo) return { photo, reason: error instanceof Error ? error.message : 'context capture unavailable' };
            throw error;
        }
    });
    cache = new ContextViewCache(god.db.db, god.opts.worldId, input, async (i, signal) => {
        const sheet = (i.payload as {
            sheet?: Tile[];
        }).sheet;
        if (!sheet)
            return capture(i, signal);
        const images = sheet.map(r => cache.image(imageRef(r), r.key));
        if (images.some(p => !p))
            return { reason: 'Sheet source pictures changed' };
        const release = await hostRenderSlot(signal);
        try {
            return { png: await renderContextSheet(images as Uint8Array[], signal) };
        }
        finally {
            await release();
        }
    }, async signal => {
        if (!d.contextReady || !d.waitForContext) throw new Error('context readiness unavailable');
        if (!d.contextReady()) await d.waitForContext(signal);
        await prepare(true, signal);
        if (!d.contextReady()) throw new Error('context frontier changed');
        current();
    });
    const close = async () => { unsub(); lifetime.abort(new Error('world closed')); live.delete(cache); await cache.close(); await preparing?.catch(() => {}); };
    live.set(cache, close);
    const pixels = (entity: typeof god.model.entities extends Map<string, infer E> ? E : never) => {
        const { about, name, v, by, born, ...physical } = entity;
        return JSON.stringify(physical);
    };
    const unsub = god.onCommit(commit => {
        const before = token(), diff = commit.diff;
        const meaningOnly = !diff.removes.length && !diff.defs.length && !diff.world && !diff.constants && !diff.tiles.length && !diff.layers
            && diff.upserts.every(entity => {
                const old = previousEntities.get(entity.id);
                if (!old || pixels(old) !== pixels(entity)) return false;
                const index = sceneRows.get(entity.id);
                if (!scene || index === undefined) return true;
                const canonical = { ...entity, state: { ...entity.state, ...(entity.state && 'doors' in entity.state ? { doors: {} } : {}) } };
                return pixels(scene.snapshot.entities[index]) === pixels(canonical);
            });
        committedRevision = god.model.editSeq;
        for (const id of diff.removes) previousEntities.delete(id);
        for (const entity of diff.upserts) previousEntities.set(entity.id, entity);
        if (meaningOnly && scene && sceneStamp === before) {
            // Geometry is already detached. Update only semantic rows; cameras are
            // derived anew from targets, so authored front/viewpoint/part edits count.
            const entities = scene.snapshot.entities.slice();
            for (const entity of diff.upserts) {
                semanticUpdates.set(entity.id, entity);
                const index = sceneRows.get(entity.id);
                if (index !== undefined) entities[index] = { ...entities[index], name: entity.name, about: structuredClone(entity.about), v: entity.v, by: entity.by, born: entity.born };
            }
            scene = { ...scene, revision: committedRevision, snapshot: { ...scene.snapshot, entities, seq: committedRevision } };
            sceneStamp = token();
        }
        if (d.levelAt) cache.refresh();
    });
    if (d.levelAt)
        cache.refresh();
    type AccessFacts = {
        unknown: Place[];
        unknownRefs: Set<string>;
        placesByRef: Map<string, Place>;
        containing: ReturnType<PlaceIndex['locator']>;
    };
    const canKnow = (target: ContextTarget, facts: AccessFacts) => {
        const owner = god.model.entities.get(target.ref.split('/')[0]);
        if (!owner)
            return false;
        if (!facts.unknown.length)
            return true;
        const roomRef = target.slot ? god.model.pathOf(target.entity) + '/' + target.slot : null;
        const room = roomRef ? facts.placesByRef.get(roomRef) : undefined;
        if (roomRef && facts.unknownRefs.has(roomRef))
            return false;
        // Names/listings follow knowledge/1. Public neighbouring geometry stays public.
        for (const id of new Set([target.entity, owner.id])) {
            const entity = god.model.entities.get(id);
            if (!entity)
                return false;
            const pose = god.model.worldPose(entity), path = god.model.pathOf(id);
            let ancestor = '';
            for (const segment of path.split('/')) {
                ancestor = ancestor ? ancestor + '/' + segment : segment;
                if (facts.unknownRefs.has(ancestor))
                    return false;
            }
            if (facts.containing(pose.x, pose.z, d.levelAt!(pose.x, pose.z, supportY(god.model, entity))))
                return false;
        }
        const [x, y, z] = target.point, bound = god.model.entities.get(target.entity)!;
        const level = room?.level ?? target.level ?? d.levelAt!(x, z, supportY(god.model, bound));
        // A building's framing midpoint is not a separately named point. Only an
        // explicitly bound point/slot adds physical point membership to support access.
        const levels = new Set([level, ...(target.stand || target.slot ? [d.levelAt!(x, z, y)] : [])]);
        for (const atLevel of levels)
            if (facts.containing(x, z, atLevel))
                return false;
        // Bound regions can straddle a hidden room even when their owner is outside it.
        if (target.part && target.region)
            for (const place of facts.unknown)
                if (levels.has(place.level) && contextRegionsOverlap(target.region, place.polygon))
                    return false;
        return true;
    };
    const requestAccess = new WeakMap<Context, (ref: string, prepared?: boolean) => ContextTarget | null>();
    const access = (c: Context) => {
        const cached = requestAccess.get(c);
        if (cached)
            return cached;
        if (!d.levelAt)
            throw new ApiError(503, 'context.unavailable', 'Authoritative world floor membership is unavailable');
        if (!d.contextReady?.()) throw new ApiError(503, 'context.pending', 'World meaning is catching up; retry shortly');
        const soul = d.soul(c), places = [...edge.places.byId.values()];
        // Evaluate actual knowledge once per request; no per-target whole-place scan.
        const unknown = contextStage('access.unknown', () => places.filter(place => !edge.knowledge.knows(soul, place.id)));
        const index = new PlaceIndex({ contract: 'place-data/1', world: god.opts.worldId, places: unknown });
        const facts: AccessFacts = {
            unknown,
            unknownRefs: new Set(unknown.flatMap(place => place.ref ? [place.ref] : [])),
            placesByRef: new Map(places.flatMap(place => place.ref ? [[place.ref, place] as const] : [])),
            containing: index.locator(),
        };
        const known = (ref: string, prepared = false) => {
            const target = prepared ? resolvePreparedTarget(ref) : resolveTarget(ref);
            return target && canKnow(target, facts) ? target : null;
        };
        requestAccess.set(c, known);
        return known;
    };
    const authorized = (c: Context, ref: string) => {
        const target = access(c)(ref);
        if (!target)
            throw new ApiError(404, 'context.not-found', 'No known visual target with that ref');
        return target;
    };
    const originalFor = (t: ContextTarget) => t.original && !moderation.isHidden(t.original.sha) ? { ...t.original, source: 'original-image', version: t.original.sha, url: `/v1/world/context/original?ref=${encodeURIComponent(t.ref)}&version=${t.original.sha}` } : undefined;
    const safeTarget = (t: ContextTarget) => ({ ...t, enclosed: contextEnclosed(preparedModel!, t), camera: cameraFor(t).viewpoint, original: originalFor(t) });
    const manifest = (t: ContextTarget, detail = false) => {
        const record = cache.request(imageRef({ ref: t.ref, detail }))!, { ref: _ref, ...r } = record;
        return { ...safeTarget(t), ...r, ref: t.ref, source: 'architectural-context', freshness: record.status === 'ready' ? 'current' : 'missing', presentation: CONTEXT_PRESENTATION,
            url: record.status === 'ready' ? `/v1/world/context/image?ref=${encodeURIComponent(t.ref)}&key=${record.key}${detail ? '&detail=1' : ''}` : null,
            original: originalFor(t) };
    };
    const awaitContext = async (c: Context, next: () => Promise<void>) => {
        if (!d.contextReady || !d.waitForContext)
            throw new ApiError(503, 'context.unavailable', 'Maintained world context is unavailable');
        try {
            if (!d.contextReady()) await d.waitForContext(c.req.raw.signal);
            const picture = /\/context\/(views|image|sheet)$/.test(c.req.path);
            if (!picture) { await prepare(false, c.req.raw.signal); current(); }
            if (!d.contextReady()) throw new Error('context changed before publication');
        } catch { throw new ApiError(503, 'context.pending', 'World meaning is catching up; retry shortly'); }
        await next();
    };
    app.use('/v1/world/context', awaitContext);
    app.use('/v1/world/context/*', awaitContext);
    app.get('/context-view', c => {
        try {
            return c.html(readFileSync(resolve(process.env.WEB_DIR ?? new URL('../../../web/dist/', import.meta.url).pathname, 'context-view.html'), 'utf8'));
        }
        catch {
            throw new ApiError(503, 'context.unavailable', 'Context renderer bundle unavailable');
        }
    });
    app.get('/v1/world/context', c => {
        d.limit(c);
        const revision = current().revision, known = access(c), q = searchText((c.req.query('q') ?? '').trim()), exact = c.req.query('ref');
        const cursor = c.req.query('cursor'), match = cursor ? /^([a-f0-9]{64}):(\d+)$/.exec(cursor) : null;
        const offset = match ? Number(match[2]) : 0;
        const semanticRefs = new Set([...edge.places.byId.values()].flatMap(place => place.ref ? [place.ref] : []));
        const discoverable = (target: ContextTarget) => !!(target.part || target.slot || target.original || god.model.entities.get(target.entity)?.about || semanticRefs.has(god.model.pathOf(target.entity)));
        const candidates = contextStage('listing.candidates', () => exact ? (byRef.has(exact) ? [byRef.get(exact)!] : []) : q ? targets : targets.filter(discoverable));
        const found = contextStage('listing.authorize', () => candidates.filter(target => (!q || textByRef.get(target.ref)!.includes(q)) && known(target.ref, true)));
        const listing = contextHash([revision, moderation.version(), q, exact ?? null, found.map(t => t.ref)]);
        if (cursor && (!match || match[1] !== listing))
            throw new ApiError(409, 'context.changed', 'Meaning or listing access changed; start a fresh context query');
        const page = found.slice(offset, offset + 100), next = offset + page.length < found.length ? `${listing}:${offset + page.length}` : null;
        const pageTargets = contextStage('listing.page', () => page.map(safeTarget));
        // The whole access/filter/materialization pass is synchronous. Check the
        // frontier once more here, including external moderation-log changes.
        current();
        if (!d.contextReady?.()) throw new ApiError(503, 'context.pending', 'World meaning changed');
        return c.json({ contract: 'world-context/1', revision, listingRevision: listing, source: 'authored-meaning', scope: exact ? 'exact' : q ? 'search-all' : 'semantic', targets: pageTargets, total: found.length, nextCursor: next, presentation: CONTEXT_PRESENTATION }, 200, { 'cache-control': 'no-store' });
    });
    app.post('/v1/world/context/views', async (c) => {
        d.limit(c);
        const b = await c.req.json().catch(() => null);
        if (!b || !Array.isArray(b.refs) || b.refs.length < 1 || b.refs.length > CONTEXT_LIMITS.batch || b.refs.some((r: unknown) => typeof r !== 'string' || r.length > 220) || new Set(b.refs).size !== b.refs.length)
            throw new ApiError(400, 'context.invalid', 'Select one to six distinct stable refs');
        await prepare(true, c.req.raw.signal);
        if (!d.contextReady?.()) throw new ApiError(503, 'context.pending', 'World meaning changed');
        const selected = b.refs.map((ref: string) => authorized(c, ref));
        const views = selected.map((t: ContextTarget) => manifest(t, b.detail === true));
        const refs: Tile[] = views.map((v: ReturnType<typeof manifest>) => ({ ref: v.ref, key: v.key, detail: b.detail === true }));
        const wantsSheet = b.sheet === true;
        const record = wantsSheet && views.every((v: ReturnType<typeof manifest>) => v.status === 'ready') ? cache.request(sheetRef(refs)) : null, cols = Math.min(3, views.length);
        const sheet = { source: 'architectural-context', status: record?.status ?? 'pending', key: record?.key ?? null,
            url: record?.status === 'ready' ? '/v1/world/context/sheet?views=' + encodeURIComponent(JSON.stringify(refs)) + '&key=' + record.key : null,
            tiles: refs.map((v, index) => ({ ...v, photo: views[index].photo, index: index + 1, x: (index % cols) * 320, y: Math.floor(index / cols) * 224, width: 320, height: 224 })) };
        return c.json({ contract: 'world-context-views/1', views, sheet: wantsSheet ? sheet : null, presentation: CONTEXT_PRESENTATION }, 200, { 'cache-control': 'no-store' });
    });
    app.get('/v1/world/context/image', async c => {
        await prepare(true, c.req.raw.signal);
        if (!d.contextReady?.()) throw new ApiError(503, 'context.pending', 'World meaning changed');
        const t = authorized(c, c.req.query('ref') ?? ''), png = cache.image(imageRef({ ref: t.ref, detail: c.req.query('detail') === '1' }), c.req.query('key') ?? '');
        if (!png)
            throw new ApiError(404, 'context.stale', 'Picture unavailable or superseded; request current views');
        return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    });
    app.get('/v1/world/context/sheet', async c => {
        await prepare(true, c.req.raw.signal);
        if (!d.contextReady?.()) throw new ApiError(503, 'context.pending', 'World meaning changed');
        d.limit(c);
        const raw = c.req.query('views') ?? '';
        let refs: unknown;
        try {
            refs = raw.length <= 4000 ? JSON.parse(raw) : null;
        }
        catch {
            refs = null;
        }
        if (!Array.isArray(refs) || refs.length < 1 || refs.length > 6 || refs.some(r => !r || typeof r.ref !== 'string' || r.ref.length > 220 || typeof r.key !== 'string' || !/^[a-f0-9]{64}$/.test(r.key)))
            throw new ApiError(400, 'context.invalid', 'Invalid sheet selection');
        for (const r of refs)
            authorized(c, r.ref);
        const key = c.req.query('key') ?? '', png = key === sheetKey(refs) ? cache.image(sheetRef(refs), key) : null;
        if (!png)
            throw new ApiError(404, 'context.stale', 'Sheet unavailable or superseded');
        return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    });
    app.get('/v1/world/context/original', c => {
        const t = authorized(c, c.req.query('ref') ?? ''), asset = t.original;
        if (!asset || asset.sha !== c.req.query('version') || moderation.isHidden(asset.sha) || !god.assets.lookup(asset.sha)?.image)
            throw new ApiError(404, 'context.not-found', 'Original image unavailable');
        const path = god.assets.file(asset.sha, asset.ext);
        if (!path)
            throw new ApiError(404, 'context.not-found', 'Original image unavailable');
        return c.body(new Uint8Array(readFileSync(path)), 200, { 'content-type': asset.ext === 'png' ? 'image/png' : 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    });
    return { cache, close, targets: () => { current(); return targets; } };
}
