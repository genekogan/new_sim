export type VisitorWorld={path:string;name:string;worldId?:string;owner?:string|null;status?:string};
/** Use only exact same-site world routes. Registry names/ownership never authorize a private read. */
export function visitorWorlds(manifest:unknown):VisitorWorld[]{
 if(!manifest||typeof manifest!=='object')return [];
 const m=manifest as {contract?:unknown;worlds?:unknown};if(m.contract!=='local-worlds/1'||!Array.isArray(m.worlds))return [];
 return m.worlds.flatMap((value:unknown)=>{
  if(!value||typeof value!=='object')return [];const r=value as Record<string,unknown>;
  if(typeof r.basePath!=='string'||!/^\/(?:worlds\/)?w\/[a-z][a-z0-9-]{0,31}$/.test(r.basePath))return [];
  if(r.configPath!==r.basePath+'/v1/config')return [];
  return [{path:r.basePath,name:typeof r.name==='string'?r.name.slice(0,100):String(r.worldKey??r.key??'World'),...(typeof r.worldId==='string'?{worldId:r.worldId}:{}),...(typeof r.owner==='string'||r.owner===null?{owner:r.owner}:{}),...(typeof r.status==='string'?{status:r.status}:{})}];
 }).slice(0,61);
}
export async function discoverVisitorWorlds(current:VisitorWorld,get:typeof fetch=fetch,ownerId?:string){
 const lists=await Promise.all(['/__sim/worlds.json','/worlds/__sim/worlds.json'].map(async path=>{
  try{const r=await get(path,{signal:AbortSignal.timeout(5000),cache:'no-store'});return r.ok&&r.headers.get('content-type')?.includes('application/json')?visitorWorlds(await r.json()):[];}catch{return [];}
 }));
 const worlds=new Map([[current.path,current]]);for(const w of lists.flat())if(!worlds.has(w.path))worlds.set(w.path,w);
 const candidates=[...worlds.values()];
 // A private read through the launcher can boot a sleeping child. Summaries must not wake worlds.
 const paused=candidates.filter(w=>w.path!==current.path&&w.status!==undefined&&w.status!=='running');
 return {worlds:candidates.filter(w=>!paused.includes(w)).slice(0,60),paused:paused.filter(w=>w.owner===ownerId).map(w=>w.name),capped:lists.some(l=>l.length>60)||worlds.size>60};
}
