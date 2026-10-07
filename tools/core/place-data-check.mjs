// PLACE-DATA-v1 check: node tools/core/place-data-check.mjs <places.v1.json>
// Structural rules 1-3 and 5. Rule 4 (occupiers vs live native fixtures) runs when the
// edge server boots with this file (tools/core/edge-server.mjs refuses the file on any violation).
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const [file]=process.argv.slice(2);
if(!file){console.error('usage: place-data-check <places.v1.json>');process.exit(2);}
const {validatePlaceData}=await import(new URL('../../apps/server/src/edge/ledger/places.ts',import.meta.url).href);
const data=JSON.parse(readFileSync(resolve(file),'utf8')),errs=validatePlaceData(data);
if(errs.length){for(const e of errs)console.log('violation:',e);process.exit(1);}
console.log(`ok (${data.places.length} places; occupiers are checked against live fixtures at edge server boot)`);
