// Camera, canvas and readiness semantics mirror tools/god-skill/lib/look.mjs at the W2 base.
import type { Look } from './look.ts';

export const preserveScript = `(() => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, attrs) { if (/webgl/.test(String(type))) attrs = { ...(attrs || {}), preserveDrawingBuffer: true }; return orig.call(this, type, attrs); }; })()`;

const ready = `(want) => {
      const w = window.__simEntity; if (!w?.layer?.active) return { ready: false, why: document.title === 'no-entity-world' ? 'no entity world on this page' : 'loading the viewer' };
      const drawn = w.layer.drawn; const now = w.layer.now ?? performance.now();
      const easing = drawn ? [...drawn.values()].filter((d) => (now - d.t0) / 1000 < d.dur).length : 0;
      // terrain-only entities (hills, lakes) are not drawn as things: most of \`want\` is enough
      return { ready: !!window.__shotReady && (!want || (drawn?.size ?? 0) >= Math.floor(want * 0.6)) && easing === 0, drawn: drawn?.size ?? null, want, easing, shotReady: !!window.__shotReady };
    }`;

const frame = `([e0, a, roofs, cutAt, fitSpan]) => new Promise((res) => {
    const w = window.__simEntity;
    // back the camera off until \`fitSpan\` metres fit the frame at this camera's real field of view
    let e = e0;
    if (fitSpan > 0 && w.camera.fov) {
      const v = (w.camera.fov * Math.PI) / 180, h = 2 * Math.atan(Math.tan(v / 2) * (w.camera.aspect || 1.6));
      const need = (fitSpan / 2) / Math.tan(Math.min(v, h) / 2) * 1.05, d = [e0[0] - a[0], e0[1] - a[1], e0[2] - a[2]], len = Math.hypot(...d) || 1;
      if (len < need) e = d.map((c, i) => a[i] + (c / len) * need);
    }
    const eyeDistance = Math.hypot(...e.map((c, i) => c - a[i]));
    if (!e.every(Number.isFinite) || !a.every(Number.isFinite) || !Number.isFinite(eyeDistance) || eyeDistance <= Math.max(0, w.camera.near ?? 0)) throw Error('Requested look camera is within the viewer near clipping plane');
    // L2's interior view: roofs (and the storeys above \`cut\`) off for every building
    window.__buildingView = roofs ? { hideRoofs: true, cut: cutAt } : { hideRoofs: false, cut: null };
    w.controls.target.set(a[0], a[1], a[2]); w.camera.position.set(e[0], e[1], e[2]); w.camera.lookAt(w.controls.target); w.controls.update?.();
    // a world-scale look (the camera a kilometre out) must not be cut by the play camera's far plane or fog
    const dist = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
    if (w.camera.far < dist * 3) { w.camera.far = dist * 3; w.camera.updateProjectionMatrix?.(); }
    const fog = w.scene.fog; if (fog && 'far' in fog && fog.far < dist * 2.5) { fog.near = Math.max(fog.near ?? 0, dist * 0.8); fog.far = dist * 2.5; }
    if (fog && 'density' in fog) fog.density = Math.min(fog.density, 0.6 / Math.max(1, dist));
    const hidden = [];
    if (roofs) w.scene.traverse((o) => { if (o.visible && (/roof/i.test(o.name ?? '') || o.userData?.role === 'roof')) { o.visible = false; hidden.push(o); } });
    window.__lookRestore = () => { for (const o of hidden) o.visible = true; };
    const canvas = document.querySelector('canvas');
    if (canvas) { const keep = new Set(); for (let n = canvas; n; n = n.parentElement) keep.add(n); for (const n of keep) for (const c of n.children ?? []) if (!keep.has(c)) c.style.visibility = 'hidden'; }
    let n = 0; const t = performance.now(); const tick = () => { if (++n >= 4 || performance.now() - t > 120000) res({ n, ms: Math.round(performance.now() - t), roofsHidden: hidden.length, eye: e, at: a }); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  })`;

const canvas = `({ eye, at }) => {
    try {
      const w = window.__simEntity, close = (v, want) => v?.toArray().every((c, i) => Number.isFinite(c) && Math.abs(c - want[i]) <= 1e-4);
      if (!window.__shotReady || !close(w?.camera?.position, eye) || !close(w?.controls?.target, at)) throw Error('look: requested camera changed before capture; retry the shot');
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return c ? c.toDataURL('image/png') : null;
    } finally { window.__lookRestore?.(); }
  }`;

export const readyExpression = (expect: number) => `(${ready})(${JSON.stringify(expect)})`;
export const captureExpression = (shot: Look) => `(async () => { const frames = await (${frame})(${JSON.stringify([shot.eye, shot.at, shot.hideRoofs, shot.cut, shot.span])}); await new Promise(r => setTimeout(r, 800)); return (${canvas})(frames); })()`;
