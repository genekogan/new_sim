import type {Object3D} from 'three';
/** Visual obstruction boundary only. Caller supplies current owned greenery;
 * flat decorative paint, labels and effects are deliberately outside this list. */
export function worldCameraRenderRoots(geometry:Object3D,recordedObjects:readonly Object3D[],greenery:readonly (Object3D|null|undefined)[]):readonly Object3D[]{
 return [...new Set([geometry,...recordedObjects,...greenery.filter((root):root is Object3D=>!!root)])];
}
