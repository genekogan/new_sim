import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync,symlinkSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {manifest} from '../world-launcher/deploy/release-manifest.mjs';
const script=new URL('../world-launcher/deploy/release.sh',import.meta.url);
const verifier=new URL('../world-launcher/deploy/release-manifest.mjs',import.meta.url).pathname;
function fixture(t){const root=mkdtempSync(join(tmpdir(),'sim-release-safe-'));t.after(()=>{const trash=join(homedir(),'.Trash');mkdirSync(trash,{recursive:true});renameSync(root,join(trash,root.split('/').at(-1)+'-'+Date.now()));});writeFileSync(join(root,'BUILD'),'we-123456789abc\n');mkdirSync(join(root,'app'));writeFileSync(join(root,'app','main.js'),'export const version=1;\n');symlinkSync('app/main.js',join(root,'main'));return root;}
function seal(root){const path=join(root,'RELEASE-MANIFEST.json');writeFileSync(path,JSON.stringify(manifest(root))+'\n');return path;}
function verify(root,path){return spawnSync(process.execPath,[verifier,'verify',root,path],{encoding:'utf8'});}
test('release recipe retains remote/local releases and refuses unverified same-build uploads',()=>{
  const source=readFileSync(script,'utf8');
  assert.doesNotMatch(source,/\brm\s+-|--delete|prune-local\.sh/,'shipping must not delete or invoke automatic retention');
  assert.match(source,/trash_existing "\$OUT"/);
  assert.match(source,/REMOTE_STATE.*MANIFEST_SHA/);
  assert.match(source,/node --input-type=module - verify/);
  assert.match(source,/elif \[ "\$REMOTE_STATE" = fresh \]/);
  assert.match(source,/refusing to overwrite nonempty/);
  assert.equal(spawnSync('bash',['-n',script.pathname]).status,0);
});
test('same-build manifest permits installed dependencies but detects extra or changed artifacts',t=>{
  const root=fixture(t), path=seal(root);assert.equal(verify(root,path).status,0);
  mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'node_modules','installed'),'Linux dependencies');assert.equal(verify(root,path).status,0);
  writeFileSync(join(root,'unexpected.js'),'stale code');assert.notEqual(verify(root,path).status,0);
  renameSync(join(root,'unexpected.js'),join(root,'node_modules','retained-extra'));
  writeFileSync(join(root,'app','main.js'),'export const version=2;\n');assert.notEqual(verify(root,path).status,0);
});
test('same-build manifest detects missing files, symlink changes and executable changes',t=>{
  const root=fixture(t),path=seal(root);
  renameSync(join(root,'main'),join(root,'old-main'));symlinkSync('BUILD',join(root,'main'));assert.notEqual(verify(root,path).status,0);
  const second=fixture(t),secondPath=seal(second);chmodSync(join(second,'app','main.js'),0o755);assert.notEqual(verify(second,secondPath).status,0);
  const third=fixture(t),thirdPath=seal(third);mkdirSync(join(third,'node_modules'));renameSync(join(third,'app','main.js'),join(third,'node_modules','retained-main'));assert.notEqual(verify(third,thirdPath).status,0);
});

test('upload branch permits fresh destinations, verifies exact reuse, and refuses occupied or altered trees', t => {
  const root=fixture(t),bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'ssh'),'#!/bin/sh\nshift\nexec bash -c "$1"\n',{mode:0o755});
  writeFileSync(join(bin,'rsync'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$MOCK_UPLOAD_LOG"\n',{mode:0o755});
  const source=readFileSync(script,'utf8'), fragment=source.slice(source.indexOf('MANIFEST_SHA='),source.indexOf('echo "== install'));
  const out=fixture(t);seal(out);
  const run=(label,rel)=>{const log=join(root,label+'.upload');const result=spawnSync('bash',['-euo','pipefail','-c',fragment],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,ROOT:resolve(script.pathname,'../../../..'),OUT:out,REL:rel,RELROOT:root,HOST:'fake',PREV:'',MOCK_UPLOAD_LOG:log}});return {...result,uploaded:existsSync(log)};};
  const fresh=run('fresh',join(root,'new-release'));assert.equal(fresh.status,0,fresh.stderr);assert.equal(fresh.uploaded,true);
  const exact=run('exact',out);assert.equal(exact.status,0,exact.stderr);assert.equal(exact.uploaded,false);assert.match(exact.stdout,/exactly matches/);
  const occupied=fixture(t),unverified=run('unverified',occupied);assert.notEqual(unverified.status,0);assert.equal(unverified.uploaded,false);
  writeFileSync(join(out,'stale-code.js'),'extra');const altered=run('altered',out);assert.notEqual(altered.status,0);assert.equal(altered.uploaded,false);assert.ok(existsSync(join(out,'stale-code.js')),'failed reuse retains unexpected files');
});

test('local rebuild preserves the prior artifact in unique Trash rather than deleting it',t=>{
  const root=fixture(t),artifact=join(root,'old-build');mkdirSync(artifact);writeFileSync(join(artifact,'proof'),'preserve me');
  const source=readFileSync(script,'utf8'),move=source.slice(source.indexOf('trash_existing() {'),source.indexOf('echo "== assemble'));
  const result=spawnSync('bash',['-euo','pipefail','-c',move+'\ntrash_existing "$TASK_LOCAL_ARTIFACT"'],{encoding:'utf8',env:{...process.env,TASK_LOCAL_ARTIFACT:artifact}});
  assert.equal(result.status,0,result.stderr);assert.equal(existsSync(artifact),false);
  const destination=result.stdout.trim().split('retained previous local artifact in ')[1];
  assert.ok(destination.startsWith(join(homedir(),'.Trash','sim-release.')));
  assert.equal(readFileSync(join(destination,'old-build','proof'),'utf8'),'preserve me');
});
