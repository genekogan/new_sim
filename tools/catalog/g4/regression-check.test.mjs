import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyComparisonReports } from './regression-check.mjs';
function report(busy) {
  const views = (labels) => labels.flatMap((label) => ['front-left', 'front-right', 'back', 'above'].map((view) => ({ label, view, live: true, cover: 0.2 })));
  const item = (id, variants, extra) => ({ id, defHash: 'a'.repeat(64), variants, views: views(variants), errors: [], ...extra });
  return { gpu: 'ANGLE NVIDIA L4 Vulkan', comparison: 'fixed-backdrop/1', fixture: { busy }, items: [
    item('core/supermarket@1', ['default', 'style=barn'], { ok: false, errors: ['style=barn: looks the same'], numbers: { 'diff:style=barn': 0.15 } }),
    item('core/dumpster@1', ['default', 'variant=blue'], { ok: true, numbers: { 'diff:variant=blue': 7 } }),
    ...['core/sound-emitter@1', 'core/bird@1'].map((id) => item(id, ['default'], { ok: false, status: 'unqualified', unqualifiedClaims: [{ reason: 'requires nonvisual proof' }] })),
  ] };
}
test('regression proof rejects the observed background false negative and a false rejection', () => {
  assert.equal(verifyComparisonReports(report(0), report(48)).length, 2);
  const falseNegative = report(48); falseNegative.items[0].ok = true; falseNegative.items[0].numbers['diff:style=barn'] = 4.46;
  assert.throws(() => verifyComparisonReports(report(0), falseNegative), /escaped/);
  const falsePositive = report(48); falsePositive.items[1].ok = false;
  assert.throws(() => verifyComparisonReports(report(0), falsePositive), /genuinely different/);
});
test('proof rejects empty pictures, software GPU, wrong context and nonvisual rubber stamping', () => {
  const empty = report(48); empty.items[1].views[0].cover = 0;
  assert.throws(() => verifyComparisonReports(report(0), empty), /empty pictures/);
  const software = report(48); software.gpu = 'NVIDIA SwiftShader';
  assert.throws(() => verifyComparisonReports(report(0), software), /NVIDIA capture/);
  const stamped = report(48); stamped.items[2].ok = true;
  assert.throws(() => verifyComparisonReports(report(0), stamped), /nonvisual/);
  assert.throws(() => verifyComparisonReports(report(48), report(48)), /wrong fixture context/);
});
