// Stage B (lane B-facade, rotation 3): the GodMode bridge's read side in a read worker. Main's bridge registers the god
// layer's reads on its ledger (god walks and on-demand walks, seats/beds/items/surfaces on god-built things, layers and
// calendar items, the constitution, god notices); the worker's ledger gets the same reads from an EngineBridge built in
// read mode (BridgeOptions.read) over
//   - a GodReplica (split/god-replica.ts): the god model from the worker's read-only database, current to main's last
//     commit (synced before each read: one point query when nothing moved);
//   - the worker's MenuWorld as its engine (every engine read the bridge's read side makes is a MenuWorld read);
//   - what main's bridge derived for the engine and the worker cannot (its physics facts: seat/bed/item/surface assets
//     and its levels; the god places it installed): shipped with the delta (ledgerEnv.physics, static.walkable).
// Created when main's delta first says main has a bridge (`physics` in the ledger env).
import {EngineBridge, type BridgePhysicsV1} from '../god/engine-bridge.ts';
import {GodReplica} from './god-replica.ts';
import {installGroundCapabilities, type GroundEnvV1} from '../god/ground-host.ts';
import type {ReadOnlyHost} from './read-host.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {WorldHost} from '../world.ts';

type Held = {bridge: EngineBridge; god: GodReplica; physics: unknown; walkable: unknown};
const HELD = new WeakMap<EdgeLedger, Held>();

/** Create (once main has a bridge) and refresh the read bridge of a worker's ledger; null when main has none. Call
 *  before each read: adopts what the last deltas shipped, then brings the god model to main's last commit. */
export function readBridgeSync(host: ReadOnlyHost, L: EdgeLedger): EngineBridge | null {
  const E = host.rw.ledgerEnv as {physics?: unknown; ground?: unknown}, S = host.rw.R.static as {walkable?: string[]} | undefined;
  let h = HELD.get(L);
  if (!h) {
    if (!('physics' in E)) return null;
    const god = new GodReplica(host.db, host.worldId, () => host.rw.R.pos.tick);
    // the bridge's engine is the worker's MenuWorld; everything else is the read-only host
    const bhost = new Proxy(host, {get: (t, k) => k === 'engine' ? host.rw.mw : Reflect.get(t, k, t)}) as unknown as WorldHost;
    // main installs the ground's swim and flag offers before its bridge (main.ts): the same order here
    if ('ground' in E) installGroundCapabilities(L as never, god as never, bhost, () => (host.rw.ledgerEnv as {ground?: GroundEnvV1}).ground);
    const bridge = new EngineBridge({host: bhost, god: god as never, edge: L, read: true, log: (m) => console.log(`[read-bridge] ${m}`)});
    h = {bridge, god, physics: undefined, walkable: undefined}; HELD.set(L, h);
  }
  if (E.physics !== h.physics || S?.walkable !== h.walkable) {
    h.bridge.readAdopt({...(E.physics !== h.physics ? {physics: (E.physics ?? null) as BridgePhysicsV1 | null} : {}), ...(S?.walkable !== h.walkable && S?.walkable ? {walkable: S.walkable} : {})});
    h.physics = E.physics; h.walkable = S?.walkable;
  }
  h.bridge.readSync();
  return h.bridge;
}
export const readBridgeCost = (L: EdgeLedger) => HELD.get(L)?.god.cost ?? null;
