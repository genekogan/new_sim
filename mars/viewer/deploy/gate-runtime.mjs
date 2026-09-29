import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// All gate children get their own process group, including npm/wrangler descendants.
export class GateProcesses {
  children = new Set();
  closed = false;
  spawn(cmd, args, options) {
    if (this.closed) throw new Error('gate process scope was interrupted');
    const child = spawn(cmd, args, { ...options, detached: true });
    this.children.add(child);
    return child;
  }
  kill(child, signal = 'SIGKILL') {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  cleanup() {
    this.closed = true;
    for (const child of this.children) this.kill(child);
    this.children.clear();
  }
}

export async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export function nodeTestSummary(out) {
  const pick = (k) => out.match(new RegExp(`^(?:ℹ |# )${k} (\\d+)`, 'm'))?.[1];
  const [tests, pass, fail, skipped, todo] = ['tests', 'pass', 'fail', 'skipped', 'todo'].map(pick);
  return { tests, pass, fail, skipped, todo, summary: pass === undefined ? '' : `${pass} pass / ${fail} fail / ${skipped ?? 0} skip / ${todo ?? 0} todo` };
}

export async function startLocalSimulation({ root, outDir, processes, timeout = 60_000, command, readyPath = '/api/simulation/state', readyStatus = 401 }) {
  const port = await unusedPort();
  let inspectorPort;
  do { inspectorPort = await unusedPort(); } while (inspectorPort === port);
  const base = `http://127.0.0.1:${port}`;
  const cmd = command?.(port) ?? ['node', 'node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'simulation/wrangler.jsonc', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspectorPort), '--persist-to', `${outDir}/simulation-state`, '--no-show-interactive-dev-session'];
  const child = processes.spawn(cmd[0], cmd.slice(1), { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(`${outDir}/simulation-server.log`);
  log.write(`$ ${cmd.join(' ')}\n`);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let failure;
  child.once('error', (error) => { failure = error; });
  child.once('exit', (code, signal) => { failure ??= new Error(`simulation server exited (${code ?? signal})`); });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const stop = async () => {
    processes.kill(child);
    await closed;
    processes.children.delete(child);
    await new Promise((resolve) => log.end(resolve));
  };
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try {
        const response = await fetch(`${base}${readyPath}`, { signal: AbortSignal.timeout(500) });
        await response.body?.cancel();
        if (response.status === readyStatus) return { base, stop };
      } catch { /* keep waiting until readiness deadline or process failure */ }
      await delay(100);
    }
    throw new Error(`simulation server readiness timed out after ${timeout}ms`);
  } catch (error) {
    await stop();
    throw error;
  }
}
