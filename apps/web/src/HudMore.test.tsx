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
  const el = (name: string, o: { text?: string; aria?: string; hidden?: boolean } = {}) => ({ click: () => clicked.push(name), textContent: o.text ?? '', hidden: o.hidden ?? false, getAttribute: (a: string) => (a === 'aria-label' ? o.aria ?? null : null) });
  const page: Record<string, ReturnType<typeof el>[]> = {
    '.account-sign-in': [el('signin', { text: 'Sign in' })],
    '[data-god-panel-toggle]': [el('god', { text: '✦ Claim this world' })],
    '.cn-chip': [el('cn', { text: '§ Constitutionv1' })],
    '[data-feedback-open]': [el('feedback', { text: 'Send feedback' })],
    '.visitor-controls button': [el('away', { text: 'Since your last visit' })],
    '.eden-sound-toggle [data-sound]': [el('mute', { aria: 'Sound is on: mute' }), el('music', { aria: 'Music is off: turn on', hidden: true })],
  };
  assert.deepEqual(Object.keys(page), MORE_TARGETS.map((t) => t.selector));
  const items = collectMoreItems({ querySelectorAll: (s) => page[s] ?? [] });
  assert.deepEqual(items.map((i) => i.label), ['Sign in', 'Claim this world', 'Constitution', 'Feedback', 'Since your last visit', 'Sound is on: mute']);
  assert.deepEqual(items.map((i) => i.key), ['sign-in', 'god', 'constitution', 'feedback', 'visitor', 'sound']);
  items[3].target.click(); items[5].target.click();
  assert.deepEqual(clicked, ['feedback', 'mute']);
  assert.deepEqual(collectMoreItems({ querySelectorAll: () => [] }), []);
});
