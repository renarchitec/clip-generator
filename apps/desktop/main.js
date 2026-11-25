// Electron main: menjalankan worker bundel (PyInstaller) sebagai child process
// dan meneruskan event JSON-per-baris dari stdout-nya ke renderer.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const OUT_DIR = path.join(os.homedir(), 'DartClip', 'clips');

function workerBinary() {
  const candidates = [
    process.env.DARTCLIP_WORKER_BIN,
    path.join(process.resourcesPath || '', 'dartclip-worker', 'dartclip-worker'),
    path.join(__dirname, '..', '..', 'worker', 'desktop', 'dist', 'dartclip-worker', 'dartclip-worker'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

let current = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 620,
    title: 'DartClip (spike)',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  ipcMain.handle('render', (_event, opts) => {
    if (current) return { ok: false, error: 'Render lain masih berjalan.' };
    const bin = workerBinary();
    if (!bin) return { ok: false, error: 'Worker belum dibangun: jalankan worker/desktop/build-mac.sh' };

    const args = ['--url', opts.url, '--out', OUT_DIR, '--encoder', opts.encoder];
    for (const range of opts.ranges) args.push('--range', range);
    const started = Date.now();
    const child = spawn(bin, args, { env: { ...process.env } });
    current = child;

    const send = (channel, payload) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    };
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        send('worker-event', JSON.parse(line));
      } catch {
        send('worker-log', line);
      }
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => send('worker-log', line));
    child.on('close', (code) => {
      current = null;
      send('worker-exit', { code, seconds: (Date.now() - started) / 1000 });
    });
    child.on('error', (err) => {
      current = null;
      send('worker-exit', { code: -1, error: err.message });
    });
    return { ok: true, bin };
  });

  ipcMain.handle('reveal', (_event, file) => shell.showItemInFolder(file));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (current) current.kill('SIGTERM');
  app.quit();
});
