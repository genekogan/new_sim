// perception (lane AWARE, 2026-10-23) — `GET /v1/edge/around?to=<words>`: how to get to a named place, or where a named Soul
// is, said the way a person would: "int-bakery: 140 m north-east (~2 min walk), past eden-dome". Perception only: it reads
// the public map, the Soul's own knowledge (a secret place it has not found is no answer) and public body positions; it
// never moves anyone. A Soul elsewhere is placed by its building or outdoor place, never by the room it is in.
import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeSoul} from '../contract.ts';
import {tokens} from '../ledger/vocabulary.ts';
import type {MeaningPart} from '../../god/meaning.ts';
import {centroid, inPoly} from '../ledger/places.ts';
import {Perception} from './here.ts';
import {compassOf, dist2, durationWord, walkSeconds} from './geometry.ts';

type V2 = [number, number];
const WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassWord = (deg: number) => WORDS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Names a person can use as a landmark (not generated scenery ids or carried things). */
const LANDMARK_KINDS = new Set(['landmark', 'building', 'stall', 'pier', 'hill', 'water', 'park zone']);
const plainName = (name: string) => !/^(e_[0-9a-f]{6,}|trees-|land-|place-|path-|road-|grass-|bush-|rock-)/.test(name) && !name.includes('/');

type Place = {id: string; name: string; kind?: string; parent: string | null; polygon: V2[]; level?: number; carrier?: unknown; description?: string; aliases?: readonly string[]; semanticKind?:string;parts?:MeaningPart[]};

