const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, shell } = require('electron');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PORT = process.env.PORT || 3737;
const HOTKEY = process.env.INBOX_HOTKEY || 'CommandOrControl+Shift+K';

let win = null;

const osa = (script) => {
  try {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 4000 }).trim();
  } catch {
    return '';
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Grab the current selection by sending Cmd-C. More reliable across apps than
 * reading the accessibility selection — works in browsers, PDFs, native apps.
 * The previous clipboard contents are restored afterwards.
 */
// NOTE: clipboard.readText()/writeText() are ASYNC as of Electron 44 — they were
// synchronous for years. Without the awaits you end up putting "[object Promise]"
// on the user's clipboard and shipping a Promise over IPC.
async function grabSelection() {
  const prev = (await clipboard.readText()) || '';
  // Don't clear the clipboard first — Electron rejects writeText('') outright.
  // Poll for a change instead, and fall back to whatever is already there.
  osa('tell application "System Events" to keystroke "c" using command down');
  let text = '';
  for (let i = 0; i < 24; i++) {
    await sleep(25);
    const now = (await clipboard.readText()) || '';
    if (now && now !== prev) { text = now; break; }
    text = now;
  }
  return { text: String(text ?? ''), prev: String(prev ?? '') };
}

async function restoreClipboard(prev, text) {
  if (!prev || prev === text) return;
  try { await clipboard.writeText(String(prev)); } catch { /* nothing worth failing over */ }
}

function frontApp() {
  return osa('tell application "System Events" to name of first application process whose frontmost is true');
}

function browserUrl(appName) {
  if (appName === 'Safari') return osa('tell application "Safari" to return URL of front document');
  if (/Chrome|Arc|Brave|Edge/i.test(appName)) {
    return osa(`tell application "${appName}" to return URL of active tab of front window`);
  }
  return '';
}

function createWindow() {
  win = new BrowserWindow({
    width: 640,
    height: 250,
    frame: false,
    transparent: true,
    vibrancy: 'hud',
    visualEffectState: 'active',
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'hud.html'));
  win.on('blur', () => { if (win?.isVisible()) hide(); });
}

function hide() {
  win?.hide();
  // Give focus back to whatever the user was reading.
  if (process.platform === 'darwin') app.hide();
}

async function summon() {
  try {
    if (!win) createWindow();
    if (win.isVisible()) return hide();

    const appName = frontApp();
    const { text, prev } = await grabSelection();
    const url = browserUrl(appName);
    await restoreClipboard(prev, text);

    console.log(`[summon] app=${JSON.stringify(appName)} chars=${text.length} url=${JSON.stringify(url)}`);
    win.center();
    win.show();
    win.focus();
    win.webContents.send('capture:selection', { text, sourceApp: appName, sourceUrl: url });
  } catch (e) {
    console.error('[summon] failed:', e?.message ?? e);
  }
}

app.whenReady().then(() => {
  createWindow();
  const ok = globalShortcut.register(HOTKEY, summon);
  console.log(ok ? `inbox HUD ready — press ${HOTKEY}` : `FAILED to register ${HOTKEY} (already taken?)`);
  if (process.platform === 'darwin') app.dock?.hide(); // menu-bar-less background agent
});

ipcMain.handle('capture:submit', async (_e, payload) => {
  const res = await fetch(`http://localhost:${PORT}/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
});

ipcMain.on('capture:dismiss', hide);
ipcMain.on('capture:resize', (_e, h) => {
  if (win) win.setBounds({ ...win.getBounds(), height: Math.round(h) }, true);
});
ipcMain.on('capture:open-vault', () => shell.openPath(path.join(__dirname, '..', 'vault')));

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault()); // stay resident for the hotkey
