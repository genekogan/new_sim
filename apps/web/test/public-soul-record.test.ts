import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPublicRecord,PUBLIC_SOUL_PATH} from '../src/public-soul-record.ts';
test('reads the proposed eden-edge public record, bounded and tolerant',()=>{
 const r=readPublicRecord({contract:'eden-edge/1',fade:{colour:'yellow',idleSeconds:1900},lastAcceptedAt:1791400000000,self:{state:'seated',placePath:[{name:'Chair'},{name:'Commons'}]},
  receipts:Array.from({length:15},(_,i)=>({id:'r'+i,capability:'walk:x',label:'X',phase:'completed'})),
  events:[{id:'e1',kind:'speech',from:{name:'Rin'},text:'x'.repeat(900),untrusted:true},{id:'e2',kind:'arrival',soul:{name:'Ash'},placeId:'commons'},{id:'e3',kind:'future-kind',extra:1}],unknown:{a:1}});
 assert.ok(r);assert.equal(r!.fade?.colour,'yellow');assert.equal(r!.receipts.length,10);assert.equal(r!.events.length,3);assert.equal(r!.events[0].text!.length,500);
});
test('refuses non-edge bodies; path encodes the id',()=>{
 assert.equal(readPublicRecord({fade:{colour:'green'}}),null);assert.equal(readPublicRecord('<!doctype html>'),null);assert.equal(readPublicRecord(null),null);
 assert.equal(PUBLIC_SOUL_PATH('s_1/../x'),'/v1/edge/public/souls/s_1%2F..%2Fx');
});
import {readFileSync} from 'node:fs';
test('live Core 2c7f40b1 public read parses (fade null until C9, speech events, receipts)',()=>{
 const r=readPublicRecord(JSON.parse(readFileSync(new URL('./fixtures/edge-public-soul-2c7f40b1.json',import.meta.url),'utf8')));
 assert.ok(r);assert.equal(r!.fade,null);assert.equal(r!.receipts.length,1);assert.deepEqual(r!.events.map(e=>e.kind),['speech','speech']);assert.equal(r!.self?.placePath?.[0]?.name,'Green field');
});
