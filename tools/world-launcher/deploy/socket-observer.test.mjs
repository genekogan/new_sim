import test from 'node:test';
import assert from 'node:assert/strict';
import {recordWorldSockets} from './socket-observer.mjs';

function fixture(t,url='wss://fixture/ws'){
 class Socket extends EventTarget{
  wire=[];send(data){this.wire.push(data);}
  emit(type,fields={}){this.dispatchEvent(Object.assign(new Event(type),fields));}
 }
 const prior=globalThis.window;globalThis.window={WebSocket:Socket,top:{}};t.after(()=>{globalThis.window=prior;});
 recordWorldSockets();const socket=new window.WebSocket(url);return{socket,record:window.__z1ws[0]};
}
test('observer preserves send and stores only safe outbound types, not credentials or payloads',t=>{
 const{socket,record}=fixture(t),hello=JSON.stringify({t:'hello',token:'fixture-secret-not-retained',proto:1});socket.send(hello);socket.send(JSON.stringify({t:'unknown-private-kind',payload:'fixture-private-data'}));
 assert.deepEqual(socket.wire,[hello,JSON.stringify({t:'unknown-private-kind',payload:'fixture-private-data'})]);
 assert.deepEqual(record.sent.map(x=>x.type),['hello','other']);assert.doesNotMatch(JSON.stringify(record),/fixture-secret|private-data|unknown-private-kind/);
});
test('observer records server close reason and welcome timing without retaining welcome payload',t=>{
 const{socket,record}=fixture(t);socket.emit('open');socket.emit('message',{data:'{"t":"welcome","build":"fixture-build","you":{"private":"never retained"}}'});socket.emit('close',{code:1008,reason:'too many messages'});
 assert.equal(record.code,1008);assert.equal(record.reason,'too many messages');assert.equal(record.build,'fixture-build');assert.ok(record.first>=record.open);assert.ok(record.close>=record.first);assert.doesNotMatch(JSON.stringify(record),/never retained/);
});
test('observer bounds outbound history at50 entries and handles binary messages',t=>{
 const{socket,record}=fixture(t);for(let n=0;n<75;n++)socket.send(JSON.stringify({t:'ping',n}));socket.send(new Uint8Array([1,2,3]));
 assert.equal(record.sent.length,50);assert.equal(record.sent.at(-1).type,'other');assert.equal(socket.wire.length,76);
});

test('observer retains hello presence but strips query values and ignores nonworld sockets',t=>{
 const{record}=fixture(t,'wss://fixture/ws?hello='+encodeURIComponent('{"token":"fixture-secret"}')+'&key=private-value');
 assert.equal(record.urlHello,true);assert.equal(record.url,'wss://fixture/ws?hello=present');assert.doesNotMatch(JSON.stringify(record),/fixture-secret|private-value/);
 new window.WebSocket('wss://unrelated/session?token=fixture-secret');assert.equal(window.__z1ws.length,1);
});
