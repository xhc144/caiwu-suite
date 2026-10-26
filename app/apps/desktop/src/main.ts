import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
  utilityProcess,
  type IpcMainInvokeEvent,
} from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ServiceSession, allowUnload, wakeWindow, type ServiceChild } from './lifecycle';
import { createLog } from './log';
import { atomicPdfWrite, exportPdf, targetState, withResource, type TargetState } from './printing';
import {
  assertSender,
  fileName,
  isLocalUrl,
  pdfName,
  printDocument,
  printInput,
  printWasCancelled,
  safeExternalUrl,
} from './security';
import {
  checkDataDir,
  chooseDataDir,
  readSettings,
  resolveDataDir,
  visibleBounds,
  writeSettings,
  validDirectory,
  type Settings,
  type WindowState,
} from './settings';

let mainWindow: BrowserWindow | null = null;
let server: ServiceSession | null = null;
let origin = '';
let settings: Settings = { version: 1 };
let settingsFile = '';
let activeDataDir = '';
let pendingDataDir: string | null = null;
let closeAction: 'quit' | 'recover' = 'quit';
let finalized = false;
let quitting = false;
let recovering = false;
let choosingDirectory = false;
let ipcBusy = false;
let booting = false;
let log: ReturnType<typeof createLog> = () => {};

// 与版本号、安装目录和开发 checkout 无关；单实例锁及用户设置随升级保持稳定。
app.setName('财务软件');
const userData = process.env.CAIWU_DESKTOP_USER_DATA_DIR
  ? validDirectory(process.env.CAIWU_DESKTOP_USER_DATA_DIR)
  : path.join(app.getPath('appData'), 'caiwu-desktop');
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

