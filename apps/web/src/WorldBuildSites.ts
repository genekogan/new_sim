// Construction overlays own all of their GPU resources. Never pass these through disposeObject.
import * as THREE from 'three';
import type { Entity, OBB, WorldModel } from '@sim/world-compiler';

export type Mass = { name?: string; at: [number, number]; size: [number, number]; h: number; yaw?: number; roof?: 'flat' | 'gable' | 'pyramid' };
export type PublicSite = {
  id: string; title: string; status: 'active' | 'paused' | 'done' | 'abandoned'; rev: number; lastAt: number; pauseAfterMs: number; closed: boolean;
  step: { n: number; label: string; of: number }; site: { at: [number, number]; size: [number, number]; yaw: number };
  massing: Mass[]; roots: string[]; claims: { part: string; status: 'held' | 'stale' | 'released' | 'done' | 'taken'; root?: string }[];
};
export type SiteDelta = Pick<PublicSite, 'id' | 'rev' | 'status' | 'lastAt'> & {
  closed?: boolean; step?: PublicSite['step']; claim?: PublicSite['claims'][number]; rootsAdded?: string[]; rootsRemoved?: string[];
};
type SiteRecord = PublicSite | SiteDelta;
type Feed = { reset: boolean; records: SiteRecord[]; rev: number; now?: number };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const revision = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const isSiteRecord = (v: unknown): v is SiteRecord => record(v) && typeof v.id === 'string' && revision(v.rev) && finite(v.lastAt) && ['active', 'paused', 'done', 'abandoned'].includes(String(v.status));
const fullSite = (v: SiteRecord): v is PublicSite => 'site' in v && 'massing' in v && 'roots' in v;

/** The only wire-shape adapter. Revision 2 uses builds[] on diffs, site/delta on world-build,
 * buildsRev on snapshots, and rev on GET /v1/world/builds. Singular build is the V1-brief alias. */
export function parseBuildFeed(input: unknown, now?: number): Feed | null {
  if (Array.isArray(input)) return { reset: false, records: input.filter(isSiteRecord), rev: 0, now };
  if (!record(input)) return null;
  const clock = finite(input.now) ? input.now : finite(input.at) ? input.at : now;
  if (input.kind === 'world-build') {
    const site = input.site ?? input.delta;
    if (!isSiteRecord(site) || !revision(input.rev) || site.rev !== input.rev) return null;
    return { reset: false, records: [site], rev: input.rev, now: clock };
  }
  if (input.kind === 'world-diff') {
    const entries = input.builds ?? (input.build ? [input.build] : []);
    return Array.isArray(entries) ? { reset: false, records: entries.filter(isSiteRecord), rev: 0, now: clock } : null;
  }
  if (Array.isArray(input.builds)) {
    const rev = input.buildsRev ?? input.rev;
    if (!revision(rev) || !input.builds.every(v => isSiteRecord(v) && fullSite(v))) return null;
    return { reset: true, records: input.builds, rev, now: clock };
  }
  return null;
}

export type SiteModel = Pick<WorldModel, 'entities' | 'subtree' | 'worldPose' | 'footprintsOf'>;
type Options = {
  model: () => SiteModel | null; groundAt: (x: number, z: number) => number | null;
  fetchBuilds?: () => Promise<unknown>; now?: () => number; createCanvas?: () => HTMLCanvasElement; search?: string;
};
type Member = { root: string; mask: number };
type View = {
  data: PublicSite; roots: Set<string>; group: THREE.Group;
  marker: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  faces: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; ranges: { start: number; count: number }[];
  parts: number[]; members: Map<string, Member>; reindex: boolean;
  label: THREE.Sprite | null; canvas: HTMLCanvasElement | null; text: string;
  wheel: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
  sheen: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> | null;
  deadline: number; receivedAt: number; silence: number; pausedAt: number; paused: boolean; nextLabelAt: number;
};
const ACTIVE = new THREE.Color('#ffc05c'), PAUSED = new THREE.Color('#999fa8');
const MINUTE = 60_000, QUIET_MS = 3 * MINUTE;
export const SITE_REFINEMENT = { scale: 0.9, seconds: 1.2, removalDelaySeconds: 2.5 * 0.6 } as const;
const STYLES = ['ring', 'label', 'outline', 'sheen', 'wheel'] as const;
type Style = typeof STYLES[number];

