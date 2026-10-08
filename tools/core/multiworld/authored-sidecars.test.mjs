import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {readAuthoredSidecars} from './authored-sidecars.mjs';
test('authored source binding refuses altered bytes, outside paths, partial pairs and default worlds',()=>{
 const input=mkdtempSync(join(tmpdir(),'lm-source-'));try{mkdirSync(join(input,'worlds/littlemartians'),{recursive:true});const cfg={input,worldKey:'littlemartians',worldVariant:'authored',worldId:'authored-sidecar-fixture'};
 for(const [key,file] of [['placeData','places.v1.json'],['activityData','activity-spots.v1.json'],['nativeAliases','native-place-aliases.json']]){const bytes=JSON.stringify({fixture:key}),path=join(input,'worlds/littlemartians',file);writeFileSync(path,bytes);cfg[key]=path;cfg[key+'Sha256']=createHash('sha256').update(bytes).digest('hex');}
 assert.equal(readAuthoredSidecars(cfg).placeData.fixture,'placeData');assert.equal(readAuthoredSidecars({input,worldKey:'littlemartians',worldVariant:'legacy',worldId:'littlemartians-1'}),undefined);assert.equal(readAuthoredSidecars({input,worldKey:'mars',worldVariant:'legacy',worldId:'mars-2026-1'}),undefined);
 for(const change of [{worldVariant:'legacy'},{worldKey:'mars'},{worldId:'littlemartians-1'},{placeData:join(input,'elsewhere.json')},{activityDataSha256:undefined},{nativeAliasesSha256:'0'.repeat(64)}])assert.throws(()=>readAuthoredSidecars({...cfg,...change}),/authored/);
 writeFileSync(cfg.placeData,'{}');assert.throws(()=>readAuthoredSidecars(cfg),/hash differs/);
 }finally{rmSync(input,{recursive:true,force:true});}
});
