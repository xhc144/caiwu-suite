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
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  ServiceSession,
  ServiceStopError,
  allowUnload,
  wakeWindow,
  type ServiceChild,
} from './lifecycle';
import { createLog } from './log';
import { assertDataOutsideInstall } from './data-safety';
import { assertWebFiles } from './web-files';
import { DesktopUpdates, verifyWindowsInstallerVersion } from './updates';
import { backupBeforeUpdate, prepareUpdateInstall } from './update-backup';
import { atomicPdfWrite, exportPdf, targetState, withResource, type TargetState } from './printing';
import {
  assertSender,
  fileName,
  isLocalUrl,
  isLocalDownload,
  pdfName,
  printDocument,
  printInput,
  printWasCancelled,
  safeExternalUrl,
  desktopMessage as message,
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
let pendingWindowState: WindowState | undefined;
let closeAction: 'quit' | 'recover' = 'quit';
let finalized = false;
let quitting = false;
let recovering = false;
let choosingDirectory = false;
let ipcBusy = false;
let booting = false;
let stoppingServer: Promise<boolean> | undefined;
let updates: DesktopUpdates | undefined;
let pendingUpdate = false;
let updateDialog = false;
let log: ReturnType<typeof createLog> = () => {};

// 与版本号、安装目录和开发 checkout 无关；单实例锁及用户设置随升级保持稳定。
app.setName('财务软件');
let userData = '';
let configFailure = false;
try {
  userData = process.env.CAIWU_DESKTOP_USER_DATA_DIR
    ? validDirectory(process.env.CAIWU_DESKTOP_USER_DATA_DIR)
    : path.join(app.getPath('appData'), 'caiwu-desktop');
  if (app.isPackaged) assertDataOutsideInstall(userData, path.dirname(process.execPath));
  mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
} catch {
  configFailure = true;
}

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
      // IPC 异步发送错误由回调接收；仍以真实退出结果决定成功与否。
      child.send('caiwu:shutdown', () => {});
    },
    forceStop: () => {
      child.kill('SIGKILL');
    },
  };
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
  if (app.isPackaged) {
    assertDataOutsideInstall(dir, path.dirname(process.execPath), userData);
  }
  checkDataDir(dir);
}

