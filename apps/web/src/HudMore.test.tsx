import test from 'node:test'; import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { HudMore, MORE_TARGETS, SMALL_SCREEN, collectMoreItems, moreMenu } from './HudMore.tsx';

test('desktop shows no More button (no matchMedia, a desktop matchMedia, or forced off)', () => {
  assert.equal(renderToStaticMarkup(<HudMore/>), '');
  assert.equal(renderToStaticMarkup(<HudMore small={false} initialOpen/>), '');
  const g = globalThis as { matchMedia?: unknown };
  const prior = g.matchMedia; const asked: string[] = [];
  g.matchMedia = (q: string) => { asked.push(q); return { matches: false, addEventListener() {}, removeEventListener() {} }; };
  try { assert.equal(renderToStaticMarkup(<HudMore/>), ''); } finally { g.matchMedia = prior; }
  assert.deepEqual(asked, [SMALL_SCREEN]);
});

test('small screens show one More button, closed until tapped', () => {
  const g = globalThis as { matchMedia?: unknown };
  const prior = g.matchMedia;
  g.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  try {
    const closed = renderToStaticMarkup(<HudMore/>);
    assert.equal(closed.match(/class="hud-camera hud-more"/g)?.length, 1);
    assert.match(closed, /aria-label="More"/);
    assert.match(closed, /aria-expanded="false"/);
    assert.doesNotMatch(closed, /role="menu"/);
  } finally { g.matchMedia = prior; }
  const open = renderToStaticMarkup(<HudMore small initialOpen/>);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /role="menu"/);
});

test('open/close: the button toggles; Escape, a tap outside and an item close it', () => {
  assert.equal(moreMenu(false, 'toggle'), true);
  assert.equal(moreMenu(true, 'toggle'), false);
  assert.equal(moreMenu(true, 'close'), false);
  assert.equal(moreMenu(false, 'close'), false);
});

test('menu items are the existing controls on the page; choosing one clicks that control', () => {
  const clicked: string[] = [];
  const el = (name: string, o: { text?: string; aria?: string; hidden?: boolean; onScreen?: boolean } = {}) => ({ click: () => clicked.push(name), textContent: o.text ?? '', hidden: o.hidden ?? false, getAttribute: (a: string) => (a === 'aria-label' ? o.aria ?? null : null), checkVisibility: () => o.onScreen ?? false });
  const page: Record<string, ReturnType<typeof el>[]> = {
    '.account-sign-in': [el('signin', { text: 'Sign in' })],
    '[data-god-panel-toggle]': [el('claim', { text: '✦ Claim this world' })],
    '[data-god-open]': [el('god', { text: 'God⌘G' })],
    '[data-feedback-open]': [el('feedback', { text: 'Send feedback' })],
    '.visitor-controls button': [el('away', { text: 'Since your last visit' })],
    '.hud-camera-row .fullscreen-toggle': [el('fullscreen', { aria: 'Full screen', onScreen: true })],
    '.hud-camera-slot .viewer-broadcast, .hud-camera-slot .viewer-following button': [el('broadcast', { text: 'Broadcast' })],
    '.hud-camera-row .hud-camera[aria-label="Camera controls"]': [el('camera', { aria: 'Camera controls', onScreen: true })],
    '.hud-explore-group .my-souls > button': [el('ada', { aria: 'Open Ada' })],
    '.eden-sound-toggle [data-sound]': [el('mute', { aria: 'Sound is on: mute' }), el('music', { aria: 'Music is off: turn on', hidden: true })],
  };
  assert.deepEqual(Object.keys(page), MORE_TARGETS.map((t) => t.selector));
  const items = collectMoreItems({ querySelectorAll: (s) => page[s] ?? [] });
  // U3: what is still on screen (Full screen, Camera controls here) is not offered twice
  assert.deepEqual(items.map((i) => i.label), ['Sign in', 'Claim this world', 'God', 'Feedback', 'Since your last visit', 'Broadcast', 'Open Ada', 'Sound is on: mute']);
  assert.deepEqual(items.map((i) => i.key), ['sign-in', 'claim', 'god', 'feedback', 'visitor', 'follow', 'souls', 'sound']);
  items[3].target.click(); items[7].target.click();
  assert.deepEqual(clicked, ['feedback', 'mute']);
});

test('signed out (no account menu), More still offers Feedback; nothing else is invented', () => {
  const items = collectMoreItems({ querySelectorAll: () => [] });
  assert.deepEqual(items.map((i) => [i.key, i.label]), [['feedback', 'Feedback']]);
});