export function routeFrame(ledger: EdgeLedger, soul: EdgeSoul, query: string) {
  const P = new Perception(ledger, soul), pos = P.pos, K = ledger.knowledge, q = norm(query).slice(0, 80);
  if (!pos || !q) return {query, found: false, reason: !q ? 'Say where: around?to=<place or Soul name>.' : 'You have no body in the world right now.'};
  const level = ledger.placeLevel(P.w.entities[soul.entityId]?.human?.level as number | undefined);
  const known = ([...ledger.places.byId.values()] as unknown as Place[])
    .filter(p => p.parent !== null && !p.carrier && p.kind !== 'sleeping-mat' && !/(^|-)mat-\d+$/.test(p.id) && K.knows(soul.soulId, p.id));
  const placeAt = (p: Place) => centroid(p.polygon) as V2;
  const leg = (to: V2, inside: boolean) => {const m = inside ? 0 : Math.round(dist2(pos, to)); return {m, dir: compassWord(compassOf(to[0] - pos[0], to[1] - pos[1])), eta: '~' + durationWord(walkSeconds(m * 1.25)) + ' walk'};};
  const mine = new Set(ledger.placePathOf(soul.soulId).map(p => p.id));
  // a landmark along the way (between 15% and 85% of the line, close to it), else the nearest landmark to where you are going
  const landmark = (to: V2, skip: Set<string>) => {
    const len = dist2(pos, to); if (len < 12) return null;
    const dx = (to[0] - pos[0]) / len, dz = (to[1] - pos[1]) / len; let best: {p: Place; s: number; how: 'past' | 'near'} | null = null;
    for (const p of known) {
      if (skip.has(p.id) || mine.has(p.id) || !LANDMARK_KINDS.has(p.kind ?? '') || !plainName(p.name) || K.isSecret(p.id) || Math.abs((p.level ?? 0) - level) > 1) continue;
      const c = placeAt(p), t = (c[0] - pos[0]) * dx + (c[1] - pos[1]) * dz, off = Math.abs((c[0] - pos[0]) * dz - (c[1] - pos[1]) * dx);
      const s = t > len * 0.15 && t < len * 0.85 && off < Math.max(15, len * 0.15) ? off + (p.kind === 'landmark' ? 0 : 8) : dist2(c, to) < 45 ? 1000 + dist2(c, to) : Infinity;
      if (s < (best?.s ?? Infinity)) best = {p, s, how: s < 1000 ? 'past' : 'near'};
    }
    return best ? {how: best.how, name: best.p.name, id: best.p.id} : null;
  };
  // a Soul by name: where it is (its building or outdoor place, never the room)
  const soulHit = [...ledger.host.minds.values()].filter(m => m.soulId !== soul.soulId && norm(m.name) === q || (q.length >= 4 && m.soulId !== soul.soulId && norm(m.name).includes(q)))
    .sort((a, b) => Number(norm(b.name) === q) - Number(norm(a.name) === q))[0];
  if (soulHit) {
    const b = P.w.entities[soulHit.entityId]; if (!b) return {query, found: false, reason: `${soulHit.name} is not in the world right now.`};
    const at: V2 = [b.pose.p[0], b.pose.p[2]], where = ledger.placePathOf(soulHit.soulId).find(p => p.kind !== 'occupier' && p.kind !== 'room' && plainName(p.name) && !K.isSecret(p.id))
      ?? ledger.placePathOf(soulHit.soulId).find(p => p.kind !== 'occupier' && !K.isSecret(p.id));
    const l = leg(at, false), lm = landmark(at, new Set(where ? [where.id] : []));
    return {query, found: true, soul: {id: soulHit.soulId, name: soulHit.name}, at: where?.name ?? 'out in the open', ...l, ...(lm ? {[lm.how]: lm.name} : {}),
      say: `${soulHit.name} is at ${where?.name ?? 'an open spot'}, ${l.m} m ${l.dir} of you (${l.eta})${lm ? `, ${lm.how} ${lm.name}` : ''}.`};
  }
  // Names/aliases are authored vocabulary; shared aliases return a bounded choice rather than a silent nearest.
  const ask=tokens(query),matches=(names:string[])=>{const exact=names.some(n=>tokens(n).join(' ')===ask.join(' '));const all=names.flatMap(tokens);return exact?0:ask.length&&ask.every(w=>all.includes(w))?1:9;};
  const scored=known.map(p=>{const tier=matches([p.name,p.id,...(p.aliases??[]),...(p.semanticKind?[p.semanticKind]:[])]),at=placeAt(p);return{p,at,tier:tier+(p.name.includes('/')?0.5:0),d:inPoly(pos[0],pos[1],p.polygon)?0:dist2(pos,at)};}).filter(x=>x.tier<9).sort((a,b)=>a.tier-b.tier||a.d-b.d);
  const parts=known.flatMap(p=>(p.parts??[]).map(part=>({p,part,tier:matches([part.title,...(part.aliases??[])])<9?matches([part.title,...(part.aliases??[])]):matches([part.title,...(part.aliases??[]),p.name,...(p.aliases??[])])+0.5}))).filter(x=>x.tier<9).sort((a,b)=>a.tier-b.tier);
  if(parts.length&&(!scored.length||parts[0].tier<scored[0].tier)){
    const tied=parts.filter(x=>x.tier===parts[0].tier);
    if(tied.length>1)return{query,found:false,code:'place.ambiguous',reason:'Several named parts match; choose one by its owner and name.',candidates:tied.slice(0,5).map(({p,part})=>({name:part.title,in:p.name,walk:part.walk}))};
    const {p,part}=parts[0],target=part.target,at=target?.point?[target.point[0],target.point[2]] as V2:target?.entity?ledger.thingAt?.(target.entity):null;
    if(!part.walk||!at)return{query,found:true,part:{id:part.id,name:part.title,in:p.name},what:part.what,navigable:false,reason:'This is a descriptive part without an actionable spatial binding.'};
    const l=leg(at,false),cap=ledger.capabilities(soul).find(c=>c.id===part.walk);
    return{query,found:true,part:{id:part.id,name:part.title,in:p.name},what:part.what,...l,walk:part.walk,...(part.sit?{sit:part.sit}:{}),...(cap?.available?{reachable:true}:{reachable:false,why:cap?.blocked?.code??'part.not-offered',via:`walk:${p.id}`}),say:`${part.title} in ${p.name}: ${l.m} m ${l.dir}. ${part.what??''}`.trim()};
  }
  const tied=scored.filter(x=>x.tier===scored[0]?.tier);
  if(tied.length>1)return{query,found:false,code:'place.ambiguous',reason:'Several places match; choose one by its exact id.',candidates:tied.slice(0,5).map(({p,at})=>({id:p.id,name:p.name,...leg(at,false)}))};
  if (!scored.length) return {query, found: false, reason: `No place or Soul you know is called "${query}". Try a word from its name; explore shows what is close by.`};
  const walks = new Map(ledger.capabilities(soul).filter(c => c.verb === 'walk' && c.target?.kind === 'place').map(c => [c.target!.id, c.id]));
  const {p, at, d} = scored[0]!, inside = mine.has(p.id), l = leg(at, inside || d === 0), lm = landmark(at, new Set([p.id]));
  const walk = walks.get(p.id) ?? `walk:${p.id}`, problem = inside ? null : ledger.routeProblem(soul, walk);
  const also = scored.slice(1).filter(x => x.tier <= scored[0]!.tier + 0.5).slice(0, 3).map(x => {const o = leg(x.at, x.d === 0); return `${x.p.name} · ${o.m} m ${o.dir}`;});
  return {query, found: true, place: {id: p.id, name: p.name}, ...l, ...(lm ? {[lm.how]: lm.name} : {}), ...(inside ? {here: true} : {walk, ...(problem ? {reachable: false, why: problem.code} : {})}),
    say: inside ? `You are at ${p.name} now.` : `${p.name}: ${l.m} m ${l.dir} (${l.eta})${lm ? `, ${lm.how} ${lm.name}` : ''}. To go: act ${walk}.`, ...(also.length ? {also} : {})};
}
