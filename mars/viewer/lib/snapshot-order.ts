import type { SimSnapshot } from '../simulation/shared';
export function acceptsSnapshot(last: SimSnapshot | null, next: SimSnapshot) {
  return (
    !last ||
    (next.state.revision >= last.state.revision &&
      (next.state.revision > last.state.revision || next.now >= last.now))
  );
}
