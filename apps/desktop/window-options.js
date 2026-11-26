const THEME_BACKGROUND = {
  dark: '#09090b',
  light: '#ffffff',
};

function themeBackgroundColor(shouldUseDarkColors) {
  return shouldUseDarkColors ? THEME_BACKGROUND.dark : THEME_BACKGROUND.light;
}

function normalizeThemeSource(value) {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function buildMenuTemplate() {
  return [
    { label: 'DartClip', submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' },
      { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
}

function buildWindowOptions({ shouldUseDarkColors, bootError, preloadPath, apiBaseUrl, dataDir }) {
  return {
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 660,
    title: 'DartClip',
    backgroundColor: themeBackgroundColor(shouldUseDarkColors),
    show: false,
    fullscreenable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(bootError ? {} : {
        preload: preloadPath,
        additionalArguments: [`--dartclip-api-base-url=${apiBaseUrl}`, `--dartclip-clips-dir=${dataDir}`],
      }),
    },
  };
}

module.exports = {
  THEME_BACKGROUND,
  themeBackgroundColor,
  normalizeThemeSource,
  buildMenuTemplate,
  buildWindowOptions,
};
