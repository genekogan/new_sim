/** Legacy backdrop URL (pinned in the server's scene) -> the same campus, content-addressed and immutable at
 * /blobs/assets/<sha[0:2]>/<sha>.glb on sim.eden.art. Lane W3 (2026-10-19): shared parts + placements, sub-pixel detail
 * dropped, AVIF (tools/blobs/campus-parts.mjs on the BLOBS copy 64b8838c…: 41.8 -> 7.5 MB, br 18.5 -> 3.6 MB), then two
 * tiers: this base tier (--tier base --coarse 64: 4.6 MB, br 1.41 MB) is all the arrival waits for; the fittings and
 * furniture in it are as seen from 64 m or farther until BACKDROP_DETAIL replaces them. (Single-file 0d473682… retired.) */
export const BACKDROP_BLOBS:Readonly<Record<string,string>>=Object.freeze({
  '/browser/campus.glb?v=20260922b':'/blobs/assets/ab/abad8cfc1353cc29f93273e31245f0d96bc75b43074850e6329c529f0433eace.glb',
});
/** The same campus's detail tier (campus-parts.mjs --tier detail): its "Fittings and furniture" exact, loaded after
 * arrival in place of the base tier's coarse ones (WorldBackdropTiers.ts). Only follows the base blob above. */
export const BACKDROP_DETAIL:Readonly<Record<string,string>>=Object.freeze({
  '/browser/campus.glb?v=20260922b':'/blobs/assets/26/26fa3fc8797f10a3588f8c08a0c097e5f4ba3deb12a8712bb64186dfef0b1bda.glb',
});
/** The scene the Mars world serves always names this backdrop (packages/engine-mars mars-2026-map.ts). */
export const MARS_CAMPUS_URL='/browser/campus.glb?v=20260922b';

// W3: on /w/mars the campus was requested only after config, the scene and the world build had started (2.7 s of a
// 4.5 s cold card). Its URL is known at boot, so the page starts the download as soon as main.ts runs (after the CDN
// mapping and the byte meter are installed) and the backdrop parses those bytes when the scene asks for them.
const early=new Map<string,Promise<ArrayBuffer>>();
export function prefetchBackdrop(url:string,fetcher:typeof fetch=fetch){
  if(early.has(url))return;
  const p=fetcher(url).then(r=>{if(!r.ok)throw Error(`backdrop ${r.status}`);return r.arrayBuffer();});
  p.catch(()=>{});early.set(url,p);
}
/** The prefetched bytes for url, once (null when none was started). */
export function takeBackdrop(url:string):Promise<ArrayBuffer>|null{const p=early.get(url)??null;early.delete(url);return p;}
