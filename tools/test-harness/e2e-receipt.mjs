import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = {'V6-scenarios':'e2e','V6-party':'e2e-party','V6-souls-r2':'e2e-r2','V6-join-clerk':'e2e-join','V6-join-dev':'e2e-join','V6-mars-two':'e2e-mars-two','V6-lm-two':'e2e-lm-two','V6-launcher':'e2e-launcher'};
export function collect(step, root, out, since) {
  if (!roots[step]) throw Error(`unregistered e2e report root: ${step}`);
  const dir = join(root,'.lane',roots[step]);
  const reports = readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>join(dir,e.name,'report.json')).flatMap(path=>{
    let report; try { report=JSON.parse(readFileSync(path,'utf8')); } catch { return []; }
    if (step.startsWith('V6-join-') && report.mode!==step.slice('V6-join-'.length)) return [];
    return Date.parse(report.startedAt)>=Number(since)*1000 ? [{path,report}] : [];
  });
  if (reports.length!==1) throw Error(`${step}: expected exactly one fresh report, found ${reports.length}`);
  const {path,report}=reports[0];
  if (!Array.isArray(report.steps)||!report.steps.length||report.summary?.steps!==report.steps.length||!Number.isInteger(report.summary?.failed)||!Array.isArray(report.failures)||report.summary.failed!==report.failures.length) throw Error(`${step}: incomplete e2e report`);
  const seen=new Set();
  const steps=report.steps.map(s=>{
    if (typeof s.name!=='string'||!s.name.trim()||typeof s.ok!=='boolean'||seen.has(s.name)) throw Error(`${step}: malformed/duplicate scenario`);
    seen.add(s.name); return {id:s.name,status:s.ok?'pass':'fail'};
  });
  const harnessFailures=report.failures.filter(f=>!steps.some(s=>s.id===f.name&&s.status==='fail')).map(f=>String(f.name||'unknown'));
  const receipt={schemaVersion:1,completed:true,steps,harnessFailures,sourceReport:relative(root,path)};
  writeFileSync(join(out,`${step}-cases.json`),JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { collect(...process.argv.slice(2)); } catch(e) { console.error(e.message); process.exitCode=1; }
}
