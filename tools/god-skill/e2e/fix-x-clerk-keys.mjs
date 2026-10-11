// Lane X: a persistent synthetic Clerk issuer for local walkthroughs (test-only key pair, never a real provider key).
//   node tools/god-skill/e2e/fix-x-clerk-keys.mjs init <origin>[,<origin>…]  writes .lane/fixx/clerk/{jwks.json,private.json,clerk.env}
//   node tools/god-skill/e2e/fix-x-clerk-keys.mjs sign <sub> [azp]           prints a Clerk-shaped session token (TOKEN_TTL, default 60s)
// Then: launcher.mjs --base /worlds --auth-env <abs>/.lane/fixx/clerk/clerk.env --public-origin <origin> (see fix-x-walkthrough.mjs).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const req = createRequire(`${root}/apps/server/package.json`);
const { generateKeyPair, exportJWK, importJWK, SignJWT } = req('jose');
const dir = `${root}/.lane/fixx/clerk`, ISSUER = 'https://clerk.example.test';
export const PUBLISHABLE_KEY = 'pk_live_' + Buffer.from('clerk.example.test$').toString('base64');
export async function init(origins) {
  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256' };
  writeFileSync(`${dir}/jwks.json`, JSON.stringify({ keys: [jwk] }));
  writeFileSync(`${dir}/private.json`, JSON.stringify(await exportJWK(privateKey)));
  writeFileSync(`${dir}/clerk.env`, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${origins.join(',')}`,
    `SIM_TEST_JWKS_FILE=${dir}/jwks.json`, `NODE_OPTIONS=--import=${root}/apps/server/test/clerk-jwks-preload.mjs`, ''].join('\n'));
}
export async function sign(sub, azp) {
  const key = await importJWK(JSON.parse(readFileSync(`${dir}/private.json`, 'utf8')), 'RS256');
  return new SignJWT({ sid: 'sess_' + sub.replace(/[^A-Za-z0-9]/g, ''), azp }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject(sub).setIssuer(ISSUER).setIssuedAt().setNotBefore('0s').setExpirationTime(process.env.TOKEN_TTL ?? '60s').sign(key);
}
if (process.argv[1]?.endsWith('fix-x-clerk-keys.mjs')) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'init') await init(a.split(','));
  else if (cmd === 'sign') console.log(await sign(a, b));
}
