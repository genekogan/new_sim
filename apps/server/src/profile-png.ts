import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const MAX_BYTES=262144,MAX_DIMENSION=512,SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(data:Uint8Array){let n=0xffffffff;for(const b of data)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function reject():never{throw new Error('profile-photo.invalid: use a complete noninterlaced 8-bit RGB/RGBA PNG of at most 512px and 256KiB');}
/** Accept the existing canvas portrait format. No remote fetch, SVG/script, metadata retention or unbounded inflate. */
export function validateProfilePNG(dataUrl:unknown){
 if(typeof dataUrl!=='string'||dataUrl.length>Math.ceil(MAX_BYTES/3)*4+30||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl))reject();
 const base64=dataUrl.slice('data:image/png;base64,'.length),bytes=Buffer.from(base64,'base64');if(bytes.length>MAX_BYTES||bytes.toString('base64')!==base64||!bytes.subarray(0,8).equals(SIGNATURE))reject();
 let offset=8,width=0,height=0,channels=0,ended=false,idat=false,idatEnded=false;const kept:Buffer[]=[],compressed:Buffer[]=[];
 while(offset<bytes.length){if(offset+12>bytes.length)reject();const length=bytes.readUInt32BE(offset),end=offset+12+length;if(end>bytes.length)reject();const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);if(!/^[A-Za-z]{4}$/.test(type)||crc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))reject();
  if(!width&&type!=='IHDR')reject();
  if(type==='IHDR'){if(width||length!==13)reject();width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===6?4:data[9]===2?3:0;if(width<1||height<1||width>MAX_DIMENSION||height>MAX_DIMENSION||data[8]!==8||!channels||data[10]||data[11]||data[12])reject();kept.push(bytes.subarray(offset,end));}
  else if(type==='IDAT'){if(idatEnded)reject();idat=true;compressed.push(data);kept.push(bytes.subarray(offset,end));}
  else if(type==='IEND'){if(length||!idat||end!==bytes.length)reject();ended=true;kept.push(bytes.subarray(offset,end));}
  else if(type==='tRNS'||type[0]===type[0].toUpperCase())reject(); // Unknown critical chunks and alternate transparency are not silently changed.
  if(idat&&type!=='IDAT')idatEnded=true;
  offset=end;
 }
 if(!ended)reject();const rowBytes=width*channels+1;let pixels:Buffer;try{pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:rowBytes*height});}catch{reject();}if(pixels!.length!==rowBytes*height)reject();for(let row=0;row<height;row++)if(pixels![row*rowBytes]>4)reject();
 const image=Buffer.concat([SIGNATURE,...kept]),hash=createHash('sha256').update(image).digest('hex');return {image,photo:{hash,mime:'image/png' as const,width,height,bytes:image.length}};
}
