// Entry 35: ordinary CLI seats for the owned world: a folder per Soul with the shipped eden.mjs, registered and created
// exactly as a Soul's agent does it (eden.mjs register <url>; eden.mjs create "<Name>"). Prints each seat's soul id.
import {mkdirSync,copyFileSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {resolve} from 'node:path';
const scene=process.env.SOUL_HANDS_SCENE??'<team>/soul-actions/day-35/scene',port=Number(process.env.SOUL_HANDS_PORT??7876),url=`http://127.0.0.1:${port}/w/soul-hands`;
const out={};
for(const name of (process.env.SOUL_HANDS_SEATS??'Ada,Bea,Cy').split(',')){
 const dir=`${scene}/${name.toLowerCase()}`;mkdirSync(dir,{recursive:true});
 if(!existsSync(dir+'/eden.mjs'))copyFileSync(resolve('tools/world-launcher/soul/eden.mjs'),dir+'/eden.mjs');
 const run=(...a)=>execFileSync(process.execPath,['eden.mjs',...a],{cwd:dir,encoding:'utf8'});
 if(!existsSync(dir+'/.eden-agent.json')){run('register',url);out[name]=(run('create',name).match(/s_[A-Za-z0-9_-]+/)??['created'])[0];
  // each Soul picks its own body with the CLI (a look whose legs reach its shoes: some random kit looks leave the shins out)
  const want=Object.fromEntries((process.env.SOUL_HANDS_BODIES??'Ada=woman,Bea=casual,Cy=punk').split(',').map(x=>x.split('=')))[name];
  if(want){run('body','look','--set','preset='+want,...(want==='woman'?['frame=fem']:[]));out[name]+=' look '+want;}}else out[name]='existing';
}
console.log(JSON.stringify(out));
