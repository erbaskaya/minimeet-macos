const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, clipboard, systemPreferences, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mediaWindow = null;
let toolbarWindow = null;
let annotationWindow = null;
let annotationToolsWindow = null;
let participantLink = '';
let meetingActive = false;
let annotationActive = false;
let saveTimer = null;
let remoteScreenViewing = false;
let compactMediaBounds = null;

function mediaPath(file) {
  return path.join(__dirname, file);
}

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}

function saveWindowState(bounds) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify({ mediaBounds: bounds }, null, 2));
    } catch (error) {
      console.warn('Pencere konumu kaydedilemedi', error);
    }
  }, 180);
}

function setupWindowBounds() {
  const area = currentWorkArea();
  const width = Math.min(1120, Math.max(900, area.width - 40));
  const height = Math.min(900, Math.max(700, area.height - 40));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  };
}

function createMediaWindow() {
  const initialBounds = setupWindowBounds();
  mediaWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 820,
    minHeight: 680,
    thickFrame: true,
    frame: false,
    show: false,
    backgroundColor: '#090d16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mediaWindow.loadFile(mediaPath('media.html'));
  mediaWindow.once('ready-to-show', () => mediaWindow.show());
  mediaWindow.on('move', () => {
    if (meetingActive && !remoteScreenViewing && mediaWindow && !mediaWindow.isDestroyed()) saveWindowState(mediaWindow.getBounds());
  });
  mediaWindow.on('resize', () => {
    if (meetingActive && !remoteScreenViewing && mediaWindow && !mediaWindow.isDestroyed()) saveWindowState(mediaWindow.getBounds());
  });
  mediaWindow.on('closed', () => {
    mediaWindow = null;
    closeAuxWindows();
  });
}

function currentWorkArea() {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point).workArea;
}

function validSavedBounds(saved, area) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y) || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return false;
  return saved.width >= 220 && saved.height >= 300 && saved.x < area.x + area.width - 40 && saved.y < area.y + area.height - 40;
}

function positionOverlayWindows() {
  const area = currentWorkArea();
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    const saved = readWindowState().mediaBounds;
    if (validSavedBounds(saved, area)) {
      mediaWindow.setBounds(saved);
    } else {
      const width = 320;
      const height = 430;
      mediaWindow.setBounds({
        x: Math.round(area.x + area.width - width - 16),
        y: Math.round(area.y + 16),
        width,
        height
      });
    }
  }

  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    const width = 860;
    const height = 78;
    toolbarWindow.setBounds({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + area.height - height - 16),
      width,
      height
    });
  }
}

