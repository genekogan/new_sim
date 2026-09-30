// Explicit bounded fixture evaluation; NO sustained loop or browser credentials.
import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Director } from './director.ts';
import { JevProvider, JEV_MODEL } from './jev-server.ts';
loadEnvFile('<typesafe-repo>/.env');
const input = 'e2e/artifacts/codex-autonomous-camera-comparison/sequence.json';
const sequence = JSON.parse(readFileSync(input, 'utf8'));
const provider = new JevProvider(process.env.TYPESAFE_API_KEY, {
  maxCalls: 12,
  budgetUSD: 0.01,
});
const cases = [];
let lastRequest = -Infinity;
for (const policy of ['clear', 'restrained']) {
  const d = new Director(policy);
  let count = 0,
    previous = '';
  for (const o of sequence.observations) {
    d.update(o);
    const req = d.request();
    if (!req || req.candidates.length === 0) continue;
    const fp = JSON.stringify([
      o.activity.phase,
      o.activity.focus,
      o.geometryVersion,
    ]);
    if (fp === previous || count >= 6) continue;
    previous = fp;
    count++;
    const delay = Math.max(0, 1000 - (performance.now() - lastRequest));
    if (delay) await new Promise((r) => setTimeout(r, delay));
    lastRequest = performance.now();
    const baseline = d.selectedId,
      controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 1500);
    try {
      const reply = await provider.choose(req, controller.signal);
      cases.push({
        policy,
        time: o.time,
        baseline,
        request: req,
        reply,
        agrees: reply.choice === baseline || reply.choice === 'HOLD',
      });
    } catch {
      cases.push({
        policy,
        time: o.time,
        baseline,
        error: 'camera.jev-unavailable',
        costUpperBoundUSD: provider.costUSD,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
const report = {
  model: JEV_MODEL,
  config: {
    maxCalls: 12,
    budgetUSD: 0.01,
    minIntervalMs: 1000,
    timeoutMs: 1500,
  },
  calls: provider.calls,
  inputTokens: provider.inputTokens,
  costUSD: provider.costUSD,
  cases,
  note: 'Bounded API evaluation on causal recorded hypothetical classroom observations; not proof of live model direction or visual superiority. Errors retain conservative full-context cost reservation.',
};
writeFileSync(
  'e2e/artifacts/codex-autonomous-camera-comparison/jev-evaluation.json',
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    model: report.model,
    calls: report.calls,
    inputTokens: report.inputTokens,
    costUSD: report.costUSD,
    cases: cases.map((c) => ({
      policy: c.policy,
      time: c.time,
      baseline: c.baseline,
      choice: c.reply?.choice,
      latencyMs: c.reply?.latencyMs,
      error: c.error,
    })),
  }),
);
