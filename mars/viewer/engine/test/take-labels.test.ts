// Step labels in take files (W39). Sequence templates write labels with parameter references ("$crew[2] climbs below");
// `bindTemplate` keeps them as written (a filled label would move planHash), so the recorder fills them with
// `bindLabel` from the plan's bindings. 1. bindLabel itself; 2. the shipped chapter takes: no step label and no log text
// (step labels, event messages) still holds a template reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindLabel } from '../sequence/bind.ts';

const B = { crew: ['m1', 'm2', 'm3'], pile: 'pile-7', at: { x: 1.5 }, n: 4 };

test('bindLabel fills inline references from the bindings', () => {
  assert.equal(bindLabel('$crew[2] climbs below', B), 'm3 climbs below');
  assert.equal(bindLabel('relay $crew[0] hands up to $crew[1]', B), 'relay m1 hands up to m2');
  assert.equal(bindLabel('take it off $pile, then $n more', B), 'take it off pile-7, then 4 more');
  assert.equal(bindLabel('crew: $crew', B), 'crew: m1, m2, m3');
  assert.equal(bindLabel('stand at $at.x m', B), 'stand at 1.5 m');
  assert.equal(bindLabel('no references here', B), 'no references here');
});

test('bindLabel: sentence ends, literal $$, unbound and out-of-range references stay as written', () => {
  assert.equal(bindLabel('handed to $crew[1].', B), 'handed to m2.');
  assert.equal(bindLabel('$crew[1].done', B), 'm2.done'); // "done" is not a field of a string: only the index is used
  assert.equal(bindLabel('costs $$5', B), 'costs $5');
  assert.equal(bindLabel('$other[0] waits', B), '$other[0] waits');
  assert.equal(bindLabel('$crew[9] waits', B), '$crew[9] waits');
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = join(ROOT, 'public/engine/takes/manifest.json');
const REF = /\$[A-Za-z_]/;

test('shipped chapter takes: no step label or event message holds a template reference', { skip: !existsSync(MANIFEST) && 'no manifest' }, () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { otherYears?: { file: string; kind?: string }[] };
  const chapters = (m.otherYears ?? []).filter((e) => e.kind === 'year-build-chapter');
  assert.ok(chapters.length >= 7, `expected the A+B chapter takes, found ${chapters.length}`);
  for (const e of chapters) {
    const f = JSON.parse(readFileSync(join(ROOT, 'public', e.file), 'utf8')) as {
      steps: { id: string; label?: string }[];
      take: { events: { type: string; message?: string }[] };
    };
    const labelled = f.steps.filter((s) => s.label);
    assert.ok(labelled.length > 0, `${e.file}: no labelled steps`);
    const bad = labelled.filter((s) => REF.test(s.label!)).map((s) => `${s.id}: ${s.label}`);
    assert.deepEqual(bad.slice(0, 5), [], `${e.file}: ${bad.length} step labels still hold template references`);
    const badMsg = f.take.events.filter((x) => typeof x.message === 'string' && REF.test(x.message)).map((x) => x.message);
    assert.deepEqual(badMsg.slice(0, 5), [], `${e.file}: ${badMsg.length} event messages hold template references`);
  }
});