function createToolbarWindow() {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) return;

  toolbarWindow = new BrowserWindow({
    width: 860,
    height: 78,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
  toolbarWindow.setContentProtection(true);
  toolbarWindow.loadFile(mediaPath('toolbar.html'));
  toolbarWindow.once('ready-to-show', () => {
    positionOverlayWindows();
    toolbarWindow.showInactive();
  });
  toolbarWindow.on('closed', () => { toolbarWindow = null; });
}

function createAnnotationWindows() {
  if (annotationWindow && !annotationWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;

  annotationWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  annotationWindow.setAlwaysOnTop(true, 'floating');
  annotationWindow.setContentProtection(false); // çizimler ekran paylaşımında görünmeli
  annotationWindow.loadFile(mediaPath('annotation.html'));

  annotationToolsWindow = new BrowserWindow({
    width: 520,
    height: 64,
    x: Math.round(bounds.x + 24),
    y: Math.round(bounds.y + 24),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  annotationToolsWindow.setAlwaysOnTop(true, 'screen-saver');
  annotationToolsWindow.setContentProtection(true); // araç paleti katılımcıya gitmesin
  annotationToolsWindow.loadFile(mediaPath('annotation-toolbar.html'));

  annotationWindow.on('closed', () => { annotationWindow = null; });
  annotationToolsWindow.on('closed', () => {
    annotationToolsWindow = null;
    if (annotationActive) toggleAnnotation(false);
  });
}

function toggleAnnotation(force) {
  const next = typeof force === 'boolean' ? force : !annotationActive;
  annotationActive = next;
  if (next) {
    createAnnotationWindows();
    annotationWindow?.showInactive();
    annotationToolsWindow?.show();
  } else {
    if (annotationWindow && !annotationWindow.isDestroyed()) annotationWindow.close();
    if (annotationToolsWindow && !annotationToolsWindow.isDestroyed()) annotationToolsWindow.close();
    annotationWindow = null;
    annotationToolsWindow = null;
  }
  toolbarWindow?.webContents.send('annotation-state', { active: annotationActive });
}

function closeAuxWindows() {
  toggleAnnotation(false);
  if (toolbarWindow && !toolbarWindow.isDestroyed()) toolbarWindow.close();
  toolbarWindow = null;
}

function enterMeetingMode() {
  meetingActive = true;
  createToolbarWindow();
  if (!mediaWindow || mediaWindow.isDestroyed()) return;

  mediaWindow.setAlwaysOnTop(true, 'screen-saver');
  mediaWindow.setSkipTaskbar(true);
  mediaWindow.setResizable(true);
  mediaWindow.setMinimumSize(220, 300);
  mediaWindow.setAspectRatio(320 / 430);
  mediaWindow.setContentProtection(true);
  positionOverlayWindows();
  mediaWindow.showInactive();
}

function leaveMeetingMode() {
  remoteScreenViewing = false;
  compactMediaBounds = null;
  meetingActive = false;
  closeAuxWindows();

  if (!mediaWindow || mediaWindow.isDestroyed()) return;
  mediaWindow.setContentProtection(false);
  mediaWindow.setAlwaysOnTop(false);
  mediaWindow.setSkipTaskbar(false);
  mediaWindow.setAspectRatio(0);
  mediaWindow.setResizable(true);
  mediaWindow.setMinimumSize(820, 680);
  mediaWindow.setBounds(setupWindowBounds());
  mediaWindow.show();
  mediaWindow.focus();
}


function setRemoteScreenViewing(active) {
  if (!mediaWindow || mediaWindow.isDestroyed() || !meetingActive) return;
  const next = Boolean(active);
  if (next === remoteScreenViewing) return;

  const area = currentWorkArea();
  if (next) {
    compactMediaBounds = mediaWindow.getBounds();
    remoteScreenViewing = true;
    mediaWindow.setAspectRatio(0);
    mediaWindow.setMinimumSize(720, 480);
    const width = Math.min(1180, Math.max(760, area.width - 100));
    const height = Math.min(760, Math.max(520, area.height - 100));
    mediaWindow.setBounds({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height
    });
    mediaWindow.show();
    mediaWindow.focus();
    return;
  }

  remoteScreenViewing = false;
  mediaWindow.setMinimumSize(220, 300);
  mediaWindow.setAspectRatio(320 / 430);
  const restore = compactMediaBounds;
  compactMediaBounds = null;
  if (validSavedBounds(restore, area)) mediaWindow.setBounds(restore);
  else positionOverlayWindows();
  mediaWindow.showInactive();
}

async function requestMacMediaPermissions() {
  if (process.platform !== 'darwin') return;

  for (const mediaType of ['camera', 'microphone']) {
    try {
      const status = systemPreferences.getMediaAccessStatus(mediaType);
      if (status === 'not-determined') {
        await systemPreferences.askForMediaAccess(mediaType);
      }
    } catch (error) {
      console.warn(`macOS ${mediaType} izni kontrol edilemedi`, error);
    }
  }
}

function configurePermissions() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'display-capture');
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media' || permission === 'display-capture'));

  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const primary = screen.getPrimaryDisplay();
      const selected = sources.find((source) => String(source.display_id) === String(primary.id)) || sources[0];
      if (!selected) return callback({});
      callback({ video: selected, audio: process.platform === 'win32' ? 'loopback' : undefined });
    } catch (error) {
      console.error('Display capture selection failed', error);
      callback({});
    }
  });
}

app.whenReady().then(async () => {
  configurePermissions();
  await requestMacMediaPermissions();
  createMediaWindow();
  app.on('activate', () => { if (!mediaWindow) createMediaWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('lesson-started', (_event, payload) => {
  participantLink = String(payload?.studentLink || payload?.participantLink || '');
  enterMeetingMode();
});
ipcMain.on('lesson-ended', () => leaveMeetingMode());
ipcMain.on('student-link', (_event, link) => { participantLink = String(link || ''); });
ipcMain.on('toolbar-state', (_event, state) => { toolbarWindow?.webContents.send('toolbar-state', state); });
ipcMain.on('toolbar-command-from-toolbar', (_event, command) => {
  if (command === 'copy-link' && participantLink) return clipboard.writeText(participantLink);
  if (command === 'toggle-annotation') return toggleAnnotation();
  mediaWindow?.webContents.send('toolbar-command', command);
});
ipcMain.on('annotation-command-from-tools', (_event, command) => {
  annotationWindow?.webContents.send('annotation-command', command);
});
ipcMain.on('annotation-close', () => toggleAnnotation(false));
ipcMain.on('remote-screen-active', (_event, active) => setRemoteScreenViewing(active));
ipcMain.on('close-app', () => app.quit());
ipcMain.on('minimize-media', () => mediaWindow?.minimize());
ipcMain.handle('copy-text', (_event, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('get-app-info', () => ({ version: app.getVersion(), platform: process.platform, lessonActive: meetingActive, annotationActive }));
