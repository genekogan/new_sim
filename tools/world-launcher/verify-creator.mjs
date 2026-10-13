// Minimal authentication process: env-file by path, bearer token only on stdin.
// No world, model, or persistent token storage is constructed.
import { Auth } from '../../apps/server/src/auth.ts';
import { Db } from '../../apps/server/src/db.ts';
let db, auth, id = null;
try {
  let token = '';
  for await (const chunk of process.stdin) {
    token += chunk.toString('utf8');
    if (token.length > 32768) throw Error('token too large');
  }
  if (!token || /\s/.test(token)) throw Error('invalid token');
  db = new Db(':memory:');
  auth = new Auth({ authProvider: 'clerk', accountAuthRequired: true, worldEngine: true,
    clerkIssuer: process.env.CLERK_ISSUER_URL ?? '', clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? '',
    clerkAuthorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    accountRegistryPath: process.env.ACCOUNT_REGISTRY_PATH, publicUrl: process.env.PUBLIC_URL,
    worldId: 'creator-verifier', adminEmails: [], inviteRequired: false }, db);
  await auth.init();
  const account = await auth.accountFromToken(token);
  id = account?.identity.id ?? null;
} catch { id = null; }
finally { auth?.close(); db?.db.close(); }
process.stdout.write(JSON.stringify(id));
