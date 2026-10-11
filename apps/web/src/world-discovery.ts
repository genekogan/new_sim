export const SHARED_WORLD_KEYS=['eden','mars','littlemartians'] as const;
export type SharedWorldKey=typeof SHARED_WORLD_KEYS[number];
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export class WorldBootstrapError extends Error {readonly unavailable=true;}
/** A served HTML fallback is not an API, and one world's config cannot grant
 * entry/control under another namespace. No identity is inferred from the URL. */
/** `expectedPath`: this build's world path. Old worlds (root build) leave it at `/w/<key>`, main's rule exactly; a
 * prefixed launcher build passes its own `<BASE>/w/<key>` (world-path.ts worldPath). */
export async function readWorldBootstrap(response:Response,key:string,expectedPath=`/w/${key}`){
 if(!response.ok){if(response.status===404)throw new WorldBootstrapError('This world is not connected to this site.');throw Error(`the server answered ${response.status}`);}
 if(!response.headers.get('content-type')?.includes('application/json'))throw new WorldBootstrapError('This world has no runtime connected to this site.');
 const cfg:unknown=await response.json();
 if(!object(cfg)||cfg.worldKey!==key||typeof cfg.worldId!=='string'||!cfg.worldId||cfg.worldPath!==expectedPath)throw new WorldBootstrapError('The runtime does not match the selected world.');
 return cfg;
}
/** Prefer the actual dispatcher manifest; older hosts are checked individually.
 * Failed/HTML/mismatched endpoints are never advertised as served worlds. */
export async function discoverWorlds(get:(path:string)=>Promise<Response>):Promise<Set<string>>{
 try{const response=await get('/__sim/worlds.json');if(response.ok&&response.headers.get('content-type')?.includes('application/json')){
  const body:unknown=await response.json();if(object(body)&&body.contract==='local-worlds/1'&&Array.isArray(body.worlds))return new Set(body.worlds.filter((row:unknown)=>object(row)&&SHARED_WORLD_KEYS.includes(row.key as SharedWorldKey)&&row.worldKey===row.key&&row.basePath===`/w/${row.key}`&&row.configPath===`/w/${row.key}/v1/config`).map((row:Record<string,unknown>)=>row.key as string));
 }}catch{/* Probe the old explicit public bootstrap below. */}
 const results=await Promise.all(SHARED_WORLD_KEYS.map(async key=>{try{await readWorldBootstrap(await get(`/w/${key}/v1/config`),key);return key;}catch{return null;}}));
 return new Set(results.filter((key):key is SharedWorldKey=>key!==null));
}