async function selectDirectory(): Promise<string | null> {
  if (choosingDirectory || quitting || recovering || stoppingServer || pendingUpdate) return null;
  if (!mainWindow && server) return null; // 服务尚未确认关闭时不能直接提交启动目录。
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

function stopServer(): Promise<boolean> {
  stoppingServer ??= stopServerOnce().finally(() => {
    stoppingServer = undefined;
  });
  return stoppingServer;
}

async function stopServerOnce(): Promise<boolean> {
  for (;;) {
    try {
      await server?.stop();
      server = null;
      return true;
    } catch (error) {
      log('service-stop-failed', error);
      // 超时或拒绝后，原来的目录切换必须重新选择；任何配置都不能提前提交。
      pendingDataDir = null;
      pendingWindowState = undefined;
      pendingUpdate = false;
      const alive = server?.alive ?? false;
      const reason = error instanceof ServiceStopError ? error.message : '无法确认本地服务正常退出';
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: '正常退出未完成',
        message: reason,
        detail:
          '数据目录未更改，软件不会重启。当前业务会话不可继续使用；原账套和备份仍在原目录。' +
          '失败的服务即使已经退出，也可能留下数据目录锁；本软件不会删除锁或绕过备份拒绝。请保留日志并联系维护人员处理。' +
          (alive ? '继续等待只等待当前任务，不会再次启动服务。' : '服务已退出，不能在此恢复业务。'),
        buttons: alive
          ? ['继续等待', '查看诊断日志', '强制退出（未确认保存）']
          : ['查看诊断日志', '异常退出（未确认保存）'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (alive && response === 0) continue;
      if (response === (alive ? 1 : 0)) {
        await shell.openPath(path.join(userData, 'logs'));
        continue;
      }
      if (alive) {
        const confirm = await dialog.showMessageBox({
          type: 'warning',
          title: '确认强制退出',
          message: '强制结束可能中断备份、关账或日志写入，不能视为保存成功。',
          detail: '不会切换目录或重新启动，也不会清除数据目录锁。请优先继续等待。',
          buttons: ['继续等待', '仍然强制退出'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirm.response !== 1) continue;
        try {
          await server?.terminate();
        } catch {
          dialog.showErrorBox(
            '强制终止未确认',
            '本地服务仍未确认退出，请保留诊断日志并联系维护人员。',
          );
          continue;
        }
      }
      finalized = true;
      app.exit(1); // 明确异常结束；没有配置提交或 relaunch。
      return false;
    }
  }
}

async function finishQuit() {
  if (finalized || quitting) return;
  quitting = true;
  if (pendingUpdate) {
    try {
      const started = await prepareUpdateInstall({
        stop: stopServer,
        backup: () => backupBeforeUpdate(activeDataDir, app.getVersion()),
        verify: async () => {
          const { file, update } = await updates!.installer();
          await verifyWindowsInstallerVersion(file, update.version);
        },
        launch: async () => {
          const { file } = await updates!.installer();
          if (pendingWindowState) saveSettings({ ...settings, window: pendingWindowState });
          // 正常交互式 NSIS；不抑制系统安全提示，也不自动发布或运行安装后的版本。
          const error = await shell.openPath(file);
          if (error) throw new Error('Windows 未能打开更新安装器，请保留备份并检查系统安全提示');
        },
      });
      if (!started) return;
      finalized = true;
      app.quit();
      return;
    } catch (error) {
      pendingUpdate = false;
      pendingWindowState = undefined;
      quitting = false;
      dialog.showErrorBox(
        '更新安装未启动',
        message(
          error,
          '更新前备份、校验或安装器启动失败；账套仍在原目录，请检查磁盘空间和权限后重试',
        ),
      );
      await boot();
      return;
    }
  } else {
    if (!(await stopServer())) {
      quitting = false;
      return;
    }
  }
  if (pendingDataDir || pendingWindowState) {
    try {
      if (pendingDataDir) checkDirectory(pendingDataDir);
      saveSettings({
        ...settings,
        ...(pendingWindowState ? { window: pendingWindowState } : {}),
        ...(pendingDataDir ? { dataDir: pendingDataDir } : {}),
      });
      if (pendingDataDir) app.relaunch();
    } catch (error) {
      pendingDataDir = null;
      pendingWindowState = undefined;
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
  const canRetry = server?.alive ?? true;
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: '本地服务不可用',
    message: reason,
    detail: canRetry
      ? '重试会先等待本地服务正常退出，再重新打开账套选择页；尚未保存的内容无法自动恢复。原账套文件不会被移动或删除。'
      : '本地服务已经退出，当前业务会话不可继续。下一步会检查退出结果并提供诊断日志入口，不会自动重启或清除数据目录锁。',
    buttons: canRetry ? ['重试', '退出'] : ['查看退出结果'],
    defaultId: 0,
    cancelId: canRetry ? 1 : 0,
    noLink: true,
  });
  recovering = false;
  if (quitting || finalized) return;
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    closeAction = canRetry && response === 0 ? 'recover' : 'quit';
    win.close();
  } else if (canRetry && response === 0) {
    if (await stopServer()) await boot();
  } else await finishQuit();
}

async function boot() {
  if (booting || quitting || finalized) return;
  booting = true;
  let failure: string | null = null;
  try {
    try {
      assertWebFiles(
        app.isPackaged
          ? path.join(process.resourcesPath, 'web')
          : path.resolve(__dirname, '../../web/dist'),
      );
    } catch (error) {
      log('window-load-failed', error);
      throw error;
    }
    activeDataDir = resolveDataDir(process.env.CAIWU_DATA_DIR, settings, app.getPath('documents'));
    try {
      checkDirectory(activeDataDir);
    } catch (error) {
      log('data-dir-failed', error);
      throw error;
    }
    const token = randomBytes(24).toString('hex');
    const current = new ServiceSession(log, () => {
      void recover('本地服务意外退出，无法确认备份和关账完成；当前业务会话不可继续');
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
      pendingUpdate = false;
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
    pendingWindowState = closingState;
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
            preferCSSPageSize: true,
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
  handle('caiwu:host:updateStatus', async (...args) => {
    if (args.length || !updates) throw new Error('当前平台不支持 Windows 安装更新');
    return updates.status();
  });
  handle('caiwu:host:checkUpdate', async (...args) => {
    if (args.length || !updates) throw new Error('当前平台不支持 Windows 安装更新');
    return updateRequest('check');
  });
  handle('caiwu:host:downloadUpdate', async (...args) => {
    if (args.length || !updates) throw new Error('当前平台不支持 Windows 安装更新');
    return updateRequest('download');
  });
  handle('caiwu:host:installUpdate', async (...args) => {
    if (args.length) throw new Error('桌面参数不合法');
    return installUpdate().finally(refreshUpdateMenu);
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

function refreshUpdateMenu() {
  const state = updates?.status().state;
  const menu = Menu.getApplicationMenu();
  const check = menu?.getMenuItemById('caiwu-check-update');
  const install = menu?.getMenuItemById('caiwu-install-update');
  if (check) check.enabled = !!updates && state !== 'checking' && state !== 'downloading';
  if (install) install.enabled = state === 'downloaded';
}

async function updateRequest(action: 'check' | 'download') {
  const pending = updates![action]();
  refreshUpdateMenu();
  if (action === 'download' && mainWindow && !mainWindow.isDestroyed())
    mainWindow.setProgressBar(2);
  try {
    return await pending;
  } finally {
    refreshUpdateMenu();
    if (action === 'download' && mainWindow && !mainWindow.isDestroyed())
      mainWindow.setProgressBar(-1);
  }
}

async function installUpdate(): Promise<boolean> {
  if (
    !updates ||
    !mainWindow ||
    quitting ||
    recovering ||
    choosingDirectory ||
    pendingDataDir ||
    pendingUpdate
  )
    return false;
  const { update } = await updates.installer();
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '保存退出并安装更新',
    message: `即将安装 ${update.version}，请先保存所有业务页面。`,
    detail:
      `来源：${update.page}\nSHA-256：${update.sha256}\n` +
      '下一步仍会检查未保存内容。正常关闭服务后，将为当前数据目录内全部账套创建并校验独立备份；任何一步失败都不启动安装。' +
      '安装程序仍会显示 Windows 的安全提示，本软件尚无代码签名。安装后请自行启动并重新登录。',
    buttons: ['取消', '保存退出并安装'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response !== 1 || !mainWindow || quitting || recovering) return false;
  pendingUpdate = true;
  mainWindow.close();
  return true; // 只表示已请求关闭；取消未保存提示仍会撤销更新。
}

async function checkForUpdates(manual: boolean) {
  if (!updates || updateDialog || quitting || recovering || !mainWindow) return;
  updateDialog = true;
  try {
    const result = await updateRequest('check');
    if (!mainWindow || quitting || recovering) return;
    if (result.state !== 'available' || !result.update) {
      if (manual)
        await dialog.showMessageBox(mainWindow, {
          type: result.state === 'error' ? 'error' : 'info',
          title: '检查更新',
          message: result.message,
          detail: `来源：${result.source}\n当前版本：${result.current}`,
          buttons: ['知道了'],
        });
      return;
    }
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现正式更新',
      message: result.message,
      detail:
        `当前版本：${result.current}\n来源：${result.update.page}\n` +
        `下载大小：${Math.ceil(result.update.size / 1024 / 1024)} MB\nSHA-256：${result.update.sha256}\n` +
        '确认后下载安装包，校验完成后另行确认安装。此发行渠道尚无代码签名。',
      buttons: ['暂不更新', '下载并校验'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response !== 1 || quitting || recovering) return;
    const downloaded = await updateRequest('download');
    if (downloaded.state === 'error') dialog.showErrorBox('更新下载未完成', downloaded.message);
    else await installUpdate();
  } catch {
    if (manual)
      dialog.showErrorBox('更新未完成', '请稍后在帮助菜单重新检查更新；当前程序和账套未更改');
  } finally {
    updateDialog = false;
  }
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
  if (app.isPackaged && process.platform === 'win32' && process.arch === 'x64')
    updates = new DesktopUpdates(app.getVersion(), path.join(userData, 'updates'));
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
  session.defaultSession.on('will-download', (event, item, owner) => {
    const win = mainWindow;
    if (
      !win ||
      win.isDestroyed() ||
      owner !== win.webContents ||
      !isLocalUrl(owner.getURL(), origin) ||
      !isLocalDownload(item.getURL(), origin)
    ) {
      event.preventDefault();
      return;
    }
    try {
      item.setSaveDialogOptions({
        title: '保存导出文件',
        defaultPath: path.join(app.getPath('documents'), fileName(item.getFilename())),
        buttonLabel: '保存',
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
    } catch {
      event.preventDefault();
      dialog.showErrorBox('导出未保存', '导出文件名含有不支持的字符，请修改名称后重新导出');
    }
  });
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
            id: 'caiwu-check-update',
            label: '检查软件更新…',
            enabled: !!updates,
            click: () => {
              void checkForUpdates(true);
            },
          },
          {
            id: 'caiwu-install-update',
            label: '安装已下载更新…',
            enabled: false,
            click: () => {
              void installUpdate()
                .finally(refreshUpdateMenu)
                .catch(() =>
                  dialog.showErrorBox('更新尚未准备好', '请先在帮助菜单检查更新并完成下载校验'),
                );
            },
          },
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
  if (updates) {
    void checkForUpdates(false);
    const timer = setInterval(
      () => {
        void checkForUpdates(false);
      },
      6 * 60 * 60 * 1000,
    );
    timer.unref();
  }
}

if (configFailure) {
  void app.whenReady().then(() => {
    dialog.showErrorBox(
      '用户配置目录不可用',
      '请检查用户配置目录的写入权限和磁盘空间。如设置了 CAIWU_DESKTOP_USER_DATA_DIR，请使用与安装目录互不包含的独立绝对路径后重试。软件尚未启动本地服务，也未更改账套。',
    );
    app.exit(1);
  });
} else if (!app.requestSingleInstanceLock()) {
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
