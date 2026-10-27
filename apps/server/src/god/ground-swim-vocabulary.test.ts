import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability,type VocabContext} from '../edge/ledger/vocabulary.ts';
test('generic swimming keeps the nearby-water action while explicit middle requests preserve their target',()=>{
 for(const name of ['West Lake','Middle Lake']){
  const ref=name.toLowerCase().replaceAll(' ','-'),base=`swim:${ref}`,ctx:VocabContext={root:['world'],me:[0,0],places:[],caps:[
   {id:base,verb:'swim',label:`Swim in ${name} (enter nearby reachable deep water)`,available:true,target:{id:'lake',kind:'object'}},
   {id:`${base}/middle`,verb:'swim',label:`Swim to the middle of ${name}`,available:true,target:{id:'lake',kind:'object'}},
  ],target:()=>({names:[name],around:[],at:[10,0]})};
  for(const q of ['swim','take a swim',`swim in the nearest ${name}`,`swim in ${name}`]){const r=resolveCapability(q,ctx);assert.notEqual(r.kind,'unknown',JSON.stringify({q,r}));if(r.kind!=='unknown')assert.equal(r.cap.id,base,q);}
  for(const q of [`${base}/middle`,`swim to the middle of ${name}`]){const r=resolveCapability(q,ctx);assert.notEqual(r.kind,'unknown',JSON.stringify({q,r}));if(r.kind!=='unknown')assert.equal(r.cap.id,`${base}/middle`,q);}
 }
});
