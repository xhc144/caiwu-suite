import { afterAll, expect, it, vi } from 'vitest';
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
    whenReady: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  Menu: {},
  dialog: {},
  ipcMain: {},
  screen: {},
  session: {},
  shell: {},
  utilityProcess: {},
}));
vi.mock('electron', () => electron);

const root = mkdtempSync(path.join(os.tmpdir(), 'caiwu-single-instance-'));
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
