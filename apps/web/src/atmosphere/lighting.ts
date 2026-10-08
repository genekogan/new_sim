import * as THREE from 'three';
/** Multiplies a value owned by someone else (Daylight writes light intensities
 * and the background only when its clock changes). We remember the base the
 * owner last wrote: if the live value differs from what we last wrote, the
 * owner has written a new base. Restore puts the base back. No allocation. */
export class ScaledNumber{
 private base=0;private written=NaN;private bound=false;
 private readonly get:()=>number;private readonly set:(v:number)=>void;
 constructor(get:()=>number,set:(v:number)=>void){this.get=get;this.set=set;}
 apply(k:number){const v=this.get();if(!this.bound||v!==this.written){this.base=v;this.bound=true;}this.written=this.base*k;this.set(this.written);}
 restore(){if(this.bound&&this.get()===this.written)this.set(this.base);this.bound=false;this.written=NaN;}
 get value(){return this.bound?this.base:this.get();}
}
export class TintedColor{
 readonly base=new THREE.Color();private readonly written=new THREE.Color();private bound=false;
 private readonly target:()=>THREE.Color|null;
 constructor(target:()=>THREE.Color|null){this.target=target;}
 /** Returns the owner's base colour (updated if the owner wrote a new one). */
 sample():THREE.Color|null{const c=this.target();if(!c)return null;if(!this.bound||!c.equals(this.written)){this.base.copy(c);this.bound=true;}return this.base;}
 write(c:THREE.Color){const t=this.target();if(!t)return;t.copy(c);this.written.copy(c);}
 restore(){const t=this.target();if(t&&this.bound&&t.equals(this.written))t.copy(this.base);this.bound=false;}
}
const luma=(c:THREE.Color)=>c.r*.2126+c.g*.7152+c.b*.0722;
/** Overcast grey of the same brightness as a sky colour. */
export function overcast(sky:THREE.Color,out:THREE.Color){const l=luma(sky)*.92;return out.setRGB(l*.97,l*1.0,l*1.04);}