export class WorldBuildSites {
  readonly group = new THREE.Group();
  maxRev = 0;
  readonly stats = { applied: 0, refetches: 0, labelRedraws: 0, lastError: null as string | null };
  private views = new Map<string, View>();
  private styles = new Set<Style>();
  private options: Options;
  private clock: () => number;
  private initialized = false;
  private disposed = false;
  private generation = 0;
  private pending = new Map<number, { item: SiteRecord; now?: number; receivedAt: number }>();
  private fetching: Promise<void> | null = null;
  private retryAt = 0;
  private time = { value: 0 };
  private activeSheen: THREE.ShaderMaterial | null = null;
  private pausedSheen: THREE.ShaderMaterial | null = null;

  constructor(options: Options) {
    this.options = options; this.clock = options.now ?? (() => performance.now());
    this.group.name = 'build-sites'; this.group.userData.cameraTransparent = true;
    this.siteStyle(new URLSearchParams(options.search ?? (typeof location === 'undefined' ? '' : location.search)).get('sites') ?? 'ring,label');
  }

  /** Runtime screenshot/perf switch. `off` suppresses all effects, including refinement. */
  siteStyle(style: string) {
    this.styles.clear();
    for (const s of style.split(',')) if ((STYLES as readonly string[]).includes(s.trim())) this.styles.add(s.trim() as Style);
    this.group.visible = this.styles.size > 0;
    for (const v of this.views.values()) { this.refit(v); this.refresh(v, this.clock()); }
    return [...this.styles].join(',') || 'off';
  }

  reset(builds: PublicSite[], buildsRev = 0, now?: number) {
    if (this.disposed || !revision(buildsRev) || buildsRev < this.maxRev || (this.initialized && buildsRev === this.maxRev)) return;
    this.initialized = true; this.generation++; this.maxRev = buildsRev;
    const keep = new Set(builds.filter(b => b.status === 'active' || b.status === 'paused').map(b => b.id));
    for (const [id, v] of this.views) if (!keep.has(id)) { this.release(v); this.views.delete(id); }
    for (const b of builds) if (keep.has(b.id)) this.put(structuredClone(b), now);
    for (const rev of this.pending.keys()) if (rev <= buildsRev) this.pending.delete(rev);
    this.drain();
    // Buffered diff geometry may already be installed when its roots delta is replayed.
    for (const v of this.views.values()) if (v.reindex) { this.countParts(v); this.refit(v); }
  }

  apply(input: unknown, now?: number) {
    if (this.disposed) return;
    const feed = parseBuildFeed(input, now); if (!feed) return;
    if (feed.reset) { this.reset(feed.records as PublicSite[], feed.rev, feed.now); return; }
    for (const item of feed.records) {
      if (item.rev <= this.maxRev) continue;
      if (item.rev !== this.maxRev + 1 || (!fullSite(item) && !this.views.has(item.id) && item.status !== 'done' && item.status !== 'abandoned')) {
        if (!this.pending.has(item.rev)) this.pending.set(item.rev, { item, now: feed.now, receivedAt: this.clock() });
        void this.resync(); continue;
      }
      this.commit(item, feed.now); this.drain();
    }
  }

