// Privy auth. The browser holds a Privy access token (ES256 JWT); the server
// verifies it with the app's verification key, fetched once with the app secret.
// To the user this is just "sign in"; the embedded wallet is incidental for now.
import { createHash, randomBytes } from 'node:crypto';
import { importSPKI, jwtVerify, type CryptoKey } from 'jose';
import type { Me } from '@sim/protocol';
import type { Config } from './config.ts';
import type { Db, UserRow } from './db.ts';
import { ownerShort } from './world.ts';

export class Auth {
  private key: CryptoKey | null = null;
  private profileAt = new Map<string, number>();
  ready = false;
  devAuth: boolean;
  cfg: Config; db: Db;
  constructor(cfg: Config, db: Db) {
    this.cfg = cfg; this.db = db; this.devAuth = process.env.DEV_AUTH === '1';
    // "Bearer dev:admin" is an admin when dev auth is on. It must never be on for a public site.
    if (this.devAuth && cfg.publicUrl.startsWith('https://')) throw new Error('DEV_AUTH=1 with a public https PUBLIC_URL: refusing to start');
  }

  private basic() { return 'Basic ' + Buffer.from(`${this.cfg.privyAppId}:${this.cfg.privyAppSecret}`).toString('base64'); }

  async init() {
    if (!this.cfg.privyAppId || !this.cfg.privyAppSecret) { console.warn('[auth] Privy not configured; logins disabled'); return; }
    const res = await fetch(`https://auth.privy.io/api/v1/apps/${this.cfg.privyAppId}`, { headers: { Authorization: this.basic(), 'privy-app-id': this.cfg.privyAppId } });
    if (!res.ok) throw new Error(`privy app config ${res.status}`);
    const app = (await res.json()) as { verification_key: string; name: string };
    const b64 = app.verification_key.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
    const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
    this.key = await importSPKI(pem, 'ES256');
    this.ready = true;
    console.log(`[auth] Privy app "${app.name}" verification key loaded`);
  }

  /** Verify a Privy access token and return the user (creating the row on first sight). */
  async userFromToken(token: string | undefined | null): Promise<UserRow | null> {
    if (!token) return null;
    if (this.devAuth && token.startsWith('dev:')) {
      const id = `dev:${token.slice(4, 40)}`;
      if (!this.db.user(id)) this.db.upsertUser({ id, email: `${token.slice(4)}@dev.local`, wallet: null, role: token === 'dev:admin' ? 'admin' : 'user' });
      return this.db.user(id)!;
    }
    if (!this.key) return null;
    let did: string;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'privy.io', audience: this.cfg.privyAppId });
      did = String(payload.sub);
    } catch { return null; }
    let u = this.db.user(did);
    // (re)fetch the profile on first sight, or hourly, so a wallet created later shows up on the debug page
    const fetched = this.profileAt.get(did) ?? 0;
    if (!u || Date.now() - fetched > 3600_000) {
      this.profileAt.set(did, Date.now());
      const prof = await this.fetchProfile(did).catch(() => null);
      const email = prof?.email ?? u?.email ?? null;
      const role = email && this.cfg.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
      this.db.upsertUser({ id: did, email, wallet: prof?.wallet ?? u?.wallet ?? null, role });
      u = this.db.user(did)!;
    } else {
      // the admin list is read on every request, so removing someone takes effect at once
      const role = u.email && this.cfg.adminEmails.includes(u.email.toLowerCase()) ? 'admin' : 'user';
      if (role !== u.role) { this.db.upsertUser({ id: did, email: u.email, wallet: u.wallet, role }); u = this.db.user(did)!; } else this.db.touchUser(did);
    }
    return u;
  }

  private async fetchProfile(did: string): Promise<{ email: string | null; wallet: string | null }> {
    const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, { headers: { Authorization: this.basic(), 'privy-app-id': this.cfg.privyAppId } });
    if (!res.ok) throw new Error(`privy user ${res.status}`);
    const u = (await res.json()) as { linked_accounts?: any[] };
    let email: string | null = null, wallet: string | null = null;
    for (const a of u.linked_accounts ?? []) {
      if (a.type === 'email' && a.address) email = email ?? a.address;
      if (a.type === 'google_oauth' && a.email) email = email ?? a.email;
      if (a.type === 'wallet' && a.address) wallet = wallet ?? a.address;
    }
    return { email, wallet };
  }

  me(u: UserRow): Me {
    return { userId: u.id, short: ownerShort(u.id), email: u.email, wallet: u.wallet, role: u.role, souls: this.db.soulsOf(u.id).map((s) => s.id), invited: !this.cfg.inviteRequired || u.role === 'admin' || !!u.invited_by };
  }
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString('hex')}`;
export const newSoulToken = (soulId: string) => `sim_${soulId}_${randomBytes(24).toString('base64url')}`;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Tiny sliding-window rate limiter. */
export class RateLimit {
  private hits = new Map<string, number[]>(); private calls = 0;
  allow(key: string, max: number, windowMs: number): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { this.hits.set(key, arr); return { ok: false, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) }; }
    arr.push(now); this.hits.set(key, arr);
    // forget keys nobody has used for over an hour (the longest window), so the map does not grow with every address seen
    if (++this.calls % 2000 === 0) for (const [k, a] of this.hits) if (!a.length || now - a[a.length - 1] > 3600_000) this.hits.delete(k);
    return { ok: true };
  }
}
