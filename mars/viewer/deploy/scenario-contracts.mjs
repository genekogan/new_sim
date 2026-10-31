// scenario-coverage.json (beside this file) is authoritative. Keep only useful contract text in the UI,
// never the large historical proof registry or local capture paths.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const inventoryUrl = new URL(
  './scenario-coverage.json',
  import.meta.url,
);
export const outputUrl = new URL(
  '../app/lab/scenario-contracts.ts',
  import.meta.url,
);

export function generatedContracts(inventory) {
  const ids = new Set();
  const groups = new Set(inventory.discoveryGroups.map((group) => group.id));
  const rows = inventory.scenarios.map((row) => {
    if (ids.has(row.id))
      throw Error(`scenario.registration-duplicate: ${row.id}`);
    ids.add(row.id);
    const contract = inventory.contracts[row.contractRef];
    if (!contract)
      throw Error(`scenario.contract-missing: ${row.id}/${row.contractRef}`);
    if (
      !groups.has(row.discoveryGroup) ||
      !row.startControls?.length ||
      !contract.terminal?.trim() ||
      !contract.limits?.trim()
    )
      throw Error(`scenario.contract-incomplete: ${row.id}`);
    if (
      !row.testRefs?.length ||
      row.testRefs.some(
        (ref) => !inventory.tests[ref]?.file || !inventory.tests[ref]?.name,
      )
    )
      throw Error(`scenario.coverage-missing: ${row.id}`);
    return [
      row.id,
      {
        group: row.discoveryGroup,
        start: row.startControls,
        outcome: contract.terminal,
        scope: contract.limits,
      },
    ];
  });
  return (
    '// Generated from deploy/scenario-coverage.json.\n' +
    '// Run node deploy/scenario-contracts.mjs; engine tests check exact parity.\n' +
    'export const LAB_SCENARIO_GROUPS = ' +
    JSON.stringify(inventory.discoveryGroups, null, 2) +
    ' as const;\n' +
    'export const LAB_CONTRACTS = ' +
    JSON.stringify(Object.fromEntries(rows), null, 2) +
    ' as const;\n'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = generatedContracts(
    JSON.parse(readFileSync(inventoryUrl, 'utf8')),
  );
  if (process.argv.includes('--check')) {
    if (readFileSync(outputUrl, 'utf8') !== source)
      throw Error(
        'scenario.contract-stale: run node deploy/scenario-contracts.mjs',
      );
  } else writeFileSync(outputUrl, source);
}
