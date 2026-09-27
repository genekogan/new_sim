// Per-frame actor overlays: collision discs (engine radius) with facing
// arrows, and phase labels above heads (CSS2D, so they show in screenshots).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import { HUMAN_RADIUS } from '../../engine/world/catalog.ts';

const ACT_COLOR: Record<string, string> = { walk: '#3dd6ff', idle: '#e8e8e8', wait: '#ffc233', 'climb-up': '#8cff66', 'climb-down': '#8cff66', sit: '#ff7ac8', warm: '#ff9a3d', talk: '#c48cff', watch: '#fff27a' };

type Marker = { disc: THREE.Mesh; arrow: THREE.ArrowHelper; label: CSS2DObject };

export class AgentOverlays {
  readonly discs = new THREE.Group();
  readonly labels = new THREE.Group();
  private markers = new Map<string, Marker>();

  constructor() {
    this.discs.name = 'overlay:agents';
    this.labels.name = 'overlay:labels';
  }

  clear() {
    for (const m of this.markers.values()) {
      m.disc.geometry.dispose();
      (m.disc.material as THREE.Material).dispose();
      m.arrow.dispose();
      m.label.element.remove();
    }
    this.markers.clear();
    this.discs.clear();
    this.labels.clear();
  }

  private marker(id: string): Marker {
    let m = this.markers.get(id);
    if (m) return m;
    const disc = new THREE.Mesh(new THREE.RingGeometry(HUMAN_RADIUS - 0.04, HUMAN_RADIUS, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff', depthTest: false, transparent: true }));
    disc.renderOrder = 5;
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.6, '#fff', 0.18, 0.12);
    const el = document.createElement('div');
    el.className = 'lab-label';
    const label = new CSS2DObject(el);
    label.center.set(0.5, 1.25); // sit above the anchor so top-down views still show the person
    m = { disc, arrow, label };
    this.discs.add(disc, arrow);
    this.labels.add(label);
    this.markers.set(id, m);
    return m;
  }

  /**
   * positions: interpolated rig positions; yaw/activity/phase from the world.
   * violators: actor ids with a violation this tick (drawn red).
   */
  update(rt: Runtime, positions: Map<string, THREE.Vector3>, violators: Set<string>, showDiscs: boolean, showLabels: boolean) {
    if (!showDiscs && !showLabels) return;
    for (const [id, p] of positions) {
      const e = rt.world.entities[id];
      if (!e?.human) continue;
      const m = this.marker(id);
      const bad = violators.has(id);
      const color = bad ? '#ff1133' : ACT_COLOR[e.human.activity] ?? '#c48cff';
      m.disc.position.set(p.x, p.y + 0.04, p.z);
      (m.disc.material as THREE.MeshBasicMaterial).color.set(color);
      m.arrow.position.set(p.x, p.y + 0.06, p.z);
      m.arrow.setDirection(new THREE.Vector3(Math.cos(e.pose.yaw), 0, Math.sin(e.pose.yaw)));
      m.arrow.setColor(color);
      m.label.position.set(p.x, p.y + 2.05, p.z);
      if (showLabels) {
        const rec = e.human.task ? rt.records.get(e.human.task) : undefined;
        // social / crew children show their parents' verbs (nearest two): "gather › take_slot·occupied"
        const up: string[] = [];
        for (let p = rec?.parent ? rt.records.get(rec.parent) : undefined; p && up.length < 2; p = p.parent ? rt.records.get(p.parent) : undefined) up.unshift(p.verb);
        const phase = rec ? `${up.map((v) => `${v} › `).join('')}${rec.verb}${rec.phase ? `·${rec.phase}` : ''}${rec.status === 'blocked' ? ' BLOCKED' : ''}` : 'no task';
        const text = `${id} · ${e.human.activity} · L${e.human.level}\n${phase}`;
        if (m.label.element.textContent !== text) m.label.element.textContent = text;
        m.label.element.classList.toggle('bad', bad || rec?.status === 'blocked');
      }
    }
    for (const [id, m] of this.markers)
      if (!positions.has(id)) {
        this.discs.remove(m.disc, m.arrow);
        this.labels.remove(m.label);
        m.label.element.remove();
        this.markers.delete(id);
      }
  }
}
