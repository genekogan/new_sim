// Only explicit authored LM source pairs can install these three sidecars.
import {readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
export function readAuthoredSidecars({input,worldKey,worldVariant,worldId,placeData,placeDataSha256,activityData,activityDataSha256,nativeAliases,nativeAliasesSha256}){
 const rows=[['placeData',placeData,placeDataSha256,'places.v1.json'],['activityData',activityData,activityDataSha256,'activity-spots.v1.json'],['nativeAliases',nativeAliases,nativeAliasesSha256,'native-place-aliases.json']];
 if(rows.every(([,path,hash])=>path===undefined&&hash===undefined))return undefined;
 if(worldKey!=='littlemartians'||worldVariant!=='authored'||worldId==='littlemartians-1')throw Error('authored sidecars require a separate explicit authored LM identity');
 const result={};for(const [key,path,hash,file] of rows){
  const expected=join(resolve(input),'worlds/littlemartians',file);
  if(typeof path!=='string'||resolve(path)!==expected||realpathSync(path)!==join(realpathSync(input),'worlds/littlemartians',file)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error('authored sidecars require exact source-relative files and hashes');
  const bytes=readFileSync(path);if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('authored sidecar hash differs: '+key);
  result[key]=JSON.parse(bytes.toString('utf8'));
 }return result;
}
