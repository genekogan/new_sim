// The Modal fan-out's static shape (modal_suite.py), read with Python's ast so no Modal client is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REQUIRED_STEPS } from './release-gate.mjs';

const SUITE = fileURLToPath(new URL('./modal_suite.py', import.meta.url));
// Literal constants, the resources of each @app.function, and plan() evaluated without importing modal.
const PY = String.raw`
import ast, json, sys
src = open(sys.argv[1]).read(); tree = ast.parse(src); ns = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        try: ns[node.targets[0].id] = ast.literal_eval(node.value)
        except ValueError: pass
functions = {}
for node in tree.body:
    if isinstance(node, ast.FunctionDef):
        for d in node.decorator_list:
            if isinstance(d, ast.Call) and getattr(d.func, 'attr', '') == 'function':
                functions[node.name] = {k.arg: ast.get_source_segment(src, k.value) for k in d.keywords}
        if node.name == 'plan': exec(ast.get_source_segment(src, node), ns)
calls = json.loads(sys.argv[2])
print(json.dumps({'GROUPS': ns['GROUPS'], 'ORDER': ns['ORDER'], 'LARGE': sorted(ns['LARGE']), 'V5_SHARDS': ns['V5_SHARDS'], 'functions': functions,
                  'plans': [ns['plan'](*c) for c in calls]}))
`;
const shape = (...calls) => JSON.parse(execFileSync('python3', ['-I', '-c', PY, SUITE, JSON.stringify(calls)], { encoding: 'utf8' }));

test('modal fan-out: group a on 8 CPU, one 4 CPU container for the small steps, 2 V5 shards', () => {
  const s = shape(['']);
  assert.deepEqual(Object.keys(s.GROUPS), ['a', 's']); assert.deepEqual(s.LARGE, ['a']); assert.equal(s.V5_SHARDS, 2);
  const steps = Object.values(s.GROUPS).flat();
  assert.equal(new Set(steps).size, steps.length, 'a step is in two groups');
  assert.deepEqual([...steps].sort(), s.ORDER.filter(x => !x.startsWith('V5-')).sort());
  for (const step of REQUIRED_STEPS.filter(x => !x.startsWith('V5-'))) assert.ok(steps.includes(step), step);
  assert.deepEqual(s.plans[0].map(j => j[0]), ['a', 's', 'v5-1', 'v5-2']);
  assert.deepEqual(s.plans[0].filter(j => j[2]).map(j => j[2]), ['1/2', '2/2']);
  const { run, run_large: large } = s.functions;
  assert.equal(run.cpu, '4.0'); assert.equal(run.memory, '8192'); assert.equal(large.cpu, '8.0'); assert.equal(large.memory, '16384');
  for (const f of [run, large]) { assert.equal(f.single_use_containers, 'True'); assert.ok(f.max_containers); assert.equal(f.timeout, '4 * 3600'); }
});
test('modal fan-out: a bounded --server-files run keeps V5 and its baseline in one container', () => {
  const [plan] = shape(['src/a.test.ts']).plans;
  assert.deepEqual(plan.map(j => j[0]), ['a', 's', 'v5']); assert.equal(plan[2][1], 'V5-server-full,V5-server-baseline');
});
test('dependencies come from an image layer keyed by the lockfile; the install log names the cached layer', () => {
  const src = readFileSync(SUITE, 'utf8'), stage = readFileSync(fileURLToPath(new URL('./remote-suite.sh', import.meta.url)), 'utf8');
  assert.match(stage, /git -C "\$ROOT" show "\$REF:pnpm-lock.yaml" > "\$STAGE\/deps\/pnpm-lock.yaml"/);
  assert.match(src, /add_local_dir\(DEPS, "\/deps", copy=True\)\.run_commands\(/);
  assert.match(src, /pnpm fetch --store-dir \/pnpm-store/);
  // the layer is added before the uncopied /in mount (Modal requires mounts last) and only when the stage has a lockfile
  assert.ok(src.indexOf('add_local_dir(DEPS') < src.indexOf('add_local_dir(SRC, "/in")'));
  assert.match(src, /echo "cached layer \$lock"; pnpm install --frozen-lockfile --offline --store-dir \/pnpm-store/);
  assert.match(src, /no cached layer for lockfile \$lock/);
});
