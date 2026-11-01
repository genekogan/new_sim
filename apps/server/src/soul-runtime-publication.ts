// Opt-in managed controller artifacts share the configured Soul publication
// directory. Never serve arbitrary siblings, state, credentials or source paths.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Hono} from 'hono';
export function mountSoulRuntimePublication(app:Hono,controllerFile:()=>string|undefined){
 for(const file of ['run.mjs','launch.mjs','manifest.json'])app.get('/soul-runtime/'+file,c=>{
  const controller=controllerFile();
  if(!controller)return c.json({error:{code:'not-found',message:'Managed Soul runtime is not published on this world.'}},404);
  try{
   const bytes=readFileSync(join(dirname(controller),'runtime',file));
   return new Response(bytes,{status:200,headers:{'content-type':file.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'public, max-age=60'}});
  }catch{return c.json({error:{code:'not-found',message:'Managed Soul runtime artifact unavailable.'}},404);}
 });
}
