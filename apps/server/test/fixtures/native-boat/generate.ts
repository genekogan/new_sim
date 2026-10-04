// Offline canonical fixture generation: no server, database, model or renderer.
import { writeFileSync } from 'node:fs';
import { nativeBoatTake } from '../../../../../packages/engine-mars/src/boat-fixture.ts';
const result=await nativeBoatTake();
writeFileSync(new URL('./journey.v1.json',import.meta.url),JSON.stringify(result)+'\n');
console.log(JSON.stringify({ticks:result.take.ticks,trace:result.trace,finalStateHash:result.finalStateHash}));
