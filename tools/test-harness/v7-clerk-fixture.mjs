// V7's new-world browser walk uses the same synthetic Clerk/JWKS contract as the approval walks.
// Only isolated loopback5873/5874-5876; no provider credentials or product state.
import {spawn} from 'node:child_process';
import {mkdirSync, openSync, closeSync, writeFileSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {clerkKeys, ISSUER, PUBLISHABLE_KEY} from '../../apps/server/test/clerk-fixture.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const STUB = `(() => {
  const KEY = 'stubClerk.user', listeners = new Set();
  const make = () => { const sub = window.Clerk && window.Clerk.loaded ? localStorage.getItem(KEY) : null;
    if (!sub) return { client: { sessions: [], signedInSessions: [], activeSessions: [], lastActiveSessionId: null }, session: null, user: null, organization: null };
    const user = { id: sub, firstName: sub.slice(5), primaryEmailAddress: { emailAddress: sub + '@example.test' }, emailAddresses: [], organizationMemberships: [] };
    const sid = 'sess_' + sub.replace(/[^A-Za-z0-9]/g, '');
    const session = { id: sid, status: 'active', user, actor: null, lastActiveToken: { jwt: { claims: { sub, sid, iss: 'https://clerk.example.test' } } }, factorVerificationAge: null,
      getToken: async () => window.__stubClerkMint(sub), checkAuthorization: () => true };
    return { client: { sessions: [session], signedInSessions: [session], activeSessions: [session], lastActiveSessionId: sid }, session, user, organization: null }; };
  let state = make();
  const emit = () => { state = make(); for (const l of listeners) l({ ...state }); };
  window.Clerk = { loaded: false, status: 'loading', version: 'stub', sdkMetadata: {}, instanceType: 'production', frontendApi: 'clerk.example.test', isSatellite: false,
    get client() { return state.client; }, get session() { return state.session; }, get user() { return state.user; }, get organization() { return null; },
    async load() { await new Promise((r) => setTimeout(r, 600)); this.loaded = true; this.status = 'ready'; emit(); },
    addListener(l) { listeners.add(l); l({ ...state }); return () => listeners.delete(l); },
    on(event, handler) { if (event === 'status' && typeof handler === 'function') setTimeout(() => handler(this.status), 0); }, off() {}, __internal_getOption() {}, __internal_updateProps() {}, telemetry: { record() {} },
    openSignIn() {}, openSignUp() {}, closeSignIn() {}, async signOut() { localStorage.removeItem(KEY); emit(); },
    async setActive() {}, buildSignInUrl() { return location.href; }, buildSignUpUrl() { return location.href; }, redirectToSignIn() {} };
})();`;

export async function startV7ClerkFixture({origin, out, web, marsWeb}) {
  if (origin !== 'http://127.0.0.1:5873') throw Error('V7 Clerk fixture requires loopback5873');
  for (const port of [5873,5874,5875,5876]) await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => reject(new Error(`V7 fixture port ${port} is unavailable`, {cause: error})));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const keys = await clerkKeys(origin), authDir = join(out, 'auth');
  mkdirSync(authDir); // Fresh run only: never overwrite a prior fixture.
  const jwks = join(authDir, 'jwks.json'), envFile = join(authDir, 'clerk.env');
  writeFileSync(jwks, JSON.stringify({keys: [keys.jwk]}), {mode: 0o600});
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`,
    `CLERK_AUTHORIZED_PARTIES=${origin}`, `SIM_TEST_JWKS_FILE=${jwks}`,
    `NODE_OPTIONS=--import=${resolve(root, 'apps/server/test/clerk-jwks-preload.mjs')}`, ''].join('\n'), {mode: 0o600});
  const fd = openSync(join(out, 'launcher.log'), 'wx');
  const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', '5873', '--range', '5874-5876',
    '--data', join(out, 'launcher-data'), '--base', '/worlds', '--web', resolve(web),
    ...(marsWeb ? ['--mars-web', resolve(marsWeb)] : []), '--auth-env', envFile, '--public-origin', origin],
    {cwd: root, stdio: ['ignore', fd, fd]});
  closeSync(fd);
  writeFileSync(join(out, 'fixture.json'), JSON.stringify({auth: 'synthetic-clerk', pid: launcher.pid, origin,
    ports: [5873,5874,5875,5876], sourceRoot: root, data: join(out, 'launcher-data')}, null, 2)+'\n');
  let spawnError = null, stopping = null;
  launcher.on('error', error => { spawnError = error; });
  const alive = () => launcher.exitCode === null && launcher.signalCode === null && !spawnError;
  const stopOnExit = () => { if (alive()) launcher.kill('SIGTERM'); };
  process.once('exit', stopOnExit);
  const stop = () => stopping ??= (async () => {
    stopOnExit();
    for (let i=0; i<150 && alive(); i++) await sleep(100);
    if (alive()) throw Error(`Owned V7 launcher ${launcher.pid} did not stop; retain fixture and inspect before continuing`);
    process.removeListener('exit', stopOnExit);
  })();
  const onSignal = () => { void stop().then(() => process.exit(130), error => { console.error(error); process.exit(1); }); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal); process.once('SIGALRM', onSignal);
  try {
    let ready = false;
    for (let i=0; i<60 && alive(); i++) {
      ready = await fetch(`${origin}/worlds/__sim/worlds.json`, {signal: AbortSignal.timeout(1000)}).then(r => r.ok, () => false);
      if (ready) break; await sleep(500);
    }
    if (!ready) throw spawnError ?? Error('Synthetic Clerk launcher did not become ready');
  } catch (error) { await stop(); throw error; }
  return {
    async prepareContext(ctx) {
      await ctx.exposeFunction('__stubClerkMint', sub => keys.sign(sub));
      await ctx.addInitScript(() => localStorage.setItem('stubClerk.user', 'user_v7gaia'));
      await ctx.addInitScript(STUB);
      await ctx.route(/clerk\.example\.test/, route => route.abort());
    },
    async stop() { await stop(); for (const signal of ['SIGINT','SIGTERM','SIGALRM']) process.removeListener(signal, onSignal); },
  };
}
