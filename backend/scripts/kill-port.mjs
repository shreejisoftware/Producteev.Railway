import { execSync } from 'node:child_process';

function safeExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

function sleepMs(ms) {
  // Node-friendly sleep without extra deps
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

const port = Number(process.argv[2] || process.env.PORT || 4000);
if (!Number.isFinite(port)) process.exit(0);

const isWin = process.platform === 'win32';

function getPidsListeningOnPort(p) {
  if (isWin) {
    const out = safeExec(`netstat -ano | findstr ":${p}" | findstr LISTENING`);
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/).at(-1))
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  // macOS / Linux
  const out = safeExec(`lsof -ti tcp:${p} -sTCP:LISTEN || true`);
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const pids = Array.from(new Set(getPidsListeningOnPort(port)));
if (pids.length === 0) process.exit(0);

for (const pid of pids) {
  try {
    if (isWin) safeExec(`taskkill /PID ${pid} /T /F`);
    else safeExec(`kill -9 ${pid}`);
  } catch {}
}

// Wait (briefly) until port is actually free.
for (let i = 0; i < 20; i++) {
  const still = Array.from(new Set(getPidsListeningOnPort(port)));
  if (still.length === 0) break;
  sleepMs(250);
}

