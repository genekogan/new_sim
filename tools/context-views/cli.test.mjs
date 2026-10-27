import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContextViewArgs} from '../world-launcher/soul/eden.mjs';
test('visual requests are explicit, bounded, and distinguish originals from architectural details',()=>{
 assert.deepEqual(parseContextViewArgs(['e_first','e_second','--detail','--out','sheet.png']),{refs:['e_first','e_second'],detail:true,original:false,out:'sheet.png'});
 assert.equal(parseContextViewArgs(['e_art','--original']).original,true);
 for(const args of [[],Array.from({length:7},(_,i)=>'e_'+i),['e_a','e_a'],['e_a','e_b','--original'],['e_a','--out'],['e_a','--all']])assert.throws(()=>parseContextViewArgs(args));
});
