// Test-only preload (node --import) for world processes started by a test: serves the
// JWKS in SIM_TEST_JWKS_FILE at CLERK_ISSUER_URL/.well-known/jwks.json so a synthetic
// Clerk issuer verifies without network. Loaded only through a test's own env file
// (NODE_OPTIONS=--import=…); a production env file never names it.
import { readFileSync } from 'node:fs';
const file = process.env.SIM_TEST_JWKS_FILE, issuer = process.env.CLERK_ISSUER_URL;
if (file && issuer) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input instanceof Request ? input.url : input) === `${issuer}/.well-known/jwks.json`
    ? new Response(readFileSync(file, 'utf8'), { headers: { 'content-type': 'application/json' } })
    : original(input, init);
}
