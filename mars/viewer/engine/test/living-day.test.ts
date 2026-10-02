import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import {
  createRegistry,
  servicesFor,
  ENGINE_INVARIANTS,
} from '../api/registry.ts';
import {
  livingDayWorld,
  livingDayScene,
  startLivingDay,
  tickLivingDay,
  readLivingDay,
  type LivingDayName,
} from '../scenarios/living-day.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { readBook } from '../objects/reading.ts';
import { readGarden } from '../objects/garden.ts';
for (const name of ['living-day-4', 'living-day-studio'] as LivingDayName[])
  for (const worker of ['original', 'assistant'] as const)
    test(`${name}: ${worker} independent day returns to unfinished purpose`, () => {
      const w = livingDayWorld(name),
        rt = new Runtime(
          w,
          createRegistry(),
          servicesFor({ [w.base.campus]: livingDayScene(name) })(w),
          ENGINE_INVARIANTS,
        );
      const request = startLivingDay(rt, name, {
        worker,
        workstation: worker === 'original' ? 'preferred' : 'alternative',
      });
      assert.ok(!('code' in request));
      for (
        let i = 0;
        i < 16000 && readLivingDay(rt)?.phase !== 'completed';
        i++
      ) {
        rt.step();
        tickLivingDay(rt);
        if (rt.violations.length) break;
      }
      assert.deepEqual(rt.violations, []);
      assert.equal(
        readLivingDay(rt)?.phase,
        'completed',
        JSON.stringify({
          day: readLivingDay(rt),
          failed: [...rt.records.values()].filter((r) => r.status === 'failed'),
          blocked: [...rt.records.values()].filter(
            (r) => r.status === 'blocked',
          ),
        }),
      );
      const day = readLivingDay(rt)!;
      assert.equal(rt.records.get(day.routine!)?.status, 'completed');
      assert.equal(rt.records.get(day.music!)?.status, 'completed');
      const work = readWorkstation(
        rt,
        worker === 'assistant'
          ? 'aux-computer'
          : name === 'living-day-studio'
            ? 'studio-computer'
            : 'workstation',
      );
      assert.ok(!('code' in work));
      assert.equal(work.status, 'completed');
      const book = readBook(rt, 'book');
      assert.ok(!('code' in book));
      assert.equal(book.elapsed, 24);
      const garden = readGarden(rt, 'plant-a');
      assert.ok(!('code' in garden));
      assert.equal(garden.cycles, 2);
      assert.equal(rt.world.entities['water-bowl'].contents?.fraction, 0.25);
      assert.equal(day.intentions[0]?.completed.length, 4);
      assert.equal(day.intentions[1]?.completed.length, 3);
      assert.ok(!('code' in request));
      assert.equal(readLivingDay(rt)?.initial, request.id);
    });
