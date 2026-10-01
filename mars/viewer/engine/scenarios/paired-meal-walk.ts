// HYPOTHETICAL clear-aisle invitation data; the activity checks actual feasibility.
import type { PairedWalkParams } from '../activities/paired-walk.ts';
export function pairedMealWalk(worker: string, companion: string, centreX: number): PairedWalkParams {
  return { actors: [worker, companion], rendezvous: [[centreX - 0.45, 4], [centreX + 0.45, 4]],
    destination: [[centreX - 0.45, -5.85], [centreX + 0.45, -5.85]], speed: 0.9 };
}
