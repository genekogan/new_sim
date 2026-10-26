// node tools/playtest/review/cli.mjs review|develop|report|all <run-dir> [--server-root dir] [--model m] [--only I-1,F-2]
// Steps 5 (review), 6 (develop), 7 (report) on an existing run folder. JSON summary on stdout.
import { resolve } from 'node:path';
import { reviewRun } from './reviewer.mjs';
import { developRun, DEFAULT_SERVER_ROOT } from './developer.mjs';
import { reportRun } from './report.mjs';
const [cmd, dir, ...rest] = process.argv.slice(2);
const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
if (!['review', 'develop', 'report', 'all'].includes(cmd) || !dir) { process.stderr.write('usage: cli.mjs review|develop|report|all <run-dir> [--server-root dir] [--model m] [--only ids]\n'); process.exit(2); }
const runDir = resolve(dir); const out = {};
if (cmd === 'review' || cmd === 'all') { const r = await reviewRun({ runDir, model: opt('--model') ?? undefined }); out.review = { requests: r.reviews.length, fidelity: r.reviews.map((x) => `${x.requestId}:${x.fidelity}`), issues: r.issues.length, featureRequests: r.featureRequests.length }; }
if (cmd === 'develop' || cmd === 'all') out.develop = await developRun({ runDir, serverRoot: opt('--server-root') ?? DEFAULT_SERVER_ROOT, model: opt('--model') ?? undefined, only: opt('--only')?.split(',') ?? null });
if (cmd === 'report' || cmd === 'all') out.report = reportRun(runDir).report;
process.stdout.write(JSON.stringify({ ok: true, ...out }) + '\n');
