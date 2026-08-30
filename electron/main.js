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
 * Recolour the PAGE's selection highlight while capture is active, so the user
 * can see at a glance that the tool is listening. There is no way to restyle
 * another app's selection from outside, so for browsers we inject a ::selection
 * rule into the page itself.
 *
 * Requires Safari > Settings > Developer > "Allow JavaScript from Apple Events"
 * (or Chrome's View > Developer equivalent). Degrades silently when it is off —
 * capture still works, the highlight is just the OS default colour.
 */
const HL = 'rgba(167,139,250,0.55)';
const JS_ON =
  "(function(){var i='inbox-hl';if(document.getElementById(i))return 1;" +
  "var s=document.createElement('style');s.id=i;" +
  `s.textContent='::selection{background:${HL} !important}::-moz-selection{background:${HL} !important}';` +
  'document.documentElement.appendChild(s);return 1})()';
const JS_OFF = "(function(){var e=document.getElementById('inbox-hl');if(e)e.remove();return 1})()";

let injectedInto = '';

function pageJs(appName, js) {
  if (appName === 'Safari') {
    return osaAsync(`tell application "Safari" to do JavaScript "${js}" in current tab of front window`);
  }
  if (/Chrome|Brave|Edge/i.test(appName)) {
    return osaAsync(`tell application "${appName}" to execute active tab of front window javascript "${js}"`);
  }
  return Promise.resolve('');
}

async function paintSelection(appName) {
  const r = await pageJs(appName, JS_ON);
  injectedInto = String(r).includes('rror') ? '' : appName;
  if (!injectedInto && /Safari|Chrome|Brave|Edge/i.test(appName)) {
    console.log('[hl] page injection unavailable — enable "Allow JavaScript from Apple Events"');
  }
}

async function unpaintSelection() {
  if (!injectedInto) return;
  await pageJs(injectedInto, JS_OFF).catch(() => {});
  injectedInto = '';
}

/**
 * Live selection tracking.
 *
 * Safari does not expose web-content selections through AXSelectedText, so the
 * only way to read a selection is Cmd-C. That means the HUD must NOT hold focus
 * while tracking — if it does, the copy lands in the HUD instead of the page,
 * which is exactly the regression this replaces.
 *
 * So: the window shows inactive and polls. The moment the user clicks into it
 * (to type a note or hit Save) it takes focus, tracking stops, and the last
 * selection is frozen.
 */
let track = null;
let originalClip = '';
let sourceApp = '';

function stopTracking() {
  if (track) { clearTimeout(track); track = null; }
}

async function trackLoop() {
  if (!win || !win.isVisible() || win.isFocused()) { stopTracking(); return; }
  try {
    await sendCopy();
    const now = (await clipboard.readText()) || '';
    if (now && now !== lastClip) {
      lastClip = now;
      if (win && !win.isDestroyed()) win.webContents.send('capture:selection', { text: now, sourceApp });
    }
  } catch { /* keep polling */ }
  if (win?.isVisible() && !win.isFocused()) track = setTimeout(trackLoop, 500);
  else stopTracking();
}

/**
 * The FIRST clipboard.readText() after idle costs 500-1800ms — a cold pasteboard
 * wake. Subsequent reads are ~15ms. So keep it warm on a timer and keep the last
 * value, which also means summon() already has `prev` and never pays that cost.
 */
let lastClip = '';
function startClipboardWarmer() {
  const tick = async () => {
    if (track) return;                 // the tracking loop owns lastClip while it runs
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
    width: 430,
    height: 200,
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
    // NSPanel rather than NSWindow: macOS only lets a panel float over another
    // app's full-screen space. A plain window is confined to the desktop space
    // no matter what always-on-top level it is given.
    type: 'panel',
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
  // The HUD stays open when you click away (no hide-on-blur). Focus only decides
  // whether we are tracking: Cmd-C needs the SOURCE app focused, so tracking runs
  // exactly when the HUD is not focused.
  win.on('focus', stopTracking);
  win.on('blur', () => { if (win?.isVisible() && !track) trackLoop(); });
}

/** Park it top-right of the display under the cursor. Still draggable. */
function place() {
  if (!win) return;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const b = win.getBounds();
  win.setBounds({
    x: Math.round(workArea.x + workArea.width - b.width - 24),
    y: Math.round(workArea.y + 24),
    width: b.width,
    height: b.height,
  });
}

async function hide() {
  stopTracking();
  await unpaintSelection();
  win?.hide();
  // Tracking clobbers the clipboard repeatedly; put back what was there.
  if (originalClip) { try { await clipboard.writeText(originalClip); } catch {} }
}

async function summon() {
  const t0 = Date.now();
  try {
    if (!win) createWindow();

    // Show FIRST, and take no focus. showInactive leaves the source app focused,
    // which is exactly what Cmd-C needs; focus is stolen only once we have text.
    place();
    win.showInactive();
    win.webContents.send('capture:pending');
    const tShown = Date.now();

    originalClip = lastClip;
    const appName = await frontAppAsync();   // before any focus change
    sourceApp = appName;
    console.log(`[summon] visible in ${tShown - t0}ms app=${JSON.stringify(appName)} — tracking selection`);

    // Never focus here. The source app keeps focus so Cmd-C reaches the page.
    stopTracking();
    trackLoop();
    paintSelection(appName);

    const url = await browserUrlAsync(appName);
    if (win && !win.isDestroyed()) win.webContents.send('capture:source', { sourceApp: appName, sourceUrl: url });
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

/**
 * After a save the HUD still has focus, which keeps tracking stopped — that is
 * why a second highlight never appeared. Give focus back to the source app and
 * resume.
 */
ipcMain.on('capture:resume', async () => {
  if (!win || !win.isVisible()) return;
  if (sourceApp) await osaAsync(`tell application "${sourceApp}" to activate`);
  else win.blur();
  if (!track) trackLoop();
});

ipcMain.on('capture:dismiss', hide);
ipcMain.on('capture:resize', (_e, h) => {
  if (!win) return;
  const b = win.getBounds();
  // grow downward from the top-right anchor; never move x/y
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: Math.max(150, Math.min(760, Math.round(h))) }, false);
});

/** Capture tab is narrow; the dashboard tab needs room for the prototype grid. */
ipcMain.on('capture:shape', (_e, mode) => {
  if (!win) return;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wide = mode === 'dash';
  const width = wide ? Math.min(1080, workArea.width - 48) : 430;
  const height = wide ? Math.min(760, workArea.height - 48) : 320;
  win.setBounds({
    x: Math.round(workArea.x + workArea.width - width - 24),
    y: Math.round(workArea.y + 24),
    width, height,
  }, false);
});
ipcMain.on('capture:open-vault', () => shell.openPath(path.join(__dirname, '..', 'vault')));
ipcMain.on('capture:open-dashboard', () => shell.openExternal(`http://localhost:${PORT}`));

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault()); // stay resident for the hotkey
