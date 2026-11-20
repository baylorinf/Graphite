'use strict';

// Only the main Graphite page can operate a project. Preview frames and school
// windows share none of the file or process actions exposed to the editor.
function registerCodeWorkbench({ipcMain, url, getWindow, projects, runner}) {
  const startUrl = new URL(url);
  function isEditorFrame(frame, contents) {
    if (!frame || frame !== contents?.mainFrame) return false;
    try {
      const sender = new URL(frame.url);
      return sender.origin === startUrl.origin && (sender.pathname === '/' || sender.pathname === '/index.html');
    } catch { return false; }
  }
  function register(channel, service, actions) {
    ipcMain.handle(channel, async (event, action, args = {}) => {
      const win = getWindow();
      if (!win || win.isDestroyed() || event.sender !== win.webContents || !isEditorFrame(event.senderFrame, win.webContents)) {
        return {ok:false, code:'wrong_window', message:'Open the project in the Graphite editor.'};
      }
      if (!actions.includes(action) || !args || typeof args !== 'object' || Array.isArray(args)) {
        return {ok:false, code:'invalid_action', message:'Unknown project action.'};
      }
      try {
        const value = await service[action](args);
        return {...value, ok:true};
      } catch (error) {
        return {ok:false, code:error.code || 'project_error', message:error.message || 'The project action failed.'};
      }
    });
  }
  register('code-project', projects, ['status', 'choose', 'useVault', 'list', 'read', 'write', 'create', 'mkdir']);
  register('code-run', runner, ['tools', 'start', 'stop', 'debug']);
  return data => {
    const win = getWindow();
    if (win && !win.isDestroyed() && isEditorFrame(win.webContents.mainFrame, win.webContents)) {
      win.webContents.send('code-run-event', data);
    }
  };
}

module.exports = {registerCodeWorkbench};
