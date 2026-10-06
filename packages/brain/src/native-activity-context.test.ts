import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMidRequest,fingerprint,type MidContext} from './mid.ts';
const base:MidContext={world:{time:'afternoon',weather:'clear',happening:'ordinary'},soul:{name:'Observer',about:'An invited resident',intent:'Observe',ownerNote:null,hasIntent:false,intentIsNew:false,energy:'rested',where:'commons',doing:'resting',recent:[]},nearby:[],nudge:null,running:true,trigger:'fixture',options:[{id:'rest',template:'rest',label:'Rest here',steps:[{verb:'rest',params:{seconds:20}}],durationHint:'seconds'}]};
test('native phase context informs existing choice without inventing options or authority',()=>{
 const context={...base,nativeActivities:['Nearby classroom: presenting; nine locally present participants; eight actual seated attendees. Distance scope only; walls and line of sight are not checked. This grants no participation or body-control authority.']};
 const request=buildMidRequest(context),legacy=buildMidRequest(base);
 assert.deepEqual(request.keys,legacy.keys);assert.deepEqual((request.request.questions.next as any).criteria,(legacy.request.questions.next as any).criteria);
 assert.deepEqual((request.request.state as Record<string,unknown>).local_native_activities,context.nativeActivities);
 assert.ok((request.request.questions.next as any).instructions.consider.some((s:string)=>s.includes('Choose only enumerated feasible options')));
 assert.notEqual(fingerprint(context),fingerprint({...context,nativeActivities:['Nearby classroom: cleanup.']}));
 assert.equal(fingerprint(context),fingerprint(structuredClone(context)));
 assert.equal('local_native_activities' in (legacy.request.state as Record<string,unknown>),false);
 assert.equal('local_native_activities' in (buildMidRequest({...base,nativeActivities:[]}).request.state as Record<string,unknown>),false);
 assert.throws(()=>buildMidRequest({...base,nativeActivities:Array(17).fill('extra')}),/overflow/);
 assert.throws(()=>buildMidRequest({...base,nativeActivities:['x'.repeat(401)]}),/overflow/);
});
