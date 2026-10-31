// garden-pool-v2 (eden-walk-three fixtureVersion 2). One membership rule shared
// by the live independent-errand trigger and the read-only oracle, so both
// decide "in which sealed garden is this body" identically. Scenarios without
// gardenRule keep their frozen single-region behaviour untouched.
export const GARDEN_POOL_RULE='garden-pool-v2';
const finite=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
export const gardenPoolOf=scenario=>scenario?.gardenRule===GARDEN_POOL_RULE?scenario.gardenCandidates:null;

/** nearest-pool-centre/1: the pool garden whose centre is nearest to the [x,z]
 * point, if within its radius; an exact distance tie goes to the earlier pool
 * entry. A point is therefore in at most one pool garden. */
export function poolGardenAt(p,pool){
 if(!finite(p)||!Array.isArray(pool))return null;
 let best=null,distance=Infinity;
 for(const g of pool){const d=Math.hypot(p[0]-g.region.pos[0],p[1]-g.region.pos[1]);if(d<distance){best=g;distance=d;}}
 return best&&distance<=best.region.radiusM?best:null;
}

/** Oracle region form: the declared circle plus pool exclusivity. */
export const poolGardenRegion=(garden,pool)=>({pos:garden.region.pos,radiusM:garden.region.radiusM,pool,poolRef:garden.ref});

/** Structural check of a sealed pool: bounded, unique refs, finite circles,
 * and the v1 default garden is a pool member. */
export function validGardenPool(scenario){
 const pool=gardenPoolOf(scenario);
 if(!pool)return scenario?.gardenRule===undefined;
 return Array.isArray(pool)&&pool.length>0&&pool.length<=8&&new Set(pool.map(g=>g?.ref)).size===pool.length
  &&pool.every(g=>typeof g?.ref==='string'&&/^[-A-Za-z0-9_]{1,120}$/.test(g.ref)&&finite(g.region?.pos)&&Number.isFinite(g.region.radiusM)&&g.region.radiusM>0)
  &&pool.some(g=>g.ref===scenario.venue?.gardenRef);
}
