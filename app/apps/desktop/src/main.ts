// Electron 主进程：启动本地服务 → 打开窗口加载本地服务提供的网页。
// 打包后服务在 utilityProcess 里运行（better-sqlite3 需为 Electron 重新编译，见 electron-builder.yml）；
// 开发时（未打包）用系统 Node + tsx 运行服务源码。
import { BrowserWindow, app, dialog, ipcMain, shell, utilityProcess } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type ServerProcess = {
  kill: () => void;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
};

let serverProc: ServerProcess | null = null;
let mainWindow: BrowserWindow | null = null;

/** 账套默认放在"文档/财务账套"，用户能看到、能备份。可用环境变量 CAIWU_DATA_DIR 改。 */
function dataDir(): string {
  const dir = process.env.CAIWU_DATA_DIR || path.join(app.getPath('documents'), '财务账套');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function startServer(token: string): Promise<number> {
  const env = {
    ...process.env,
    CAIWU_TOKEN: token,
    CAIWU_PORT: '0',
    CAIWU_DATA_DIR: dataDir(),
    CAIWU_VERSION: app.getVersion(),
  };
  if (app.isPackaged) {
    const child = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], {
      env: { ...env, CAIWU_WEB_DIST: path.join(process.resourcesPath, 'web') },
      stdio: 'pipe',
      serviceName: 'caiwu-server',
    });
    serverProc = { kill: () => child.kill(), stdout: child.stdout, stderr: child.stderr };
  } else {
    const appRoot = path.resolve(__dirname, '../../..');
    const child: ChildProcess = spawn(
      process.env.CAIWU_NODE ?? 'node',
      ['--import', 'tsx', 'apps/server/src/main.ts'],
      {
        cwd: appRoot,
        env: {
          ...env,
          CAIWU_DEV: process.env.CAIWU_DEV ?? '1',
          CAIWU_WEB_DIST: path.join(appRoot, 'apps/web/dist'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    serverProc = { kill: () => child.kill(), stdout: child.stdout, stderr: child.stderr };
  }
  serverProc.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务 30 秒内没有启动')), 30_000);
    let buf = '';
    serverProc!.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = /CAIWU_READY (\{.*\})/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve((JSON.parse(m[1]!) as { port: number }).port);
      }
    });
  });
}

function createWindow(port: number) {
  const origin = `http://127.0.0.1:${port}`;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: '财务软件',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // 只允许在本地服务内导航；外部链接用系统浏览器打开
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void mainWindow.loadURL(`${origin}/`);
}

/** 打印 / 存 PDF：在隐藏窗口里加载打印用 HTML。 */
async function withPrintWindow<T>(
  html: string,
  fn: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await fn(win);
  } finally {
    win.destroy();
  }
}

ipcMain.handle('caiwu:print', (_e, html: string, opts: { title: string; silent?: boolean }) =>
  withPrintWindow(
    html,
    (win) =>
      new Promise<void>((resolve, reject) =>
        win.webContents.print({ silent: !!opts.silent, printBackground: true }, (ok, reason) =>
          ok || reason === 'cancelled' ? resolve() : reject(new Error(reason)),
        ),
      ),
  ),
);

ipcMain.handle(
  'caiwu:printToPdf',
  async (_e, html: string, opts: { title: string; landscape?: boolean }) => {
    const parent = mainWindow ?? undefined;
    const res = parent
      ? await dialog.showSaveDialog(parent, {
          title: '存为 PDF',
          defaultPath: `${opts.title}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      : await dialog.showSaveDialog({
          title: '存为 PDF',
          defaultPath: `${opts.title}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
    if (res.canceled || !res.filePath) return null;
    const pdf = await withPrintWindow(html, (win) =>
      win.webContents.printToPDF({ landscape: !!opts.landscape, printBackground: true }),
    );
    writeFileSync(res.filePath, pdf);
    return res.filePath;
  },
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const port = await startServer(randomBytes(24).toString('hex'));
      createWindow(port);
    })
    .catch((err: unknown) => {
      dialog.showErrorBox('启动失败', String(err));
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => serverProc?.kill());
}
