// Synthetic Clerk for tests: an RS256 key pair, a JWKS served by a stubbed fetch
// for one fixed https issuer, and session tokens signed like Clerk's (sub, sid,
// azp, iat, nbf, exp). No network, no provider keys, never used outside tests.
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

export const ISSUER = 'https://clerk.example.test';
export const ORIGIN = 'https://sim.example.test';
/** A live-shaped publishable key whose encoded domain matches ISSUER (what Auth.init checks). */
export const PUBLISHABLE_KEY = 'pk_live_' + Buffer.from('clerk.example.test$').toString('base64');

export async function clerkKeys(origin = ORIGIN) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256' };
  /** A Clerk-shaped session token for `sub` (override any claim with `extra`, the issuer with `iss`). */
  const sign = async (sub = 'user_alice', extra: Record<string, unknown> = {}, iss = ISSUER) =>
    new SignJWT({ sid: 'sess_fixture', azp: origin, ...extra }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setSubject(sub).setIssuer(iss).setIssuedAt().setNotBefore('0s')
      .setExpirationTime(typeof extra.exp === 'number' ? extra.exp : '60s').sign(privateKey);
  return { jwk, sign };
}

/** Serve `jwk` at ISSUER's JWKS URL; anything else goes to the real fetch. Returns the restore function. */
export function stubJwks(jwk: object, issuer = ISSUER) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    String(input instanceof Request ? input.url : input) === issuer + '/.well-known/jwks.json'
      ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })
      : original(input, init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/** The Config fields that select Clerk (production sign-in) for a world at ORIGIN. */
export const clerkSettings = (registryPath: string, worldPath = '/w/hello', origin = ORIGIN) => ({
  authProvider: 'clerk' as const, accountAuthRequired: true, clerkIssuer: ISSUER, clerkPublishableKey: PUBLISHABLE_KEY,
  clerkAuthorizedParties: [origin], publicUrl: origin + worldPath, accountRegistryPath: registryPath,
  privyAppId: '', privyAppSecret: '',
});
