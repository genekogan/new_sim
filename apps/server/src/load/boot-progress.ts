// Boot progress slots (LOAD-CONTRACT §4 `phase` + `boot.{stage,tick,target}`), lane L5.
// A shim until lane L2's monitor owns the SharedArrayBuffer: L2 either imports `bootSlots` into the buffer its
// watchdog worker reads, or calls `attachBootSlots(view, offset)` to redirect the writes into its own buffer.
// Writes are plain Float64 stores (no locks): the worker only reads, and a torn read of one slot is harmless.
// Nothing here touches world state; recording progress never changes what a boot does.

export const BOOT_PHASES = ['boot:restore', 'boot:replay', 'boot:projection', 'boot:prepare', 'serving', 'stopping'] as const;
export type BootPhase = typeof BOOT_PHASES[number];

/** Slot layout (Float64): [phase index, boot tick, boot target tick, wall ms of the last write]. */
export const BOOT_SLOT = { phase: 0, tick: 1, target: 2, at: 3 } as const;
export const BOOT_SLOT_COUNT = 4;

let view: Float64Array<ArrayBufferLike> = new Float64Array(new SharedArrayBuffer(BOOT_SLOT_COUNT * 8));
let base = 0;
view[BOOT_SLOT.phase] = -1;

/** The slots as written by this process (L2's worker reads them through the SharedArrayBuffer). */
export const bootSlots = () => ({ view, offset: base });
/** Redirect future writes into another Float64Array (L2's buffer) at `offset`; copies the current values across. */
export function attachBootSlots(target: Float64Array, offset = 0): void {
  for (let i = 0; i < BOOT_SLOT_COUNT; i++) target[offset + i] = view[base + i];
  view = target; base = offset;
}

/** Enter a phase; `tick`/`target` are the engine tick now and the tick the phase must reach (replay: the clock frontier). */
export function bootPhase(phase: BootPhase, tick = 0, target = tick): void {
  view[base + BOOT_SLOT.phase] = BOOT_PHASES.indexOf(phase);
  view[base + BOOT_SLOT.tick] = tick; view[base + BOOT_SLOT.target] = target; view[base + BOOT_SLOT.at] = Date.now();
}
/** Replay progress, called once per replayed tick: two stores, the wall clock only every 64 ticks. */
export function bootTick(tick: number): void {
  view[base + BOOT_SLOT.tick] = tick;
  if ((tick & 63) === 0) view[base + BOOT_SLOT.at] = Date.now();
}

/** Decode slots (for the worker / tests): the live.json `phase` and, while booting, `boot`. */
export function readBootProgress(slots: Float64Array, offset = 0): { phase: BootPhase | null; at: number; boot?: { stage: string; tick: number; target: number } } {
  const i = slots[offset + BOOT_SLOT.phase], phase = i >= 0 ? BOOT_PHASES[i] ?? null : null, at = slots[offset + BOOT_SLOT.at];
  if (!phase || !phase.startsWith('boot:')) return { phase, at };
  return { phase, at, boot: { stage: phase.slice(5), tick: slots[offset + BOOT_SLOT.tick], target: slots[offset + BOOT_SLOT.target] } };
}