  /** Also used by the existing 20-second seq poll to catch a lost final message. */
  checkRevision(rev: unknown) { if (revision(rev) && rev > this.maxRev) void this.resync(); }
  resync(): Promise<void> {
    if (this.disposed || this.fetching || !this.options.fetchBuilds || this.clock() < this.retryAt) return this.fetching ?? Promise.resolve();
    const generation = this.generation;
    this.stats.refetches++;
    this.fetching = Promise.resolve().then(() => this.options.fetchBuilds!()).then(input => {
      if (this.disposed || generation !== this.generation) return;
      const feed = parseBuildFeed(input);
      if (!feed?.reset || feed.rev < this.maxRev) throw Error('Invalid or stale build snapshot');
      this.reset(feed.records as PublicSite[], feed.rev, feed.now);
      // A response can predate the newest buffered delta. Do not refetch every frame.
      if (this.pending.size) this.retryAt = this.clock() + 20_000;
      this.stats.lastError = null;
    }).catch(e => { if (!this.disposed) { this.stats.lastError = String(e); this.retryAt = this.clock() + 20_000; } }).finally(() => { this.fetching = null; });
    return this.fetching;
  }

  private drain() {
    for (;;) {
      const next = this.pending.get(this.maxRev + 1); if (!next) break;
      if (!fullSite(next.item) && !this.views.has(next.item.id) && next.item.status !== 'done' && next.item.status !== 'abandoned') break;
      this.pending.delete(next.item.rev);
      this.commit(next.item, next.now === undefined ? undefined : next.now + this.clock() - next.receivedAt);
    }
  }
  private commit(item: SiteRecord, now?: number) {
    this.maxRev = item.rev; this.initialized = true; this.stats.applied++;
    const old = this.views.get(item.id);
    if (item.status === 'done' || item.status === 'abandoned') { if (old) { this.release(old); this.views.delete(item.id); } return; }
    if (fullSite(item)) { this.put(structuredClone(item), now); return; }
    if (!old) return;
    const b = old.data;
    b.rev = item.rev; b.status = item.status; b.lastAt = item.lastAt;
    if (item.closed !== undefined) b.closed = item.closed;
    if (item.step) b.step = { ...item.step };
    if (item.claim) { const i = b.claims.findIndex(c => c.part === item.claim!.part); if (i < 0) b.claims.push({ ...item.claim }); else b.claims[i] = { ...item.claim }; }
    if (item.rootsAdded?.length || item.rootsRemoved?.length) {
      for (const id of item.rootsRemoved ?? []) old.roots.delete(id);
      for (const id of item.rootsAdded ?? []) old.roots.add(id);
      b.roots = [...old.roots]; old.reindex = true;
    }
    this.setClock(old, now); this.tint(old); this.refresh(old, this.clock());
    if (old.wheel && this.styles.has('wheel')) this.wheel(old);
  }

  /** Uses the PRE-batch roots/model. Must run before apply and before model.delete. */
  heldRemovals(input: unknown, model: SiteModel): Set<string> {
    const held = new Set<string>(); if (!this.styles.size || !record(input) || !record(input.diff) || !Array.isArray(input.diff.removes)) return held;
    const touched = new Set(parseBuildFeed(input)?.records.map(b => b.id));
    for (const id of input.diff.removes) {
      if (typeof id !== 'string') continue;
      const e = model.entities.get(id), site = e && this.memberOf(e, model);
      if (site && touched.has(site.id)) held.add(id);
    }
    return held;
  }
  memberOf(entity: Entity, model: SiteModel = this.options.model()!): PublicSite | null {
    if (!model) return null;
    for (const v of this.views.values()) if (!v.paused && v.data.status === 'active' && this.rootOf(entity, v, model)) return v.data;
    return null;
  }
  refinement(entity: Entity, model: SiteModel) { return this.styles.size && this.memberOf(entity, model) ? SITE_REFINEMENT : null; }
  private rootOf(entity: Entity, v: View, model: SiteModel): string | null {
    let e: Entity | undefined = entity;
    for (let depth = 0; e && depth <= model.entities.size; depth++) {
      if (v.roots.has(e.id)) return e.id;
      if (e.in.parent === 'world') break;
      e = model.entities.get(e.in.parent);
    }
    return null;
  }

