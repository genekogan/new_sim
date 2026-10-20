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
await build({stdin: {contents: `export {AgentMessageBoxView} from './AgentMessageBox.tsx';export {watchStatus} from './god-ui/god-api.ts';export {watchInbox, godState} from './god-ui/god-store.ts';export {publishSession} from './auth-session.ts';export {SoulFocus} from './SoulFocus.tsx';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx'}, outfile, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty'}, logLevel: 'silent'});
const {AgentMessageBoxView, watchStatus, watchInbox, godState, publishSession, SoulFocus, createElement: h, renderToStaticMarkup: render} = require(outfile);
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
// G4: the God box is the God modal's agent section now (the God button watches the owner's inbox while the world's status
// says owner). Signing out resets the status even when the provider keeps the same label, so the owner view and the
// command log go away with it.
test('God box disappears on sign-out even if the provider retains the same label', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ok: true, status: 200, json: async () => String(url).includes('/v1/god/inbox')
    ? {inbox: {connected: true, lastSeenAt: 1, latest: null, queued: 1, log: [{id: 'm1', text: 'Build a barn', state: 'sent', sentAt: 1}]}}
    : {you: 'owner', pending: [], agents: 1}});
  const until = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(ok()); };
  const session = {mode: 'dev', ready: true, authed: true, label: 'same-label', getToken: async () => 'dev:same-label', login() {}, logout() {}};
  publishSession(session);
  const seen = []; const stopStatus = watchStatus((s) => seen.push(s?.you ?? null));
  try {
    await until(() => seen.at(-1) === 'owner');
    const stopInbox = watchInbox();   // what GodButton does while the status says owner
    await until(() => godState().inbox?.log?.length === 1);
    publishSession({...session, authed: false});
    assert.equal(seen.at(-1), null);   // the owner status is gone at once, same label or not
    stopInbox();                      // GodButton stops watching when owner turns false
    assert.equal(godState().inbox, null);
  } finally { stopStatus(); globalThis.fetch = realFetch; }
});
test.after(() => rm(dir, {recursive: true, force: true}));
