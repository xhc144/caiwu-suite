import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const electron = vi.hoisted(() => ({
  app: {
    setName: vi.fn(),
    setPath: vi.fn(),
    getPath: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => false),
    quit: vi.fn(),
    whenReady: vi.fn(async () => {}),
    exit: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  Menu: {},
  dialog: { showErrorBox: vi.fn() },
  ipcMain: {},
  screen: {},
  session: {},
  shell: {},
  utilityProcess: {},
}));
vi.mock('electron', () => electron);

const root = mkdtempSync(path.join(os.tmpdir(), 'caiwu-single-instance-'));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  electron.app.getPath.mockReturnValue(root);
  vi.stubEnv('CAIWU_DESKTOP_USER_DATA_DIR', root);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it('requestSingleInstanceLock 未获得锁时立即退出，不初始化服务、IPC 或第二个窗口', async () => {
  electron.app.getPath.mockReturnValue(root);
  vi.stubEnv('CAIWU_DESKTOP_USER_DATA_DIR', root);
  await import('../main');
  expect(electron.app.requestSingleInstanceLock).toHaveBeenCalledOnce();
  expect(electron.app.quit).toHaveBeenCalledOnce();
  expect(electron.app.whenReady).not.toHaveBeenCalled();
  expect(electron.app.on).not.toHaveBeenCalled();
  expect(electron.BrowserWindow).not.toHaveBeenCalled();
});

it('配置根路径不合法时中文提示并退出，不创建服务或文件能力', async () => {
  vi.stubEnv('CAIWU_DESKTOP_USER_DATA_DIR', 'relative');
  await import('../main');
  await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(1));
  expect(electron.dialog.showErrorBox).toHaveBeenCalledWith(
    '用户配置目录不可用',
    expect.stringContaining('独立绝对路径'),
  );
  expect(electron.app.requestSingleInstanceLock).not.toHaveBeenCalled();
  expect(electron.app.on).not.toHaveBeenCalled();
  expect(electron.BrowserWindow).not.toHaveBeenCalled();
});
