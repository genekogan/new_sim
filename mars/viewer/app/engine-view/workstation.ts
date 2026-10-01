import * as THREE from 'three';
import { importedWorkstation, type WorkstationAppearanceOptions, type WorkstationAppearanceState } from './imported-workstation.ts';
export type { WorkstationAppearanceOptions, WorkstationAppearanceState } from './imported-workstation.ts';
import type { Entity } from '../../engine/world/types.ts';
export interface WorkstationVisual { obj: THREE.Group; update(e: Entity): void; dispose(): void; appearanceState?(): WorkstationAppearanceState }
/** Generic composite scaled to the catalog envelope; no imported laptop mesh. */
export function workstationObject(box: (color: string, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, metal?: number) => THREE.Mesh, sx: number, sy: number, sz: number, appearance?: WorkstationAppearanceOptions): WorkstationVisual {
  const group = new THREE.Group(), desktop = sy * 0.74 / 1.3;
  group.add(box('#a98b68', 0, desktop - 0.04, 0, sx, 0.04, sz));
  for (const x of [-1, 1]) for (const z of [-1, 1]) group.add(box('#59636d', x * (sx / 2 - 0.08), 0, z * (sz / 2 - 0.08), 0.05, desktop - 0.04, 0.05, 0.4));
  group.add(box('#333b46', 0, desktop, sz * 0.22, 0.18, 0.025, 0.15));
  group.add(box('#333b46', 0, desktop + 0.025, sz * 0.22, 0.04, sy - desktop - 0.42, 0.04));
  group.add(box('#172330', 0, sy - 0.4, sz * 0.22, 0.6, 0.4, 0.06));
  group.add(box('#345967', 0, sy - 0.37, sz * 0.22 - 0.032, 0.54, 0.34, 0.004));
  group.add(box('#303942', 0, desktop, -sz * 0.25, 0.42, 0.018, 0.15));
  group.add(box('#424c55', 0.32, desktop, -sz * 0.25, 0.05, 0.025, 0.07));
  const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 240;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const geometry = new THREE.PlaneGeometry(0.54, 0.34);
  const screen = new THREE.Mesh(geometry, material); screen.position.set(0, sy - 0.2, sz * 0.22 - 0.037); screen.rotation.y = Math.PI; group.add(screen);
  const primitive = group.children.slice(5);
  let primitiveScreenDisposed = false;
  const releasePrimitiveScreen = () => {
    if (primitiveScreenDisposed) return;
    primitiveScreenDisposed = true;
    screen.removeFromParent();
    geometry.dispose();
    material.dispose();
  };
  const imported = appearance ? importedWorkstation(group, texture, sx, sy, sz, desktop, appearance, () => {
    for (const part of primitive) part.visible = false;
    // Loading may render the fallback before the model arrives. Release its owned
    // plane/material now; the imported CRT continues to use the shared canvas.
    releasePrimitiveScreen();
  }) : undefined;
  let key = '';
  return { obj: group, ...(imported ? { appearanceState: imported.state } : {}), update(e: Entity) {
    const c = e.equipment?.kind === 'workstation' ? e.equipment.config : {};
    const status = typeof c.status === 'string' ? c.status : 'idle';
    const task = typeof c.task === 'string' ? c.task : 'Computer ready';
    const progress = typeof c.workSeconds === 'number' && typeof c.durationSeconds === 'number' && c.durationSeconds > 0 ? Math.min(1, c.workSeconds / c.durationSeconds) : 0;
    const next = `${status}:${task}:${Math.round(progress * 100)}`; if (next === key) return; key = next;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#172b36'; ctx.fillRect(0, 0, 384, 240);
    ctx.fillStyle = '#d8eee9'; ctx.font = 'bold 25px sans-serif'; ctx.fillText(task.slice(0, 24), 24, 54);
    ctx.font = '22px sans-serif'; ctx.fillText(`${status} · ${Math.round(progress * 100)}%`, 24, 105);
    ctx.fillStyle = '#355764'; ctx.fillRect(24, 153, 336, 25); ctx.fillStyle = '#7dc7bc'; ctx.fillRect(24, 153, 336 * progress, 25);
    texture.needsUpdate = true;
  }, dispose() { imported?.dispose(); texture.dispose(); releasePrimitiveScreen(); } };

}
