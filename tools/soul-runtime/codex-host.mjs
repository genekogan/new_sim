// Owned stdio Codex session. It exposes lifecycle facts; no Soul decisions or
// world writes occur here. A turn finishing is not completion of a Soul goal.
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';

const fault=(code,message)=>Object.assign(Error(message),{code});
const input=text=>[{type:'text',text}];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const GROUP_REAP_POLLS=200,GROUP_REAP_POLL_MS=25;
const probeErrorCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value)?value:'UNKNOWN';
const threadName=value=>{if(value===null)return null;if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value))throw fault('HOST_INVALID_NAME','Thread name must be readable text of1..200characters');return value.trim();};
const booleanOption=(name,value)=>{if(typeof value!=='boolean')throw fault('HOST_INVALID_OPTION',name+' must be boolean');return value;};
export class CodexHost extends EventEmitter {
  constructor({cwd,model=null,effort='low',command='codex',args=['app-server','--listen','stdio://'],requestTimeoutMs=30000,spawnProcess=spawn,killProcess=process.kill,ephemeral=false,name=null,internalProbe=false}={}) {
    super();this.cwd=cwd;this.model=model;this.effort=effort;this.requestTimeoutMs=requestTimeoutMs;
    this.ephemeral=booleanOption('ephemeral',ephemeral);this.name=threadName(name);this.internalProbe=booleanOption('internalProbe',internalProbe);this.killProcess=killProcess;
    this.connected=false;this.connecting=false;this.archiving=null;this.archived=false;
    this.pending=new Map();this.turns=new Map();this.sequence=0;this.threadId=null;this.activeTurnId=null;this.closed=false;this.closing=false;this.buffer='';
    this.child=spawnProcess(command,args,{cwd,stdio:['pipe','pipe','pipe'],detached:true});
    this.pid=this.child.pid;this.exit=new Promise(resolve=>{
      this.child.once('exit',(code,signal)=>{this.exitStatus={code,signal};this.fail(fault('HOST_EXITED','Codex host exited'));resolve(this.exitStatus)});
      this.child.once('error',e=>{this.exitStatus={code:null,signal:null,startFailed:true};this.fail(fault('HOST_START_FAILED',e.message));resolve(this.exitStatus);});
    });
    this.child.stdin.on('error',e=>this.fail(fault('HOST_INPUT_FAILED',e.message)));
    // Never copy arbitrary host stderr (which can contain config/auth details)
    // into Soul context or diagnostic artifacts.
    this.child.stderr.on('data',()=>{});
    this.child.stdout.on('data',data=>{
      this.buffer+=data.toString();
      if(Buffer.byteLength(this.buffer)>8*1024*1024){this.fail(fault('HOST_PROTOCOL','Host line exceeded bound'));return;}
      let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(line.trim())this.receive(line);}
    });
  }
  fail(error){
    if(this.closed)return;this.closed=true;this.failure=error;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();
    for(const t of this.turns.values())if(!t.terminal){t.terminal=true;t.reject(error);}
    this.emit('fault',error);
  }
  send(message){if(this.closed)throw this.failure??fault('HOST_CLOSED','Host is closed');this.child.stdin.write(JSON.stringify(message)+'\n');}
  request(method,params){
    if(this.closed)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{
        // Timeout is ambiguous: do not replay turn/start or steer into a host
        // that may already have accepted it. Caller must close and reconcile.
        this.fail(fault('HOST_REQUEST_TIMEOUT',`Host request timed out: ${method}`));
      },this.requestTimeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  turnRecord(id){
    let t=this.turns.get(id);if(t)return t;
    let resolve,reject;const completed=new Promise((a,b)=>{resolve=a;reject=b});completed.catch(()=>{});
    t={id,text:[],characters:0,terminal:false,completed,resolve,reject};this.turns.set(id,t);return t;
  }
  receive(line){
    let m;try{m=JSON.parse(line)}catch{this.fail(fault('HOST_PROTOCOL','Malformed host JSON'));return;}
    if(m.id!==undefined&&this.pending.has(m.id)){
      const p=this.pending.get(m.id);clearTimeout(p.timer);this.pending.delete(m.id);
      if(m.error)p.reject(Object.assign(Error(m.error.message??'Host request refused'),{code:m.error.code,data:m.error.data}));else p.resolve(m.result);return;
    }
    if(m.id!==undefined&&m.method){
      // This adapter doesn't grant tools/permissions or wait for a human.
      try{this.send({id:m.id,error:{code:-32601,message:'No tool or approval handler in Soul decision adapter'}})}catch{}
      this.emit('unsupportedRequest',{method:m.method});return;
    }
    const p=m.params??{};
    if(p.threadId&&this.threadId&&p.threadId!==this.threadId)return;
    if(m.method==='turn/started'){
      const id=p.turn?.id;if(!id)return;
      if(this.activeTurnId&&this.activeTurnId!==id){this.fail(fault('HOST_OVERLAPPING_TURNS','Host started a second decision turn'));return;}
      this.activeTurnId=id;this.turnRecord(id);
    }else if(m.method==='item/completed'&&p.item?.type==='agentMessage'&&p.turnId){
      const t=this.turnRecord(p.turnId),text=p.item.text??'';t.characters+=text.length;
      if(t.characters>512*1024){this.fail(fault('HOST_OUTPUT_LIMIT','Decision output exceeded bound'));return;}
      t.text.push(text);
    }else if(m.method==='turn/completed'&&p.turn?.id){
      const t=this.turnRecord(p.turn.id);t.terminal=true;t.result={turnId:t.id,status:p.turn.status,error:p.turn.error??null,text:t.text.join('\n')};
      if(this.activeTurnId===t.id)this.activeTurnId=null;t.resolve(t.result);
      // Keep a small recent window for acknowledgement/completion races.
      for(const [id,old] of this.turns){if(this.turns.size<=32)break;if(old.terminal&&id!==t.id)this.turns.delete(id);}
    }
    if(['turn/started','turn/completed','item/started','item/completed','thread/tokenUsage/updated','thread/name/updated','thread/archived','error'].includes(m.method))this.emit('event',{method:m.method,params:p,receivedAt:Date.now()});
  }
  async connect({threadId=null,instructions='',baseInstructions=null,config={},ephemeral=this.ephemeral,name=this.name}={}){
    ephemeral=booleanOption('ephemeral',ephemeral);name=threadName(name);
    if(threadId!==null&&(typeof threadId!=='string'||!threadId))throw fault('HOST_INVALID_THREAD','Resume needs a nonempty thread ID');
    // Ephemeral work has no persistent history to resume. Never reinterpret a
    // retained durable thread ID as permission to drop or replace its history.
    if(ephemeral&&threadId!==null)throw fault('HOST_EPHEMERAL_RESUME','Ephemeral mode cannot resume a retained thread');
    if(this.connecting||this.connected||this.threadId)throw fault('HOST_ALREADY_CONNECTED','Host already has a thread connection');
    this.connecting=true;this.ephemeral=ephemeral;this.name=name;
    try{
    this.emit('lifecycle',{state:'host-started',hostPid:this.pid??null,cwd:this.cwd});
    await this.request('initialize',{clientInfo:{name:'sim_soul_continuity',version:'0.1.0'}});this.send({method:'initialized',params:{}});
    if(!this.model){
      const listed=await this.request('model/list',{});
      this.model=listed.data?.find(m=>m.isDefault)?.model;
      if(!this.model)throw fault('HOST_MODEL_UNAVAILABLE','Host did not advertise a default model');
    }
    const params={cwd:this.cwd,model:this.model,approvalPolicy:'never',sandbox:'read-only',developerInstructions:instructions,...(baseInstructions?{baseInstructions}:{}),config};
    const r=await this.request(threadId?'thread/resume':'thread/start',threadId?{...params,threadId}:{...params,ephemeral});
    this.threadId=r.thread.id;
    // Publish ownership as soon as the authoritative ID exists, even if naming
    // or the supervisor's first world observation subsequently fails.
    this.emit('lifecycle',{state:'session-created',threadId:this.threadId,hostPid:this.pid??null,cwd:this.cwd,ephemeral,resumed:threadId!==null});
    // Installed app-server refuses metadata updates for ephemeral threads. Keep
    // their readable name in local lifecycle evidence, without a persistence fallback.
    if(name!==null&&!ephemeral)await this.request('thread/name/set',{threadId:this.threadId,name});
    this.connected=true;return {threadId:this.threadId,model:r.model??this.model,ephemeral,name};
    }finally{this.connecting=false;}
  }
  async begin(text,{outputSchema}={}){
    if(this.archiving||this.archived)throw fault('HOST_ARCHIVED','Thread is being archived or already archived');
    if(!this.connected)throw fault('HOST_NOT_CONNECTED','Await thread connection and naming before starting a turn');
    if(this.activeTurnId||this.starting)throw fault('HOST_BUSY','A decision turn is already active');
    this.starting=true;
    try{
      const r=await this.request('turn/start',{threadId:this.threadId,input:input(text),effort:this.effort,...(outputSchema?{outputSchema}:{})});
      const t=this.turnRecord(r.turn.id);if(!t.terminal)this.activeTurnId=t.id;
      return {turnId:t.id,completed:t.completed};
    }finally{this.starting=false;}
  }
  async steer(text,expectedTurnId=this.activeTurnId){
    if(!expectedTurnId)throw fault('HOST_IDLE','No active turn to steer');
    return this.request('turn/steer',{threadId:this.threadId,expectedTurnId,input:input(text)});
  }
  async interrupt(expectedTurnId=this.activeTurnId){
    const turnId=expectedTurnId;if(!turnId)return {status:'idle'};
    if(turnId!==this.activeTurnId)throw fault('HOST_TURN_MISMATCH','Interrupt target differs from the active turn');
    const turn=this.turnRecord(turnId);
    await this.request('turn/interrupt',{threadId:this.threadId,turnId});
    return turn.completed;
  }
  // Caller must establish terminal *run* completion and ownership separately;
  // model-turn completion, routine close, and recovery never trigger archival.
  async archiveCompleted({expectedThreadId=this.threadId}={}){
    if(!this.internalProbe)throw fault('HOST_ARCHIVE_NOT_OWNED','Archival requires an explicitly owned internal probe host');
    if(!this.connected||!this.threadId)throw fault('HOST_NOT_CONNECTED','No connected thread to archive');
    if(expectedThreadId!==this.threadId)throw fault('HOST_THREAD_MISMATCH','Archive target differs from this host thread');
    if(this.activeTurnId||this.starting)throw fault('HOST_BUSY','Cannot archive an active or starting turn');
    if(this.archived)return {threadId:this.threadId,archived:true,alreadyArchived:true};
    if(this.ephemeral)return {threadId:this.threadId,archived:false,ephemeral:true};
    if(this.archiving)return this.archiving;
    this.archiving=this.request('thread/archive',{threadId:this.threadId}).then(()=>{this.archived=true;return {threadId:this.threadId,archived:true};}).finally(()=>{this.archiving=null;});
    return this.archiving;
  }
  async close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      this.child.stdin.end();
      await Promise.race([this.exit,delay(1000)]);
      // Owned process group can outlive its parent; always clean the group.
      if(this.pid){
        try{this.killProcess(-this.pid,'SIGTERM')}catch{}
        await Promise.race([this.exit,delay(1000)]);
        try{this.killProcess(-this.pid,'SIGKILL')}catch{}
        await Promise.race([this.exit,delay(1000)]);
      }
      let groupClosed=this.exitStatus?.startFailed===true&&!this.pid;
      let groupProbeCount=0,groupProbeFirstErrorCode=null,groupProbeLastErrorCode=null;
      const groupProbeStarted=performance.now();
      // A leader's exit can precede descendant reaping. Keep the existing
      // bounded probe budget after cleanup signals. A transient probe error
      // remains unknown and may recover; only actual ESRCH establishes absence.
      if(this.pid)for(let n=0;n<GROUP_REAP_POLLS;n++){
        groupProbeCount++;
        try{this.killProcess(-this.pid,0);}catch(e){
          const code=probeErrorCode(e?.code);
          groupProbeFirstErrorCode??=code;groupProbeLastErrorCode=code;
          if(e?.code==='ESRCH'){groupClosed=true;break;}
        }
        await delay(GROUP_REAP_POLL_MS);
      }
      // Codes include the expected ESRCH absence result; never retain arbitrary
      // error messages or error properties in lifecycle/cleanup evidence.
      const groupProbeElapsedMs=Math.round(performance.now()-groupProbeStarted);
      this.closeProof={...this.exitStatus,hostPid:this.pid??null,threadId:this.threadId,groupClosed,groupVerification:groupClosed?'absent':'unverified',groupProbeCount,groupProbeElapsedMs,groupProbeFirstErrorCode,groupProbeLastErrorCode};
      this.emit('lifecycle',{state:'host-closed',...this.closeProof});
      return this.closeProof;
    })();return this.closing;
  }
}
