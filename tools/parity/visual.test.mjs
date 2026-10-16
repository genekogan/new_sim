import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeLocalUrl,observeClockSource} from './visual.mjs';
const here=dirname(fileURLToPath(import.meta.url));
test('visual target guard rejects live and neighbouring lane ports',()=>{
  for(const url of ['http://127.0.0.1:4950/w/mars','http://127.0.0.1:4970','https://sim.eden.art/worlds','http://localhost:5899','http://localhost:5910'])assert.throws(()=>safeLocalUrl(url));
  assert.equal(safeLocalUrl('http://127.0.0.1:5900/w/test').port,'5900');
});
test('clock observer is read-only and refuses a changed Daylight signature',()=>{
  const source='class Light{update(e){let t=e;this.key=t;if(!e){this.daylightFactor=null;return}}}';
  const out=observeClockSource(source);assert.ok(out.source.includes('globalThis.__parityRenderedDatetime=e;'));
  assert.equal(out.source.replace('globalThis.__parityRenderedDatetime=e;',''),source);
  assert.equal(observeClockSource('const x=1'),null);
  assert.throws(()=>observeClockSource('class X{draw(){this.daylightFactor=null}}'));
});
test('image difference detects one changed pixel, exact copy and size mismatch',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'parity-images-'));
  try{
    execFileSync('python3',['-c',`from PIL import Image
import sys
p=sys.argv[1]
a=Image.new('RGB',(10,10),'black');a.save(p+'/a.png');a.save(p+'/b.png')
a.putpixel((0,0),(255,0,0));a.save(p+'/c.png')
Image.new('RGB',(9,10)).save(p+'/small.png')`,dir]);
    const diff=(right)=>JSON.parse(execFileSync('python3',[resolve(here,'image-diff.py'),resolve(dir,'a.png'),resolve(dir,right),resolve(dir,'pair.png')],{encoding:'utf8'}));
    assert.equal(diff('b.png').status,'PASS');
    const changed=diff('c.png');assert.equal(changed.status,'FAIL');assert.equal(changed.changedPixels,1);assert.equal(changed.meanAbsoluteError,1/300);
    assert.equal(diff('small.png').status,'FAIL');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
