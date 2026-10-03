import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLayout} from '../lib/layout.ts';
test('saved layouts cannot silently cross years; legacy layouts belong to 2026',()=>{
 const data={schema_version:1,base_model:'mars-campus-modular-v1',year:2020,edits:[]};
 assert.equal(validateLayout(data,new Set(),new Set(),2020).year,2020);
 assert.throws(()=>validateLayout(data,new Set(),new Set(),2026));
 delete data.year;
 assert.doesNotThrow(()=>validateLayout(data,new Set(),new Set(),2026));
 assert.throws(()=>validateLayout(data,new Set(),new Set(),2020));
});

test('proposed2027 saved layouts are accepted only in their own draft year',()=>{
 const draft={schema_version:1,base_model:'mars-campus-modular-v1',year:2027,edits:[]};
 assert.equal(validateLayout(draft,new Set(),new Set(),2027).year,2027);
 assert.throws(()=>validateLayout(draft,new Set(),new Set(),2026));
});
