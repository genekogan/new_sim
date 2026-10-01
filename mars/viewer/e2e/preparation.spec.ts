/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { preparationReadout } from '../app/lab/preparation.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
// These named fixtures contain all four preparation objects; the global hook
// remains optional outside preparation scenarios.
type PreparationHook = Omit<EngineHook, 'preparation'> & {
  preparation: () => NonNullable<ReturnType<typeof preparationReadout>>;
};
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'preparation',
);

// Two orientations exercise the same physical actions, with real Play rather than fast-forward.
for (const scenario of ['cold-preparation', 'cold-preparation-rotated']) {
  test(`${scenario}: fresh Step, retained deposits, actual Play completion and three reset lifetimes`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    mkdirSync(artifacts, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/lab?scenario=${scenario}`);
    await page.waitForFunction(() => window.__marsEngine?.ready);
    await page.evaluate(
      (name) =>
        window.__marsEngine.runScenario(name, { paused: true, speed: 4 }),
      scenario,
    );
    const button = (name: string) =>
      page.getByRole('button', { name, exact: true });
    const state = () =>
      page.evaluate(() =>
        (window.__marsEngine as PreparationHook).preparation(),
      );
    await button('Reset').click();
    await button('Step').click();
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
      [],
    );
    const original = await state();
    expect(original.preparation).toBeNull();
    expect(
      original.items.map((item) => [item.id, item.contents?.fraction]),
    ).toEqual([
      ['beans', 1],
      ['greens', 1],
      ['pot', 0],
      ['spoon', undefined],
    ]);
    await button('Start preparation').click();
    await button('Play').click();
    await page.waitForFunction(() => {
      const s = (window.__marsEngine as PreparationHook).preparation();
      return (
        !!s.preparation &&
        s.preparation.ingredients[0].deposited >= 0.25 &&
        s.preparation.ingredients[0].deposited < 1
      );
    });
    await button('Pause').click();
    const partial = await state();
    expect(partial.preparation?.complete).toBe(false);
    for (const ingredient of partial.preparation!.ingredients) {
      expect(
        partial.items.find((item) => item.id === ingredient.item)?.contents
          ?.fraction,
      ).toBe(1 - ingredient.deposited);
    }
    expect(
      partial.items.find((item) => item.id === 'pot')?.contents?.fraction,
    ).toBe(
      partial.preparation!.ingredients.reduce(
        (sum, ingredient) => sum + ingredient.deposited,
        0,
      ) / 4,
    );
    await page.screenshot({
      path: path.join(artifacts, `${scenario}-partial-deposit.png`),
    });
    await button('Interrupt preparation').click();
    await button('Play').click();
    await page.waitForFunction(
      () => !(window.__marsEngine as PreparationHook).preparation().active,
    );
    await button('Pause').click();
    const stopped = await state();
    expect(stopped.status).toBe('cancelled');
    expect(stopped.preparation).toEqual(partial.preparation);
    expect(stopped.items.map((item) => item.contents)).toEqual(
      partial.items.map((item) => item.contents),
    );
    for (const item of stopped.items.filter((item) => item.id !== 'spoon')) {
      const before = original.items.find(
        (candidate) => candidate.id === item.id,
      )!;
      expect({
        id: item.id,
        def: item.def,
        pose: item.pose,
        support: item.support,
      }).toEqual({
        id: before.id,
        def: before.def,
        pose: before.pose,
        support: before.support,
      });
    }
    expect(stopped.items.find((item) => item.id === 'spoon')?.support).toEqual({
      kind: 'in-hand',
      by: 'cook',
      hand: 'right',
    });
    expect(
      Object.entries(stopped.claims).filter(
        ([key, owners]) => key !== 'holds:cook' && owners.length,
      ),
    ).toEqual([]);
    await page.screenshot({
      path: path.join(artifacts, `${scenario}-interrupted-same-pot.png`),
    });
    await button('Resume same preparation').click();
    await button('Play').click();
    await page.waitForFunction(() => {
      const s = (window.__marsEngine as PreparationHook).preparation();
      return s.preparation?.complete && s.status === 'completed';
    });
    await button('Pause').click();
    const complete = await state();
    expect(complete.preparation).toMatchObject({
      complete: true,
      mixedTicks: 60,
      ingredients: [
        { item: 'beans', initial: 1, deposited: 1 },
        { item: 'greens', initial: 1, deposited: 1 },
      ],
    });
    expect(
      complete.items.map((item) => [item.id, item.contents?.fraction]),
    ).toEqual([
      ['beans', 0],
      ['greens', 0],
      ['pot', 0.5],
      ['spoon', undefined],
    ]);
    expect(
      complete.items.find((item) => item.id === 'pot')?.contents?.food,
    ).toBe('hypothetical cold shared dish');
    expect(complete.items.map((item) => [item.id, item.def])).toEqual(
      original.items.map((item) => [item.id, item.def]),
    );
    await expect(page.getByTestId('preparation-readout')).toContainText(
      'ready for serving',
    );
    await button('Put spoon down').click();
    await button('Play').click();
    await page.waitForFunction(
      () =>
        window.__marsEngine
          .records()
          .filter((r) => r.verb === 'put_item')
          .at(-1)?.status === 'completed',
    );
    await button('Pause').click();
    const stowed = await state();
    expect(stowed.items.find((item) => item.id === 'spoon')?.support).toEqual(
      original.items.find((item) => item.id === 'spoon')?.support,
    );
    expect(stowed.preparation).toEqual(complete.preparation);
    expect(Object.values(stowed.claims).flat()).toEqual([]);
    expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual(
      [],
    );
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
      [],
    );
    await page.screenshot({
      path: path.join(artifacts, `${scenario}-two-servings-spoon-stowed.png`),
    });
    const finishOrdinary = async (control: string, verb: string) => {
      await button(control).click();
      await button('Play').click();
      await page.waitForFunction(
        (action) =>
          window.__marsEngine
            .records()
            .filter((r) => r.verb === action)
            .at(-1)?.status === 'completed',
        verb,
      );
      await button('Pause').click();
      expect(
        await page.evaluate(() => window.__marsEngine.violations()),
      ).toEqual([]);
    };
    await finishOrdinary('Take empty bowl', 'take_item');
    await finishOrdinary('Take spoon', 'take_item');
    await finishOrdinary('Serve prepared dish', 'serve');
    const served = await state();
    expect(
      served.items.find((item) => item.id === 'pot')?.contents?.fraction,
    ).toBe(0.25);
    expect(served.items.find((item) => item.id === 'beans')?.contents).toEqual({
      food: 'hypothetical cold shared dish',
      fraction: 1,
    });
    expect(served.items.find((item) => item.id === 'beans')?.support).toEqual({
      kind: 'in-hand',
      by: 'cook',
      hand: 'left',
    });
    await finishOrdinary('Eat serving', 'eat');
    const eaten = await state();
    expect(
      eaten.items.find((item) => item.id === 'beans')?.contents?.fraction,
    ).toBe(0);
    expect(
      eaten.items.find((item) => item.id === 'pot')?.contents?.fraction,
    ).toBe(0.25);
    expect(eaten.preparation).toEqual(complete.preparation);
    await page.screenshot({
      path: path.join(
        artifacts,
        `${scenario}-prepared-food-served-and-eaten.png`,
      ),
    });
    await finishOrdinary('Serve prepared dish', 'serve');
    const secondServed = await state();
    expect(
      secondServed.items.find((item) => item.id === 'pot')?.contents?.fraction,
    ).toBe(0);
    expect(
      secondServed.items.find((item) => item.id === 'beans')?.contents,
    ).toEqual({ food: 'hypothetical cold shared dish', fraction: 1 });
    expect(
      secondServed.items.find((item) => item.id === 'beans')?.support,
    ).toEqual({ kind: 'in-hand', by: 'cook', hand: 'left' });
    expect(
      secondServed.items.find((item) => item.id === 'spoon')?.support,
    ).toEqual({ kind: 'in-hand', by: 'cook', hand: 'right' });
    await finishOrdinary('Eat serving', 'eat');
    const secondEaten = await state();
    expect(
      secondEaten.items
        .filter((item) => item.contents)
        .map((item) => [item.id, item.contents!.fraction]),
    ).toEqual([
      ['beans', 0],
      ['greens', 0],
      ['pot', 0],
    ]);
    expect(secondEaten.preparation).toEqual(complete.preparation);
    for (const id of ['pot', 'greens']) {
      const before = original.items.find((item) => item.id === id)!;
      const after = secondEaten.items.find((item) => item.id === id)!;
      expect({
        id: after.id,
        def: after.def,
        pose: after.pose,
        support: after.support,
      }).toEqual({
        id: before.id,
        def: before.def,
        pose: before.pose,
        support: before.support,
      });
    }
    for (const verb of ['serve', 'eat'])
      expect(
        await page.evaluate(
          (action) =>
            window.__marsEngine
              .records()
              .filter((r) => r.verb === action && r.status === 'completed')
              .length,
          verb,
        ),
      ).toBe(2);
    await expect(button('Serve prepared dish')).toBeDisabled();
    await expect(button('Eat serving')).toBeDisabled();
    expect(
      Object.entries(secondEaten.claims).filter(
        ([key, owners]) => key !== 'holds:cook' && owners.length,
      ),
    ).toEqual([]);
    await page.screenshot({
      path: path.join(
        artifacts,
        `${scenario}-both-prepared-servings-eaten.png`,
      ),
    });
    await finishOrdinary('Return bowl', 'put_item');
    await finishOrdinary('Put spoon down', 'put_item');
    const cleaned = await state();
    expect(cleaned.items.find((item) => item.id === 'beans')?.support).toEqual(
      original.items.find((item) => item.id === 'beans')?.support,
    );
    expect(cleaned.items.find((item) => item.id === 'spoon')?.support).toEqual(
      original.items.find((item) => item.id === 'spoon')?.support,
    );
    expect(
      cleaned.items
        .filter((item) => item.contents)
        .map((item) => [item.id, item.contents!.fraction]),
    ).toEqual([
      ['beans', 0],
      ['greens', 0],
      ['pot', 0],
    ]);
    expect(cleaned.preparation).toEqual(complete.preparation);
    expect(Object.values(cleaned.claims).flat()).toEqual([]);
    expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual(
      [],
    );
    const baseline = await page.evaluate(() => window.__marsEngine.info());
    const resets = [];
    for (let reset = 0; reset < 3; reset++) {
      const frame = await page.evaluate(
        () => window.__marsEngine.info().frames,
      );
      await button('Reset').click();
      await page.waitForFunction(
        (previous) => window.__marsEngine.info().frames > previous + 3,
        frame,
      );
      const info = await page.evaluate(() => window.__marsEngine.info());
      expect({ geometries: info.geometries, textures: info.textures }).toEqual({
        geometries: baseline.geometries,
        textures: baseline.textures,
      });
      resets.push(info);
      await button('Step').click();
      expect((await state()).items).toEqual(original.items);
      expect((await state()).preparation).toBeNull();
      expect(await page.evaluate(() => window.__marsEngine.records())).toEqual(
        [],
      );
      expect(
        await page.evaluate(() => window.__marsEngine.violations()),
      ).toEqual([]);
    }
    writeFileSync(
      path.join(artifacts, `${scenario}-retention-reset-resources.json`),
      JSON.stringify(
        {
          original,
          partial,
          stopped,
          complete,
          stowed,
          served,
          eaten,
          secondServed,
          secondEaten,
          cleaned,
          baseline,
          resets,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  });
}
