/** Shared sim-time rowing phase: bodies and both pairs of oars move together in every viewer. */
export function rowingStroke(seconds:number){const phase=seconds*Math.PI*2/2.6;return {pull:Math.sin(phase),lift:Math.cos(phase)};}
