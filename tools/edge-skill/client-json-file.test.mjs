import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,linkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';
import {writeAtomicJSON} from './client-json-file.mjs';
test('independent readers never receive partial JSON while another process publishes documents',async()=>{
 const root=mkdtempSync(join(tmpdir(),'eden-json-')),file=join(root,'state.json');
 try{
  writeAtomicJSON(file,{version:0,text:'a'.repeat(65536)});
  const script=`import {writeAtomicJSON} from ${JSON.stringify(new URL('./client-json-file.mjs',import.meta.url).href)};for(let i=1;i<=250;i++)writeAtomicJSON(process.argv[1],{version:i,text:String(i).repeat(65536)});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,file],{stdio:['ignore','ignore','pipe']});let done=false,error='';child.stderr.on('data',b=>{error+=b;});
  const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{done=true;code===0?resolve():reject(Error(error||'writer failed'));});});
  let reads=0;while(!done){const d=JSON.parse(readFileSync(file,'utf8'));assert.ok(Number.isInteger(d.version)&&d.version>=0&&d.version<=250);assert.equal(d.text,d.version===0?'a'.repeat(65536):String(d.version).repeat(65536));reads++;await new Promise(setImmediate);}
  await exit;assert.ok(reads>10);assert.equal(JSON.parse(readFileSync(file,'utf8')).version,250);assert.deepEqual(readdirSync(root),['state.json']);assert.equal(statSync(file).mode&0o777,0o600);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('linked targets are refused without touching their source or leaving temporary files',()=>{
 const root=mkdtempSync(join(tmpdir(),'eden-json-links-')),original=join(root,'original.json');
 try{writeAtomicJSON(original,{unchanged:true});for(const kind of ['symbolic','hard']){const target=join(root,kind+'.json');kind==='symbolic'?symlinkSync(original,target):linkSync(original,target);assert.throws(()=>writeAtomicJSON(target,{changed:true}),/refused/);assert.deepEqual(JSON.parse(readFileSync(original,'utf8')),{unchanged:true});}assert.ok(readdirSync(root).every(n=>!n.endsWith('.tmp')));}
 finally{rmSync(root,{recursive:true,force:true});}
});
