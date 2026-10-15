// Account age means first verified sign-in to this registry, not provider signup.
// Count registered worlds (including sleeping ones); never trust request body ownership.
export function creationPolicy(cfg = {}) {
  const policy = {
    maxWorldsPerAccount: cfg.maxWorldsPerAccount ?? 5,
    newAccountHours: cfg.newAccountHours ?? 24,
    newAccountWorldLimit: cfg.newAccountWorldLimit ?? 2,
    newAccountCreateLimit: cfg.newAccountCreateLimit ?? 1,
    newAccountWindowMinutes: cfg.newAccountWindowMinutes ?? 60,
  };
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`launcher: ${key} must be a positive integer`);
  }
  return policy;
}

export function checkAccountCreation(policy, { createdAt, worlds, now = Date.now() }) {
  // Missing or corrupt registry age must never grant the mature allowance.
  const young = !Number.isSafeInteger(createdAt) || createdAt > now || now - createdAt < policy.newAccountHours * 3600_000;
  const cap = young ? Math.min(policy.maxWorldsPerAccount, policy.newAccountWorldLimit) : policy.maxWorldsPerAccount;
  if (worlds.length >= cap) return {
    status: 409, ok: false, code: 'account-world-limit', limit: cap,
    message: young
      ? `Accounts first seen here less than ${policy.newAccountHours} hours ago can hold at most ${cap} worlds. Your existing worlds are still available.`
      : `Your account can hold at most ${cap} worlds. Your existing worlds are still available.`,
  };
  if (young) {
    const window = policy.newAccountWindowMinutes * 60_000;
    const recent = worlds.map(w => w.createdAt).filter(t => Number.isSafeInteger(t) && t > now - window).sort((a, b) => a - b);
    if (recent.length >= policy.newAccountCreateLimit) {
      const retryAfter = Math.max(1, Math.ceil((recent[recent.length - policy.newAccountCreateLimit] + window - now) / 1000));
      return { status: 429, ok: false, code: 'new-account-velocity', retry_after: retryAfter,
        message: `Accounts first seen here less than ${policy.newAccountHours} hours ago can create ${policy.newAccountCreateLimit} world(s) per ${policy.newAccountWindowMinutes} minutes. Try again in ${retryAfter} seconds.` };
    }
  }
  return null;
}
