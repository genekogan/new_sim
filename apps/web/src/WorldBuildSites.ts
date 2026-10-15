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
type VertexRange = { start: number; count: number };
type Member = { root: string; mask: number; boxes: OBB[] };
type View = {
  data: PublicSite; roots: Set<string>; group: THREE.Group;
  marker: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  faces: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; ranges: VertexRange[]; edgeRanges: VertexRange[];
  parts: number[]; coverage: number[]; members: Map<string, Member>; reindex: boolean;
  label: THREE.Sprite | null; canvas: HTMLCanvasElement | null; text: string; labelY: number;
  wheel: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  sheen: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  deadline: number; receivedAt: number; silence: number; pausedAt: number; paused: boolean; nextLabelAt: number;
};
const ACTIVE = new THREE.Color('#ffc05c'), PAUSED = new THREE.Color('#999fa8');
const MARKER_ALPHA = 0.95, FAINT_EDGE_ALPHA = 0.06, COVERAGE_GRID = 8; // 64 sampled columns per mass
const MINUTE = 60_000, QUIET_MS = 3 * MINUTE;
const LABEL_FONT_PX = 28, LABEL_HEIGHT_PX = 44, LABEL_MIN_TEXT_PX = 14, LABEL_WORLD_HEIGHT = 1.2;
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
  private viewport = new THREE.Vector2();

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
    return { maxRev: this.maxRev, style: [...this.styles].join(',') || 'off', ...this.stats, sites: [...this.views.values()].map(v => ({ id: v.data.id, paused: v.paused, text: v.text, parts: [...v.parts], coverage: [...v.coverage], draws: v.group.children.filter(o => o.visible && (!(o instanceof THREE.LineSegments) || o.geometry.getAttribute('position').count > 0)).length })) };
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
    const marker = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    marker.renderOrder = 997;
    const mass = massGeometry(data, this.options.groundAt);
    const faces = new THREE.Mesh(mass.geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false }));
    faces.renderOrder = 995; group.add(marker, faces);
    const v: View = { data, roots: new Set(data.roots), group, marker, faces, ranges: mass.ranges, edgeRanges: [], parts: data.massing.map(() => 0), coverage: data.massing.map(() => 0), members: new Map(), reindex: true, label: null, canvas: null, text: '', labelY: 0, wheel: null, sheen: null, deadline: 0, receivedAt: 0, silence: 0, pausedAt: 0, paused: false, nextLabelAt: 0 };
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
    if (v.label) v.label.visible = this.styles.has('label');
    // Wake only at a deadline or a visible minute boundary, never once per animation frame.
    v.nextLabelAt = paused ? (b.closed ? v.pausedAt + (Math.floor((now - v.pausedAt) / MINUTE) + 1) * MINUTE : Infinity) : Math.min(v.deadline, v.receivedAt + (silence < QUIET_MS ? QUIET_MS - v.silence : (Math.floor(silence / MINUTE) + 1) * MINUTE - v.silence));
    if (changed) { this.tint(v); if (v.wheel && this.styles.has('wheel')) this.wheel(v); }
    if (v.sheen) v.sheen.material = paused ? this.sheenMaterial(false) : this.sheenMaterial(true);
  }
  private label(v: View, text: string) {
    const canvas = v.canvas ?? this.options.createCanvas?.() ?? document.createElement('canvas');
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.font = `600 ${LABEL_FONT_PX}px system-ui, sans-serif`; const width = Math.ceil(ctx.measureText(text).width) + 28;
    canvas.width = width; canvas.height = LABEL_HEIGHT_PX;
    ctx.font = `600 ${LABEL_FONT_PX}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(20,20,20,0.8)'; ctx.beginPath(); ctx.roundRect(0, 0, width, LABEL_HEIGHT_PX, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, 14, 23);
    if (!v.label) {
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      v.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
      // The bottom edge clears the tallest roof/root even when the screen-size floor enlarges the sprite.
      v.label.center.set(0.5, 0); v.label.frustumCulled = false;
      v.label.onBeforeRender = (renderer, _scene, camera) => {
        const sprite = v.label!, m = sprite.matrixWorld.elements, view = camera.matrixWorldInverse.elements;
        const depth = Math.max(0.01, -(view[2] * m[12] + view[6] * m[13] + view[10] * m[14] + view[14]));
        const height = renderer.getSize(this.viewport).y;
        const unitsPerPixel = 2 * (camera instanceof THREE.PerspectiveCamera ? depth : 1) / (Math.max(1, height) * camera.projectionMatrix.elements[5]);
        const scale = Math.max(LABEL_WORLD_HEIGHT, LABEL_MIN_TEXT_PX * LABEL_HEIGHT_PX / LABEL_FONT_PX * unitsPerPixel);
        sprite.scale.set(canvas.width / LABEL_HEIGHT_PX * scale, scale, 1);
        sprite.updateMatrixWorld();
      };
      v.label.renderOrder = 998; v.group.add(v.label);
    }
    v.canvas = canvas; v.text = text; v.label.material.map!.needsUpdate = true;
    v.label.scale.set(width / LABEL_HEIGHT_PX * LABEL_WORLD_HEIGHT, LABEL_WORLD_HEIGHT, 1);
    const [x, z] = v.data.site.at;
    v.label.position.set(x, v.labelY, z);
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
      v.members.set(id, { root, mask, boxes });
    }
    // Count remains diagnostic only. Union the cached physical OBBs, including members
    // whose centres are outside a mass but whose footprints overlap it.
    const boxes = [...v.members.values()].flatMap(member => member.boxes);
    for (let k = 0; k < v.coverage.length; k++) v.coverage[k] = massCoverage(v.data, v.data.massing[k], boxes, this.options.groundAt);
    v.reindex = false; this.tint(v);
  }
  private tint(v: View) {
    const c = v.paused ? PAUSED : ACTIVE;
    const lines = v.marker.geometry.getAttribute('color');
    if (lines) {
      for (let k = 0; k < lines.count; k++) lines.setXYZW(k, c.r, c.g, c.b, MARKER_ALPHA);
      for (let i = 0; i < v.edgeRanges.length; i++) {
        const range = v.edgeRanges[i], remaining = Math.max(0, 1 - v.coverage[i] / 0.8);
        const alpha = FAINT_EDGE_ALPHA + (MARKER_ALPHA - FAINT_EDGE_ALPHA) * remaining * remaining;
        for (let k = range.start; k < range.start + range.count; k++) lines.setW(k, alpha);
      }
      lines.needsUpdate = true;
    }
    const colors = v.faces.geometry.getAttribute('color');
    v.faces.visible = false;
    for (let i = 0; i < v.ranges.length; i++) {
      const range = v.ranges[i], alpha = 0.35 * Math.max(0, 1 - v.coverage[i] / 0.6);
      for (let k = range.start; k < range.start + range.count; k++) colors.setXYZW(k, c.r, c.g, c.b, alpha);
      if (this.styles.size && alpha > 0 && range.count) v.faces.visible = true;
    }
    colors.needsUpdate = true;
  }

  private refit(v: View) {
    const b = v.data, lines: number[] = [];
    if (this.styles.has('ring')) {
      for (let side = 0; side < 4; side++) for (let i = 0; i < 8; i++) {
        const corner = (t: number) => { const u = side === 0 ? -0.5 + t : side === 1 ? 0.5 : side === 2 ? 0.5 - t : -0.5; const w = side === 0 ? -0.5 : side === 1 ? -0.5 + t : side === 2 ? 0.5 : 0.5 - t; const [x, z] = worldPoint(u * b.site.size[0], w * b.site.size[1], b.site.at, b.site.yaw); return [x, (this.options.groundAt(x, z) ?? 0) + 0.09, z]; };
        lines.push(...corner(i / 8), ...corner((i + 1) / 8));
      }
    }
    const masses = massVolumes(b, this.options.groundAt);
    v.edgeRanges = [];
    if (this.styles.size) for (const mass of masses) {
      const start = lines.length / 3;
      for (const id of mass.edges) lines.push(...mass.vertices[id]);
      v.edgeRanges.push({ start, count: lines.length / 3 - start });
    }
    const boxes: OBB[] = [];
    const model = this.options.model();
    if (model) {
      const seen = new Set<string>();
      for (const root of v.roots) for (const id of model.subtree(root)) if (!seen.has(id)) { seen.add(id); boxes.push(...model.footprintsOf(id)); }
      if (this.styles.has('outline')) for (const box of boxes) lines.push(...obbEdges(box));
    }
    // Prefer actual parts once they exist; an empty prefab root falls back to the massing.
    let top = this.options.groundAt(...b.site.at) ?? 0;
    if (boxes.length) for (const box of boxes) top = Math.max(top, box.y1);
    else for (const volume of masses) for (const vertex of volume.vertices) top = Math.max(top, vertex[1]);
    v.labelY = top + 0.75;
    replaceGeometry(v.marker, lineGeometry(lines)); v.marker.visible = lines.length > 0 && this.styles.size > 0;
    this.tint(v);
    if (this.styles.has('wheel')) this.wheel(v); else if (v.wheel) v.wheel.visible = false;
    if (this.styles.has('sheen')) {
      // Merged padded volumes follow the rooflines; a tall tower must not make a giant
      // rectangular band across the empty air over a low nave. Positions stay in world space.
      const padded = boxes.length ? boxes.map(box => obbVolume(box, 0.35)) : massVolumes(b, this.options.groundAt, 0.35);
      const geometry = sheenGeometry(padded);
      if (!v.sheen) { v.sheen = new THREE.Mesh(geometry, this.sheenMaterial(!v.paused)); v.sheen.renderOrder = 996; v.group.add(v.sheen); }
      else { v.sheen.geometry.dispose(); v.sheen.geometry = geometry; }
      v.sheen.visible = padded.length > 0;
    } else if (v.sheen) v.sheen.visible = false;
    if (v.label) { v.label.visible = this.styles.has('label'); const [x, z] = b.site.at; v.label.position.set(x, v.labelY, z); }
    this.tag(v);
  }
  private wheel(v: View) {
    const positions: number[] = [], colors: number[] = [], b = v.data, radius = Math.max(1.5, Math.min(...b.site.size) * 0.24), fraction = Math.max(0, Math.min(1, b.step.n / Math.max(1, b.step.of)));
    const width = Math.max(0.18, radius * 0.09);
    const c = v.paused ? PAUSED : ACTIVE;
    const point = (a: number, r: number): [number, number] => [Math.sin(a) * r, -Math.cos(a) * r];
    const quad = (a: number[], d: number[], e: number[], f: number[], alpha: number) => {
      for (const [dx, dz] of [a, d, e, a, e, f]) {
        const x = b.site.at[0] + dx, z = b.site.at[1] + dz;
        positions.push(x, (this.options.groundAt(x, z) ?? 0) + 0.14, z); colors.push(c.r, c.g, c.b, alpha);
      }
    };
    const arc = (from: number, to: number, alpha: number) => {
      if (to <= from) return;
      quad(point(from * Math.PI * 2, radius - width / 2), point(from * Math.PI * 2, radius + width / 2), point(to * Math.PI * 2, radius + width / 2), point(to * Math.PI * 2, radius - width / 2), alpha);
    };
    // A world-width ribbon stays visible in WebGL, where LineBasicMaterial is only one pixel.
    // Split the boundary segment so the bright arc is exactly n/of, including 0 and complete.
    for (let i = 0; i < 96; i++) {
      arc(i / 96, Math.min((i + 1) / 96, fraction), 0.95);
      arc(Math.max(i / 96, fraction), (i + 1) / 96, 0.24);
    }
    // Thick stroke digits share the progress-ring draw and ground-level label anchor.
    const text = `${b.step.n}/${b.step.of}`, scale = radius * 1.25 / (text.length * 0.75);
    for (let i = 0; i < text.length; i++) for (const [ax, az, bx, bz] of digitLines(text[i])) {
      const x0 = (i * 0.75 + ax - (text.length * 0.75 - 0.25) / 2) * scale, z0 = (az - 0.5) * scale;
      const x1 = (i * 0.75 + bx - (text.length * 0.75 - 0.25) / 2) * scale, z1 = (bz - 0.5) * scale;
      const length = Math.hypot(x1 - x0, z1 - z0), dx = -(z1 - z0) / length * width * 0.22, dz = (x1 - x0) / length * width * 0.22;
      quad([x0 + dx, z0 + dz], [x0 - dx, z0 - dz], [x1 - dx, z1 - dz], [x1 + dx, z1 + dz], 0.95);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    if (!v.wheel) { v.wheel = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, forceSinglePass: true, depthTest: false, depthWrite: false, toneMapped: false })); v.wheel.renderOrder = 997; v.group.add(v.wheel); }
    else { v.wheel.geometry.dispose(); v.wheel.geometry = geometry; }
    v.wheel.visible = true;
  }
  private sheenMaterial(active: boolean) {
    const old = active ? this.activeSheen : this.pausedSheen; if (old) return old;
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uActive: { value: active ? 1 : 0 }, uColor: { value: active ? ACTIVE : PAUSED } },
      vertexShader: 'attribute float aHeight; varying float vHeight; void main(){vHeight=aHeight;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float uTime; uniform float uActive; uniform vec3 uColor; varying float vHeight; void main(){float band=1.0-smoothstep(0.025,0.075,abs(vHeight-fract(uTime*0.125)));gl_FragColor=vec4(uColor,0.006+uActive*band*0.055);}',
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
function lineGeometry(points: number[]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(points.length / 3 * 4), 4)); return g; }
function replaceGeometry(obj: THREE.LineSegments, geometry: THREE.BufferGeometry) { obj.geometry.dispose(); obj.geometry = geometry; }
/** 8×8 footprint samples, with exact vertical interval unions at each sample. The
 * column tops follow the declared roof; overlapping/nested OBBs never count twice.
 * Called on snapshots/shape or terrain refreshes and the site's diffs, never frames. */
function massCoverage(site: PublicSite, mass: Mass, boxes: OBB[], groundAt: Options['groundAt']): number {
  const centre = worldPoint(...mass.at, site.site.at, site.site.yaw), yaw = site.site.yaw + (mass.yaw ?? 0);
  // Coverage uses physical ground, excluding the ghost geometry's 8 cm z-fight lift.
  const base = groundAt(...centre) ?? 0, [w, d] = mass.size, rise = Math.min(w, d) * 0.5;
  const candidates = boxes.flatMap(box => {
    const [x, z] = localPoint(...box.c, centre, yaw), c = Math.cos(box.yaw - yaw), s = Math.sin(box.yaw - yaw);
    const y0 = Math.max(0, box.y0 - base), y1 = Math.min(mass.h + (mass.roof === 'gable' || mass.roof === 'pyramid' ? rise : 0), box.y1 - base);
    const dx = Math.abs(c) * box.half[0] + Math.abs(s) * box.half[1], dz = Math.abs(s) * box.half[0] + Math.abs(c) * box.half[1];
    return y1 <= y0 || Math.abs(x) - dx >= w / 2 || Math.abs(z) - dz >= d / 2 ? [] : [{ x, z, c, s, half: box.half, y0, y1 }];
  }).sort((a, b) => a.y0 - b.y0);
  if (!candidates.length) return 0;
  let filled = 0, total = 0;
  for (let iz = 0; iz < COVERAGE_GRID; iz++) for (let ix = 0; ix < COVERAGE_GRID; ix++) {
    const x = ((ix + 0.5) / COVERAGE_GRID - 0.5) * w, z = ((iz + 0.5) / COVERAGE_GRID - 0.5) * d;
    const roof = mass.roof === 'gable' ? 1 - (w >= d ? Math.abs(z) * 2 / d : Math.abs(x) * 2 / w) : mass.roof === 'pyramid' ? 1 - Math.max(Math.abs(x) * 2 / w, Math.abs(z) * 2 / d) : 0;
    const top = mass.h + roof * rise; total += top;
    let high = 0;
    for (const box of candidates) {
      if (box.y0 >= top) break;
      const dx = x - box.x, dz = z - box.z;
      if (Math.abs(dx * box.c - dz * box.s) > box.half[0] || Math.abs(dx * box.s + dz * box.c) > box.half[1]) continue;
      const end = Math.min(top, box.y1);
      filled += Math.max(0, end - Math.max(high, box.y0)); high = Math.max(high, end);
    }
  }
  return Math.min(1, filled / total);
}
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
function massVolumes(site: PublicSite, groundAt: Options['groundAt'], pad = 0) {
  return site.massing.slice(0, 8).map(m => {
    const v = volume(m.size[0], m.size[1], m.h, m.roof), [cx, cz] = worldPoint(m.at[0], m.at[1], site.site.at, site.site.yaw), base = (groundAt(cx, cz) ?? 0) + 0.08;
    const height = Math.max(...v.vertices.map(vertex => vertex[1]));
    v.vertices = v.vertices.map(([x, y, z]) => {
      const [sx, sz] = worldPoint(x * (1 + 2 * pad / m.size[0]), z * (1 + 2 * pad / m.size[1]), m.at, m.yaw ?? 0), [wx, wz] = worldPoint(sx, sz, site.site.at, site.site.yaw);
      return [wx, base + y * (1 + 2 * pad / height) - pad, wz];
    });
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
function obbVolume(box: OBB, pad = 0) {
  const v = volume(box.half[0] * 2 + pad * 2, box.half[1] * 2 + pad * 2, box.y1 - box.y0 + pad * 2, 'flat');
  v.vertices = v.vertices.map(([x, y, z]) => { const [wx, wz] = worldPoint(x, z, box.c, box.yaw); return [wx, box.y0 - pad + y, wz]; });
  return v;
}
function obbEdges(box: OBB) { const v = obbVolume(box); return v.edges.flatMap(id => v.vertices[id]); }
function sheenGeometry(volumes: Volume[]) {
  const points: number[] = [], heights: number[] = [];
  let low = Infinity, high = -Infinity;
  for (const volume of volumes) for (const vertex of volume.vertices) { low = Math.min(low, vertex[1]); high = Math.max(high, vertex[1]); }
  for (const volume of volumes) for (const id of volume.triangles) {
    const vertex = volume.vertices[id]; points.push(...vertex); heights.push((vertex[1] - low) / Math.max(0.001, high - low));
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  return geometry;
}
const DIGIT_SEGMENTS = [[0, 0, 0.5, 0], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 1], [0, 1, 0.5, 1], [0, 0.5, 0, 1], [0, 0, 0, 0.5], [0, 0.5, 0.5, 0.5]];
const DIGITS: Record<string, string> = { '0': '012345', '1': '12', '2': '01643', '3': '01236', '4': '1256', '5': '02563', '6': '023456', '7': '012', '8': '0123456', '9': '012356' };
function digitLines(char: string): number[][] { return char === '/' ? [[0.05, 1, 0.45, 0]] : [...(DIGITS[char] ?? '')].map(i => DIGIT_SEGMENTS[Number(i)]); }
