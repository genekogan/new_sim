import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SELECTABLE_SCENARIOS } from '../../app/lab/scenarios.ts';
import {
  generatedContracts,
  inventoryUrl,
  outputUrl,
} from '../../deploy/scenario-contracts.mjs';

const inventory = JSON.parse(readFileSync(inventoryUrl, 'utf8'));
const groups = new Set([
  'connected',
  'activities',
  'scripted',
  'continuous',
  'probes',
  'diagnostics',
  'construction',
  'snapshots',
]);

test('every production registration declares an exact execution contract and test mapping', () => {
  const declared = inventory.scenarios;
  assert.equal(
    new Set(declared.map((row: { id: string }) => row.id)).size,
    declared.length,
  );
  assert.deepEqual(
    declared.map((row: { id: string }) => row.id).sort(),
    SELECTABLE_SCENARIOS.map((s) => s.name).sort(),
  );
  for (const scenario of SELECTABLE_SCENARIOS) {
    const row = declared.find((r: { id: string }) => r.id === scenario.name);
    assert.equal(row.title, scenario.title, scenario.name);
    assert.equal(
      row.category === 'continuous',
      scenario.execution === 'sustained',
      `${scenario.name}: sustained execution must be declared honestly`,
    );
    assert.equal(
      row.engineContinuousFlag,
      !!scenario.continuous,
      scenario.name,
    );
    assert.ok(
      groups.has(row.discoveryGroup),
      `${scenario.name}: discovery group`,
    );
    const contract = inventory.contracts[row.contractRef];
    assert.ok(
      contract?.terminal?.trim(),
      `${scenario.name}: meaningful outcome`,
    );
    assert.ok(contract?.limits?.trim(), `${scenario.name}: supported scope`);
    assert.ok(row.startControls.length, `${scenario.name}: start instructions`);
    assert.ok(row.testRefs.length, `${scenario.name}: test mapping`);
    for (const ref of row.testRefs) {
      const mapped = inventory.tests[ref];
      assert.ok(
        mapped?.name && mapped?.file,
        `${scenario.name}: missing test ${ref}`,
      );
      assert.ok(
        existsSync(new URL(`../../../${mapped.file}`, import.meta.url)),
        `${scenario.name}: absent test file ${mapped.file}`,
      );
    }
  }
});

test('UI contract metadata is exactly generated from the authoritative coverage inventory', () => {
  assert.equal(readFileSync(outputUrl, 'utf8'), generatedContracts(inventory));
});

test('duplicate, undeclared, incomplete and unmapped registrations fail with named diagnostics', () => {
  for (const [change, expected] of [
    [
      (copy: typeof inventory) => copy.scenarios.push(copy.scenarios[0]),
      'scenario.registration-duplicate',
    ],
    [
      (copy: typeof inventory) => {
        copy.scenarios[0].contractRef = 'missing';
      },
      'scenario.contract-missing',
    ],
    [
      (copy: typeof inventory) => {
        copy.scenarios[0].discoveryGroup = 'missing';
      },
      'scenario.contract-incomplete',
    ],
    [
      (copy: typeof inventory) => {
        copy.scenarios[0].testRefs = [];
      },
      'scenario.coverage-missing',
    ],
    [
      (copy: typeof inventory) => {
        copy.scenarios[0].testRefs = ['missing'];
      },
      'scenario.coverage-missing',
    ],
  ] as const) {
    const copy = structuredClone(inventory);
    change(copy);
    assert.throws(() => generatedContracts(copy), new RegExp(expected));
  }
});
