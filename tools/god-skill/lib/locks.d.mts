export type Holder = { pid: number; host: string; start: string; label?: string };
export const CHROME_LOCK: string;
export const LOCK_TTL_MS: number;
export function processStart(pid?: number): string | null;
export function holder(label?: string): Holder;
export function parseHolder(raw: unknown): Holder | undefined;
export function liveness(h?: Holder): 'unknown' | 'alive' | 'dead' | 'recycled';
export function lockStatus(h: Holder | undefined, heartbeatAt: number, ttlMs?: number, now?: number): { holder: Holder | null; heartbeatAt: number; ttlMs: number; liveness: string; stale: boolean; reason: string };
export function acquireLock(path:string,options?:{label?:string;ttlMs?:number;detail?:boolean;reentrant?:boolean}):()=>void;
