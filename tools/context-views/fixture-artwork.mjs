// The same deterministic original asset used by the frozen five-case baseline.
import { deflateSync } from 'node:zlib';
export function artwork(version){
 const W=128,H=96,raw=Buffer.alloc(H*(1+W*3));for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*(1+W*3)+1+x*3;const square=x>22&&x<62&&y>20&&y<65,circle=(x-93)**2+(y-49)**2<20**2;raw.set(square?[220,40,40]:circle?[25,100,240]:version?[255,220,40]:[240,240,220],i);}
 const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const b=Buffer.concat([Buffer.from(name),data]),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(b));return Buffer.concat([n,b,c]);};
 const hdr=Buffer.alloc(13);hdr.writeUInt32BE(W);hdr.writeUInt32BE(H,4);hdr[8]=8;hdr[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
