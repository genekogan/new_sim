import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classWords} from './edge/intents/class-words.ts';
const places=[{id:'eden',name:'Eden'},{id:'eden-classroom-1',name:'Eden east classroom'},{id:'eden-classroom-seat-02',name:'Classroom seat 2'},{id:'eden-library-1',name:'Library'}];
void test('W8: ordinary words for attending a class become an audience seat in the classroom',()=>{
 for(const t of ['attend the lecture','go to class','Go to the classroom','sit in on the lesson','join the class','take a seat in the classroom',"let's attend today's lecture",'watch the presentation','listen to the talk','attend class.'])
  assert.deepEqual(classWords(t,places),{verb:'sit',target:{in:'eden-classroom-1',row:'any'}},t);
 assert.deepEqual(classWords('attend the lecture in the front row',places),{verb:'sit',target:{in:'eden-classroom-1',row:'front'}});
 assert.deepEqual(classWords('sit at the back of the class',places),{verb:'sit',target:{in:'eden-classroom-1',row:'back'}});
});
void test('W8: other words and worlds without a classroom are untouched',()=>{
 for(const t of ['go to the library','sit:eden-classroom-seat-02','walk to the pond',"don't go to class",'skip the lecture','class is boring','go for a swim','join the yoga class','go to the dance class','attend the cooking class','join a swimming lesson','go to the art class'])assert.equal(classWords(t,places),null,t);
 assert.equal(classWords('attend the lecture',[{id:'camp',name:'Camp'}]),null);
});
