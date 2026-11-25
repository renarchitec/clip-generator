const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const host = '127.0.0.1';
const keyFields = ['nineRouterApiKey', 'geminiApiKey', 'openaiApiKey'];

function getDataDir() {
  return path.resolve(process.env.DARTCLIP_DATA_DIR || path.join(os.homedir(), 'DartClip'));
}

function resolveDesktopPaths({ isPackaged, resourcesPath, repoRoot, workerBin = process.env.DARTCLIP_WORKER_BIN }) {
  const apiDir = isPackaged ? path.join(resourcesPath, 'api') : path.join(repoRoot, 'apps', 'api');
  const workerDir = isPackaged
    ? path.join(resourcesPath, 'dartclip-worker')
    : path.join(repoRoot, 'worker', 'desktop', 'dist', 'dartclip-worker');
  return {
    apiDir,
    apiEntry: path.join(apiDir, 'dist', 'main.js'),
    sqliteClientPath: path.join(apiDir, 'node_modules', '.prisma', 'sqlite-client'),
    sqliteInitSql: path.join(apiDir, 'prisma', 'sqlite-init.sql'),
    workerBin: workerBin ? path.resolve(workerBin) : path.join(workerDir, 'dartclip-worker'),
    webDistDir: isPackaged ? path.join(resourcesPath, 'web') : path.join(repoRoot, 'apps', 'web', 'dist-desktop'),
  };
}

async function startApiProcess({ dataDir = getDataDir(), ...layout }) {
  dataDir = path.resolve(dataDir);
  const paths = resolveDesktopPaths(layout);
  const internalToken = randomBytes(32).toString('hex');
  const nodeBin = process.env.DARTCLIP_NODE_BIN || process.execPath;
  const tempRoot = path.join(dataDir, 'tmp');
  const logDir = path.join(dataDir, 'logs');
  const logPath = path.join(logDir, 'desktop-api.log');
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(logPath, 'a', 0o600);
  const recent = [];
  const secrets = new Set();
  function remember(value) {
    if (typeof value !== 'string' || !value) return;
    secrets.add(value);
    secrets.add(JSON.stringify(value).slice(1, -1));
    try { secrets.add(encodeURIComponent(value)); } catch { /* malformed surrogate */ }
  }
  remember(internalToken);
  function redact(text) {
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      text = text.replaceAll(secret, '[redacted]');
    }
    return text;
  }
  function logLine(source, line) {
    const entry = `[${source}] ${redact(line)}`;
    recent.push(entry.slice(0, 1000));
    if (recent.length > 15) recent.shift();
    try { fs.writeSync(log, `${entry}\n`); } catch { /* logging failure must not crash the app */ }
  }

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DARTCLIP_MODE: 'desktop',
    DATABASE_URL: `file:${path.join(dataDir, 'dartclip.db')}`,
    CLIPS_DIR: dataDir,
    TEMP_ROOT: tempRoot,
    HOST: host,
    PORT: '0',
    DARTCLIP_INTERNAL_TOKEN: internalToken,
    DARTCLIP_SQLITE_CLIENT_PATH: paths.sqliteClientPath,
    DARTCLIP_SQLITE_INIT_SQL: paths.sqliteInitSql,
    DARTCLIP_WORKER_BIN: paths.workerBin,
  };
  // The saved desktop settings are the source of credentials, not the shell environment.
  for (const name of Object.keys(env)) {
    if (/API_KEY$/i.test(name)) {
      remember(env[name]);
      delete env[name];
    }
  }
  delete env.DARTCLIP_LLM_CONFIG_PATH;

  let child;
  try {
    child = spawn(nodeBin, [paths.apiEntry], { cwd: dataDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    fs.closeSync(log);
    throw new Error(`Could not start the local API: ${redact(error.message)}. Log: ${logPath}`);
  }
  let closed = false;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const drained = new Promise((resolve) => child.once('close', (code, signal) => {
    closed = true;
    fs.closeSync(log);
    resolve({ code, signal });
  }));
  let stopping;
  function stop() {
    stopping ??= (async () => {
      if (closed) return;
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        child.kill('SIGTERM');
        let timer;
        try {
          const forced = await Promise.race([
            exited.then(() => false),
            new Promise((resolve) => { timer = setTimeout(resolve, 5000, true); }),
          ]);
          if (forced && child.kill('SIGKILL')) await exited;
        } finally {
          clearTimeout(timer);
        }
      }
    })();
    return stopping;
  }

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    logLine('stdout', line);
    try {
      const event = JSON.parse(line);
      if (event?.event === 'ready' && event.host === host && Number.isInteger(event.port)
          && event.port > 0 && event.port <= 65535) resolveReady({ port: event.port });
    } catch { /* other output is plain text */ }
  });
  readline.createInterface({ input: child.stderr }).on('line', (line) => logLine('stderr', line));
  const spawnError = new Promise((resolve) => child.on('error', (error) => {
    logLine('process', error.message);
    resolve({ reason: `Could not start the local API: ${redact(error.message)}` });
  }));
  let timer;
  const outcome = await Promise.race([
    ready,
    spawnError,
    drained.then(({ code, signal }) => ({ reason: `The local API exited before startup (${signal || `code ${code}`}).` })),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ reason: 'The local API did not start within 30 seconds.' }), 30_000);
    }),
  ]);
  clearTimeout(timer);
  if (!outcome.port) {
    await stop();
    const details = recent.length ? `\n\nRecent API output:\n${recent.join('\n')}` : '';
    throw new Error(`${outcome.reason}\nLog: ${logPath}${details}`);
  }

  const { port } = outcome;
  const baseUrl = `http://${host}:${port}`;
  async function post(endpoint, options = {}) {
    const response = await fetch(`${baseUrl}/api/system/${endpoint}`, {
      ...options,
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(endpoint === 'llm-test' ? 60_000 : 10_000),
    });
    if (!response.ok) throw new Error(`Local API ${endpoint} failed (HTTP ${response.status}).`);
    return response.json();
  }
  return {
    port,
    baseUrl,
    pushConfig(runtimeConfig) {
      for (const field of keyFields) remember(runtimeConfig[field]);
      return post('desktop-config', {
        headers: { 'content-type': 'application/json', 'x-dartclip-internal-token': internalToken },
        body: JSON.stringify(runtimeConfig),
      });
    },
    async testLlm() {
      const result = await post('llm-test');
      for (const field of ['error', 'provider', 'model', 'baseUrl']) {
        if (typeof result[field] === 'string') result[field] = redact(result[field]);
      }
      return result;
    },
    stop,
  };
}

module.exports = { getDataDir, resolveDesktopPaths, startApiProcess };
