// Small, safe bridge between the app page and the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

// Put back the settings saved when the app last closed, before the page's own scripts read them.
// (The built-in server's address changes at every launch, which would otherwise start them empty.)
try {
  const saved = ipcRenderer.sendSync('storage-load') || {};
  for (const [k, v] of Object.entries(saved)) if (typeof v === 'string') window.localStorage.setItem(k, v);
} catch (e) { console.warn('Could not restore settings', e); }

contextBridge.exposeInMainWorld('myobsidianDesktop', {
  isDesktop: true,
  // Ask which folder to use as the vault; the app restarts on the new vault.
  chooseVault: () => ipcRenderer.invoke('choose-vault'),
  // Keep the desktop dialogs in the same language as the app.
  setLanguage: code => ipcRenderer.send('set-language', code),
  // Updates: ask whether a newer version exists, get told when one appears, install it.
  checkUpdates: ({ force = false } = {}) => ipcRenderer.invoke('update-check', { force: force === true }),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: cb => ipcRenderer.on('update-state', (_e, state) => cb(state)),
  copyText: text => ipcRenderer.invoke('copy-text', String(text)),
  codeProject: (action, args = {}) => ipcRenderer.invoke('code-project', action, args),
  codeRun: (action, args = {}) => ipcRenderer.invoke('code-run', action, args),
  onCodeRun: cb => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('code-run-event', listener);
    return () => ipcRenderer.removeListener('code-run-event', listener);
  },
  // Actions chosen in the right-click menu (format selection, search, run a command).
  onAppCommand: cb => ipcRenderer.on('app-command', (_e, cmd) => cb(cmd)),
});
