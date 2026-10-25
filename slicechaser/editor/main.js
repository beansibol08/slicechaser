// SliceChaser editor: Electron main process. Owns all file access; the page talks to it over IPC.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PRODUCTS = ['Resolume Arena', 'Resolume Avenue'];

function documentsDir() {
  return app.getPath('documents'); // follows OneDrive redirection, same as the plugin
}
function chaseFilePath() {
  return process.env.SLICECHASER_FILE || path.join(documentsDir(), 'SliceChaser', 'chases.json');
}

// Every Advanced Output file we can find: the live setup plus saved presets.
function listAdvancedOutputFiles() {
  const out = [];
  for (const product of PRODUCTS) {
    const base = path.join(documentsDir(), product);
    const live = path.join(base, 'Preferences', 'AdvancedOutput.xml');
    if (fs.existsSync(live)) out.push({ path: live, label: `${product.replace('Resolume ', '')}: current setup`, live: true, mtime: fs.statSync(live).mtimeMs });
    const presetDir = path.join(base, 'Presets', 'Advanced Output');
    let entries = [];
    try { entries = fs.readdirSync(presetDir); } catch { /* none */ }
    for (const name of entries.filter((n) => n.toLowerCase().endsWith('.xml')).sort()) {
      const p = path.join(presetDir, name);
      out.push({ path: p, label: `${product.replace('Resolume ', '')} preset: ${name.replace(/\.xml$/i, '')}`, live: false, mtime: fs.statSync(p).mtimeMs });
    }
  }
  return out;
}

// Write next to the target and rename, so the plugin never reads a half-written file.
// Resolume may have the file open for a moment, so retry the rename briefly.
async function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 10) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

let win = null;
let watched = null;

function watchSource(file) {
  if (watched) fs.unwatchFile(watched);
  watched = file || null;
  if (!watched) return;
  // Arena rewrites AdvancedOutput.xml when you change slices and close the window.
  fs.watchFile(watched, { interval: 1000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs && win) win.webContents.send('source-changed', watched);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#161c2b',
    title: 'SliceChaser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

ipcMain.handle('env', () => ({ chaseFile: chaseFilePath(), platform: process.platform, version: app.getVersion() }));
ipcMain.handle('list-sources', () => listAdvancedOutputFiles());
ipcMain.handle('read-text', (_e, file) => fs.readFileSync(file, 'utf8'));
ipcMain.handle('read-chase', () => {
  const file = chaseFilePath();
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
});
ipcMain.handle('write-chase', async (_e, text) => {
  await writeAtomic(chaseFilePath(), text);
  return Date.now();
});
ipcMain.handle('choose-source', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose an Advanced Output file',
    defaultPath: path.join(documentsDir(), 'Resolume Arena'),
    filters: [{ name: 'Advanced Output', extensions: ['xml'] }],
    properties: ['openFile']
  });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('watch-source', (_e, file) => { watchSource(file); });
ipcMain.handle('reveal-chase', () => {
  const file = chaseFilePath();
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else shell.openPath(path.dirname(file));
});

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => {
  if (watched) fs.unwatchFile(watched);
  app.quit();
});
