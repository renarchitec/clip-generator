import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import settingsModule from '../settings-store.js';
import staticModule from '../static-server.js';
import apiModule from '../api-process.js';

const { SettingsStore, maskSecret } = settingsModule;
const { startStaticServer } = staticModule;
const { resolveDesktopPaths } = apiModule;

async function temporaryDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dartclip-desktop-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function mockSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value.split('').reverse().join('')),
    decryptString: (buffer) => buffer.toString().split('').reverse().join(''),
  };
}

test('settings defaults and renderer view contain no raw keys', async (t) => {
  const dataDir = await temporaryDir(t);
  const store = new SettingsStore({ dataDir });
  const defaults = {
    nineRouterUrl: 'https://9router.rencraft.site/v1', nineRouterModel: 'tabi-fixer',
    geminiModel: 'gemini-2.5-flash', openaiModel: 'gpt-4o-mini', videoEncoder: 'h264_videotoolbox',
  };
  assert.deepEqual(store.getRuntimeConfig(), defaults);
  assert.deepEqual(store.getView(), {
    ...defaults, hasNineRouterApiKey: false, nineRouterApiKeyHint: null, hasGeminiApiKey: false,
    geminiApiKeyHint: null, hasOpenaiApiKey: false, openaiApiKeyHint: null,
    encryptionAvailable: false, clipsDir: dataDir,
  });
  assert.equal(maskSecret('abc'), '••••');
  assert.equal(maskSecret('1234567890'), '123…7890');
});

test('settings encrypt, reload, replace and clear keys using a private file', async (t) => {
  const dataDir = await temporaryDir(t);
  const safeStorage = mockSafeStorage();
  const keys = {
    nineRouterApiKey: 'abc-router-1234',
    geminiApiKey: 'def-gemini-5678',
    openaiApiKey: 'ghi-openai-9012',
  };
  const store = new SettingsStore({ dataDir, safeStorage });
  const view = store.applyPatch({ ...keys, nineRouterModel: 'new-model', videoEncoder: 'libx264' });
  assert.deepEqual([view.nineRouterApiKeyHint, view.geminiApiKeyHint, view.openaiApiKeyHint],
    ['abc…1234', 'def…5678', 'ghi…9012']);
  assert.equal(view.encryptionAvailable, true);
  const file = path.join(dataDir, 'desktop-settings.json');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const text = await fs.readFile(file, 'utf8');
  const saved = JSON.parse(text);
  assert.deepEqual(saved.plainKeys, {});
  for (const [name, key] of Object.entries(keys)) {
    assert.ok(!text.includes(key));
    assert.ok(!JSON.stringify(view).includes(key));
    assert.equal(saved.encryptedKeys[name], safeStorage.encryptString(key).toString('base64'));
  }
  const reloaded = new SettingsStore({ dataDir, safeStorage });
  assert.deepEqual(reloaded.getView(), view);
  assert.deepEqual(reloaded.getRuntimeConfig(), store.getRuntimeConfig());
  reloaded.applyPatch({ nineRouterApiKey: 'replacement', geminiApiKey: ' ' });
  assert.equal(reloaded.getRuntimeConfig().nineRouterApiKey, 'replacement');
  assert.equal(reloaded.getRuntimeConfig().geminiApiKey, keys.geminiApiKey);
  const cleared = reloaded.applyPatch({ clearNineRouterApiKey: true, clearGeminiApiKey: true, clearOpenaiApiKey: true });
  assert.equal(cleared.hasNineRouterApiKey, false);
  assert.equal(cleared.hasGeminiApiKey, false);
  assert.equal(cleared.hasOpenaiApiKey, false);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).encryptedKeys, {});
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  for (const name of Object.keys(keys)) assert.ok(!(name in reloaded.getRuntimeConfig()));
});

