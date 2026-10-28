import type { WorldLocation, WorldLocationPage } from './WorldLocations.ts';
type Target = {
    ref: string;
    title: string;
    point: [
        number,
        number,
        number
    ];
    radius: number;
    enclosed?: boolean;
    camera?: {
        eye: [
            number,
            number,
            number
        ];
        at: [
            number,
            number,
            number
        ];
    };
    viewpoint?: {
        eye: [
            number,
            number,
            number
        ];
        at: [
            number,
            number,
            number
        ];
    };
};
/** Explore and Soul clients use the same server records. Work exists only for a visible request. */
export class WorldContextViews {
    locations: readonly WorldLocation[] = [];
    private loading = false;
    private query = '';
    private total = 0;
    private nextCursor: string | null = null;
    private error: string | null = null;
    private revision: number | string = 0;
    private generation = 0;
    private requestController: AbortController | null = null;
    private pending = new Map<string, (url: string | null) => void>();
    private scheduled = false;
    private pictureController = new AbortController();
    private api: (path: string) => string;
    private signal: AbortSignal;
    private changed: () => void;
    private supported: boolean;
    constructor(api: (path: string) => string, signal: AbortSignal, changed: () => void = () => { }, supported = true) { this.api = api; this.signal = signal; this.changed = changed; this.supported = supported; }
    page(): WorldLocationPage {
        return { total: this.total, more: !!this.nextCursor, loading: this.loading, query: this.query, error: this.error };
    }
    async refresh() { await this.load(false); }
    async search(query: string) {
        const next = query.trim();
        if (next !== this.query) {
            this.cancelPictures();
            this.query = next;
            this.locations = [];
            this.total = 0;
            this.nextCursor = null;
        }
        await this.load(false);
    }
    async more() {
        if (!this.loading && this.nextCursor)
            await this.load(true);
    }
    private async load(append: boolean, restarts = 0): Promise<void> {
        // Legacy worlds use their depicted/curated Explore locations; they have no context routes.
        if (!this.supported || this.signal.aborted)
            return;
        const generation = ++this.generation, query = this.query;
        const cursor = append ? this.nextCursor : null;
        this.requestController?.abort();
        const controller = new AbortController();
        this.requestController = controller;
        this.loading = true;
        this.error = null;
        this.changed();
        const active = () => !this.signal.aborted && generation === this.generation;
        try {
            const params = new URLSearchParams();
            if (query) params.set('q', query);
            if (cursor) params.set('cursor', cursor);
            const response = await fetch(this.api('/v1/world/context' + (params.size ? '?' + params : '')), { signal: AbortSignal.any([this.signal, controller.signal]) });
            if (!active()) return;
            if (response.status === 409) {
                if (restarts < 1) { await this.load(false, restarts + 1); return; }
                this.nextCursor = null;
                this.error = 'Locations changed again. Reopen Explore to refresh.';
                return;
            }
            if (!response.ok) {
                this.error = 'Locations are temporarily unavailable. Reopen Explore to retry.';
                return;
            }
            const data: { targets: Target[]; total?: number; revision: number; listingRevision?: string; nextCursor?: string | null } = await response.json();
            if (!active()) return;
            const revision = data.listingRevision ?? data.revision;
            if (append && revision !== this.revision) {
                if (restarts < 1) { await this.load(false, restarts + 1); return; }
                this.nextCursor = null;
                this.error = 'Locations changed again. Reopen Explore to refresh.';
                return;
            }
            if (!append && revision !== this.revision) this.cancelPictures();
            const locations = data.targets.map(t => {
                const camera = t.viewpoint ?? t.camera;
                return { id: 'context:' + t.ref, regionId: 'context:' + t.ref, label: t.title,
                    previewRevision: revision,
                    previewLabel: 'Architectural context · fixed daylight · default doors · no Souls or carried objects. Current sight may differ.',
                    target: camera?.at ?? t.point,
                    p: camera?.eye ?? [t.point[0] + t.radius * 1.5, t.point[1] + t.radius, t.point[2] + t.radius * 1.5] as [number, number, number],
                    radius: t.radius, ...(t.enclosed && camera ? { inside: { p: camera.eye, target: camera.at } } : {}) };
            });
            this.locations = append ? [...new Map([...this.locations, ...locations].map(location => [location.id, location])).values()] : locations;
            this.revision = revision;
            this.total = data.total ?? this.locations.length;
            this.nextCursor = data.nextCursor ?? null;
        } catch {
            if (active() && !controller.signal.aborted)
                this.error = 'Locations are temporarily unavailable. Reopen Explore to retry.';
        } finally {
            if (active()) {
                this.loading = false;
                this.changed();
            }
        }
    }
    cancelPictures() {
        this.pictureController.abort();
        this.pictureController = new AbortController();
        for (const resolve of this.pending.values()) resolve(null);
        this.pending.clear();
    }
    picture(id: string): Promise<string | null> {
        if (!this.supported || this.signal.aborted || !id.startsWith('context:'))
            return Promise.resolve(null);
        return new Promise(resolve => { const ref = id.slice(8), previous = this.pending.get(ref); this.pending.set(ref, url => { previous?.(url); resolve(url); }); if (!this.scheduled) {
            this.scheduled = true;
            queueMicrotask(() => void this.drain());
        } });
    }
    private async drain() {
        const signal = AbortSignal.any([this.signal, this.pictureController.signal]);
        while (this.pending.size && !signal.aborted) {
            const batch = [...this.pending.entries()].slice(0, 6);
            for (const [ref] of batch)
                this.pending.delete(ref);
            const waiting = new Map(batch);
            try {
                for (let attempt = 0; attempt < 16 && waiting.size && !signal.aborted; attempt++) {
                    const response = await fetch(this.api('/v1/world/context/views'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [...waiting.keys()] }), signal });
                    if (!response.ok)
                        break;
                    const data = await response.json();
                    if (signal.aborted) break;
                    for (const view of data.views ?? []) {
                        if (view.status === 'pending')
                            continue;
                        if (view.status === 'ready' && view.photo) {
                            const label = `Architectural context${view.photo.cutaway ? ' · Cutaway (classified roof/wall removed)' : ''} · ${view.photo.provenance?.camera === 'authored' ? 'authored camera' : 'geometric camera'} · front ${view.photo.provenance?.front ?? 'unknown'} · fixed daylight · default doors · no Souls or carried objects. Current sight may differ.`;
                            this.locations = this.locations.map(location => location.id === 'context:' + view.ref ? { ...location, previewLabel: label } : location);
                            this.changed();
                        }
                        waiting.get(view.ref)?.(view.status === 'ready' && view.url ? this.api(view.url) : null);
                        waiting.delete(view.ref);
                    }
                    if (waiting.size)
                        await new Promise<void>(r => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); r(); }; const timer = setTimeout(done, 1000); signal.addEventListener('abort', done, { once: true }); });
                }
            }
            catch { /* An expired/revoked or unavailable view stays text-only. */ }
            finally {
                for (const resolve of waiting.values())
                    resolve(null);
            }
        }
        this.scheduled = false;
        if (this.signal.aborted) {
            for (const resolve of this.pending.values()) resolve(null);
            this.pending.clear();
        } else if (this.pending.size) {
            this.scheduled = true;
            queueMicrotask(() => void this.drain());
        }
    }
}
