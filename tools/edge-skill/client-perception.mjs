import {existsSync,readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
const copy=value=>structuredClone(value);
const safe=path=>{try{if(lstatSync(path).isSymbolicLink())throw Error('client cache linked file refused');}catch(e){if(e.code!=='ENOENT')throw e;}return path;};
const relative=url=>{if(typeof url!=='string'||!url.startsWith('/v1/edge/')||url.includes('..')||url.includes('://'))throw Error('unsafe boot reference');return url;};
/** Cached public world catalogue, fresh local perception. No identity/token access. */
export function openClientPerception(directory,{call,scope,onBoot=()=>{},onHere=()=>{}}){
 const path=join(resolve(directory),'.client-world-cache.json');let cache={scope,places:[],visited:[],lastPlace:null,caps:null,etag:null};
 if(existsSync(path)){const saved=JSON.parse(readFileSync(safe(path),'utf8'));if(saved.scope===scope)cache=saved;}
 const save=()=>{safe(path);safe(path+'.tmp');writeFileSync(path+'.tmp',JSON.stringify(cache)+'\n',{mode:0o600});renameSync(path+'.tmp',path);};
 async function catalogue(data){
  const stat=data.static??{},pages=stat.destinationPages??data.destinationPages??[];let places=stat.places??data.places??[];
  if(!Array.isArray(places)||!Array.isArray(pages)||pages.length>100||(pages.length&&typeof stat.completeStaticEtag!=='string'))throw Error('invalid boot catalogue');
  for(const page of pages){const r=await call(relative(page.url),{});if(r.status!==200)throw Error('complete boot destination page unavailable');if(r.data.catalogueEtag!==stat.completeStaticEtag)throw Error('boot catalogue changed while paging');places=[...places,...(r.data.places??[])];}
  const ids=new Set();for(const p of places){if(typeof p.id!=='string'||typeof p.name!=='string'||ids.has(p.id))throw Error('duplicate/invalid boot place');ids.add(p.id);}
  const fullRef=data.fullMap??stat.fullMap;let known=places;if(fullRef?.url){const r=await call(relative(fullRef.url));if(r.status!==200||!Array.isArray(r.data.places))throw Error('full public knowledge catalogue unavailable');known=r.data.places;}cache.references=[...(data.worldId??stat.worldId?[{id:data.worldId??stat.worldId,kind:'world',name:data.worldId??stat.worldId,source:'boot-world'}]:[]),...known.map(p=>({id:p.id,kind:'place',name:p.name,source:'boot-public-catalogue:'+String(fullRef?.etag??data.staticEtag??'edge1')}))];
  cache.places=copy(places);cache.etag=data.staticEtag??null;cache.rules=copy(stat.rules??{});cache.verbs=copy(stat.verbs??[]);save();onBoot(copy(cache));
 }
 async function boot(){
  const r=await call('/v1/edge/boot');
  if(r.status===200){cache.modern=r.data.apiContract==='eden-edge/1.1';if(r.data.staticEtag!==cache.etag||!cache.places.length||!cache.references)await catalogue(r.data);cache.clock=copy(r.data.clock??null);cache.sampleTick=r.data.tick??r.data.here?.tick??null;save();return r.data;}
  if(![404,501].includes(r.status))throw Error('boot unavailable: '+r.status);
  // edge1 compatibility: full map once at start/rotation; never truncates coverage.
  const old=await call('/v1/edge/map');if(old.status!==200)throw Error('legacy map unavailable');cache.modern=false;await catalogue({places:old.data.places??[],staticEtag:null});return {contract:'edge1-fallback'};
 }
 async function wake(){
  const r=await call('/v1/edge/here'+(cache.modern?'?include=doHere':''));if(r.status!==200)return {fallback:true};const frame=r.data.here??r.data,place=frame.me?.place??null;
  if(cache.modern){cache.caps=[...(frame.doHere??[]).map(c=>typeof c==='string'?{id:c,verb:c.split(':')[0],label:c}:c),...(frame.exits??[]).map(e=>({id:e.walk,verb:'walk',label:e.name}))];}
  else if(place!==cache.lastPlace||cache.caps===null){const c=await call('/v1/edge/capabilities');if(c.status===200)cache.caps=c.data.capabilities??[];}
  if(place&&place!==cache.lastPlace){if(!cache.visited.includes(place))cache.visited.push(place);onHere(copy(frame),{arrival:true,previous:cache.lastPlace});}
  else onHere(copy(frame),{arrival:false,previous:cache.lastPlace});
  cache.lastPlace=place;save();const clock=copy(cache.clock);if(clock&&Number.isFinite(clock.absoluteWorldMinutes)&&Number.isFinite(cache.sampleTick)&&Number.isFinite(frame.tick)&&clock.ticksPerWorldMinute>0)clock.absoluteWorldMinutes+=(frame.tick-cache.sampleTick)/clock.ticksPerWorldMinute;return {frame,capabilities:copy(cache.caps??[]),clock};
 }
 const destinations=()=>cache.places.filter(p=>p.walkable&&p.kind!=='sleeping-mat'&&p.kind!=='world');
 const coverage=()=>{const all=destinations(),visited=all.filter(p=>cache.visited.includes(p.id));return {visited:visited.length,total:all.length,complete:all.length>0&&visited.length===all.length,unvisited:all.filter(p=>!cache.visited.includes(p.id)).map(p=>p.id)};};
 return {
  boot,wake,snapshot:()=>copy(cache),coverage,
  arrival(place){if(typeof place==='string'&&cache.places.some(p=>p.id===place)&&!cache.visited.includes(place)){cache.visited.push(place);save();}},
  schedule(frame){const raw=frame?.clock;if(typeof raw!=='string')return [];const [hour,minute]=raw.split(':').map(Number),now=hour*60+minute;const out=[];for(const place of cache.places)for(const slot of place.schedule??[]){const match=/^(\d{1,2})\s+(\d{1,2})\s/.exec(slot.cron??'');if(!match)continue;const start=Number(match[2])*60+Number(match[1]),since=(now-start+1440)%1440,until=(start-now+1440)%1440;if(since<Number(slot.durationMinutes??60)||until<120)out.push({what:slot.label??slot.id,where:place.name,go:place.walkable?'walk:'+place.id:null,now:since<Number(slot.durationMinutes??60),startsInWorldMinutes:until});}return out.slice(0,4);},
  gazetteer(){return destinations().map(p=>`${p.id} · ${p.name} · ${(Array.isArray(p.goodFor)?p.goodFor:[p.goodFor??'']).join(', ')} · ${cache.visited.includes(p.id)?'visited✓':'visited✗'}`).join('\n');},
  unvisited(frame){const at=frame?.me?.pos,all=destinations().filter(p=>!cache.visited.includes(p.id));return all.sort((a,b)=>{const dist=p=>Array.isArray(at)&&Array.isArray(p.centre??p.center)?Math.hypot((p.centre??p.center)[0]-at[0],(p.centre??p.center)[1]-at[1]):Infinity;return dist(a)-dist(b)||a.id.localeCompare(b.id);}).slice(0,5).map(p=>`${p.id} · ${p.name}`);},
  truthful(text){const c=coverage();if(!c.complete&&/\b(all (?:zones|places|areas)(?: (?:are|have been))? (?:mapped|visited|explored)|(?:tour|exploration) (?:is )?complete|explored (?:the )?(?:whole|entire) town)\b/i.test(String(text)))return `Actual coverage: ${c.visited}/${c.total} walkable places visited; ${c.total-c.visited} remain.`;return text;},
 };
}
