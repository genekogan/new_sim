import * as THREE from 'three';
import type { PhotoSubject, PhotoCandidate, PhotoEvidence, PhotoFront } from './context-photographer.ts';
export type ContextGround = (x: number, z: number) => number | null;
export type ContextMesh = { id: string; entity: string; mesh: THREE.Mesh };
export type ContextPhotoTarget = {
    ref: string; entity: string; point: [number, number, number]; radius: number;
    viewpoint?: { eye: [number, number, number]; at: [number, number, number] };
    fixedCamera?: boolean; interior?: boolean; front?: PhotoFront;
    scope?: 'entity' | 'room' | 'slot' | 'point' | 'region';
    subjectKind?: PhotoSubject['kind']; region?: [number, number][];
    room?: NonNullable<PhotoSubject['room']>;
};
/** Convex room clipping is exact. Unsupported concave room masks remain an honest miss. */
export function roomPlanes(room: NonNullable<PhotoSubject['room']>): THREE.Plane[] | null {
    const polygon = room.polygon, center = new THREE.Vector3(polygon.reduce((n,p)=>n+p[0],0)/polygon.length, 0, polygon.reduce((n,p)=>n+p[1],0)/polygon.length);
    if (polygon.length < 3) return null;
    const planes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -room.floor), new THREE.Plane(new THREE.Vector3(0, -1, 0), room.ceiling)];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(b[1] - a[1], 0, a[0] - b[0]).normalize(), new THREE.Vector3(a[0], 0, a[1]));
        if (plane.distanceToPoint(center) < 0) plane.negate();
        if (polygon.some(p => plane.distanceToPoint(new THREE.Vector3(p[0], 0, p[1])) < -.001)) return null;
        planes.push(plane);
    }
    return planes;
}
export function contextPhotoScene(target: ContextPhotoTarget, entries: readonly ContextMesh[]) {
    // A semantic point or seat slot has no isolated render geometry. Never score its whole owner as the part.
    if (target.scope === 'point' || target.scope === 'slot') return null;
    const regionScope = target.scope === 'region';
    if (regionScope && !target.region?.length) return null;
    const kind = regionScope ? 'landscape' : target.subjectKind ?? (target.interior ? 'part' : 'exterior');
    const room = kind === 'room' ? target.room : undefined;
    const planes = room ? roomPlanes(room) : [];
    if (!planes) return null;
    const roomBox = room ? new THREE.Box3().setFromPoints(room.polygon.flatMap(([x,z]) => [new THREE.Vector3(x,room.floor,z),new THREE.Vector3(x,room.ceiling,z)])) : undefined;
    const selected = entries.filter(entry => {
        if (regionScope) return false;
        if (!roomBox) return entry.entity === target.entity;
        if (entry.mesh.userData.contextStructure?.classification === 'roof') return false;
        const box = new THREE.Box3().setFromObject(entry.mesh);
        if (!box.intersectsBox(roomBox)) return false;
        return entry.entity === target.entity || planes.every(plane => plane.distanceToPoint(box.getCenter(new THREE.Vector3())) >= -.01);
    });
    const mask = new THREE.Scene(), owned: THREE.BufferGeometry[] = [];
    for (const entry of selected) {
        const copy = entry.mesh.clone(false);
        copy.matrixAutoUpdate = false; copy.matrix.copy(entry.mesh.matrixWorld);
        mask.add(copy);
    }
    if (!mask.children.length && target.region?.length) {
        const shape = new THREE.Shape(target.region.map(p => new THREE.Vector2(p[0], -p[1]))), geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2); geometry.translate(0, target.point[1], 0); owned.push(geometry);
        mask.add(new THREE.Mesh(geometry, doubleSided));
    }
    if (!mask.children.length) return null;
    mask.updateMatrixWorld(true);
    const bounds = roomBox ?? new THREE.Box3().setFromObject(mask);
    const subject: PhotoSubject = {
        ref: target.ref, kind, target: regionScope ? bounds.getCenter(new THREE.Vector3()).toArray() : target.point,
        bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
        objectIds: selected.map(entry => entry.id), interior: target.interior, room: target.room,
        front: target.front, authoredCamera: target.fixedCamera ? target.viewpoint : undefined,
        occluders: entries.flatMap(entry => {
            const structure = entry.mesh.userData.contextStructure;
            return structure?.classification === 'roof' || structure?.classification === 'wall' ? [{ id: entry.id, classification: structure.classification, exteriorFacade: structure.exteriorFacade === true }] : [];
        }), aspect: 10 / 7,
    };
    return { mask, subject, planes, dispose() { mask.clear(); for (const geometry of owned) geometry.dispose(); } };
}
const doubleSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const direction = new THREE.Vector3(.938, .194, .287).normalize();
/** Ray parity in both directions rejects eyes inside closed solid geometry, not empty building boxes. */
function insideMesh(point: THREE.Vector3, mesh: THREE.Mesh): boolean {
    if (!new THREE.Box3().setFromObject(mesh).containsPoint(point)) return false;
    const material = mesh.material; mesh.material = doubleSided;
    try {
        return [direction, direction.clone().negate()].every(dir => {
            const hits = new THREE.Raycaster(point, dir, 0, 10000).intersectObject(mesh, false);
            const distances = hits.map(hit => hit.distance).filter((distance, i, all) => i === 0 || distance - all[i - 1] > .0001);
            return distances.some(distance => distance < .03) || distances.length % 2 === 1;
        });
    } finally { mesh.material = material; }
}
export function contextPhotoGeometry(subject: PhotoSubject, candidate: PhotoCandidate, entries: readonly ContextMesh[], ground?: ContextGround): Pick<PhotoEvidence, 'insideSolid' | 'clipping' | 'occluderIds'> {
    const camera = new THREE.PerspectiveCamera(candidate.fov, subject.aspect ?? 10 / 7, .01, 10000);
    camera.position.fromArray(candidate.eye); camera.lookAt(new THREE.Vector3(...candidate.at)); camera.updateMatrixWorld(true);
    const active = entries.filter(entry => entry.mesh.visible && !entry.mesh.userData.cameraTransparent && !candidate.cutaway?.occluderIds.includes(entry.id));
    const corners: THREE.Vector3[] = [];
    for (const x of [subject.bounds.min[0], subject.bounds.max[0]]) for (const y of [subject.bounds.min[1], subject.bounds.max[1]]) for (const z of [subject.bounds.min[2], subject.bounds.max[2]]) corners.push(new THREE.Vector3(x,y,z));
    const blockers = new Set<string>();
    const subjects = new Set(subject.objectIds);
    const byMesh = new Map(active.map(entry => [entry.mesh, entry.id]));
    for (const sample of [new THREE.Vector3(...subject.target), ...corners]) {
        const delta = sample.clone().sub(camera.position), distance = delta.length();
        if (!distance) continue;
        // Inventory every blocker before this actual subject sample. Nested roofs
        // otherwise leave the second roof hidden behind the first hit forever.
        const hits = new THREE.Raycaster(camera.position, delta.normalize(), .01, Math.max(.01, distance - .01)).intersectObjects(active.map(entry => entry.mesh), false);
        for (const hit of hits) {
            const id = byMesh.get(hit.object as THREE.Mesh);
            if (id && !subjects.has(id)) blockers.add(id);
        }
    }
    // Interior room walls deliberately surround the eye; framing their entire exterior bounding box is not the task.
    const clipping = subject.kind === 'room' ? 0 : corners.filter(point => { const projected = point.clone().project(camera); return Math.abs(projected.x) > 1.02 || Math.abs(projected.y) > 1.02 || Math.abs(projected.z) > 1; }).length / corners.length;
    const floor = ground?.(candidate.eye[0], candidate.eye[2]);
    // Terrain is a height field, not a closed mesh: ray parity cannot detect underground cameras.
    const belowGround = floor != null && Number.isFinite(floor) && candidate.eye[1] < floor + .03;
    return { insideSolid: belowGround || active.some(entry => insideMesh(camera.position, entry.mesh)), clipping, occluderIds: [...blockers] };
}
