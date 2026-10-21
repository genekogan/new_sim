import test from 'node:test';
import assert from 'node:assert/strict';
import {pageRoute} from './page-route.ts';
await test('root build: list at /, worlds under /w/<slug>, a hash on / is the single-world view, anything else is missing',()=>{
 assert.equal(pageRoute('/','',''),'list');
 assert.equal(pageRoute('/index.html','',''),'list');
 assert.equal(pageRoute('/','','#watch'),'world');
 for(const p of ['/w/eden','/w/eden/','/w/mars/2026','/w/littlemartians/x'])assert.equal(pageRoute(p,'',''),'world',p);
 for(const p of ['/nope','/l/mars','/l/eden/','/w/','/w/Eden/','/worlds-x'])assert.equal(pageRoute(p,'',''),'missing',p);
});
await test('launcher build under /worlds: same rules below the base, nothing outside it',()=>{
 assert.equal(pageRoute('/worlds/','/worlds',''),'list');
 assert.equal(pageRoute('/worlds','/worlds',''),'list');
 assert.equal(pageRoute('/worlds/w/eden-2026/','/worlds','#join'),'world');
 for(const p of ['/worlds/nope','/worlds/foo/bar','/worldsx','/w/eden/'])assert.equal(pageRoute(p,'/worlds',''),'missing',p);
});
