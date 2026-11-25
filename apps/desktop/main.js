const { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getDataDir, resolveDesktopPaths, startApiProcess } = require('./api-process');
const { SettingsStore } = require('./settings-store');
const { startStaticServer } = require('./static-server');

app.setName('DartClip');

const dataDir = getDataDir();
const logPath = path.join(dataDir, 'logs', 'desktop-api.log');
let mainWindow;
let api;
let web;
let settings;
let boot;
let bootError;
let quitting = false;
let cleanupDone = false;
let configPush = Promise.resolve();

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'DartClip', submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' },
      { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
}

function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function openExternal(url) {
  if (url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !['localhost', '[::1]', '0.0.0.0'].includes(url.hostname)
      && !url.hostname.replace(/\.$/, '').endsWith('.localhost')
      && url.hostname !== 'localhost.' && !/^127(?:\.\d+){3}$/.test(url.hostname)) {
    void shell.openExternal(url.href).catch(() => {});
  }
}

function isRenderer(event) {
  const frame = event.senderFrame;
  return Boolean(web && mainWindow && event.sender === mainWindow.webContents && frame
    && frame === event.sender.mainFrame && parseUrl(frame.url)?.origin === web.url);
}

function registerIpc() {
  ipcMain.on('desktop:bootstrap', (event) => {
    event.returnValue = isRenderer(event) ? { apiBaseUrl: api.baseUrl, clipsDir: dataDir } : {};
  });
  function handle(channel, callback) {
    ipcMain.handle(`desktop:${channel}`, (event, ...args) => {
      if (!isRenderer(event)) throw new Error('Desktop access is restricted to the DartClip window.');
      return callback(...args);
    });
  }
  handle('get-settings', () => settings.getView());
  handle('save-settings', async (patch) => {
    const view = settings.applyPatch(patch);
    const runtimeConfig = settings.getRuntimeConfig();
    const pending = configPush.then(() => api.pushConfig(runtimeConfig));
    configPush = pending.catch(() => {});
    await pending;
    return view;
  });
  handle('test-llm', async () => {
    await configPush;
    return api.testLlm();
  });
  handle('reveal-in-finder', (filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return { ok: false, error: 'No file path provided.' };
    const resolved = path.resolve(dataDir, filePath);
    if (!fs.existsSync(resolved)) return { ok: false, error: 'File not found.' };
    try {
      shell.showItemInFolder(resolved);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not reveal the file in Finder.' };
    }
  });
  handle('open-clips-folder', async () => {
    try { return { ok: (await shell.openPath(dataDir)) === '' }; }
    catch { return { ok: false }; }
  });
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function errorPage(error) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DartClip</title></head>
    <body><main><h1>DartClip couldn’t start</h1>
    <p>Check the API log below, then quit and reopen DartClip.</p>
    <p>API log: <code>${escapeHtml(logPath)}</code></p>
    <pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(error.message || error)}</pre></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  if (quitting || mainWindow) return;
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 660,
    title: 'DartClip',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(bootError ? {} : {
        preload: path.join(__dirname, 'preload.js'),
        additionalArguments: [`--dartclip-api-base-url=${api.baseUrl}`, `--dartclip-clips-dir=${dataDir}`],
      }),
    },
  });
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = undefined; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(parseUrl(url));
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    const url = parseUrl(event.url || target);
    if (!web || url?.origin !== web.url) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on('will-redirect', (event, target) => {
    if (!web || parseUrl(event.url || target)?.origin !== web.url) event.preventDefault();
  });
  void win.loadURL(bootError ? errorPage(bootError) : web.url).catch((error) => {
    if (!bootError && !win.isDestroyed() && !quitting) {
      bootError = error;
      win.destroy();
      createWindow();
    }
  });
}

async function stopServices() {
  await Promise.allSettled([api?.stop(), web?.close()]);
}

async function start() {
  try {
    const layout = {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      repoRoot: path.resolve(__dirname, '../..'),
    };
    api = await startApiProcess({ ...layout, dataDir });
    if (quitting) return;
    settings = new SettingsStore({ dataDir, safeStorage });
    await api.pushConfig(settings.getRuntimeConfig());
    if (quitting) return;
    web = await startStaticServer(resolveDesktopPaths(layout).webDistDir);
  } catch (error) {
    bootError = error;
    await stopServices();
  }
  createWindow();
}

function quitAfterCleanup(event) {
  if (cleanupDone) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    await boot;
    await stopServices();
    cleanupDone = true;
    app.quit();
  })();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    if (mainWindow) mainWindow.focus();
    else if (web || bootError) createWindow();
  });
  app.on('activate', () => { if (web || bootError) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !bootError) app.quit(); });
  app.on('before-quit', quitAfterCleanup);
  app.on('will-quit', quitAfterCleanup);
  app.whenReady().then(() => {
    if (quitting) return;
    installMenu();
    registerIpc();
    boot = start();
  });
}
