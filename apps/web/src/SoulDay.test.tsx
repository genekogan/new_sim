// OWNER-DAY: the "Today" list reads plainly (did / said / refused with the world's reason) and each placed entry
// moves the camera via the look-at event.
import test from 'node:test';import assert from 'node:assert/strict';import {renderToStaticMarkup} from 'react-dom/server';
import {DayList,daySummary,type DayEntry} from './SoulDay.tsx';
import {requestLookAt,onLookAtRequest} from './look-at-request.ts';

const t0=new Date(2026,9,23,9,5).getTime();
const day:DayEntry[]=[
 {at:t0,kind:'did',text:'walked to the bakery',where:{x:10,z:-4},place:'Bakery'},
 {at:t0+60_000,kind:'said',text:'Good morning!',where:{x:10,z:-4}},
 {at:t0+120_000,kind:'refused',text:'tried: swam the fountain',code:'not-here',reason:'There is no water to swim in here.',where:{x:12,z:-3}},
 {at:t0+180_000,kind:'doing',text:'sat down',where:null,place:'Plaza'},
];
test('Today lists what the Soul did, said and what the world refused, newest first, with the world\'s reason',()=>{
 const html=renderToStaticMarkup(<DayList name="Ada" entries={day}/>);
 assert.match(html,/Today Ada: 2 things done · 1 thing said · 1 refused by the world\./);
 assert.match(html,/The world said: There is no water to swim in here\./);
 assert.match(html,/“Good morning!”/);assert.match(html,/walked to the bakery<span class="dim"> · at Bakery/);
 assert.ok(html.indexOf('sat down')<html.indexOf('walked to the bakery'),'newest first');
 assert.equal((html.match(/<button/g)??[]).length,3,'entries with a place are buttons; the one without is not');
});
test('an empty day says so plainly',()=>assert.equal(daySummary('Ada',[]),'Ada has not done anything yet today.'));
test('look-at carries the spot to the Shell and ignores junk',()=>{
 const target=new EventTarget(),got:unknown[]=[];const off=onLookAtRequest(a=>got.push(a),target);
 assert.equal(requestLookAt({x:3,z:-7},target),true);assert.equal(requestLookAt({x:NaN,z:1},target),false);off();requestLookAt({x:1,z:1},target);
 assert.deepEqual(got,[{x:3,z:-7}]);
});
