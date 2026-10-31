#!/usr/bin/env node

// tools/soul-runtime/launch.mjs
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolve2, join as join2 } from "node:path";

// tools/soul-runtime/controller-ownership.mjs
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, lstatSync, fstatSync, realpathSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, constants } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// tools/soul-runtime/receiver.mjs
function abortableSleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve3) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve3();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

// tools/soul-runtime/controller-ownership.mjs
var fault = (code) => Object.assign(Error(code + "; ownership/state retained"), { code });
var sha = (value) => createHash("sha256").update(value).digest("hex");
var validPid = (n) => Number.isSafeInteger(n) && n > 1;
var same = (a, b) => a && b && a.pid === b.pid && a.pgid === b.pgid && a.startToken === b.startToken;
var MAX_BYTES = 262144;
var MAX_CONTROLLERS = 16;
var MAX_HOSTS = 128;
function readPrivate(path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > MAX_BYTES || s.mode & 63) throw fault("CONTROLLER_INVENTORY_UNSAFE");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = fstatSync(fd);
    if (actual.dev !== s.dev || actual.ino !== s.ino || !actual.isFile() || actual.nlink !== 1 || actual.size > MAX_BYTES || actual.mode & 63) throw fault("CONTROLLER_INVENTORY_UNSAFE");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}
