const publicId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export function soulFragment(id:string){
  if(!publicId.test(id))throw new Error('Invalid public Soul reference');
  return 'soul/'+encodeURIComponent(id);
}
export function soulFromFragment(hash:string):string|null{
  if(!hash.startsWith('#soul/'))return null;
  try{const id=decodeURIComponent(hash.slice(6));return publicId.test(id)?id:null;}catch{return null;}
}
/** Construct from public origin/world identity, never the current query/hash. */
export function publicSoulLink(origin:string,path:string,id:string){
  if(!/^\/w\/(eden|mars|littlemartians|toy)$/.test(path))throw new Error('Invalid world path');
  const url=new URL(origin);
  if(url.username||url.password||!['https:','http:'].includes(url.protocol))throw new Error('Invalid public origin');
  return url.origin+path+'#'+soulFragment(id);
}
