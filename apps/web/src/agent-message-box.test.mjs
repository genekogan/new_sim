import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve('vite/package.json'))('esbuild');
const dir = await mkdtemp(join(tmpdir(), 'sim-inbox-render-'));
Object.assign(globalThis, {location: {origin: 'http://localhost:5960', pathname: '/w/inbox/', search: '', hash: ''}, sessionStorage: {getItem: () => null}});
const outfile = join(dir, 'render.cjs');
await build({stdin: {contents: `export {AgentMessageBoxView} from './AgentMessageBox.tsx';export {publishSession} from './auth-session.ts';export {SoulFocus} from './SoulFocus.tsx';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx'}, outfile, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty'}, logLevel: 'silent'});
const {AgentMessageBoxView, publishSession, SoulFocus, createElement: h, renderToStaticMarkup: render} = require(outfile);
const props = {kind: 'god', prompt: 'Resume the existing agent and listen.', text: '', onText() {}, onSend() {}, onCopy() {}};
test('absent and unknown agent presence make no delivery claim; start prompt is copyable', () => {
  const absent = render(h(AgentMessageBoxView, {...props, inbox: {connected: false, lastSeenAt: null, latest: null}}));
  assert.match(absent, /Not running — this will wait/); assert.match(absent, /Copy start prompt/);
  assert.match(absent, /title="Resume the existing agent and listen\."/);
  assert.doesNotMatch(absent, /Delivered|Acknowledged|is connected/);
  const unknown = render(h(AgentMessageBoxView, {...props, inbox: null}));
  assert.match(unknown, /Agent status unavailable/); assert.doesNotMatch(unknown, /is connected|Delivered/);
});
for (const kind of ['god', 'soul']) for (const state of ['sent', 'delivered', 'acknowledged']) test(`${kind} overlay shows only latest ${state} receipt as plain text`, () => {
  const inbox = {connected: state !== 'sent', lastSeenAt: state === 'sent' ? null : Date.now(), latest: {id: 'one', text: '<script>owner words</script>', state, ...(state === 'acknowledged' ? {reply: '<b>On my way</b>'} : {})}};
  const html = render(h(AgentMessageBoxView, {...props, kind, inbox}));
  assert.match(html, new RegExp(`data-agent-message="${kind}"`));
  assert.match(html, new RegExp(`data-message-state="${state}"`));
  assert.match(html, /&lt;script&gt;owner words&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>|<b>On my way/);
  assert.equal((html.match(/data-message-state=/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<ol|<ul|textarea/);
  assert.match(html, state === 'sent' ? /Sent · waiting/ : state === 'delivered' ? /Delivered/ : /Acknowledged/);
  if (state === 'acknowledged') assert.match(html, /&lt;b&gt;On my way&lt;\/b&gt;/);
});
test('Soul card inbox belongs only to its authenticated owner, including account switch', () => {
  const soul = {id: 's_A', entityId: 'h_A', name: 'Ana', description: '', doing: '', energy: 'fine'};
  const sim = {me: {userId: 'acct_A', souls: ['s_A'], role: 'user', invited: true}, privateAuthorityGeneration: 1, conn: {welcome: {worldId: 'inbox-1', epoch: 1}, replica: {souls: new Map([['s_A', soul]]), entities: {}, tick: 0}}, plays: [], talk: []};
  for (const identity of ['acct_A', 'acct_B', null]) {
    const auth = {authed: !!identity, ready: true, label: identity, debug: {accountIdentity: identity, privyUserId: null}, login() {}, logout() {}};
    const html = render(h(SoulFocus, {sim, auth, api: async () => {throw Error('Rendering must not request');}, selected: 's_A', select() {}, manage() {}}));
    assert.equal(html.includes('data-agent-message="soul"'), identity === 'acct_A');
  }
});
test.after(() => rm(dir, {recursive: true, force: true}));
