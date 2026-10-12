// Bounded proof: a known unchanged variant must fail in sparse and busy contexts, while a real difference passes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function verifyComparisonReports(sparse, busy) {
  const summaries = [];
  for (const [name, report] of [['sparse', sparse], ['busy', busy]]) {
    if (report.comparison !== 'fixed-backdrop/1' || !/NVIDIA/.test(report.gpu ?? '') || /swiftshader|llvmpipe|software/i.test(report.gpu)) throw new Error(`${name}: no qualified fixed-backdrop NVIDIA capture`);
    if (name === 'sparse' ? report.fixture?.busy !== 0 : !(report.fixture?.busy > 0)) throw new Error(`${name}: wrong fixture context`);
    const unchanged = report.items.find((i) => i.id === 'core/supermarket@1'), different = report.items.find((i) => i.id === 'core/dumpster@1');
    if (!unchanged || unchanged.ok || !(unchanged.numbers['diff:style=barn'] < 2) || !unchanged.errors.some((e) => e.includes('style=barn: looks the same'))) throw new Error(`${name}: unchanged supermarket variant escaped`);
    if (!different?.ok || !(different.numbers['diff:variant=blue'] >= 2)) throw new Error(`${name}: genuinely different blue variant failed`);
    for (const id of ['core/sound-emitter@1', 'core/bird@1']) {
      const item = report.items.find((i) => i.id === id);
      if (!item || item.ok || item.status !== 'unqualified' || !item.unqualifiedClaims?.length || item.errors.some((e) => e.includes('looks the same'))) throw new Error(`${name}: nonvisual claim misclassified: ${id}`);
    }
    for (const item of report.items) {
      if (!/^[a-f0-9]{64}$/.test(item.defHash ?? '')) throw new Error(`${name}: missing engine hash`);
      for (const label of item.variants) {
        const views = item.views.filter((v) => v.label === label);
        if (views.length !== 4 || new Set(views.map((v) => v.view)).size !== 4 || views.some((v) => !v.live || v.cover === null || v.cover < 0.003 || v.missingAsset)) throw new Error(`${name}: missing/empty pictures: ${item.id}/${label}`);
      }
    }
    summaries.push({ context: name, busy: report.fixture.busy, gpu: report.gpu, unchanged: unchanged.numbers['diff:style=barn'], different: different.numbers['diff:variant=blue'], unqualified: 2, views: report.items.reduce((n, i) => n + i.views.length, 0) });
  }
  for (const item of sparse.items) if (busy.items.find((i) => i.id === item.id)?.defHash !== item.defHash) throw new Error('engine hash changed between contexts');
  return summaries;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyComparisonReports(...process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')))), null, 1));
