import * as THREE from 'three';
/** Eyes mode (M3, `?eyes=1`): the viewer as a hidden render surface for GET /v1/edge/view. A server-side render
 * worker (one headless browser, one page) calls `window.edenEyes.capture(job)`; this module poses the camera at the
 * Soul's eyes (or overhead for map mode), hides every Soul body the server did not list as seen (and the Soul's own
 * body), hides spectator overlays (speech bubbles, selection ring, pivot), draws one frame at the requested size and
 * returns it as a JPEG. Between jobs it draws nothing and the scene updates at a few Hz. Never touches simulation;
 * without `?eyes=1` it does nothing. */
export type EyesJob = {mode: 'eyes' | 'map'; w: number; h: number; quality?: number; pose: {p: [number, number, number]; yaw: number; pitch: number; vfov: number}; self: string; show: string[]; span?: number};
export type EyesResult = {ok: true; b64: string; frameTick: number | null; frames: number; ms: number} | {ok: false; error: string};
export type EyesHost = {
  renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; scene: THREE.Scene;
  /** The drawn body of an entity (Soul), if any. */
  body(entityId: string): THREE.Object3D | null;
  /** Entity ids of every Soul in the replica. */
  souls(): string[];
  /** Spectator-only overlays never shown to a Soul's eyes. */
  overlays(): (THREE.Object3D | null | undefined)[];
  tick(): number | null; ready(): boolean;
};
type Pending = {job: EyesJob; resolve(r: EyesResult): void; frames: number; started: number};
const WARM_FRAMES = 2, IDLE_MS = 100;   // 10 Hz idle updates keep the viewer's own clock (weather easing, motion) at real time

export class WorldEyes {
  private queue: Pending[] = []; private lastWake = 0; private disposed = false;
  private compiled: Promise<unknown> | undefined;
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  private readonly host: EyesHost;
  static fromSearch(search: string, host: EyesHost): WorldEyes | null {return new URLSearchParams(search).get('eyes') === '1' ? new WorldEyes(host) : null;}
  constructor(host: EyesHost) {
    this.host = host; host.renderer.setPixelRatio(1);
    (window as unknown as {edenEyes?: unknown}).edenEyes = {
      ready: () => !this.disposed && host.ready(),
      capture: (job: EyesJob) => this.capture(job),
    };
  }
  private capture(job: EyesJob): Promise<EyesResult> {
    if (this.disposed) return Promise.resolve({ok: false, error: 'viewer closed'});
    if (!this.host.ready()) return Promise.resolve({ok: false, error: 'scene not loaded yet'});
    // first job: compile every material in the scene once (software GL otherwise stalls for seconds on new shaders)
    this.compiled ??= this.host.renderer.compileAsync(this.host.scene, this.host.camera).catch(() => undefined);
    const started = performance.now();
    return this.compiled.then(() => new Promise<EyesResult>(resolve => this.queue.push({job, resolve, frames: 0, started})));
  }
  /** Run this animation frame? While idle only every IDLE_MS (the scene keeps up; nothing is drawn). */
  wake(now: number): boolean {if (this.queue.length) return true; if (now - this.lastWake >= IDLE_MS) {this.lastWake = now; return true;} return false;}
  /** Before view-dependent passes: put the main camera at the Soul's eyes so culling, shadows and LOD follow it. */
  aim(): void {
    const p = this.queue[0]; if (!p || p.job.mode !== 'eyes') return;
    const {camera} = this.host, {pose, w, h} = p.job, c = Math.cos(pose.pitch);
    camera.position.set(pose.p[0], pose.p[1], pose.p[2]); camera.up.set(0, 1, 0);
    // engine yaw: 0 faces +x, forward = (cos yaw, sin yaw) on x/z
    camera.lookAt(pose.p[0] + Math.cos(pose.yaw) * c, pose.p[1] + Math.sin(pose.pitch), pose.p[2] + Math.sin(pose.yaw) * c);
    camera.clearViewOffset(); camera.fov = pose.vfov * 180 / Math.PI; camera.aspect = w / h; camera.near = 0.05; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  /** Replaces the viewer's own draw in eyes mode. Returns true (eyes mode always handles the frame). */
  render(): boolean {
    const p = this.queue[0]; if (!p) return true;
    const {renderer, scene, camera} = this.host, {job} = p, hidden: THREE.Object3D[] = [];
    try {
      const size = renderer.getSize(new THREE.Vector2()); if (size.x !== job.w || size.y !== job.h) renderer.setSize(job.w, job.h, false);
      const show = new Set(job.show), hide = (o: THREE.Object3D | null | undefined) => {if (o && o.visible) {o.visible = false; hidden.push(o);}};
      for (const id of this.host.souls()) if ((id === job.self && job.mode === 'eyes') || (id !== job.self && !show.has(id))) hide(this.host.body(id));
      for (const o of this.host.overlays()) hide(o);
      let view: THREE.Camera = camera;
      if (job.mode === 'map') {
        const span = job.span ?? 12, a = job.h / job.w, o = this.ortho;
        o.left = -span; o.right = span; o.top = span * a; o.bottom = -span * a; o.updateProjectionMatrix();
        o.position.set(job.pose.p[0], job.pose.p[1] + 60, job.pose.p[2]); o.up.set(0, 0, -1); o.lookAt(job.pose.p[0], job.pose.p[1], job.pose.p[2]); o.updateMatrixWorld();
        view = o;
      } else this.aim();
      renderer.render(scene, view);
      p.frames++;
      if (p.frames < WARM_FRAMES) return true;
      // copy now (the drawing buffer is valid until this task ends), encode asynchronously
      const out = document.createElement('canvas'); out.width = job.w; out.height = job.h;
      const ctx = out.getContext('2d')!; ctx.drawImage(renderer.domElement, 0, 0, job.w, job.h);
      if (job.mode === 'map') mapMarker(ctx, job);
      this.queue.shift();
      const tick = this.host.tick();
      out.toBlob(blob => {
        if (!blob) {p.resolve({ok: false, error: 'encode failed'}); return;}
        void blob.arrayBuffer().then(buf => p.resolve({ok: true, b64: base64(new Uint8Array(buf)), frameTick: tick, frames: p.frames, ms: Math.round(performance.now() - p.started)}));
      }, 'image/jpeg', Math.max(0.3, Math.min(0.95, job.quality ?? 0.7)));
    } catch (error) {
      this.queue.shift(); p.resolve({ok: false, error: error instanceof Error ? error.message : String(error)});
    } finally {for (const o of hidden) o.visible = true;}
    return true;
  }
  dispose(): void {
    this.disposed = true; for (const p of this.queue.splice(0)) p.resolve({ok: false, error: 'viewer closed'});
    delete (window as unknown as {edenEyes?: unknown}).edenEyes;
  }
}
/** The Soul on the overhead map: a small arrow in its heading (north is up: screen up = −z, screen right = +x). */
function mapMarker(ctx: CanvasRenderingContext2D, job: EyesJob) {
  const cx = job.w / 2, cy = job.h / 2, dx = Math.cos(job.pose.yaw), dy = Math.sin(job.pose.yaw), s = Math.max(7, job.w / 32);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath(); ctx.moveTo(s * 1.4, 0); ctx.lineTo(-s * 0.8, s * 0.75); ctx.lineTo(-s * 0.35, 0); ctx.lineTo(-s * 0.8, -s * 0.75); ctx.closePath();
  ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.font = '600 10px system-ui,sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 3; ctx.strokeText('N', job.w - 12, 13); ctx.fillText('N', job.w - 12, 13);
}
function base64(bytes: Uint8Array): string {let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s);}
