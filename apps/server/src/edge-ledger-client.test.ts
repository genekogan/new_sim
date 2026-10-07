// Viewer client receives EDGE-CONTRACT-v1 §7 spectator messages ({type:'edge'}) via onEdge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Connection} from '../../../packages/client/src/index.ts';
class Socket{readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;sent:string[]=[];send(s:string){this.sent.push(s);}close(){}message(m:unknown){this.onmessage({data:JSON.stringify(m)});}}
test('client forwards edge spectator messages and still ignores other untyped frames',async()=>{
 const sockets:Socket[]=[],edge:any[]=[];const c=new Connection('ws://fixture',async()=>null,{onEdge:m=>edge.push(m)},()=>{const s=new Socket();sockets.push(s);return s;},()=>1000,()=>100);c.connect();await new Promise(r=>setTimeout(r,0));
 const s=sockets[0];s.message({type:'edge',kind:'speech',tick:5,at:1,text:'hi'});s.message({kind:'speech'});
 assert.deepEqual(edge.map(m=>[m.kind,m.text]),[['speech','hi']]);
});
