import {spawn} from 'node:child_process';
/** Reviewed exec isolation flags; account authentication remains inside the CLI.
 * No credential copy/symlink, user-config fallback, --last, tool approval or MCP merge.
 * Real adapter qualification is a separate Root gate; tests inject a fake executable.
 */
export const CODEX_CLIENT_GUARD=[...['shell_tool','unified_exec','shell_snapshot','hooks','apps','goals','multi_agent','multi_agent_v2','plugins','remote_plugin','memories','browser_use','browser_use_external','browser_use_full_cdp_access','computer_use','in_app_browser','image_generation','code_mode_host','workspace_dependencies','auth_elicitation','tool_suggest','skill_mcp_dependency_install','tool_call_mcp_elicitation'].flatMap(f=>['--disable',f]),'-c','web_search="disabled"','-c','tools.view_image=false','-c','project_doc_max_bytes=0','-c','mcp_servers={}','-c','sandbox_mode="read-only"'];
export function codexExecArgs({model,resumeId,effort}={}){return [...CODEX_CLIENT_GUARD,...(effort?['-c',`model_reasoning_effort=${JSON.stringify(effort)}`]:[]),'exec',...(resumeId?['resume',resumeId]:[]),'--ignore-user-config','--skip-git-repo-check','--json','--model',model,'-'];}
export function codexExecBrain({model,system,resumeId,stateless,effort,executable='codex',env=process.env,timeoutMs=120000,maxBytes=2097152,onProcess=()=>{}}={}){
 let thread=resumeId??null,proc=null,generation=0,cancel=null,closing=new Set();
 const kill=(child,signal)=>{if(child&&child.exitCode===null&&child.signalCode===null)try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
 const processEvent=(child,generation,status,extra={})=>{try{onProcess({pid:child.pid??null,pgid:process.platform==='win32'?null:child.pid??null,generation,session:thread,status,...extra});}catch{}};
 return {engine:'codex',get id(){return thread;},get isNew(){return stateless||!thread;},
  ask(text){
   if(proc)return Promise.reject(Error('codex turn already running'));
   if(thread&&!/^[A-Za-z0-9_-]{1,160}$/.test(thread))return Promise.reject(Error('invalid exact thread ID'));
   const resuming=!!thread&&!stateless,args=codexExecArgs({model,resumeId:resuming?thread:null,effort}),epoch=++generation;
   return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{env,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});proc=child;let processSession=resuming?thread:null;processEvent(child,epoch,'started',{session:processSession});let buffer='',answer='',usage=null,actualModel=null,tail='',problem=null,bytes=0,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(epoch===generation)cancel=null;error?reject(error):resolve(value);};
    const terminate=reason=>{problem=reason;kill(child,'SIGTERM');setTimeout(()=>kill(child,'SIGKILL'),1500).unref();finish(Error(reason));};
    const timer=setTimeout(()=>terminate('Codex turn exceeded bounded wall deadline'),timeoutMs);cancel=()=>terminate('Codex turn superseded');
    child.stdout.on('data',chunk=>{if(epoch!==generation||settled)return;bytes+=chunk.length;if(bytes>maxBytes){terminate('Codex stream exceeds byte bound');return;}buffer+=chunk;let cut;while((cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);let row;try{row=JSON.parse(line);}catch{continue;}
     if(row.item?.type==='error'){tail=(tail+'\nwarning: '+String(row.item.message??'')).slice(-500);continue;} // Codex >=0.16x reports config notices as item type "error"; real failures arrive as turn.failed / top-level error / exit code
     if(row.item?.type&&!['agent_message','reasoning'].includes(row.item.type)){terminate('Unexpected Codex tool/item type '+row.item.type);return;}
     if(row.type==='thread.started'&&typeof row.thread_id==='string'){thread=row.thread_id;processSession=row.thread_id;}
     if(row.type==='item.completed'&&row.item?.type==='agent_message')answer=row.item.text??answer;
     if(row.type==='turn.completed')usage=row.usage??null;
     actualModel=row.model??row.resolved_model??actualModel;
     if(row.type==='turn.failed'||row.type==='error')problem=String(row.error?.message??row.message??'Codex turn failed');
    }});
    child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){terminate('Codex stream exceeds byte bound');return;}tail=(tail+chunk).slice(-500);});
    child.once('error',error=>{processEvent(child,epoch,'spawn-error',{code:error.code??null,session:processSession});if(proc===child)proc=null;finish(error);});
    child.once('close',(code,signal)=>{processEvent(child,epoch,'exited',{code,signal,session:processSession});if(proc===child)proc=null;if(epoch!==generation){finish(Error('Codex turn superseded'));return;}if(code!==0||problem){finish(Error(problem??`Codex exited ${code}: ${tail.slice(-300)}`));return;}
     finish(null,{text:answer,model:actualModel,usage:{in:Number.isFinite(usage?.input_tokens)?Math.max(0,usage.input_tokens-(usage.cached_input_tokens??0)):null,read:usage?.cached_input_tokens??null,write:0,write1h:0,out:usage?.output_tokens??null,reasoning:usage?.reasoning_output_tokens??null},billing:{usd:null,source:'subscription-unknown'}});
     if(stateless)thread=null;
    });
    child.stdin.end(resuming?text:`${system}\n\n${text}`);
   });
  },
  close(){const child=proc;if(child){const wait=new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});cancel?.();generation++;proc=null;cancel=null;closing.add(wait);wait.finally(()=>closing.delete(wait));}return Promise.all([...closing]);},
  fresh(){this.close();thread=null;},
 };
}
