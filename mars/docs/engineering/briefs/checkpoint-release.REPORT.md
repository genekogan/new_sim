# Checkpoint release report

## 2026-09-30 — release 18 (production verified)

Branch `codex/checkpoint-release`; exact deployed source `b2928ef60f7df31c23d2efc5db6ffbe2b7667bd9`. Base worktree started at `ffca078`, then fast-forwarded to the root-authorized source. Local Git only; no remote or push. Only this report and `viewer/deploy/deployment.json` are release-owned edits.

Root supplied the clean full gate at `viewer/.cloudflare/gate/2026-09-30T03-47-46-115Z/report.json`; copied unchanged into this release worktree and verified `ok:true`, `gitDirty:false`, `cleanupError:null`, and abbreviated `gitHead` resolving to exact deployed source. Root reports unit 99, engine 745 pass/0 fail/6 skips/11 TODO, browser 103 pass/7 skips, lint/both TypeScript checks, byte-identical flagship and unchanged final probe hash `b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3`, original idle performance pass with zero violations, and regenerated evidence success. This helper did not rerun broad gates, performance, browser tests, or evidence.

Release procedure: `python3 deploy/prepare.py`; `CLOUDFLARE_RELEASE=1 npm run build`; receipt validation; `WRANGLER_WRITE_LOGS=false node deploy/upload.mjs`; pinned Wrangler 4.136.2 CLI-help inspection and `wrangler deploy --config dist/server/cloudflare.json --dry-run --outdir .cloudflare/dry-release-18`; live deployment status check; deploy. All completed successfully. Prepare staged 340 files / 821.1 MiB. All eight large objects byte-identical to release 17 manifest (SHA256 `17a92b24584d61df334b6305da8b469ec03ac5cd50347fb688dec894895d95c5`); verified ignored receipts contain only eight content-addressed keys. Upload skipped all eight: zero R2 writes. No new DO migration.

The prebuild generator validated/staged all six explicitly recorded replay scenes and all three policies, zero recorded violations/failures, matching exact source commit. JSON 18,404,144 B, SHA256 `f395c041cac12b8cc392a092701b675be6af8876a011413feec25f5ff3bdccc8`; static receipt and built payload matched. No generated JSON or MP4 committed.

Dry run read 415 build files; Worker 6940.45 KiB / 1248.44 KiB gzip. Deployment uploaded 46 new assets, 341 already uploaded; startup 99 ms. New version `4e77562e-9dc4-4f76-890b-22bc188d8ed7`, created 04:11:45.252Z/deployed 04:11:47.436Z, confirmed 100%. Pre-deploy live rollback version `7b809dd0-7655-4192-b968-5eb35d83df40` (release 17) was confirmed 100%.

Production helper verification passed, sequentially:

- `SITE_BASE=https://mars-campus-2026.<workers-subdomain>.workers.dev ALL_ASSETS=1 node deploy/smoke.mjs`: 341 assets, 19 routes, GLB range and anonymous auth denial.
- `SIM_BASE=https://mars-campus-2026.<workers-subdomain>.workers.dev node deploy/simulation-integration.mjs`: all 36 MCP tools, replay/fork isolation, stale-plan and auth/method/prototype/body-limit checks.
- `node deploy/director-demo.mjs --base https://mars-campus-2026.<workers-subdomain>.workers.dev`: all 9 steps, 9105 ms.
- `WRANGLER_WRITE_LOGS=false ./node_modules/.bin/wrangler deployments status --name mars-campus-2026`: new version 100%.

Logs retained under `viewer/.cloudflare/*release-18.log`; HTTP audit `viewer/.cloudflare/audit/http-smoke.json`. Root owns production browser journeys, actual camera/build-bay entry proof, visual inspection, and global release/evidence records. No browser captures were inspected by this helper. Root `PROD_VERIFIED` received: published browser journeys 20/20 pass in 3.5 min. Actual compiled review entry passes paused-world follow/return/Continuous invariance, questioner, portrait, same-tick resets, disposal, zero diagnostics/errors, and hidden Jev/no provider requests. Build bay 10901 ticks/43 steps/5 checks/zero violations/errors, exact unchanged Node probe hash. Root personally inspected nine new production PNGs covering quick tour, chair carry/reseat, table carry/returned surface, replay, questioner/portrait, and supported bay. Root retained browser/camera/build-bay captures and audits. This report records the root's verification; this helper did not run or visually inspect those journeys.

Metadata links the quick-tour entry `/lab?scenario=classroom-4` and records physical chair/table movement in the release feature string. Root's source gate remains `b2928ef`; this metadata/report commit is not a new built deployment source. No extra deployment or tests after `PROD_VERIFIED`. No open helper failures.