function writePrivate(path, value, { exclusive = false } = {}) {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw fault("CONTROLLER_INVENTORY_CAPACITY");
  const tmp = exclusive ? path : path + "." + randomUUID() + ".tmp";
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!exclusive) renameSync(tmp, path);
  const dir = openSync(dirname(path), constants.O_RDONLY);
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
function inspectOwnedProcess(pid) {
  if (!validPid(pid)) throw fault("CONTROLLER_PROCESS_INVALID");
  let output;
  try {
    output = execFileSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid=,lstart="], { encoding: "utf8", timeout: 500, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } });
  } catch (e) {
    if (e.status === 1 && !String(e.stdout ?? "").trim()) return null;
    throw fault("CONTROLLER_PROCESS_UNKNOWN");
  }
  const m = output.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!m || Number(m[1]) !== pid) throw fault("CONTROLLER_PROCESS_UNKNOWN");
  return { pid, ppid: Number(m[2]), pgid: Number(m[3]), startToken: m[4] };
}
function inspectOwnedGroup(pgid) {
  let output;
  try {
    output = execFileSync("pgrep", ["-g", String(pgid)], { encoding: "utf8", timeout: 500, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (e.status === 1 && !String(e.stdout ?? "").trim()) return [];
    throw fault("CONTROLLER_GROUP_UNKNOWN");
  }
  const ids = output.trim().split(/\s+/).map(Number);
  if (ids.length > 128 || ids.some((n) => !validPid(n))) throw fault("CONTROLLER_GROUP_UNKNOWN");
  return ids.map(inspectOwnedProcess).filter(Boolean);
}
function strictProcessAbsent(target, killProcess = process.kill) {
  try {
    killProcess(target, 0);
    return false;
  } catch (e) {
    if (e.code === "ESRCH") return true;
    throw fault("CONTROLLER_ABSENCE_UNKNOWN");
  }
}
function readControllerSnapshot(path) {
  let db;
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw fault("CONTROLLER_JOURNAL_UNSAFE");
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout=100; BEGIN");
    const identity = db.prepare("SELECT world,soul FROM identity WHERE singleton=1").get(), c = db.prepare("SELECT revision,payload FROM checkpoint WHERE singleton=1").get(), owner = db.prepare("SELECT owner,generation FROM controller WHERE singleton=1").get();
    if (!identity || c && Buffer.byteLength(c.payload) > 65536) throw fault("CONTROLLER_SNAPSHOT_INVALID");
    const value = c ? JSON.parse(c.payload) : null, ops = db.prepare("SELECT id,status,generation FROM operations WHERE status<>'settled' ORDER BY id LIMIT 65").all();
    if (ops.length > 64) throw fault("CONTROLLER_OPERATION_CAPACITY");
    db.exec("COMMIT");
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino) throw fault("CONTROLLER_JOURNAL_CHANGED");
    return { journalIdentity: sha(`${realpathSync(path)}:${before.dev}:${before.ino}`), worldId: identity.world, soulId: identity.soul, revision: c?.revision ?? 0, valueSha256: sha(JSON.stringify(value)), threadId: value?.threadId ?? null, instructionSha256: sha(JSON.stringify(value?.initialInstruction ?? null)), generation: owner?.generation ?? 0, ownerSha256: owner ? sha(owner.owner) : null, recoveryPending: !!(value?.pendingDecision || value?.decisionProgressV1 || value?.urgentRecoveryV1 || ops.length), operations: ops.map((o) => ({ ...o })) };
  } finally {
    db?.close();
  }
}
function validateLedger(ledger, path) {
  if (ledger?.version !== 1 || typeof ledger.id !== "string" || ledger.path !== path || !Array.isArray(ledger.controllers) || ledger.controllers.length > MAX_CONTROLLERS || ledger.controllers.reduce((n, c) => n + (c.hosts?.length ?? MAX_HOSTS + 1), 0) > MAX_HOSTS) throw fault("CONTROLLER_INVENTORY_INVALID");
  return ledger;
}
function createControllerOwner({ state, inspectProcess = inspectOwnedProcess, inspectGroup = inspectOwnedGroup, killProcess = process.kill, sleep = abortableSleep, now = Date.now } = {}) {
  const directory = resolve(state);
  mkdirSync(directory, { recursive: true, mode: 448 });
  if (lstatSync(directory).isSymbolicLink()) throw fault("CONTROLLER_INVENTORY_UNSAFE");
  const path = join(realpathSync(directory), "controller-ownership.json"), lock = path + ".lock", launcher = inspectProcess(process.pid);
  if (!launcher) throw fault("CONTROLLER_PROCESS_UNKNOWN");
  writePrivate(lock, { launcher, at: now() }, { exclusive: true });
  let ledger, failure = null;
  try {
    let existing;
    try {
      existing = readPrivate(path);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    ledger = existing ? validateLedger(existing, path) : { version: 1, id: randomUUID(), path, controllers: [] };
    if (ledger.controllers.some((c) => c.state !== "closed")) throw fault("CONTROLLER_PRIOR_OWNER_UNCONFIRMED");
    if (ledger.controllers.length) {
      let hadJournal = false;
      for (const c of ledger.controllers) {
        let proof;
        try {
          proof = readPrivate(c.proofPath);
        } catch {
          throw fault("CONTROLLER_PRIOR_OWNER_UNCONFIRMED");
        }
        if (!c.birth || !c.exit || c.proofSha256 !== sha(JSON.stringify(proof)) || proof.epoch !== c.epoch || proof.inventoryId !== ledger.id || c.hosts.some((h) => h.state !== "closed" || !h.birth || h.closeProof?.hostPid !== h.birth.pid || h.closeProof.groupClosed !== true || h.closeProof.groupVerification !== "absent")) throw fault("CONTROLLER_PRIOR_OWNER_UNCONFIRMED");
        hadJournal ||= !!proof.snapshot;
      }
      let snapshot = null;
      try {
        snapshot = readControllerSnapshot(join(directory, "continuity.sqlite"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        if (hadJournal) throw fault("CONTROLLER_PRIOR_JOURNAL_MISSING");
      }
      if (snapshot?.recoveryPending) throw fault("CONTROLLER_PRIOR_RECOVERY_PENDING");
      const previous = ledger;
      writePrivate(path + "." + previous.id + ".closed.json", previous, { exclusive: true });
      ledger = { version: 1, id: randomUUID(), path, controllers: [], previousInventoryId: previous.id };
      writePrivate(path, ledger);
    }
  } catch (e) {
    unlinkSync(lock);
    throw e;
  }
  const save = () => {
    if (failure) throw failure;
    try {
      writePrivate(path, ledger);
    } catch (e) {
      failure = e;
      throw e;
    }
  };
  const absent = (target) => strictProcessAbsent(target, killProcess);
  const groupGone = async (pgid, deadline) => {
    for (; ; ) {
      try {
        killProcess(-pgid, 0);
        return false;
      } catch (e) {
        if (e.code === "ESRCH") return true;
        if (e.code !== "EPERM") throw fault("CONTROLLER_ABSENCE_UNKNOWN");
      }
      if (now() >= deadline) throw fault("CONTROLLER_HOST_CLEANUP_UNVERIFIED");
      await sleep(25);
    }
  };
  const anchor = (host) => {
    const leader = inspectProcess(host.birth.pid);
    if (!leader) throw fault("CONTROLLER_HOST_LEADER_GONE");
    if (!same(leader, host.birth)) throw fault("CONTROLLER_HOST_BIRTH_CHANGED");
    const members = inspectGroup(host.birth.pgid), map = new Map(members.map((p) => [p.pid, p]));
    if (!map.has(leader.pid)) throw fault("CONTROLLER_GROUP_UNKNOWN");
    for (const p of members) {
      if (p.pgid !== host.birth.pgid) throw fault("CONTROLLER_GROUP_UNKNOWN");
      let current = p, seen = /* @__PURE__ */ new Set();
      while (current.pid !== leader.pid) {
        if (seen.has(current.pid) || !map.has(current.ppid)) throw fault("CONTROLLER_GROUP_ANCESTRY_UNKNOWN");
        seen.add(current.pid);
        current = map.get(current.ppid);
      }
    }
    return members;
  };
  const cleanup = async (host, deadline) => {
    if (host.state === "starting" || !host.birth) throw fault("CONTROLLER_HOST_RESERVATION_INCOMPLETE");
    if (host.state === "closed") {
      if (host.closeProof?.hostPid !== host.birth.pid || host.closeProof.groupClosed !== true || host.closeProof.groupVerification !== "absent") throw fault("CONTROLLER_HOST_CLOSURE_INVALID");
      return "prior-verified";
    }
    if (await groupGone(host.birth.pgid, deadline)) {
      if (host.state !== "closed" && !absent(host.birth.pid)) throw fault("CONTROLLER_HOST_BIRTH_CHANGED");
      return;
    }
    let members;
    for (const [signal, grace] of [["SIGTERM", 1e3], ["SIGKILL", 5e3]]) {
      if (now() >= deadline) throw fault("CONTROLLER_HOST_CLEANUP_UNVERIFIED");
      try {
        members = anchor(host);
      } catch (e) {
        if (e.code !== "CONTROLLER_HOST_LEADER_GONE" && !(await groupGone(host.birth.pgid, deadline) && absent(host.birth.pid))) throw e;
        while (now() < deadline) {
          if (await groupGone(host.birth.pgid, deadline) && absent(host.birth.pid)) return;
          await sleep(25);
        }
        if (await groupGone(host.birth.pgid, deadline) && absent(host.birth.pid)) return;
        throw fault("CONTROLLER_HOST_CLEANUP_UNVERIFIED");
      }
      try {
        killProcess(-host.birth.pgid, signal);
      } catch (e) {
        if (e.code !== "ESRCH" && e.code !== "EPERM") throw fault("CONTROLLER_CLEANUP_SIGNAL_UNKNOWN");
      }
      const end = Math.min(deadline, now() + grace);
      while (now() < end) {
        if (await groupGone(host.birth.pgid, deadline) && members.every((p) => absent(p.pid))) return;
        await sleep(25);
      }
      if (await groupGone(host.birth.pgid, deadline) && members.every((p) => absent(p.pid))) return;
    }
    throw fault("CONTROLLER_HOST_CLEANUP_UNVERIFIED");
  };
  return {
    path,
    reserveController(reentryPath = null) {
      if (ledger.controllers.length >= MAX_CONTROLLERS || ledger.controllers.reduce((n, c) => n + c.hosts.length, 0) >= MAX_HOSTS) throw fault("CONTROLLER_INVENTORY_CAPACITY");
      const epoch = randomUUID();
      ledger.controllers.push({ epoch, launcher, birth: null, state: "starting", hosts: [], reentryPath, at: now() });
      save();
      return epoch;
    },
    registerController(epoch, pid) {
      const c = ledger.controllers.find((c2) => c2.epoch === epoch);
      if (c?.state !== "starting") throw fault("CONTROLLER_RESERVATION_INVALID");
      const birth = inspectProcess(pid);
      if (!birth || birth.ppid !== launcher.pid || birth.pid === launcher.pid || birth.pgid === pid) throw fault("CONTROLLER_BIRTH_UNPROVEN");
      c.birth = birth;
      c.state = "running";
      save();
    },
    environment(epoch) {
      return { ...process.env, SIM_SOUL_CONTROLLER_INVENTORY: path, SIM_SOUL_CONTROLLER_EPOCH: epoch };
    },
    async controllerExited(epoch, exit) {
      ledger = validateLedger(readPrivate(path), path);
      const c = ledger.controllers.find((c2) => c2.epoch === epoch);
      if (!c?.birth || c.birth.ppid !== c.launcher.pid || !same(c.launcher, launcher) || !["running", "exited"].includes(c.state)) throw fault("CONTROLLER_BIRTH_UNPROVEN");
      if (!absent(c.birth.pid)) throw fault("CONTROLLER_EXIT_UNVERIFIED");
      c.state = "exited";
      c.exit = { code: exit.code ?? null, signal: exit.signal ?? null, at: now() };
      save();
      const cleanupDeadline = now() + 6e3;
      for (const host of c.hosts) {
        if (host.birth && (!validPid(host.birth.pid) || host.birth.ppid !== c.birth.pid || host.birth.pgid !== host.birth.pid || host.birth.pgid === launcher.pgid || host.birth.pgid === c.birth.pgid)) throw fault("CONTROLLER_GROUP_UNSAFE");
        const prior = await cleanup(host, cleanupDeadline);
        host.closure = prior ?? "post-exit";
        host.state = "closed";
        if (prior !== "prior-verified") host.closeProof = { hostPid: host.birth.pid, groupClosed: true, groupVerification: "absent", verifiedAt: now() };
        save();
      }
      let snapshot = null;
      try {
        snapshot = readControllerSnapshot(join(directory, "continuity.sqlite"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const proof = { version: 1, id: randomUUID(), inventoryId: ledger.id, epoch, launcher, controller: c.birth, exit: c.exit, hosts: c.hosts.map((h) => ({ birth: h.birth, closeProof: h.closeProof, closure: h.closure })), snapshot, at: now() };
      const proofPath = path + "." + epoch + ".reentry.json";
      writePrivate(proofPath, proof, { exclusive: true });
      c.state = "closed";
      c.proofPath = proofPath;
      c.proofSha256 = sha(JSON.stringify(proof));
      save();
      return proofPath;
    },
    close() {
      if (ledger.controllers.some((c) => c.state !== "closed")) throw fault("CONTROLLER_INVENTORY_UNCLOSED");
      unlinkSync(lock);
    }
  };
}

// tools/soul-runtime/launch.mjs
async function superviseProcess({ args = [], signal, seconds = null, onState = () => {
}, spawnProcess = spawn, node = process.execPath, script = fileURLToPath(new URL("./run.mjs", import.meta.url)), maxDeaths = 3, ownershipDirectory = null } = {}) {
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 1 || seconds > 604800)) throw Error("seconds must be1..604800");
  const stop = new AbortController(), abort = () => stop.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = seconds === null ? null : setTimeout(abort, seconds * 1e3);
  let deaths = 0, child, reentryPath = null, ownership = null, failure = null;
  try {
    ownership = ownershipDirectory ? createControllerOwner({ state: ownershipDirectory }) : null;
    while (!stop.signal.aborted) {
      const started = Date.now(), epoch = ownership?.reserveController(reentryPath);
      child = spawnProcess(node, [script, ...args], { stdio: "inherit", ...ownership ? { env: ownership.environment(epoch) } : {} });
      let killTimer, hasExited = false;
      const completion = new Promise((resolve3, reject) => {
        child.once("error", (e) => {
          hasExited = true;
          reject(e);
        });
        child.once("exit", (code, signal2) => {
          hasExited = true;
          resolve3({ code, signal: signal2 });
        });
      });
      completion.catch(() => {
      });
      const terminate = () => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1e4);
      };
      stop.signal.addEventListener("abort", terminate, { once: true });
      if (stop.signal.aborted) terminate();
      let ended;
      try {
        ownership?.registerController(epoch, child.pid);
        onState({ state: "controller-started", pid: child.pid });
        ended = await completion;
      } finally {
        if (!hasExited) {
          terminate();
          await completion.catch(() => {
          });
        }
        clearTimeout(killTimer);
        stop.signal.removeEventListener("abort", terminate);
        if (ownership && hasExited) reentryPath = await ownership.controllerExited(epoch, ended ?? { code: null, signal: null });
      }
      if (stop.signal.aborted || ended.code === 0) return;
      if (!ended.signal) throw Object.assign(Error("Controller exited with an explicit failure; state retained"), { code: "CONTROLLER_FAILED", exitCode: ended.code });
      if (Date.now() - started >= 6e4) deaths = 0;
      if (++deaths > maxDeaths) throw Object.assign(Error("Controller repeatedly died; state retained"), { code: "CONTROLLER_DEATH_LIMIT" });
      onState({ state: "controller-restarting", signal: ended.signal, attempt: deaths });
      await abortableSleep(1e3 * deaths, stop.signal);
    }
  } catch (e) {
    failure = e;
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (failure) {
      try {
        ownership?.close();
      } catch {
      }
    } else ownership?.close();
  }
}
async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  let seconds = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--seconds") {
      seconds = Number(args[i + 1]);
      args.splice(i, 2);
      i--;
    } else if (args[i].startsWith("--seconds=")) {
      seconds = Number(args[i].slice(10));
      args.splice(i, 1);
      i--;
    }
  }
  const stop = new AbortController(), quit = () => stop.abort();
  process.once("SIGINT", quit);
  process.once("SIGTERM", quit);
  const option = (name) => {
    const i = args.indexOf("--" + name), inline = args.find((a) => a.startsWith("--" + name + "="));
    return i >= 0 ? args[i + 1] : inline?.slice(name.length + 3);
  };
  const folder = resolve2(option("folder") ?? process.cwd()), ownershipDirectory = args.includes("--help") ? null : resolve2(option("state") ?? join2(folder, ".soul-runtime"));
  try {
    await superviseProcess({ args, seconds, ownershipDirectory, signal: stop.signal, onState: (s) => console.log(JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...s })) });
  } finally {
    process.removeListener("SIGINT", quit);
    process.removeListener("SIGTERM", quit);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve2(process.argv[1])).href) main().catch((e) => {
  console.error(JSON.stringify({ state: "blocked", code: e.code ?? "launcher.failure", reason: e.message }));
  process.exitCode = 1;
});
export {
  main,
  superviseProcess
};
