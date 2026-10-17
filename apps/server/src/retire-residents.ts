// Release 3.1.1 (Gene 2026-10-17, relayed verbatim by the coordinator): "delete the ~30 pre-sign-in residents with no signed-in
// owner". One-shot operator maintenance with the same shape as legacy-looks.env (edge/body/migrate-looks.ts): a world run by
// the launcher reads <DATA_DIR>/retire-residents.env (one line, RETIRE_RESIDENTS_MODE=plan|apply) at boot.
//   plan  : lists every live Soul whose owner is not a signed-in account (acct_<uuid> from the account registry); no writes.
//   apply : retires each of them through Souls.operatorRetire (the same journaled retire an owner's DELETE does).
// Souls owned by signed-in accounts are always kept; verification probes are left to their own cleanup.
// Each run prints `[retire-residents] <json>`, writes <DATA_DIR>/retire-residents-<mode>-<time>.json (ids, names, owner kinds),
// and renames the maintenance file to `.done-<mode>-<time>` unless an apply deferred someone (the next boot retries them).
import type { Db, SoulRow } from './db.ts';
import type { Souls } from './souls.ts';
import { isVerificationProbe } from './verification-probe.ts';

export const SIGNED_IN_OWNER = /^acct_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type OwnerKind = 'account' | 'dev' | 'privy' | 'system' | 'other';
export const ownerKind = (owner: string): OwnerKind => SIGNED_IN_OWNER.test(owner) ? 'account'
  : owner.startsWith('dev:') ? 'dev' : owner.startsWith('did:privy:') ? 'privy' : owner === 'system' ? 'system' : 'other';
export type ResidentRow = { soulId: string; name: string; owner: string; ownerKind: OwnerKind; entityId: string; native: boolean };
export type RetireResult = { planned: ResidentRow[]; kept: { soulId: string; name: string }[]; retired: string[]; deferred: { soulId: string; reason: string }[] };

const row = (s: SoulRow): ResidentRow => ({ soulId: s.id, name: s.name, owner: s.owner, ownerKind: ownerKind(s.owner), entityId: s.entity_id, native: !!s.native });

/** No writes. */
export function planRetireResidents(db: Db, worldId: string): Pick<RetireResult, 'planned' | 'kept'> {
  const planned: ResidentRow[] = [], kept: RetireResult['kept'] = [];
  for (const s of db.liveSouls(worldId)) {
    if (isVerificationProbe(s.id)) continue;
    if (ownerKind(s.owner) === 'account') { kept.push({ soulId: s.id, name: s.name }); continue; }
    planned.push(row(s));
  }
  return { planned, kept };
}

export async function retireResidents(souls: Pick<Souls, 'operatorRetire'>, db: Db, worldId: string, { dryRun = true } = {}): Promise<RetireResult> {
  const { planned, kept } = planRetireResidents(db, worldId);
  const result: RetireResult = { planned, kept, retired: [], deferred: [] };
  if (dryRun) return result;
  for (const p of planned) {
    try { await souls.operatorRetire(p.soulId); result.retired.push(p.soulId); }
    catch (e) { result.deferred.push({ soulId: p.soulId, reason: (e as { code?: string }).code ?? (e as Error).message }); }
  }
  return result;
}

export const RETIRE_RESIDENTS_FILE = 'retire-residents.env';
/** The mode from the process environment (wins) or the one-shot file; only a RETIRE_RESIDENTS_MODE line is allowed. */
export function retireResidentsMode(dataDir: string | undefined, env: Record<string, string | undefined>, read: (f: string) => string | null): { mode: string | null; file: string | null } {
  if (env.RETIRE_RESIDENTS_MODE) return { mode: env.RETIRE_RESIDENTS_MODE, file: null };
  if (!dataDir) return { mode: null, file: null };
  const file = dataDir.replace(/\/$/, '') + '/' + RETIRE_RESIDENTS_FILE, text = read(file);
  if (text === null) return { mode: null, file: null };
  let mode: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const m = line.match(/^RETIRE_RESIDENTS_MODE=([a-z]+)$/);
    if (!m) throw Error('retire-residents.env: only a RETIRE_RESIDENTS_MODE=plan|apply line is allowed');
    mode = m[1];
  }
  return { mode, file };
}

/** Boot hook shared by main.ts and the old-world servers (tools/core/edge-server.mjs, multiworld/world-server.mjs). */
export async function retireResidentsBootHook(souls: Pick<Souls, 'operatorRetire'>, db: Db, worldId: string, dataDir: string | undefined, env: Record<string, string | undefined>, log: (line: string) => void = console.log) {
  const fs = await import('node:fs');
  const { mode, file } = retireResidentsMode(dataDir, env, (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } });
  if (!mode) return null;
  if (mode !== 'plan' && mode !== 'apply') throw Error('retire-residents mode: plan or apply');
  const result = await retireResidents(souls, db, worldId, { dryRun: mode === 'plan' });
  log('[retire-residents] ' + JSON.stringify({ mode, planned: result.planned.length, kept: result.kept.length, retired: result.retired.length, deferred: result.deferred }));
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  if (dataDir) { try { fs.writeFileSync(dataDir.replace(/\/$/, '') + `/retire-residents-${mode}-${at}.json`, JSON.stringify({ mode, worldId, result }, null, 1)); } catch (e) { log('[retire-residents] result file not written: ' + (e as Error).message); } }
  if (file && !(mode === 'apply' && result.deferred.length > 0)) fs.renameSync(file, file + `.done-${mode}-${at}`);
  return result;
}