function spawnServer(token: string): ServiceChild {
  const env = {
    ...process.env,
    CAIWU_TOKEN: token,
    CAIWU_PORT: '0',
    CAIWU_DATA_DIR: activeDataDir,
    CAIWU_VERSION: app.getVersion(),
  };
  if (app.isPackaged) {
    const child = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], {
      env: { ...env, CAIWU_WEB_DIST: path.join(process.resourcesPath, 'web') },
      stdio: 'pipe',
      serviceName: 'caiwu-server',
    });
    return {
      events: child,
      stdout: child.stdout,
      stderr: child.stderr,
      requestStop: () => child.postMessage('caiwu:shutdown'),
      forceStop: () => {
        child.kill();
      },
    };
  }
  const appRoot = path.resolve(__dirname, '../../..');
  const child = spawn(
    process.env.CAIWU_NODE ?? 'node',
    ['--import', 'tsx', 'apps/desktop/src/server-entry.ts'],
    {
      cwd: appRoot,
      env: {
        ...env,
        CAIWU_DEV: process.env.CAIWU_DEV ?? '1',
        CAIWU_WEB_DIST: path.join(appRoot, 'apps/web/dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  return {
    events: child,
    stdout: child.stdout,
    stderr: child.stderr,
    requestStop: () => {
      child.send('caiwu:shutdown');
    },
    forceStop: () => {
      child.kill('SIGKILL');
    },
  };
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && /^[\u4e00-\u9fff]/u.test(error.message)
    ? error.message
    : fallback;
}

function saveSettings(next: Settings) {
  try {
    writeSettings(settingsFile, next);
    settings = next;
  } catch (error) {
    log('settings-write-failed', error);
    throw new Error('无法保存桌面配置，请检查用户配置目录的权限和磁盘空间后重试', { cause: error });
  }
}

function checkDirectory(dir: string) {
  checkDataDir(dir);
  if (app.isPackaged) {
    const install = realpathSync(path.dirname(process.execPath));
    const relative = path.relative(install, realpathSync(dir));
    if (
      !relative ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    ) {
      throw new Error('数据目录不能放在软件安装目录中，请在文档或其他数据磁盘选择文件夹');
    }
  }
}

async function selectDirectory(): Promise<string | null> {
  if (choosingDirectory || quitting || recovering) return null;
  if (process.env.CAIWU_DATA_DIR) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '数据目录由环境变量指定',
      message: '当前设置了 CAIWU_DATA_DIR。请先修改或移除该环境变量，再重新启动软件。',
      buttons: ['知道了'],
    });
    return null;
  }
  choosingDirectory = true;
  try {
    const selected = await chooseDataDir({
      choose: async () => {
        const options: Electron.OpenDialogOptions = {
          title: '选择下次启动的数据目录（不搬迁旧账套）',
          defaultPath: activeDataDir || app.getPath('documents'),
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: '选择此目录',
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      validate: checkDirectory,
      confirm: async (dir) => {
        const options: Electron.MessageBoxOptions = {
          type: 'question',
          title: '更改下次启动位置',
          message: '需要重启软件才能使用新目录，重启后需要重新登录。',
          detail: `新目录：${dir}\n原目录中的账套和备份会完整保留，不会搬迁、合并或删除；新目录可能显示为空。请先自行备份。若有未保存内容，下一步仍可留在当前页面取消重启。`,
          buttons: ['取消', '确认并重启'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const result = mainWindow
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options);
        return result.response === 1;
      },
    });
    if (selected === null || quitting) return null;
    if (!mainWindow) {
      saveSettings({ ...settings, dataDir: selected });
      activeDataDir = selected;
      return selected;
    }
    // 只有窗口真正关闭后才持久保存并重启。beforeunload 取消会清除此待定更改。
    pendingDataDir = selected;
    mainWindow.close();
    return pendingDataDir;
  } catch (error) {
    dialog.showErrorBox(
      '数据目录未更改',
      message(error, '无法使用所选目录，请重新选择可写的本机文件夹'),
    );
    return null;
  } finally {
    choosingDirectory = false;
  }
}

async function stopServer(): Promise<boolean> {
  try {
    await server?.stop();
    server = null;
    return true;
  } catch (error) {
    log('service-stop-failed', error);
    dialog.showErrorBox(
      '本地服务尚未退出',
      '无法确认本地服务已退出。请在任务管理器关闭财务软件后重新启动；软件不会继续重启或切换数据目录。',
    );
    return false;
  }
}

async function finishQuit() {
  if (finalized || quitting) return;
  quitting = true;
  if (!(await stopServer())) {
    quitting = false;
    return;
  }
  if (pendingDataDir) {
    try {
      checkDirectory(pendingDataDir);
      saveSettings({ ...settings, dataDir: pendingDataDir });
      app.relaunch();
    } catch (error) {
      pendingDataDir = null;
      quitting = false;
      dialog.showErrorBox(
        '数据目录未更改',
        message(error, '无法保存新目录，请检查权限和磁盘空间后重试'),
      );
      await boot();
      return;
    }
  }
  finalized = true;
  app.quit();
}

async function recover(reason: string) {
  if (recovering || quitting || finalized || booting) return;
  recovering = true;
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: '本地服务不可用',
    message: reason,
    detail:
      '重试会重新启动本地服务并回到账套选择页；尚未保存的内容无法自动恢复。原账套文件不会被移动或删除。',
    buttons: ['重试', '退出'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  recovering = false;
  if (quitting || finalized) return;
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    closeAction = response === 0 ? 'recover' : 'quit';
    win.close();
  } else if (response === 0) {
    if (await stopServer()) await boot();
  } else await finishQuit();
}

async function boot() {
  if (booting || quitting || finalized) return;
  booting = true;
  let failure: string | null = null;
  try {
    activeDataDir = resolveDataDir(process.env.CAIWU_DATA_DIR, settings, app.getPath('documents'));
    try {
      checkDirectory(activeDataDir);
    } catch (error) {
      log('data-dir-failed', error);
      throw error;
    }
    const token = randomBytes(24).toString('hex');
    const current = new ServiceSession(log, () => {
      void recover('本地服务意外退出，请重试；如反复发生，请检查数据目录和安装文件');
    });
    server = current;
    const port = await current.start(() => spawnServer(token), token);
    if (quitting || server !== current) return;
    origin = `http://127.0.0.1:${port}`;
    await createWindow(current);
  } catch (error) {
    if (!quitting && (await stopServer())) {
      failure = message(error, '本地服务启动失败，请检查安装文件、数据目录权限和磁盘空间后重试');
    }
  } finally {
    booting = false;
  }
  if (failure && !quitting && !finalized) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: '启动失败',
      message: failure,
      buttons: ['重试', '选择数据目录', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) await boot();
    else if (response === 1) {
      await selectDirectory();
      await boot();
    } else await finishQuit();
  }
}

async function createWindow(current: ServiceSession) {
  const bounds = visibleBounds(
    settings.window,
    screen.getAllDisplays().map((s) => s.workArea),
  );
  const win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(1024, bounds.width),
    minHeight: Math.min(640, bounds.height),
    title: '财务软件',
    icon: path.join(__dirname, 'icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  mainWindow = win;
  if (settings.window?.maximized) win.maximize();
  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocalUrl(url, origin)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isLocalUrl(url, origin)) event.preventDefault();
  });
  win.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isLocalUrl(event.url, origin)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalUrl(url, origin)) openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('will-prevent-unload', (event) => {
    const discard = allowUnload(
      event,
      () =>
        dialog.showMessageBoxSync(win, {
          type: 'warning',
          title: '有未保存的内容',
          message: '此页面有未保存的内容，退出后会丢失。',
          buttons: ['留在此处', '放弃未保存内容并退出'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }) === 1,
    );
    if (!discard) {
      pendingDataDir = null;
      closeAction = 'quit';
      quitting = false;
      win.show();
    }
  });
  win.webContents.on('render-process-gone', () => {
    log('renderer-gone');
    void recover('页面进程已退出，可以重新打开账套选择页；已保存的数据仍在原目录');
  });
  win.on('unresponsive', () => {
    log('renderer-unresponsive');
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: '页面暂时没有响应',
        message: '可以继续等待，或重新加载页面；重新加载可能丢失未保存内容。',
        buttons: ['继续等待', '重新加载'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 1 && !win.isDestroyed()) win.webContents.reload();
      });
  });
  let closingState: WindowState | undefined;
  let lastMaximized = settings.window?.maximized ?? false;
  win.on('maximize', () => {
    lastMaximized = true;
  });
  win.on('unmaximize', () => {
    lastMaximized = false;
  });
  win.on('close', () => {
    closingState = {
      ...win.getNormalBounds(),
      maximized: win.isMinimized() ? lastMaximized : win.isMaximized(),
    };
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    if (closingState) {
      try {
        saveSettings({ ...settings, window: closingState });
      } catch (error) {
        dialog.showErrorBox(
          '窗口设置未保存',
          message(error, '无法保存窗口位置，请检查用户配置目录'),
        );
      }
    }
    if (closeAction === 'recover') {
      closeAction = 'quit';
      void stopServer().then((stopped) => {
        if (stopped) void boot();
      });
    } else if (!recovering) void finishQuit();
  });
  try {
    await win.loadURL(`${origin}/`);
    if (!current.running) throw new Error('本地服务在页面加载时退出');
    if (!win.isDestroyed()) win.show();
  } catch {
    log('window-load-failed');
    recovering = true;
    if (!win.isDestroyed()) win.destroy();
    recovering = false;
    throw new Error('本地页面未能加载，请重试；如反复发生，请重新安装完整软件包');
  }
}

