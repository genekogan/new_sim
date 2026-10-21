// Judge the V7 walk reports. node v7-receipt.mjs <outDir> <root> <rcOld> <rcNew> <rcGod> <rcApprove> <rcWindow>  → v7-receipt.json, exit 0 only on pass.
// god = the God modal e2e (tools/god-skill/e2e/launcher.mjs, <outDir>/god/report.json): every one of its checks must be there and pass.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {resolve} from 'node:path';
// approve = lane HF's approval-link walk (tools/god-skill/e2e/approve-on-top.mjs, <outDir>/approve/report.json): the god opens
// #approve/<id> in Clerk mode and the approval stays on top through the whole load; every scenario must be there and pass.
export const APPROVE_SCENARIOS=['desktop-dpr1-returning-god','desktop-dpr2-new-god-intro','phone-dpr3-returning-god','desktop-dpr1-close','desktop-dpr1-link-approve'];
// window = lane PUX's in-window walk (tools/god-skill/e2e/approve-in-window.mjs, <outDir>/window/report.json): the agent's request
// (create-soul --for CODE) comes up top right in the open window; Approve, Ask again, Refuse, one sounding tab.
export const WINDOW_CHECKS=['A1','A2','A3','A4','A5a','A5','A6','A7','A8','A8b','A10','A9','B1','B2','B3','B4','B5','C1','C2','C3','D1'];
export const GOD_CHECKS=['A1','A2','A3','A4','B1','C1','D1','D2','E1','F1','G1','G2','G3','G4','G5','H1','Z'];
export function judge({old,fresh,god,approve,window:win,rcOld=0,rcNew=0,rcGod=0,rcApprove=0,rcWindow=0}){
  const checks=[];const add=(id,ok,detail)=>checks.push({id,ok:!!ok,detail});
  add('walk-old exit',rcOld===0,`rc=${rcOld}`);add('walk-new exit',rcNew===0,`rc=${rcNew}`);
  const worlds=['eden','mars','littlemartians'];
  for(const dpr of [1,2])for(const w of worlds){
    const r=(old||[]).find(x=>x.world===w&&x.dpr===dpr);const id=`old ${w} dpr${dpr}`;
    if(!r){add(id,false,'no run');continue;}
    const g=r.geometry||{},buf=g.buffer,css=g.canvasCss;
    add(`${id} arrived`,r.ui?.revealed==='true'&&!r.ui?.arrival,JSON.stringify({revealed:r.ui?.revealed,arrival:r.ui?.arrival}));
    add(`${id} canvas dpr`,css&&buf&&buf[0]>=css[0]*dpr*0.9,JSON.stringify({css,buf}));
    add(`${id} no page errors`,(r.errors||[]).length===0,(r.errors||[]).join(' | ').slice(0,300));
    const moved=Object.values(r.input||{}).filter(Boolean).length;add(`${id} input moves camera`,moved>=2,`${moved}/4 ${JSON.stringify(r.input)}`);
  }
  for(const dpr of [1,2]){
    const r=(fresh?.runs||[]).find(x=>x.dpr===dpr);const id=`new-world dpr${dpr}`;
    if(!r){add(id,false,'no run');continue;}
    if(dpr===1)add(`${id} created`,/\/worlds\/w\//.test(r.created||''),r.created);
    add(`${id} arrived`,r.geometry?.canvasCss&&r.geometry.canvasCss[0]>300,JSON.stringify(r.geometry));
    add(`${id} no 4xx/page errors`,(r.errors||[]).length===0,(r.errors||[]).join(' | ').slice(0,300));
    add(`${id} input moves camera`,Object.values(r.input||{}).filter(v=>v===true).length>=2,JSON.stringify(r.input));
    add(`${id} join line`,r.joinLine&&!/not visible/.test(r.joinLine),String(r.joinLine).slice(0,100));
  }
  add('god-modal exit',rcGod===0,`rc=${rcGod}`);
  for(const id of GOD_CHECKS){const s=(god?.steps||[]).find(x=>x.name.split(' ')[0]===id);add(`god-modal ${id}`,s?.ok,s?s.name:'no such check');}
  add('approve-on-top exit',rcApprove===0,`rc=${rcApprove}`);
  for(const id of APPROVE_SCENARIOS){const s=(approve?.scenarios||[]).find(x=>x.name===id);add(`approve-on-top ${id}`,s?.ok,s?JSON.stringify({firstAt:s.firstAt,lapses:s.lapses,onTop:s.end?.onTop,status:s.end?.status}):'no such scenario');}
  add('approve-in-window exit',rcWindow===0,`rc=${rcWindow}`);
  for(const id of WINDOW_CHECKS){const s=(win?.steps||[]).find(x=>x.name.split(' ')[0]===id);add(`approve-in-window ${id}`,s?.ok,s?s.name:'no such check');}
  return {status:checks.every(c=>c.ok)?'pass':'fail',checks};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const [out,root,rcOld,rcNew,rcGod,rcApprove,rcWindow]=process.argv.slice(2);const rd=p=>existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null;
  const j=judge({old:rd(resolve(out,'old/report.json')),fresh:rd(resolve(out,'new/report.json')),god:rd(resolve(out,'god/report.json')),approve:rd(resolve(out,'approve/report.json')),window:rd(resolve(out,'window/report.json')),rcOld:Number(rcOld),rcNew:Number(rcNew),rcGod:Number(rcGod??1),rcApprove:Number(rcApprove??1),rcWindow:Number(rcWindow??1)});
  const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const dirty=execFileSync('git',['-C',root,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='';
  const receipt={schemaVersion:1,step:'V7',source:sha,dirty,at:new Date().toISOString(),ports:'5870-5879',...j,failed:j.checks.filter(c=>!c.ok).map(c=>c.id)};
  writeFileSync(resolve(out,'v7-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(`RELEASE_GATE_V7 ${receipt.status.toUpperCase()} source=${sha} checks=${j.checks.length} failed=${receipt.failed.length} receipt=${resolve(out,'v7-receipt.json')}`);
  process.exitCode=receipt.status==='pass'?0:1;
}
