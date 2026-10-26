import {spawn} from 'node:child_process';

/** Card details may contain name/ok. Keep them as evidence, never as the assertion's identity/verdict. */
export function windowCheck(name, ok, detail = {}) {
  return {...detail, detail: {...detail}, name, ok: !!ok};
}

/** One real, bounded, model-free CLI listen in this scenario's own granted agent folder. */
export function startWindowListener(cli, folder, spawnChild = spawn) {
  const argv = [cli, 'listen', '--once', '--timeout', '55'];
  const child = spawnChild(process.execPath, argv, {cwd: folder, stdio: ['ignore', 'pipe', 'pipe']});
  const evidence = {pid: child.pid ?? null, argv, startedAt: new Date().toISOString(), stdout: '', stderr: '', stopReason: null};
  let closed = false, stopping = false, killTimer, deadline, finish;
  const done = new Promise(resolve => {finish = resolve;});
  const stop = (reason = 'fixture-finished') => {
    if (!closed && !stopping) {
      stopping = true; evidence.stopReason = reason;
      killTimer = setTimeout(() => {if (!closed) {evidence.forcedKill = true; child.kill('SIGKILL');}}, 1000);
      child.kill('SIGTERM');
    }
    return done;
  };
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', data => {
    evidence[stream] += data;
    if (Buffer.byteLength(evidence.stdout) + Buffer.byteLength(evidence.stderr) > 65_536) stop('output-limit');
  });
  child.on('error', error => {evidence.error = String(error);});
  child.once('close', (code, signal) => {
    closed = true; clearTimeout(deadline); clearTimeout(killTimer);
    Object.assign(evidence, {code, signal, endedAt: new Date().toISOString()}); finish(evidence);
  });
  deadline = setTimeout(() => stop('65s-deadline'), 65_000);
  return {done, stop, running: () => !closed && !stopping && !evidence.error, evidence};
}