function openExternal(raw: string) {
  const url = safeExternalUrl(raw);
  if (url) void shell.openExternal(url).catch(() => {});
}

function authenticate(event: IpcMainInvokeEvent) {
  const win = mainWindow;
  assertSender(
    event,
    win && !win.isDestroyed()
      ? {
          webContents: win.webContents,
          mainFrame: win.webContents.mainFrame,
          url: win.webContents.getURL(),
        }
      : null,
    event.senderFrame?.url ?? '',
    origin,
  );
}

function registerIpc() {
  const handle = (name: string, fn: (...args: unknown[]) => Promise<unknown>) => {
    ipcMain.handle(name, async (event, ...args: unknown[]) => {
      authenticate(event);
      if (ipcBusy || quitting) throw new Error('桌面正在处理另一项操作，请完成后重试');
      ipcBusy = true;
      try {
        return await fn(...args);
      } catch (error) {
        // Electron 会把被拒绝的 IPC 异常写到 stderr；此边界不得携带 HTML、路径或 cause。
        // eslint-disable-next-line preserve-caught-error -- 有意在跨进程边界去除可能含账套内容的原始异常。
        throw new Error(message(error, '桌面操作未完成，请检查文件权限、磁盘空间或打印机后重试'));
      } finally {
        ipcBusy = false;
      }
    });
  };
  handle('caiwu:print', async (html, opts, ...extra) => {
    if (extra.length) throw new Error('打印参数不合法');
    const input = printInput(html, opts, 'silent');
    await withPrintWindow(
      input.html,
      (win) =>
        new Promise<void>((resolve, reject) => {
          win.webContents.print({ silent: input.enabled, printBackground: true }, (ok, reason) => {
            if (ok || printWasCancelled(reason)) resolve();
            else reject(new Error('打印未完成，请检查打印机连接和系统打印队列后重试'));
          });
        }),
    );
  });
  handle('caiwu:printToPdf', async (html, opts, ...extra) => {
    if (extra.length) throw new Error('打印参数不合法');
    const input = printInput(html, opts, 'landscape');
    let target: { path: string; state: TargetState | null } | null = null;
    return exportPdf({
      choose: async () => {
        target = await savePath(pdfName(input.title), true);
        return target?.path ?? null;
      },
      render: () =>
        withPrintWindow(input.html, (win) =>
          win.webContents.printToPDF({
            landscape: input.enabled,
            printBackground: true,
          }),
        ),
      write: (file, data) => atomicPdfWrite(file, data, target!.state),
      failed: (error) => log('pdf-write-failed', error),
    });
  });
  handle('caiwu:host:dataDir', async (...args) => {
    if (args.length) throw new Error('桌面参数不合法');
    return { path: activeDataDir, overridden: !!process.env.CAIWU_DATA_DIR };
  });
  handle('caiwu:host:chooseDataDir', async (...args) => {
    if (args.length) throw new Error('桌面参数不合法');
    return selectDirectory();
  });
  handle('caiwu:host:openFile', async (...args) => {
    if (args.length) throw new Error('桌面参数不合法');
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '打开文件',
      buttonLabel: '打开',
      properties: ['openFile'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle('caiwu:host:saveFile', async (name, ...args) => {
    if (args.length) throw new Error('桌面参数不合法');
    return (await savePath(fileName(name)))?.path ?? null;
  });
  handle('caiwu:host:chooseDirectory', async (...args) => {
    if (args.length) throw new Error('桌面参数不合法');
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择文件夹',
      buttonLabel: '选择此目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}

async function savePath(
  name: string,
  pdf = false,
): Promise<{ path: string; state: TargetState | null } | null> {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: pdf ? '存为 PDF' : '选择保存位置',
    defaultPath: path.join(app.getPath('documents'), name),
    buttonLabel: '保存',
    filters: pdf ? [{ name: 'PDF 文档', extensions: ['pdf'] }] : undefined,
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  });
  if (result.canceled || !result.filePath) return null;
  const state = await targetState(result.filePath);
  if (state) {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: '确认覆盖文件',
      message: '所选文件已存在，是否替换？',
      detail: result.filePath,
      buttons: ['取消', '替换'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response !== 1) return null;
  }
  return { path: result.filePath, state };
}

async function withPrintWindow<T>(html: string, job: (win: BrowserWindow) => Promise<T>) {
  const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(printDocument(html))}`;
  const printSession = session.fromPartition('caiwu-print', { cache: false });
  printSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  printSession.setPermissionCheckHandler(() => false);
  printSession.webRequest.onBeforeRequest((details, callback) => {
    const image = details.resourceType === 'image' && details.url.startsWith('data:image/');
    callback({ cancel: details.url !== documentUrl && !image });
  });
  try {
    return await withResource(
      () => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            session: printSession,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            javascript: false,
            webviewTag: false,
            spellcheck: false,
          },
        });
        win.webContents.on('will-navigate', (event) => event.preventDefault());
        win.webContents.on('will-redirect', (event) => event.preventDefault());
        win.webContents.on('will-frame-navigate', (event) => event.preventDefault());
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        return win;
      },
      async (win) => {
        await win.loadURL(documentUrl);
        return job(win);
      },
    );
  } finally {
    printSession.webRequest.onBeforeRequest(null);
    await printSession.clearStorageData();
  }
}

async function initialize() {
  settingsFile = path.join(userData, 'desktop-settings.json');
  log = createLog(path.join(userData, 'logs'));
  log('launch');
  try {
    settings = readSettings(settingsFile);
  } catch {
    log('settings-invalid');
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: '桌面配置需要恢复',
      message: '桌面配置损坏或版本不受支持。为避免误用空目录，请先恢复配置或重新选择原数据目录。',
      buttons: ['退出并恢复配置', '保留副本并重新选择'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response === 0) {
      await finishQuit();
      return;
    }
    try {
      copyFileSync(settingsFile, `${settingsFile}.corrupt-${Date.now()}`);
    } catch {
      dialog.showErrorBox('配置未更改', '无法保留损坏配置副本，请检查用户配置目录的权限和剩余空间');
      await finishQuit();
      return;
    }
    if (process.env.CAIWU_DATA_DIR) {
      checkDirectory(process.env.CAIWU_DATA_DIR);
      saveSettings({ version: 1 });
    } else if (!(await selectDirectory())) {
      await finishQuit();
      return;
    }
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  registerIpc();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          {
            label: '数据目录…',
            click: () => {
              dialog.showMessageBoxSync({
                title: '当前数据目录',
                message: activeDataDir || '尚未启动本地服务',
                detail: '账套位于 books 子目录；更改位置不会搬迁旧账套或备份。',
                buttons: ['知道了'],
              });
            },
          },
          {
            label: '更改下次启动的数据目录…',
            click: () => {
              void selectDirectory();
            },
          },
          { type: 'separator' },
          { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', role: 'undo' },
          { label: '重做', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', role: 'cut' },
          { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' },
          { label: '全选', role: 'selectAll' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { label: '重新加载页面', click: () => mainWindow?.webContents.reload() },
          { label: '放大', role: 'zoomIn' },
          { label: '缩小', role: 'zoomOut' },
          { label: '恢复原始缩放', role: 'resetZoom' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '打开本地诊断日志目录',
            click: () => {
              void shell.openPath(path.join(userData, 'logs'));
            },
          },
        ],
      },
    ]),
  );
  const correctWindow = () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const bounds = visibleBounds(
      win.getNormalBounds(),
      screen.getAllDisplays().map((s) => s.workArea),
    );
    win.setMinimumSize(Math.min(1024, bounds.width), Math.min(640, bounds.height));
    if (maximized) win.unmaximize();
    win.setBounds(bounds);
    if (maximized) win.maximize();
  };
  screen.on('display-removed', correctWindow);
  screen.on('display-added', correctWindow);
  screen.on('display-metrics-changed', correctWindow);
  await boot();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => wakeWindow(mainWindow));
  app.on('before-quit', (event) => {
    if (finalized) return;
    event.preventDefault();
    if (quitting) return;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else void finishQuit();
  });
  // before-quit 不能提前杀服务，否则用户取消关闭时会丢失会话。
  app.on('window-all-closed', () => {});
  app.on('child-process-gone', () => log('service-exit'));
  process.on('uncaughtException', () => {
    log('main-exception');
    void recover('桌面发生异常，请重试或退出后重新启动');
  });
  process.on('unhandledRejection', () => {
    log('main-exception');
    void recover('桌面操作未完成，请重试或退出后重新启动');
  });
  void app
    .whenReady()
    .then(initialize)
    .catch(() => {
      dialog.showErrorBox('桌面启动失败', '无法初始化桌面，请检查安装文件和用户配置目录后重试');
      void finishQuit();
    });
}
