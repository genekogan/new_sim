/** DLG3: the world's own clock for the bottom bar ("Sat · 6:12 am"), instead of a recorded tick number.
 * Each streamed chunk records the world datetime at its last tick (`finalState.env.datetime`); the shown tick
 * is placed against it at the rate the stream itself shows (Eden: one world day per real hour), so history
 * and the live replay delay read correctly without the scene's clock config. Presentation only. */
type Loose={fromTick?:unknown;take?:{startTick?:unknown;ticks?:unknown;finalState?:{env?:{datetime?:unknown}}}};
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

/** World datetime (ISO) at `tick`, from the live chunk stream; null when the stream has no clock. */
export function worldClockAt(chunks:readonly unknown[]|null|undefined,tick:number|null|undefined):string|null{
 if(!chunks?.length||!num(tick))return null;
 const marks:{tick:number;ms:number}[]=[];
 for(const c of chunks as readonly Loose[]){const t=c?.take,iso=t?.finalState?.env?.datetime;
  if(!t||typeof iso!=='string'||!num(t.startTick)||!num(t.ticks))continue;
  const ms=Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso)?iso:iso+'Z');if(Number.isFinite(ms))marks.push({tick:t.startTick+t.ticks,ms});}
 if(!marks.length)return null;
 marks.sort((a,b)=>a.tick-b.tick);
 const first=marks[0],last=marks.at(-1)!,near=marks.reduce((a,b)=>Math.abs(b.tick-tick)<Math.abs(a.tick-tick)?b:a);
 const msPerTick=last.tick>first.tick?(last.ms-first.ms)/(last.tick-first.tick):0;
 const ms=near.ms+(Number.isFinite(msPerTick)&&msPerTick>=0?(tick-near.tick)*msPerTick:0);
 return Number.isFinite(ms)?new Date(ms).toISOString():null;
}

const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
/** "Sat · 6:12 am" (the world clock has no time zone: read as written). */
export function worldTimeText(iso:string|null|undefined):string{
 if(!iso)return '';const d=new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso)?iso:iso+'Z');if(Number.isNaN(d.getTime()))return '';
 const h=d.getUTCHours(),m=d.getUTCMinutes();
 return `${DAYS[d.getUTCDay()]} · ${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'am':'pm'}`;
}
