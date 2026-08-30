const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, shell, screen } = require('electron');
const { execFileSync, execFile } = require('node:child_process');
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

/** Async variant so an osascript round-trip can overlap the clipboard poll. */
const osaAsync = (script) =>
  new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout) =>
      resolve(err ? '' : String(stdout).trim()),
    );
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Grab the current selection by sending Cmd-C. More reliable across apps than
 * reading the accessibility selection — works in browsers, PDFs, native apps.
 * The previous clipboard contents are restored afterwards.
 */
// NOTE: clipboard.readText()/writeText() are ASYNC as of Electron 44 — they were
// synchronous for years. Without the awaits you end up putting "[object Promise]"
// on the user's clipboard and shipping a Promise over IPC.
/**
 * Frontmost app name. lsappinfo measures ~35ms against ~221ms for the
 * equivalent System Events query, which enumerates every running process.
 */
function frontAppAsync() {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', 'lsappinfo info -only name `lsappinfo front`'], { timeout: 3000 }, (err, stdout) => {
      const m = String(stdout || '').match(/"LSDisplayName"\s*=\s*"(.*)"/);
      resolve(err || !m ? '' : m[1]);
    });
  });
}

const sendCopy = () => osaAsync('tell application "System Events" to keystroke "c" using command down');

/**
 * The FIRST clipboard.readText() after idle costs 500-1800ms — a cold pasteboard
 * wake. Subsequent reads are ~15ms. So keep it warm on a timer and keep the last
 * value, which also means summon() already has `prev` and never pays that cost.
 */
let lastClip = '';
function startClipboardWarmer() {
  const tick = async () => {
    try { lastClip = (await clipboard.readText()) || ''; } catch { /* ignore */ }
  };
  tick();
  setInterval(tick, 1500).unref?.();
}

/**
 * Returns the selection, or '' when nothing was selected.
 *
 * Critical: if the clipboard never changes, there was NO selection — we must not
 * fall back to whatever was already on the clipboard, or a stale copy from
 * minutes ago gets presented as the thing you just highlighted.
 */
async function grabSelection(prev) {
  const deadline = Date.now() + 250;
  while (Date.now() < deadline) {
    const now = (await clipboard.readText()) || '';
    if (now && now !== prev) return now;
    await sleep(15);
  }
  return '';
}

async function restoreClipboard(prev, text) {
  if (!prev || prev === text) return;
  try { await clipboard.writeText(String(prev)); } catch { /* nothing worth failing over */ }
}

function browserUrlAsync(appName) {
  if (appName === 'Safari') return osaAsync('tell application "Safari" to return URL of front document');
  if (/Chrome|Arc|Brave|Edge/i.test(appName)) {
    return osaAsync(`tell application "${appName}" to return URL of active tab of front window`);
  }
  return Promise.resolve('');
}

function createWindow() {
  win = new BrowserWindow({
    width: 640,
    height: 180,
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
  // 'screen-saver' is the level that floats above full-screen apps; the default
  // always-on-top level sits below them. Combined with visibleOnFullScreen the
  // HUD follows you across spaces instead of living only on desktop 1.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'hud.html'));
  // Deliberately NO blur handler — the HUD is a session surface you keep open
  // while reading. It closes on the X button or esc, nothing else.
}

function hide() {
  win?.hide();
}

async function summon() {
  const t0 = Date.now();
  try {
    if (!win) createWindow();

    // Show FIRST, and take no focus. showInactive leaves the source app focused,
    // which is exactly what Cmd-C needs; focus is stolen only once we have text.
    win.center();
    win.showInactive();
    win.webContents.send('capture:pending');
    const tShown = Date.now();

    // Warmed by the timer, so no cold pasteboard read on the critical path.
    const prev = lastClip;

    // Must resolve BEFORE win.focus() below, or lsappinfo reports the HUD itself
    // as the frontmost app. Started here, awaited once the text is in hand.
    const appP = frontAppAsync();

    await sendCopy();
    const tPoll = Date.now();
    const text = await grabSelection(prev);
    const tGrab = Date.now();

    if (text) await restoreClipboard(prev, text); // nothing copied ⇒ nothing to restore

    const appName = await appP;
    win.focus();
    win.webContents.send('capture:selection', { text, sourceApp: appName, sourceUrl: '' });
    console.log(
      `[summon] visible in ${tShown - t0}ms, text at ${tGrab - t0}ms ` +
      `(copy ${tPoll - tShown}, poll ${tGrab - tPoll}) chars=${text.length}`,
    );

    // Second pass: the URL, which targets the app by name and so is safe to run
    // after focus has moved.
    const url = await browserUrlAsync(appName);
    if (win && !win.isDestroyed()) {
      win.webContents.send('capture:source', { sourceApp: appName, sourceUrl: url });
    }
    console.log(`[summon] source +${Date.now() - tGrab}ms app=${JSON.stringify(appName)} url=${JSON.stringify(url)}`);
  } catch (e) {
    console.error('[summon] failed:', e?.message ?? e);
  }
}

app.whenReady().then(() => {
  createWindow();
  startClipboardWarmer();
  const ok = globalShortcut.register(HOTKEY, summon);
  console.log(ok ? `inbox HUD ready — press ${HOTKEY}` : `FAILED to register ${HOTKEY} (already taken?)`);
  if (process.platform === 'darwin') app.dock?.hide(); // menu-bar-less background agent
});

const post = async (route, payload) => {
  const res = await fetch(`http://localhost:${PORT}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
};

ipcMain.handle('capture:save', (_e, payload) => post('/save', payload));
ipcMain.handle('capture:file', (_e, payload) => post('/file', payload));

ipcMain.on('capture:dismiss', hide);
ipcMain.on('capture:resize', (_e, h) => {
  if (!win) return;
  const b = win.getBounds();
  const height = Math.max(120, Math.min(520, Math.round(h)));
  const { workArea } = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
  win.setBounds({
    x: b.x,
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width: b.width,
    height,
  }, false);
});
ipcMain.on('capture:open-vault', () => shell.openPath(path.join(__dirname, '..', 'vault')));

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault()); // stay resident for the hotkey
