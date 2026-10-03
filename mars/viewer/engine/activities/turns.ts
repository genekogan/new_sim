/** Presentation-only deterministic floor state. No world, actor, or pose access. */
export interface TurnState {
  floorHolder?: string;
  elapsed: number;
  index: number;
  period: number;
}
export function createTurns(groupIndex: number): TurnState {
  // Distinct 3–5s periods for the bounded classroom's four possible groups.
  return { elapsed: 0, index: groupIndex, period: 3 + (groupIndex % 5) * 0.45 };
}
/** Clock starts only with a physically talking group and at least two eligible members. */
export function stepTurns(state: TurnState, members: readonly string[], talking: boolean, dt: number): boolean {
  const before = state.floorHolder;
  if (!talking || members.length < 2) {
    state.floorHolder = undefined;
    state.elapsed = 0;
    return before !== undefined;
  }
  if (!state.floorHolder || !members.includes(state.floorHolder)) {
    state.floorHolder = members[state.index % members.length];
    state.elapsed = 0;
  } else {
    state.elapsed += dt;
    if (state.elapsed + 1e-9 >= state.period) {
      state.index = (members.indexOf(state.floorHolder) + 1) % members.length;
      state.floorHolder = members[state.index];
      state.elapsed %= state.period;
    }
  }
  return before !== state.floorHolder;
}
