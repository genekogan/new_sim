import test from 'node:test';
import assert from 'node:assert/strict';
import {agentOnboarding,agentQuickstart} from './auth-ui.ts';
await test('New Soul prompt keeps a raw clickable-world URL and exact plain clipboard sentence',()=>{
 const onboarding=agentOnboarding('https://sim.example/w/eden/');
 assert.equal(onboarding.instructionsUrl,'https://sim.example/w/eden/instructions.md');
 assert.equal(onboarding.text,'Read the instructions at https://sim.example/w/eden/instructions.md to create a new soul in the world Eden.');
 assert.equal(agentQuickstart('https://sim.example/w/eden/'),onboarding.text);
 assert.doesNotMatch(onboarding.text,/\]\(|always.on|spending|STOP|live --|register/);
});
await test('bootstrap preserves actual world prefix and display name across worlds',()=>{
 assert.equal(agentOnboarding('http://127.0.0.1:4970/w/littlemartians').world,'Little Martians');
 const custom=agentOnboarding('https://sim.example/w/mars','Mars College');assert.equal(custom.instructionsUrl,'https://sim.example/w/mars/instructions.md');assert.ok(custom.text.endsWith('world Mars College.'));
});
