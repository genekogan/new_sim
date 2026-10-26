import type { LoadingManager } from 'three';

/** Counts actual loader requests, not elapsed time or an invented percentage. */
export type AssetDownloadProgress={loaded:number;total:number;failed:number;pending:number};
export class AssetDownloads{
 private items=new Map<string,'loading'|'loaded'|'failed'>();
 private changed?:()=>void;
 constructor(changed?:()=>void){this.changed=changed;}
 start(id:string){this.items.set(id,'loading');this.changed?.();}
 finish(id:string,failed=false){if(failed||this.items.get(id)!=='failed')this.items.set(id,failed?'failed':'loaded');this.changed?.();}
 snapshot():AssetDownloadProgress{let loaded=0,failed=0,pending=0;for(const phase of this.items.values()){if(phase==='loaded')loaded++;else if(phase==='failed')failed++;else pending++;}return{loaded,total:this.items.size,failed,pending};}
}

/** Parsed GLTFs retain their LoadingManager. Detach this view's progress callbacks when it leaves, while keeping
 *  the manager and parser usable by cached assets and any requests that are still finishing. */
export function trackAssetDownloads(manager: LoadingManager, downloads: AssetDownloads): () => void {
 const previous = { onStart: manager.onStart, onProgress: manager.onProgress, onError: manager.onError, itemStart: manager.itemStart };
 const onStart = (url: string) => downloads.start(url);
 const onProgress = (url: string) => downloads.finish(url);
 const onError = (url: string) => downloads.finish(url, true);
 const itemStart = (url: string) => { downloads.start(url); previous.itemStart.call(manager, url); };
 manager.onStart = onStart; manager.onProgress = onProgress; manager.onError = onError; manager.itemStart = itemStart;
 return () => {
  if (manager.onStart === onStart) manager.onStart = previous.onStart;
  if (manager.onProgress === onProgress) manager.onProgress = previous.onProgress;
  if (manager.onError === onError) manager.onError = previous.onError;
  if (manager.itemStart === itemStart) manager.itemStart = previous.itemStart;
 };
}
