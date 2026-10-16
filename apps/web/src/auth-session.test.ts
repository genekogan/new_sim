import test from 'node:test';
import assert from 'node:assert/strict';
import type {Session} from './auth-session.ts';

test('same-label account changes invalidate private subscribers while token refreshes do not', async () => {
  const locationBefore = Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{pathname:'/w/test'}});
  const {publishSession,session,watchSession}=await import('./auth-session.ts');
  const original = session();
  const base: Session = {mode:'clerk',ready:true,authed:true,label:'Same label',scope:'account-one',getToken:async()=>null,login(){},logout(){}};
  publishSession(base);
  let changes=0; const unwatch=watchSession(()=>changes++);
  try {
    publishSession({...base,getToken:async()=>null}); assert.equal(changes,0);
    publishSession({...base,scope:'account-two'}); assert.equal(changes,1);
    publishSession({...base,scope:null,authed:false}); assert.equal(changes,2);
  } finally { unwatch(); publishSession(original); if(locationBefore)Object.defineProperty(globalThis,'location',locationBefore);else Reflect.deleteProperty(globalThis,'location'); }
});