  /** Called after the model has installed ALL upserts. Only sites carrying a delta are recounted. */
  refitDiff(input: unknown) {
    if (!record(input) || !record(input.diff)) return;
    const diff = input.diff as { upserts?: Entity[]; removes?: string[] };
    for (const b of parseBuildFeed(input)?.records ?? []) {
      const v = this.views.get(b.id); if (!v) continue;
      this.countParts(v, diff); this.refit(v);
    }
  }
  refreshAll(groundChanged = false) {
    for (const v of this.views.values()) {
      if (groundChanged) { const mass = massGeometry(v.data, this.options.groundAt); v.faces.geometry.dispose(); v.faces.geometry = mass.geometry; v.ranges = mass.ranges; }
      v.reindex = true; this.countParts(v); this.refit(v);
    }
  }

  update(nowMs: number) {
    // No geometries, canvases, vectors or strings are allocated on ordinary frames.
    if (!this.styles.size) return;
    if (this.styles.has('sheen')) this.time.value = nowMs / 1000;
    for (const v of this.views.values()) if (nowMs >= v.nextLabelAt) this.refresh(v, nowMs);
  }

  hoverTarget(id: string) {
    if (!id.startsWith('build-site:')) return null;
    const v = this.views.get(id.slice(11)); if (!v || !this.group.visible) return null;
    const b = v.data, [x, z] = b.site.at;
    return { kind: 'place' as const, id, name: `Under construction: ${b.title}`, detail: `${b.step.label} ${b.step.n}/${b.step.of}`, point: new THREE.Vector3(x, this.options.groundAt(x, z) ?? 0, z) };
  }
  inspect() {
    return { maxRev: this.maxRev, style: [...this.styles].join(',') || 'off', ...this.stats, sites: [...this.views.values()].map(v => ({ id: v.data.id, paused: v.paused, text: v.text, parts: [...v.parts], draws: v.group.children.filter(o => o.visible && (!(o instanceof THREE.LineSegments) || o.geometry.getAttribute('position').count > 0)).length })) };
  }

