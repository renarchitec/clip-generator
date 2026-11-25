const { contextBridge, ipcRenderer } = require('electron');

function getArgument(name) {
  const prefix = `--dartclip-${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const apiBaseUrl = getArgument('api-base-url');
const clipsDir = getArgument('clips-dir');
const fallback = apiBaseUrl && clipsDir ? {} : ipcRenderer.sendSync('desktop:bootstrap') ?? {};

contextBridge.exposeInMainWorld('dartclipDesktop', {
  isDesktop: true,
  apiBaseUrl: apiBaseUrl || fallback.apiBaseUrl || '',
  clipsDir: clipsDir || fallback.clipsDir || '',
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('desktop:save-settings', patch),
  testLlm: () => ipcRenderer.invoke('desktop:test-llm'),
  revealInFinder: (filePath) => ipcRenderer.invoke('desktop:reveal-in-finder', filePath),
  openClipsFolder: () => ipcRenderer.invoke('desktop:open-clips-folder'),
});
