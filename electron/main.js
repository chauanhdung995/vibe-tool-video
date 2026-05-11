const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, shell } = require('electron');

let serverHandle = null;

function findFirstFile(rootDir, fileName) {
  if (!rootDir || !fs.existsSync(rootDir)) return '';
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }
  return '';
}

function prependPathDirs(...dirs) {
  const validDirs = dirs.filter(Boolean);
  if (!validDirs.length) return;
  process.env.PATH = [...validDirs, process.env.PATH || ''].join(path.delimiter);
}

function configureRuntime() {
  const appRoot = path.resolve(__dirname, '..');
  const dataRoot = app.getPath('userData');
  const chromeRoot = path.join(appRoot, 'vendor', 'chrome');
  const chromeBinary = findFirstFile(chromeRoot, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
  const ffmpegPath = require('ffmpeg-static');
  const ffprobePath = require('ffprobe-static').path;

  process.env.VIBE_TOOL_DATA_DIR = dataRoot;
  process.env.VIBE_TOOL_FFMPEG_PATH = ffmpegPath;
  process.env.VIBE_TOOL_FFPROBE_PATH = ffprobePath;
  process.env.VIBE_TOOL_FORCE_BUNDLED_TOOLS = '1';

  if (chromeBinary) {
    process.env.CHROME_PATH = chromeBinary;
    process.env.HYPERFRAMES_BROWSER_PATH = chromeBinary;
  }

  prependPathDirs(
    path.dirname(ffmpegPath),
    path.dirname(ffprobePath),
    chromeBinary && path.dirname(chromeBinary)
  );
}

async function createMainWindow() {
  configureRuntime();
  const { startServer } = require('../server');
  serverHandle = await startServer({ host: '127.0.0.1', port: 0 });

  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: 'Vibe Tool Video',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(serverHandle.url);
}

app.setName('Vibe Tool Video');

app.whenReady()
  .then(createMainWindow)
  .catch((error) => {
    dialog.showErrorBox('Vibe Tool Video failed to start', error?.stack || error?.message || String(error));
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => {
      dialog.showErrorBox('Vibe Tool Video failed to start', error?.stack || error?.message || String(error));
    });
  }
});

app.on('before-quit', () => {
  if (serverHandle?.server) {
    serverHandle.server.close();
  }
});
