import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
test('camera observation survives same-tick resets; validated FOV only changes rendering', async ({page}) => {
  await page.goto('/lab?scenario=classroom-4');
  await page.waitForFunction(()=>window.__marsEngine?.ready);
  const proof = await page.evaluate(()=>{
    const e=window.__marsEngine;
    e.runScenario('classroom-4',{paused:true});
    const epoch=e.scenarioEpoch, before=e.stateHash(), first=e.cameraGeometry();
    const accepted=e.camera([10,8,14],[0,1,0],60), pose=e.cameraPose();
    const refused=e.camera([1,2,3],[0,0,0],81), afterRefusal=e.cameraPose();
    const badVector=e.camera([NaN,2,3],[0,0,0],40);
    const sameGeometry=first===e.cameraGeometry(), unchanged=before===e.stateHash();
    e.runScenario('classroom-4',{paused:true});
    const reset=e.cameraGeometry();
    return {epoch,next:e.scenarioEpoch,accepted,refused,badVector,pose,afterRefusal,sameGeometry,unchanged,resetDistinct:first!==reset,resetSchema:'schema' in reset?reset.schema:null};
  });
  expect(proof.next).toBe(proof.epoch+1); expect(proof.accepted.ok).toBeTruthy();
  expect(proof.pose.fov).toBe(60); expect(proof.refused.ok).toBeFalsy();
  expect(proof.afterRefusal).toEqual(proof.pose); expect(proof.badVector.ok).toBeFalsy();
  expect(proof.sameGeometry).toBeTruthy(); expect(proof.unchanged).toBeTruthy();
  expect(proof.resetDistinct).toBeTruthy(); expect(proof.resetSchema).toBe('mars-lab-camera-geometry/1');
  await page.evaluate(() => window.__marsEngine.camera([10,8,14],[0,1,0],60));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const artifacts=path.resolve(import.meta.dirname,'artifacts',process.env.E2E_RUN!);
  mkdirSync(artifacts,{recursive:true});
  await page.screenshot({path:path.join(artifacts,'lab-camera-fov-60.png')});
  writeFileSync(path.join(artifacts,'lab-camera-hooks.json'),JSON.stringify(proof,null,2));
});
