// The art CLI warns when a web link's host will not let the world's page draw it (no CORS header).
//   node --test tools/art/eden-art.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedWarning } from './eden-art.mjs';

const fake = (status, headers = {}) => async () => ({ ok: status < 400, status, headers: new Headers(headers), body: null });
test('a host with a CORS header passes quietly; one without gets a plain warning; same-site paths are not checked', async () => {
  const w = 'https://sim.eden.art/w/eden';
  assert.equal(await embedWarning('https://cdn.example.org/a.jpg', w, fake(200, { 'access-control-allow-origin': '*' })), null);
  assert.equal(await embedWarning('https://cdn.example.org/a.jpg', w, fake(206, { 'access-control-allow-origin': 'https://sim.eden.art' })), null);
  assert.match(await embedWarning('https://www.example.com/logo.png', w, fake(200)), /www\.example\.com does not let other sites show its files.*upload/);
  assert.match(await embedWarning('https://www.example.com/gone.png', w, fake(404, { 'access-control-allow-origin': '*' })), /answered 404/);
  assert.equal(await embedWarning('/w/eden/art/abc.png', w, fake(500)), null);
  assert.equal(await embedWarning('https://sim.eden.art/w/eden/art/abc.png', w, fake(500)), null);
  assert.match(await embedWarning('https://x.invalid/a.png', w, async () => { throw new Error('getaddrinfo ENOTFOUND'); }), /could not reach/);
});
