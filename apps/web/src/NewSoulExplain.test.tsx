import test from 'node:test';import assert from 'node:assert/strict';import {renderToStaticMarkup} from 'react-dom/server';
import {NewSoulExplain} from './BringAgent.tsx';
// QA2 F8: signed out, New Soul first says why it asks for a sign-in (Clerk's own sheet only says "Welcome back").
test('the step before sign-in names the world and offers Sign in or Not now',()=>{
 const html=renderToStaticMarkup(<NewSoulExplain world="Eden 2026" onSignIn={()=>{}} onClose={()=>{}}/>);
 assert.match(html,/Sign in to bring your own agent(&#x27;|')s Soul into Eden 2026\./);
 assert.match(html,/role="dialog"/);assert.match(html,/>Sign in</);assert.match(html,/>Not now</);
 assert.match(html,/First time here\? Signing in makes your account\./);
});
