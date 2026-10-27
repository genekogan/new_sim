/** Opt-in bounded diagnostic timings. Never includes world names, refs, query text or payloads. */
let emitted = 0;
export function contextStage<T>(stage: string, work: () => T): T {
    if (process.env.SIM_CONTEXT_TIMINGS !== '1' || emitted >= 200) return work();
    const start = performance.now();
    try { return work(); }
    finally {
        emitted++;
        process.stderr.write(JSON.stringify({ contextTiming: { stage, ms: performance.now() - start } }) + '\n');
    }
}

export function contextTiming(stage: string, ms: number) {
    if (process.env.SIM_CONTEXT_TIMINGS !== '1' || emitted >= 200) return;
    emitted++;
    process.stderr.write(JSON.stringify({ contextTiming: { stage, ms } }) + '\n');
}