  private put(data: PublicSite, now?: number) {
    const previous = this.views.get(data.id);
    // Preserve canvas/texture and geometry for identical start/resume shapes.
    if (previous && JSON.stringify([previous.data.site, previous.data.massing]) === JSON.stringify([data.site, data.massing])) {
      previous.data = data; previous.roots = new Set(data.roots); previous.reindex = true;
      this.setClock(previous, now); this.countParts(previous); this.refit(previous); this.refresh(previous, this.clock()); return;
    }
    if (previous) this.release(previous);
    const group = new THREE.Group(); group.name = `build-site:${data.id}`;
    const marker = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false }));
    marker.renderOrder = 997;
    const mass = massGeometry(data, this.options.groundAt);
    const faces = new THREE.Mesh(mass.geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false }));
    faces.renderOrder = 995; group.add(marker, faces);
    const v: View = { data, roots: new Set(data.roots), group, marker, faces, ranges: mass.ranges, parts: data.massing.map(() => 0), members: new Map(), reindex: true, label: null, canvas: null, text: '', wheel: null, sheen: null, deadline: 0, receivedAt: 0, silence: 0, pausedAt: 0, paused: false, nextLabelAt: 0 };
    this.views.set(data.id, v); this.group.add(group);
    this.setClock(v, now); this.countParts(v); this.refit(v); this.refresh(v, this.clock());
    this.tag(v);
  }
  private tag(v: View) { v.group.traverse(o => { o.userData.buildSite = v.data.id; o.userData.entity = `build-site:${v.data.id}`; o.userData.cameraTransparent = true; }); }
  private setClock(v: View, now?: number) {
    v.receivedAt = this.clock(); v.silence = Math.max(0, (now ?? Date.now()) - v.data.lastAt);
    v.deadline = v.receivedAt + v.data.pauseAfterMs - v.silence;
    v.paused = v.data.status === 'paused' || v.receivedAt >= v.deadline;
    v.pausedAt = v.data.status === 'paused' ? Math.min(v.receivedAt, v.deadline) : v.deadline;
    v.nextLabelAt = v.receivedAt;
  }
  private refresh(v: View, now: number) {
    const paused = v.data.status === 'paused' || now >= v.deadline, changed = v.paused !== paused;
    v.paused = paused;
    const silence = v.silence + now - v.receivedAt;
    const tail = paused ? (v.data.closed ? `paused ${Math.max(0, Math.floor((now - v.pausedAt) / MINUTE))} min` : 'paused · open') : silence >= QUIET_MS ? `quiet ${Math.floor(silence / MINUTE)} min` : '';
    const b = v.data, text = `${b.title} · ${b.step.label} ${b.step.n}/${b.step.of}${tail ? ` · ${tail}` : ''}`;
    if (this.styles.has('label') && text !== v.text) this.label(v, text);
    if (v.label) { v.label.visible = this.styles.has('label'); const [x, z] = b.site.at; v.label.position.set(x, (this.options.groundAt(x, z) ?? 0) + 2.5, z); }
    // Wake only at a deadline or a visible minute boundary, never once per animation frame.
    v.nextLabelAt = paused ? (b.closed ? v.pausedAt + (Math.floor((now - v.pausedAt) / MINUTE) + 1) * MINUTE : Infinity) : Math.min(v.deadline, v.receivedAt + (silence < QUIET_MS ? QUIET_MS - v.silence : (Math.floor(silence / MINUTE) + 1) * MINUTE - v.silence));
    if (changed) { this.tint(v); if (v.wheel && this.styles.has('wheel')) this.wheel(v); }
    if (v.sheen) v.sheen.material = paused ? this.sheenMaterial(false) : this.sheenMaterial(true);
  }
  private label(v: View, text: string) {
    const canvas = v.canvas ?? this.options.createCanvas?.() ?? document.createElement('canvas');
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.font = '600 28px system-ui, sans-serif'; const width = Math.ceil(ctx.measureText(text).width) + 28;
    canvas.width = width; canvas.height = 44;
    ctx.font = '600 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(20,20,20,0.8)'; ctx.beginPath(); ctx.roundRect(0, 0, width, 44, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, 14, 23);
    if (!v.label) {
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      v.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
      v.label.renderOrder = 998; v.group.add(v.label);
    }
    v.canvas = canvas; v.text = text; v.label.material.map!.needsUpdate = true;
    v.label.scale.set(width / 44 * 1.2, 1.2, 1);
    const [x, z] = v.data.site.at;
    v.label.position.set(x, (this.options.groundAt(x, z) ?? 0) + 2.5, z);
    this.stats.labelRedraws++; this.tag(v);
  }

  private countParts(v: View, diff?: { upserts?: Entity[]; removes?: string[] }) {
    const model = this.options.model(); if (!model) return;
    const ids = new Set<string>();
    if (v.reindex || !diff) {
      v.members.clear(); v.parts.fill(0);
      for (const root of v.roots) for (const id of model.subtree(root)) ids.add(id);
    } else {
      for (const id of diff.removes ?? []) ids.add(id);
      for (const e of diff.upserts ?? []) for (const id of model.subtree(e.id)) ids.add(id);
    }
    for (const id of ids) {
      const old = v.members.get(id);
      if (old) { for (let k = 0; k < v.parts.length; k++) if (old.mask & (1 << k)) v.parts[k]--; v.members.delete(id); }
      const e = model.entities.get(id), root = e && this.rootOf(e, v, model); if (!e || !root) continue;
      const boxes = model.footprintsOf(id); if (!boxes.length) continue; // empty prefab containers are not physical parts
      const x = boxes.reduce((n, box) => n + box.c[0], 0) / boxes.length, z = boxes.reduce((n, box) => n + box.c[1], 0) / boxes.length;
      const [sx, sz] = localPoint(x, z, v.data.site.at, v.data.site.yaw);
      let mask = 0;
      for (let k = 0; k < v.data.massing.length; k++) { const m = v.data.massing[k], [mx, mz] = localPoint(sx, sz, m.at, m.yaw ?? 0); if (Math.abs(mx) <= m.size[0] / 2 && Math.abs(mz) <= m.size[1] / 2) { mask |= 1 << k; v.parts[k]++; } }
      v.members.set(id, { root, mask });
    }
    v.reindex = false; this.tint(v);
  }
  private tint(v: View) {
    const c = v.paused ? PAUSED : ACTIVE;
    const lines = v.marker.geometry.getAttribute('color'); if (lines) { for (let k = 0; k < lines.count; k++) lines.setXYZ(k, c.r, c.g, c.b); lines.needsUpdate = true; }
    const colors = v.faces.geometry.getAttribute('color');
    for (let i = 0; i < v.ranges.length; i++) { const range = v.ranges[i], alpha = 0.35 * Math.max(0, 1 - v.parts[i] / 6); for (let k = range.start; k < range.start + range.count; k++) colors.setXYZW(k, c.r, c.g, c.b, alpha); }
    colors.needsUpdate = true;
    v.faces.visible = this.styles.size > 0 && v.parts.some((n, i) => n < 6 && v.ranges[i].count > 0);
  }

  private refit(v: View) {
    const b = v.data, lines: number[] = [];
    if (this.styles.has('ring')) {
      for (let side = 0; side < 4; side++) for (let i = 0; i < 8; i++) {
        const corner = (t: number) => { const u = side === 0 ? -0.5 + t : side === 1 ? 0.5 : side === 2 ? 0.5 - t : -0.5; const w = side === 0 ? -0.5 : side === 1 ? -0.5 + t : side === 2 ? 0.5 : 0.5 - t; const [x, z] = worldPoint(u * b.site.size[0], w * b.site.size[1], b.site.at, b.site.yaw); return [x, (this.options.groundAt(x, z) ?? 0) + 0.09, z]; };
        lines.push(...corner(i / 8), ...corner((i + 1) / 8));
      }
    }
    if (b.massing.length && this.styles.size) lines.push(...massGeometryEdges(b, this.options.groundAt));
    const boxes: OBB[] = [];
    const model = this.options.model();
    if (!b.massing.length && model && (this.styles.has('outline') || this.styles.has('sheen'))) {
      const seen = new Set<string>();
      for (const root of v.roots) for (const id of model.subtree(root)) if (!seen.has(id)) { seen.add(id); boxes.push(...model.footprintsOf(id)); }
      if (this.styles.has('outline')) for (const box of boxes) lines.push(...obbEdges(box));
    }
    replaceGeometry(v.marker, lineGeometry(lines)); v.marker.visible = lines.length > 0 && this.styles.size > 0;
    this.tint(v);
    if (this.styles.has('wheel')) this.wheel(v); else if (v.wheel) v.wheel.visible = false;
    if (this.styles.has('sheen')) {
      if (!v.sheen) { v.sheen = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.sheenMaterial(!v.paused)); v.sheen.renderOrder = 996; v.group.add(v.sheen); }
      const bounds = new THREE.Box3();
      const points = b.massing.length ? massGeometryEdges(b, this.options.groundAt) : boxes.flatMap(obbEdges);
      for (let i = 0; i < points.length; i += 3) bounds.expandByPoint(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
      if (bounds.isEmpty()) { const [x, z] = b.site.at, y = this.options.groundAt(x, z) ?? 0; bounds.set(new THREE.Vector3(x - b.site.size[0] / 2, y, z - b.site.size[1] / 2), new THREE.Vector3(x + b.site.size[0] / 2, y + 3, z + b.site.size[1] / 2)); }
      bounds.expandByScalar(0.35); bounds.getCenter(v.sheen.position); bounds.getSize(v.sheen.scale); v.sheen.visible = true;
    } else if (v.sheen) v.sheen.visible = false;
    if (v.label) { v.label.visible = this.styles.has('label'); const [x, z] = b.site.at; v.label.position.set(x, (this.options.groundAt(x, z) ?? 0) + 2.5, z); }
    this.tag(v);
  }
  private wheel(v: View) {
    const positions: number[] = [], colors: number[] = [], b = v.data, radius = Math.max(1.2, Math.min(...b.site.size) * 0.22), n = Math.max(1, Math.min(24, b.step.of)), fraction = Math.max(0, Math.min(1, b.step.n / Math.max(1, b.step.of)));
    const c = v.paused ? PAUSED : ACTIVE;
    const point = (a: number, r: number) => { const x = b.site.at[0] + Math.cos(a) * r, z = b.site.at[1] + Math.sin(a) * r; return [x, (this.options.groundAt(x, z) ?? 0) + 0.12, z]; };
    for (let i = 0; i < 64; i++) { positions.push(...point(i / 64 * Math.PI * 2, radius), ...point((i + 1) / 64 * Math.PI * 2, radius)); const dim = i / 64 < fraction ? 1 : 0.25; for (let j = 0; j < 2; j++) colors.push(c.r * dim, c.g * dim, c.b * dim); }
    for (let i = 0; i < n; i++) { positions.push(...point(i / n * Math.PI * 2, radius * 0.82), ...point(i / n * Math.PI * 2, radius * 1.1)); for (let j = 0; j < 2; j++) colors.push(c.r, c.g, c.b); }
    // Stroke digits keep n/of legible even with the label candidate disabled, in the SAME draw.
    const text = `${b.step.n}/${b.step.of}`, scale = radius * 1.25 / (text.length * 0.75);
    for (let i = 0; i < text.length; i++) for (const [ax, az, bx, bz] of digitLines(text[i])) {
      for (const [u, w] of [[ax, az], [bx, bz]]) { const x = b.site.at[0] + (i * 0.75 + u - text.length * 0.375) * scale, z = b.site.at[1] + (w - 0.5) * scale; positions.push(x, (this.options.groundAt(x, z) ?? 0) + 0.13, z); colors.push(c.r, c.g, c.b); }
    }
    const geometry = lineGeometry(positions); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (!v.wheel) { v.wheel = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); v.wheel.renderOrder = 997; v.group.add(v.wheel); } else replaceGeometry(v.wheel, geometry);
    v.wheel.visible = true;
  }
  private sheenMaterial(active: boolean) {
    const old = active ? this.activeSheen : this.pausedSheen; if (old) return old;
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uActive: { value: active ? 1 : 0 }, uColor: { value: active ? ACTIVE : PAUSED } },
      vertexShader: 'varying float vHeight; void main(){vHeight=position.y+0.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float uTime; uniform float uActive; uniform vec3 uColor; varying float vHeight; void main(){float band=1.0-smoothstep(0.035,0.10,abs(vHeight-fract(uTime*0.25)));gl_FragColor=vec4(uColor,0.035+uActive*band*0.28);}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, toneMapped: false,
    });
    if (active) this.activeSheen = material; else this.pausedSheen = material;
    return material;
  }
  private release(v: View) {
    v.group.removeFromParent();
    v.marker.geometry.dispose(); v.marker.material.dispose(); v.faces.geometry.dispose(); v.faces.material.dispose();
    if (v.label) { v.label.material.map?.dispose(); v.label.material.dispose(); }
    if (v.wheel) { v.wheel.geometry.dispose(); v.wheel.material.dispose(); }
    v.sheen?.geometry.dispose(); // sheen materials are layer-owned and shared among all sites
    v.group.clear(); v.members.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    for (const v of this.views.values()) this.release(v);
    this.views.clear(); this.pending.clear(); this.group.clear(); this.group.removeFromParent();
    this.activeSheen?.dispose(); this.pausedSheen?.dispose();
  }
}

