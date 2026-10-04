import { writeFileSync } from 'node:fs';
import { nativeShoreCaptureFixture } from '../../../../../packages/engine-mars/src/shore-capture-fixture.ts';
const out=await nativeShoreCaptureFixture();
writeFileSync(new URL('./journeys.v1.json',import.meta.url),JSON.stringify(out)+'\n');
console.log(JSON.stringify(out.journeys.map(j=>({worldId:j.worldId,kind:j.kind,ticks:j.chunk.take.ticks,
  sceneHash:j.capture.ref.hash,finalStateHash:j.recording.finalStateHash,paidSpendUSD:0}))));
