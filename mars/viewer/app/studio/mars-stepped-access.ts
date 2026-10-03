import * as THREE from 'three';
import { registerSteppedEntry, steppedAccess, type SteppedAccessMetadata } from './stepped-access.ts';

/** Existing released CAD supports, identified by source-backed auditorium review.
 * No dimensions, geometry, material, transform or historical furniture is authored here.
 */
const SOURCES = [
  ['0758', 'Geom3D.2859'], ['0752', 'Geom3D.2847'], ['0756', 'Geom3D.2855'],
  ['0754', 'Geom3D.2851'], ['0727', 'Geom3D.2800'], ['0804', 'Geom3D.2905'],
  ['0826', 'Geom3D.2947'], ['0806', 'Geom3D.2925'], ['1814', 'Geom3D.577'],
] as const;
const ASCENT = new THREE.Vector3(-1.103851318359375, 0, -0.5241432189941406).normalize();
const ENTRY_POSITIONS = [
  [6.2043304443359375, 2.682209014892578e-7, 1.9337806701660156],
  [-2.7218017578125, 1.043081283569336e-7, 0.7320899963378906],
  [5.027679443359375, 5 / 8388608, 4.411811828613281],
  [-6.5965423583984375, -1.4901161193847656e-7, -1.1077690124511719],
  [-5.0276641845703125, -5 / 8388608, -4.411811828613281],
  [6.5965576171875, 1.4901161193847656e-7, 1.1077728271484375],
];
const ENTRY_INDEX = [0, 1, 2, 1, 0, 3, 3, 0, 4, 4, 0, 5];
function entryMatches(mesh: THREE.Mesh) {
  if (mesh.userData.component_id !== 'wood_component-1814' || mesh.userData.source_mesh !== 'Geom3D.577' || mesh.userData.assembly_id !== 'chiba') return false;
  const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  if (!p || p.count !== ENTRY_POSITIONS.length || !index || index.count !== ENTRY_INDEX.length) return false;
  for (let i = 0; i < p.count; i++) if (p.getX(i) !== ENTRY_POSITIONS[i][0] || p.getY(i) !== ENTRY_POSITIONS[i][1] || p.getZ(i) !== ENTRY_POSITIONS[i][2]) return false;
  for (let i = 0; i < index.count; i++) if (index.getX(i) !== ENTRY_INDEX[i]) return false;
  // Exact signature retains the concave footprint/hole boundary. Also assert its
  // upward coplanar role rather than allowing an underside or arbitrary polygon.
  const heights = ENTRY_POSITIONS.map(v => v[1]);
  if (Math.max(...heights) - Math.min(...heights) > 2e-6) return false;
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, index.getX(i + k)));
    if (b.sub(a).cross(c.sub(a)).normalize().y < 0.999999) return false;
  }
  return true;
}
export interface MarsSteppedAccessReport {
  tagged: string[];
  refused: { id: string; reason: string }[];
}
/** Call after additions + updateWorldMatrix, before collision rebuilding/batching.
 * The nine-support commitment is atomic; a source mismatch refuses all new tags.
 */
export function tagMarsSteppedAccess(root: THREE.Object3D): MarsSteppedAccessReport {
  root.updateWorldMatrix(true, true);
  const refused: MarsSteppedAccessReport['refused'] = [];
  const planned: { mesh: THREE.Mesh; data: SteppedAccessMetadata }[] = [];
  const host = root.getObjectByName('Chiba');
  for (const [suffix, source] of SOURCES) {
    const id = `wood_component-${suffix}`;
    const matches: THREE.Mesh[] = [];
    host?.traverse(o => { if (o instanceof THREE.Mesh && o.userData.component_id === id) matches.push(o); });
    if (matches.length !== 1) { refused.push({ id, reason: `access.source-mesh: expected one ${source}, found ${matches.length}` }); continue; }
    const mesh = matches[0];
    if (mesh.userData.source_mesh !== source || mesh.userData.assembly_id !== 'chiba') {
      refused.push({ id, reason: `access.source-mesh: expected ${source}/chiba, got ${String(mesh.userData.source_mesh)}/${String(mesh.userData.assembly_id)}` }); continue;
    }
    const axis = ASCENT.clone().transformDirection(host!.matrixWorld).transformDirection(mesh.matrixWorld.clone().invert());
    const data: SteppedAccessMetadata = { kind: 'stepped-access', id: 'mars-2026-chiba-auditorium', axis: [axis.x, axis.z], maxRise: .4, maxDrop: .4, maxGap: .04, profile: 'authored-rectangle' };
    if (suffix === '1814') {
      if (!entryMatches(mesh)) { refused.push({ id, reason: `access.entry-signature: ${source} positions/index/upward plane changed` }); continue; }
      registerSteppedEntry(mesh, () => entryMatches(mesh));
    }
    const previous = mesh.userData.walkTraversal;
    mesh.userData.walkTraversal = data;
    const qualifies = steppedAccess(mesh);
    if (previous === undefined) delete mesh.userData.walkTraversal; else mesh.userData.walkTraversal = previous;
    if (!qualifies) { refused.push({ id, reason: `access.support-profile: ${source} is not the bounded upright authored support` }); continue; }
    planned.push({ mesh, data });
  }
  if (refused.length) return { tagged: [], refused };
  for (const { mesh, data } of planned) mesh.userData.walkTraversal = data;
  return { tagged: planned.map(v => String(v.mesh.userData.component_id)), refused: [] };
}
