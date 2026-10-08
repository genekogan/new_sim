/** Public per-Soul live record reader (G4). Proposed route: INBOX-core G430. All text untrusted. */
export const PUBLIC_SOUL_PATH=(id:string)=>`/v1/edge/public/souls/${encodeURIComponent(id)}`;
type Receipt={id:string;capability?:string;label?:string;phase:string;code?:string|null};
type Event={id:string;kind:string;tick?:number;text?:string;placeId?:string;soul?:{name?:string};from?:{name?:string}};
export type PublicRecord={fade:{colour:string;idleSeconds?:number}|null;lastAcceptedAt?:number|string|null;self?:{state?:string;activity?:string;placePath?:{name?:string}[]};receipts:Receipt[];events:Event[]};
const str=(v:unknown,max=300)=>typeof v==='string'?v.slice(0,max):undefined;
/** Tolerant, bounded reader: unknown fields ignored, strings clipped, lists capped. */
export function readPublicRecord(data:unknown):PublicRecord|null{
 if(!data||typeof data!=='object')return null;const d=data as Record<string,any>;
 if(typeof d.contract!=='string'||!d.contract.startsWith('eden-edge/'))return null;
 const fade=d.fade&&typeof d.fade==='object'&&typeof d.fade.colour==='string'?{colour:d.fade.colour.slice(0,20),...(Number.isFinite(d.fade.idleSeconds)?{idleSeconds:d.fade.idleSeconds}:{})}:null;
 const receipts=(Array.isArray(d.receipts)?d.receipts:[]).slice(0,10).filter((r:any)=>r&&typeof r.phase==='string').map((r:any)=>({id:str(r.id,100)??'',capability:str(r.capability,100),label:str(r.label,120),phase:str(r.phase,20)!,code:str(r.code,100)??null}));
 const events=(Array.isArray(d.events)?d.events:[]).slice(-30).filter((e:any)=>e&&typeof e.kind==='string').map((e:any)=>({id:str(e.id,100)??'',kind:str(e.kind,40)!,tick:Number.isFinite(e.tick)?e.tick:undefined,text:str(e.text,500),placeId:str(e.placeId,100),soul:e.soul?{name:str(e.soul.name,80)}:undefined,from:e.from?{name:str(e.from.name,80)}:undefined}));
 const self=d.self&&typeof d.self==='object'?{state:str(d.self.state,40),activity:str(d.self.activity,60),placePath:Array.isArray(d.self.placePath)?d.self.placePath.slice(0,6).map((p:any)=>({name:str(p?.name,80)})):undefined}:undefined;
 return {fade,lastAcceptedAt:typeof d.lastAcceptedAt==='number'||typeof d.lastAcceptedAt==='string'?d.lastAcceptedAt:null,self,receipts,events};
}
