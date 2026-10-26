import { spawn } from 'node:child_process';
/** Run a command in its own process group, capture stdout/stderr (bounded), kill the group at maxWallMs.
 *  Never pipes stdin from the parent. Returns {code, signal, stdout, stderr, wallMs, timedOut}. */
export function run(cmd, args, { cwd, env, maxWallMs = 120000, input = null, maxBytes = 8 * 1024 * 1024, onStdoutLine } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env ?? {}) }, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    let out = '', err = '', timedOut = false, buf = '';
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000); }, maxWallMs);
    child.stdout.on('data', (d) => { const s = d.toString(); if (out.length < maxBytes) out += s; if (onStdoutLine) { buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { onStdoutLine(buf.slice(0, i)); buf = buf.slice(i + 1); } } });
    child.stderr.on('data', (d) => { if (err.length < maxBytes) err += d.toString(); });
    child.on('close', (code, signal) => { clearTimeout(timer); if (onStdoutLine && buf) onStdoutLine(buf); resolve({ code, signal, stdout: out, stderr: err, wallMs: Date.now() - t0, timedOut }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, signal: null, stdout: out, stderr: err + String(e), wallMs: Date.now() - t0, timedOut }); });
    if (input != null) { child.stdin.end(input); }
  });
}
/** Start a long-lived child (own group); returns {child, kill()}. stdout lines go to onLine. */
export function start(cmd, args, { cwd, env, onLine, onExit } = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let buf = '', out = '', err = '';
  child.stdout.on('data', (d) => { const s = d.toString(); out += s; buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine?.(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  child.stderr.on('data', (d) => { err += d.toString(); });
  child.on('close', (code, signal) => { if (buf) onLine?.(buf); onExit?.({ code, signal, stdout: out, stderr: err }); });
  return { child, pid: child.pid, kill: (sig = 'SIGTERM') => { try { process.kill(-child.pid, sig); } catch { /* gone */ } }, output: () => ({ stdout: out, stderr: err }) };
}
