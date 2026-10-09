import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ActionOutcomes,type OutcomeSnapshot} from './edge/outcomes/store.ts';
import {resolveMailRecipient} from './edge/outcomes/recipients.ts';
import type {EdgeReceipt} from './edge/contract.ts';
const snapshot=():OutcomeSnapshot=>({worldId:'test-world',tick:20,place:'field',placePath:['field'],pos:[1,2],walkable:['field'],sections:[],materials:[]});
const receipt=(id:string):EdgeReceipt=>({id,soulId:'sender',capability:'post-letter:mailbox',phase:'completed',acceptedTick:1,startedTick:2,endedTick:20,code:null,reason:null,programId:'owned-programme'});
void test('mail recipients are same-world canonical identities or exact unambiguous names, never guesses',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE souls(id TEXT,name TEXT,world_id TEXT,retired_at INTEGER)');const add=db.prepare('INSERT INTO souls VALUES(?,?,?,?)');add.run('s_a','Avery','test-world',null);add.run('s_b','Same Name','test-world',null);add.run('s_c','Same Name','test-world',null);add.run('s_x','Avery','other-world',null);add.run('s_retired','Former','test-world',1);
  assert.deepEqual(resolveMailRecipient(db,'test-world',' s_a '),{soulId:'s_a',name:'Avery'});assert.deepEqual(resolveMailRecipient(db,'test-world','avery'),{soulId:'s_a',name:'Avery'});assert.equal((resolveMailRecipient(db,'test-world','same name') as {code:string}).code,'recipient.ambiguous');for(const value of ['Aver','s_x','Former'])assert.equal((resolveMailRecipient(db,'test-world',value) as {code:string}).code,'recipient.unknown');
 }finally{db.close();}
});
void test('addressed private postbox identity persists, unauthorized peers cannot read it, notification retries atomically and once',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'test-world'),r=receipt('addressed');try{store.capture(r.id,{soulId:r.soulId,capability:r.capability,params:{to:'recipient',recipientName:'Avery',title:'Private title',text:'Private recipient text.'},acceptedTick:1});const outcome=store.terminal(r,snapshot())!,id=outcome.produced[0].id;assert.equal(outcome.produced[0].visibility,'participants');assert.equal(store.mail('unrelated',id),null);assert.equal(store.artifact('recipient',id)?.text,'Private recipient text.');assert.equal(store.mailbox('unrelated').length,0);assert.equal(new ActionOutcomes(db,'test-world').mail('recipient',id)?.status,'delivered');assert.equal(outcome.untrusted,true);assert.equal((outcome.detail.mail as {courierPhysics:boolean}).courierPhysics,false);assert.deepEqual(outcome.met,[],'receiving mail never invents an encounter');
  assert.throws(()=>store.deliverMail(()=>{throw Error('owned delivery fault');}),/delivery fault/);let calls=0;store.deliverMail((to,tick,body)=>{calls++;assert.equal(to,'recipient');assert.equal(tick,20);assert.deepEqual(body.where,{});assert.equal('from'in body,false,'sender private position cannot be enriched from a public from tag');assert.equal(body.untrusted,true);});assert.equal(store.deliverMail(()=>calls++),0);assert.equal(calls,1);assert.deepEqual(store.terminal(r,{...snapshot(),tick:200}),outcome);
 }finally{db.close();}
});
void test('unaddressed post-letter stays a private draft and terminal effect facts cannot be revised by a later replay',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'test-world'),r=receipt('draft');try{store.capture(r.id,{soulId:r.soulId,capability:r.capability,params:{text:'Draft only.'},acceptedTick:1});const change={id:'item_a',kind:'item-acquired',summary:'An actual item ledger update.',source:'ledger-item:item_a:r_effect'},effect={changed:[change],met:[{soulId:'peer',name:'Peer',placeId:'field'}],untrusted:true};const base=store.terminal(r,snapshot(),effect)!;assert.equal(base.produced[0].kind,'letter-draft');assert.equal(store.mailbox('sender').length,0);assert.equal(store.deliverMail(()=>assert.fail()),0);
  const second=store.terminal(r,{...snapshot(),tick:900},{summary:'Changed current world',changed:[],met:[{soulId:'someone-else',name:'Other',placeId:'elsewhere'}]})!;assert.deepEqual(second,base);assert.equal(second.changed.length,1);assert.equal(second.met.length,1);assert.equal(second.untrusted,true);
 }finally{db.close();}
});
