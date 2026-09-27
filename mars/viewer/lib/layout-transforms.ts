import type { Object3D } from 'three';
import type { Edit } from './layout';
export function nestedTransforms(
  root: Object3D,
): NonNullable<Edit['children']> {
  const output: NonNullable<Edit['children']> = [];
  function walk(o: Object3D, path: number[]) {
    o.children.forEach((child, i) => {
      const next = [...path, i];
      output.push({
        path: next,
        position: child.position.toArray(),
        quaternion: child.quaternion.toArray(),
        scale: child.scale.toArray(),
      });
      walk(child, next);
    });
  }
  walk(root, []);
  return output;
}
export function applyNestedTransforms(
  root: Object3D,
  edits: NonNullable<Edit['children']>,
) {
  const seen = new Set<string>();
  const resolved = edits.map((e) => {
    const key = e.path.join('.');
    if (seen.has(key)) throw Error('Duplicate child transform');
    seen.add(key);
    let o: Object3D = root;
    for (const index of e.path) {
      if (!o.children[index]) throw Error('Unknown child transform');
      o = o.children[index];
    }
    return { o, e };
  });
  for (const { o, e } of resolved) {
    o.position.fromArray(e.position);
    o.quaternion.fromArray(e.quaternion).normalize();
    o.scale.fromArray(e.scale);
  }
}
