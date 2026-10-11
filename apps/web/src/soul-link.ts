const publicId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export function soulFragment(id:string){
  if(!publicId.test(id))throw new Error('Invalid public Soul reference');
  return 'soul/'+encodeURIComponent(id);
}
export function soulFromFragment(hash:string):string|null{
  if(!hash.startsWith('#soul/'))return null;
  try{const id=decodeURIComponent(hash.slice(6));return publicId.test(id)?id:null;}catch{return null;}
}
/** Construct from public origin/world identity, never the current query/hash.
 * `path` is `<base>/w/<slug>` (world-path.ts's worldPath): base '' for the root build, or a launcher prefix such as
 * '/worlds'. Any world slug is accepted: eden/mars/littlemartians/toy resolve exactly as before, and a world made with
 * "New world" no longer throws (which broke Share Soul there). */
export function publicSoulLink(origin:string,path:string,id:string,base=''){
  if(!worldLinkPath(path,base))throw new Error('Invalid world path');
  const url=new URL(origin);
  if(url.username||url.password||!['https:','http:'].includes(url.protocol))throw new Error('Invalid public origin');
  return url.origin+path+'#'+soulFragment(id);
}
/** True when `path` is exactly `<base>/w/<slug>`. */
export function worldLinkPath(path:string,base=''){
  if(!/^(?:\/[a-z0-9][a-z0-9-]{0,31})*$/.test(base)||!path.startsWith(base+'/'))return false;
  return /^\/w\/[a-z][a-z0-9-]{0,31}$/.test(path.slice(base.length));
}
