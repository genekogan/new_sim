// Owned stdio Codex session. It exposes lifecycle facts; no Soul decisions or
// world writes occur here. A turn finishing is not completion of a Soul goal.
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';

const fault=(code,message)=>Object.assign(Error(message),{code});
const input=text=>[{type:'text',text}];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class CodexHost extends EventEmitter {
  constructor({cwd,model=null,effort='low',command='codex',args=['app-server','--listen','stdio://'],requestTimeoutMs=30000,spawnProcess=spawn}={}) {
    super();this.cwd=cwd;this.model=model;this.effort=effort;this.requestTimeoutMs=requestTimeoutMs;
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
    if(['turn/started','turn/completed','item/started','item/completed','thread/tokenUsage/updated'].includes(m.method))this.emit('event',{method:m.method,params:p,receivedAt:Date.now()});
  }
  async connect({threadId=null,instructions='',baseInstructions=null,config={}}={}){
    await this.request('initialize',{clientInfo:{name:'sim_soul_continuity',version:'0.1.0'}});this.send({method:'initialized',params:{}});
    if(!this.model){
      const listed=await this.request('model/list',{});
      this.model=listed.data?.find(m=>m.isDefault)?.model;
      if(!this.model)throw fault('HOST_MODEL_UNAVAILABLE','Host did not advertise a default model');
    }
    const params={cwd:this.cwd,model:this.model,approvalPolicy:'never',sandbox:'read-only',developerInstructions:instructions,...(baseInstructions?{baseInstructions}:{}),config};
    const r=await this.request(threadId?'thread/resume':'thread/start',threadId?{...params,threadId}:{...params,ephemeral:false});
    this.threadId=r.thread.id;return {threadId:this.threadId,model:r.model??this.model};
  }
  async begin(text,{outputSchema}={}){
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
  async interrupt(){
    const turnId=this.activeTurnId;if(!turnId)return {status:'idle'};
    await this.request('turn/interrupt',{threadId:this.threadId,turnId});
    return this.turnRecord(turnId).completed;
  }
  async close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      this.child.stdin.end();
      await Promise.race([this.exit,delay(1000)]);
      // Owned process group can outlive its parent; always clean the group.
      if(this.pid){
        try{process.kill(-this.pid,'SIGTERM')}catch{}
        await Promise.race([this.exit,delay(1000)]);
        try{process.kill(-this.pid,'SIGKILL')}catch{}
        await Promise.race([this.exit,delay(1000)]);
      }
      return this.exitStatus;
    })();return this.closing;
  }
}