test('settings fall back to private plaintext when encryption is unavailable or fails', async (t) => {
  const dataDir = await temporaryDir(t);
  const safeStorage = {
    isEncryptionAvailable: () => false,
    encryptString: () => assert.fail('should not encrypt'),
  };
  const store = new SettingsStore({ dataDir, safeStorage });
  assert.equal(store.applyPatch({ openaiApiKey: 'short' }).encryptionAvailable, false);
  const file = path.join(dataDir, 'desktop-settings.json');
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).plainKeys, { openaiApiKey: 'short' });
  const fallback = new SettingsStore({ dataDir, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString() { throw new Error('Keychain unavailable'); },
  } });
  assert.equal(fallback.applyPatch({ geminiApiKey: 'second' }).encryptionAvailable, false);
  assert.equal(fallback.getView().openaiApiKeyHint, '••••');
  assert.equal(new SettingsStore({ dataDir, safeStorage }).getRuntimeConfig().geminiApiKey, 'second');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const recovered = new SettingsStore({ dataDir, safeStorage: mockSafeStorage() });
  assert.equal(recovered.applyPatch({}).encryptionAvailable, true);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).plainKeys, {});
});

function rawRequest(port, target) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: target }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

test('static server serves files and SPA navigation without exposing neighboring files', async (t) => {
  const dir = await temporaryDir(t);
  const web = path.join(dir, 'web');
  const index = '<!doctype html><title>DartClip</title>';
  await fs.mkdir(path.join(web, 'assets'), { recursive: true });
  await fs.writeFile(path.join(web, 'index.html'), index);
  await fs.writeFile(path.join(web, 'assets/app.js'), 'export {};');
  await fs.writeFile(path.join(web, 'assets/theme.css'), 'body {}');
  await fs.writeFile(path.join(dir, 'private.js'), 'do not serve');
  await fs.symlink(path.join(dir, 'private.js'), path.join(web, 'assets/symlink.js'));
  const server = await startStaticServer(web);
  t.after(() => server.close());
  for (const route of ['/', '/index.html', '/jobs/abc?tab=clips']) {
    const response = await fetch(`${server.url}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(await response.text(), index);
  }
  const asset = await fetch(`${server.url}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await asset.text(), 'export {};');
  const head = await fetch(`${server.url}/assets/theme.css`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /text\/css/);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${server.url}/missing.js`)).status, 404);
  assert.equal((await fetch(`${server.url}/assets/symlink.js`)).status, 404);
  assert.equal(await rawRequest(server.port, '/../private.js'), 403);
  assert.equal(await rawRequest(server.port, '/%2e%2e%2fprivate.js'), 403);
});

test('desktop paths point to workspace builds in dev and Resources when packaged', () => {
  const repoRoot = path.resolve('repo');
  const resourcesPath = path.resolve('DartClip.app/Contents/Resources');
  for (const isPackaged of [false, true]) {
    const resolved = resolveDesktopPaths({ isPackaged, repoRoot, resourcesPath, workerBin: '' });
    const apiDir = isPackaged ? path.join(resourcesPath, 'api') : path.join(repoRoot, 'apps/api');
    assert.deepEqual(resolved, {
      apiDir,
      apiEntry: path.join(apiDir, 'dist/main.js'),
      sqliteClientPath: path.join(apiDir, 'node_modules/.prisma/sqlite-client'),
      sqliteInitSql: path.join(apiDir, 'prisma/sqlite-init.sql'),
      workerBin: isPackaged ? path.join(resourcesPath, 'dartclip-worker/dartclip-worker')
        : path.join(repoRoot, 'worker/desktop/dist/dartclip-worker/dartclip-worker'),
      webDistDir: isPackaged ? path.join(resourcesPath, 'web') : path.join(repoRoot, 'apps/web/dist-desktop'),
    });
  }
  assert.equal(resolveDesktopPaths({ isPackaged: true, resourcesPath, workerBin: './custom-worker' }).workerBin,
    path.resolve('custom-worker'));
});
