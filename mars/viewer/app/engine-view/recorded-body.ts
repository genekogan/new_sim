/** Additive BODY-v1 reader: recorded discrete state wins, including explicit legacy resets. */
export type RenderBody={family:'humanoid'|'floater';type?:'humanoid'|'ceramic'|'floater';model?:string;modelUrl?:string;radius?:number;hoverHeight?:number};
export function recordedBody(fallback:unknown,state:Readonly<Record<string,unknown>>):RenderBody|null{
 const value=Object.hasOwn(state,'body')?state.body:fallback;
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const b=value as Record<string,unknown>;
 if(b.family!=='humanoid'&&b.family!=='floater')return null;return b as RenderBody;
}
/** Only public hash-addressed, same-origin admission URLs become model requests. */
export function admittedBodyUrl(value:unknown,worldPath=''):string|null{
 if(typeof value!=='string')return null;
 if(/^\/v1\/edge\/body\/assets\/body_[a-f0-9]{64}\.glb$/.test(value))return worldPath+value;
 if(/^\/w\/(?:eden|mars|littlemartians|toy)\/v1\/edge\/body\/assets\/body_[a-f0-9]{64}\.glb$/.test(value))return value;
 return null;
}