function worldPoint(x: number, z: number, at: [number, number], yaw: number): [number, number] { const c = Math.cos(yaw), s = Math.sin(yaw); return [at[0] + x * c + z * s, at[1] - x * s + z * c]; }
function localPoint(x: number, z: number, at: [number, number], yaw: number): [number, number] { return worldPoint(x - at[0], z - at[1], [0, 0], -yaw); }
function lineGeometry(points: number[]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(points.length), 3)); return g; }
function replaceGeometry(obj: THREE.LineSegments, geometry: THREE.BufferGeometry) { obj.geometry.dispose(); obj.geometry = geometry; }
type Volume = { vertices: number[][]; triangles: number[]; edges: number[] };
function volume(w: number, d: number, h: number, roof: Mass['roof']): Volume {
  const x = w / 2, z = d / 2;
  const vertices = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]];
  const triangles = [0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const edges = [0, 1, 1, 2, 2, 3, 3, 0, 0, 4, 1, 5, 2, 6, 3, 7, 4, 5, 5, 6, 6, 7, 7, 4];
  const rise = Math.min(w, d) * 0.5;
  if (roof === 'pyramid') { vertices.push([0, h + rise, 0]); triangles.push(4, 8, 5, 5, 8, 6, 6, 8, 7, 7, 8, 4); edges.push(4, 8, 5, 8, 6, 8, 7, 8); }
  else if (roof === 'gable') {
    if (w >= d) { vertices.push([-x, h + rise, 0], [x, h + rise, 0]); triangles.push(4, 8, 9, 4, 9, 5, 7, 6, 9, 7, 9, 8, 4, 7, 8, 5, 9, 6); edges.push(4, 8, 7, 8, 8, 9, 5, 9, 6, 9); }
    else { vertices.push([0, h + rise, -z], [0, h + rise, z]); triangles.push(4, 7, 9, 4, 9, 8, 5, 8, 9, 5, 9, 6, 4, 8, 5, 7, 6, 9); edges.push(4, 8, 5, 8, 8, 9, 7, 9, 6, 9); }
  } else triangles.push(4, 7, 6, 4, 6, 5);
  return { vertices, triangles, edges };
}
function massVolumes(site: PublicSite, groundAt: Options['groundAt']) {
  return site.massing.slice(0, 8).map(m => {
    const v = volume(m.size[0], m.size[1], m.h, m.roof), [cx, cz] = worldPoint(m.at[0], m.at[1], site.site.at, site.site.yaw), base = (groundAt(cx, cz) ?? 0) + 0.08;
    v.vertices = v.vertices.map(([x, y, z]) => { const [sx, sz] = worldPoint(x, z, m.at, m.yaw ?? 0), [wx, wz] = worldPoint(sx, sz, site.site.at, site.site.yaw); return [wx, base + y, wz]; });
    return v;
  });
}
function massGeometry(site: PublicSite, groundAt: Options['groundAt']) {
  const points: number[] = [], colors: number[] = [], ranges: View['ranges'] = [];
  for (const v of massVolumes(site, groundAt)) {
    const start = points.length / 3;
    for (const id of v.triangles) { points.push(...v.vertices[id]); colors.push(ACTIVE.r, ACTIVE.g, ACTIVE.b, 0.35); }
    ranges.push({ start, count: points.length / 3 - start });
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  return { geometry, ranges };
}
function massGeometryEdges(site: PublicSite, groundAt: Options['groundAt']) { const points: number[] = []; for (const v of massVolumes(site, groundAt)) for (const id of v.edges) points.push(...v.vertices[id]); return points; }
function obbEdges(box: OBB) {
  const v = volume(box.half[0] * 2, box.half[1] * 2, box.y1 - box.y0, 'flat');
  v.vertices = v.vertices.map(([x, y, z]) => { const [wx, wz] = worldPoint(x, z, box.c, box.yaw); return [wx, box.y0 + y, wz]; });
  return v.edges.flatMap(id => v.vertices[id]);
}
const DIGIT_SEGMENTS = [[0, 0, 0.5, 0], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 1], [0, 1, 0.5, 1], [0, 0.5, 0, 1], [0, 0, 0, 0.5], [0, 0.5, 0.5, 0.5]];
const DIGITS: Record<string, string> = { '0': '012345', '1': '12', '2': '01643', '3': '01236', '4': '1256', '5': '02563', '6': '023456', '7': '012', '8': '0123456', '9': '012356' };
function digitLines(char: string): number[][] { return char === '/' ? [[0.05, 1, 0.45, 0]] : [...(DIGITS[char] ?? '')].map(i => DIGIT_SEGMENTS[Number(i)]); }
