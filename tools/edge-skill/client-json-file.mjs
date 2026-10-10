import {openSync,closeSync,writeFileSync,renameSync,unlinkSync,lstatSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Publish a whole local document. Concurrent readers see the old or new
 * value, never a truncated write. This does not serialize multiple writers. */
export function writeAtomicJSON(file,value){
 const target=resolve(file);
 try{const s=lstatSync(target);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('linked or nonregular JSON file refused');}catch(e){if(e.code!=='ENOENT')throw e;}
 const bytes=JSON.stringify(value)+'\n',temp=join(dirname(target),'.'+basename(target)+'.'+process.pid+'.'+randomUUID()+'.tmp');
 let fd=null;
 try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,bytes);closeSync(fd);fd=null;renameSync(temp,target);}
 finally{if(fd!==null)closeSync(fd);try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
