/** Counts actual loader requests, not elapsed time or an invented percentage. */
export type AssetDownloadProgress={loaded:number;total:number;failed:number;pending:number};
export class AssetDownloads{
 private items=new Map<string,'loading'|'loaded'|'failed'>();
 constructor(private changed?:()=>void){}
 start(id:string){this.items.set(id,'loading');this.changed?.();}
 finish(id:string,failed=false){if(failed||this.items.get(id)!=='failed')this.items.set(id,failed?'failed':'loaded');this.changed?.();}
 snapshot():AssetDownloadProgress{let loaded=0,failed=0,pending=0;for(const phase of this.items.values()){if(phase==='loaded')loaded++;else if(phase==='failed')failed++;else pending++;}return{loaded,total:this.items.size,failed,pending};}
}
