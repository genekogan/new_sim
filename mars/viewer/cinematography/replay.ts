import type { CameraPose } from '../engine/camera/shots.ts';
export type ProgramFrame = {
  time: number;
  pose: CameraPose;
  cut: boolean;
  shot?: string;
};
/** Resolved program output; exact frame replay requires no world lookahead or model. */
export function replayFrame(
  frames: readonly ProgramFrame[],
  time: number,
): ProgramFrame | undefined {
  let lo = 0,
    hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].time <= time) lo = mid + 1;
    else hi = mid - 1;
  }
  const a = frames[hi];
  if (!a) return;
  const b = frames[hi + 1];
  if (!b || b.cut || b.time === a.time) return structuredClone(a);
  const u = Math.min(1, Math.max(0, (time - a.time) / (b.time - a.time)));
  const blend = (x: number[], y: number[]) =>
    x.map((v, i) => v + (y[i] - v) * u) as [number, number, number];
  return {
    time,
    shot: a.shot,
    cut: false,
    pose: {
      position: blend(a.pose.position, b.pose.position),
      target: blend(a.pose.target, b.pose.target),
      fov: a.pose.fov + (b.pose.fov - a.pose.fov) * u,
    },
  };
}
