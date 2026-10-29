// Full native observations stay private and durable. Model/checkpoint delivery
// uses a small exact value or an explicit reference, never a truncated object.
import {createHash} from 'node:crypto';
export const MAX_RESPONSE_BYTES=4*1024*1024+8192;
export const RESPONSE_DELIVERY_BYTES=24*1024;
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
export function encodeResponse(value){
 const raw=JSON.stringify(value);
 if(raw===undefined||Buffer.byteLength(raw)>MAX_RESPONSE_BYTES)throw Error('Response exceeds 4MiB plus 8KiB reconciliation envelope');
 return raw;
}
export function responseReference(kind,id,raw){return {kind,id,bytes:Buffer.byteLength(raw),sha256:createHash('sha256').update(raw).digest('hex')};}
export function responseProjection(value,reference,{bytesLimit=8192}={}){
 if(!Number.isSafeInteger(bytesLimit)||bytesLimit<0||bytesLimit>65536)throw Error('Invalid response projection byte budget');
 if(bytes(value)<=bytesLimit)return value;
 if(!reference)throw Error('Large response needs a durable local reference');
 return {responseOmitted:true,format:'json',responseRef:reference,retrieve:{command:'response',args:{kind:reference.kind,id:reference.id,offset:0}},note:'Complete response retained locally. Inspect it before claiming an outcome.'};
}
export function validateResponseArguments(args){
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['kind','id','offset'].includes(k))||!['read','operation','startup'].includes(args.kind)||typeof args.id!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(args.id)||args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<0||args.offset>MAX_RESPONSE_BYTES))throw Error('Local response needs kind read/operation/startup, exact id and nonnegative text offset');
}
export function responseChunk(raw,reference,offset=0){
 if(offset>raw.length)throw Error('Response text offset exceeds length');
 const result={responseRef:reference,format:'json',offsetUnits:'utf16',offset,text:'',totalCharacters:raw.length,nextOffset:null};
 let low=0,high=Math.min(raw.length-offset,RESPONSE_DELIVERY_BYTES);
 while(low<high){const mid=Math.ceil((low+high)/2);result.text=raw.slice(offset,offset+mid);result.nextOffset=offset+mid<raw.length?offset+mid:null;if(bytes(result)<=RESPONSE_DELIVERY_BYTES)low=mid;else high=mid-1;}
 // Keep generated cursors between complete surrogate pairs. Explicit offsets
 // still count UTF-16 code units, so concatenating returned text is exact.
 if(low&&offset+low<raw.length&&/[\uD800-\uDBFF]/.test(raw[offset+low-1])&&/[\uDC00-\uDFFF]/.test(raw[offset+low]))low--;
 result.text=raw.slice(offset,offset+low);result.nextOffset=offset+low<raw.length?offset+low:null;
 return result;
}
export function receiptProjection(receipt,reference){
 if(receipt==null)return null;
 if(bytes(receipt)<=1024)return receipt;
 const result={detailsOmitted:true,...(reference?{responseRef:reference}:{}),note:'Receipt details exceed the checkpoint budget.'};
 for(const field of ['id','phase'])if(typeof receipt[field]==='string'&&bytes(receipt[field])<=256)result[field]=receipt[field];
 return result;
}
