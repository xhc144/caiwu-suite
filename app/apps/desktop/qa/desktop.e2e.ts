import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'node:http';
import type { DesktopHost } from '../src/bridge';

// 测试侧结构契约；不修改或重新声明共享 print 包的 DesktopBridge。
type PrintApi = {
  printToPdf(html: string, options: { title: string; landscape?: boolean }): Promise<string | null>;
};
type PrintWindow = Window & { caiwuDesktop: PrintApi };

type Fixture = { bookId: string; dataDir: string; configDir: string };
const root = process.env.CAIWU_DESKTOP_QA_FIXTURE;
const loadModule = createRequire(import.meta.url);

async function run(executable: string, args: string[], env = process.env): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('桌面安装/第二实例等待超时'));
    }, 90_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });
}

test('桌面独立回归：启动/登录壳 → 第二实例 → PDF → 未保存关闭 → 重开；Windows 再测覆盖升级/卸载', async () => {
  if (!root)
    throw new Error(
      '请先运行 prepare-fixture.ts，并设置 CAIWU_DESKTOP_QA_FIXTURE；此测试不会回退到用户数据目录',
    );
  const fixture = JSON.parse(readFileSync(path.join(root, 'fixture.json'), 'utf8')) as Fixture;
  const oldInstaller = process.env.CAIWU_DESKTOP_OLD_INSTALLER;
  const newInstaller = process.env.CAIWU_DESKTOP_NEW_INSTALLER;
  const executable = process.env.CAIWU_DESKTOP_EXECUTABLE || (loadModule('electron') as string);
  const installed = !!process.env.CAIWU_DESKTOP_EXECUTABLE;
  const env = {
    ...process.env,
    NODE_PATH: '',
    CAIWU_DATA_DIR: '',
    CAIWU_DESKTOP_USER_DATA_DIR: fixture.configDir,
    CAIWU_DEV: '0',
  };
  if (installed && (!oldInstaller || !newInstaller || process.platform !== 'win32')) {
    throw new Error('安装回归必须在 Windows 提供旧版/新版 NSIS 安装包，不能用解压包替代');
  }
  const install = async (file: string) => {
    const code = await run(file, ['/S', '/currentuser', `/D=${path.dirname(executable)}`]);
    expect(code, 'NSIS 安装退出码').toBe(0);
    await expect.poll(() => existsSync(executable)).toBe(true);
  };
  const launch = () =>
    _electron.launch({
      executablePath: executable,
      args: installed ? [] : [path.resolve('apps/desktop')],
      env,
      cwd: process.cwd(),
      timeout: 45_000,
    });
  const backup = path.join(fixture.dataDir, 'backups', '合成账套备份.caiwu');
  const hash = () => createHash('sha256').update(readFileSync(backup)).digest('hex');
  const originalBackup = hash();
  let desktop: ElectronApplication | undefined;
  let networkRequests = 0;
  const network = createServer((_request, response) => {
    networkRequests++;
    response.end('blocked');
  });
  await new Promise<void>((resolve) => network.listen(0, '127.0.0.1', resolve));
  const address = network.address();
  if (!address || typeof address === 'string') throw new Error('打印安全测试无法创建本地探针');
  try {
    if (oldInstaller) await install(oldInstaller);
    desktop = await launch();
    let page = await desktop.firstWindow();
    await expect(page.getByText('测试账套', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        async () => (await (window.caiwuDesktopHost as DesktopHost).dataDirectory.get()).path,
      ),
    ).toBe(fixture.dataDir);
    await page.getByRole('button', { name: '进入', exact: true }).click();
    await expect(page.getByText('测试账套', { exact: true })).toBeVisible();
    // 原生 SQLite 来自安装包，登录通过真实 utilityProcess；无开发机 NODE_PATH。
    const password = page.getByLabel('密码', { exact: true });
    await password.fill('admin');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('测试账套', { exact: true }).first()).toBeVisible();
    await desktop.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.minimize();
    });
    expect(await run(executable, installed ? [] : [path.resolve('apps/desktop')], env)).toBe(0);
    await expect
      .poll(() =>
        desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized()),
      )
      .toBe(false);
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);

    // 对话框响应由测试适配器提供；PDF 渲染、文件写入和打印窗安全在真实 Electron 运行。
    await desktop.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' });
    });
    expect(
      await page.evaluate(() =>
        (window as PrintWindow).caiwuDesktop.printToPdf('<p>取消</p>', { title: '取消' }),
      ),
    ).toBeNull();
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);
    const pdf = path.join(root, '中文横向.pdf');
    await desktop.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, pdf);
    const hostile = `<!doctype html><p>中文横向账簿</p><script>fetch('http://127.0.0.1:${address.port}/script')</script><img src="http://127.0.0.1:${address.port}/image"><iframe src="http://127.0.0.1:${address.port}/frame"></iframe>`;
    expect(
      await page.evaluate(
        ({ html }) =>
          (window as PrintWindow).caiwuDesktop.printToPdf(html, {
            title: '中文账簿',
            landscape: true,
          }),
        { html: hostile },
      ),
    ).toBe(pdf);
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/u.exec(
      readFileSync(pdf, 'latin1'),
    );
    expect(box, 'PDF 应包含页面尺寸').not.toBeNull();
    expect(Number(box![1]), '横向 PDF 的宽应大于高').toBeGreaterThan(Number(box![2]));
    expect(networkRequests).toBe(0);
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);
    await desktop.evaluate(
      ({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      },
      path.join(root, 'missing', 'fail.pdf'),
    );
    const failed = await page.evaluate(async () => {
      try {
        await (window as PrintWindow).caiwuDesktop.printToPdf('<p>失败</p>', { title: '失败' });
        return false;
      } catch (error) {
        return String(error).includes('PDF 未保存成功');
      }
    });
    expect(failed).toBe(true);
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);
    if (newInstaller) {
      expect(
        await run(newInstaller, ['/S', '/currentuser', `/D=${path.dirname(executable)}`]),
      ).not.toBe(0);
      expect(page.isClosed()).toBe(false);
    }
    await page.evaluate(() => {
      window.onbeforeunload = (event) => {
        event.preventDefault();
        event.returnValue = '';
      };
    });
    await desktop.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBoxSync = () => 0;
      BrowserWindow.getAllWindows()[0]!.close();
    });
    expect(page.isClosed()).toBe(false);
    expect(await page.evaluate(async () => (await fetch('/healthz')).ok)).toBe(true);
    await desktop.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const area = screen.getPrimaryDisplay().workArea;
      win.setBounds({
        x: area.x,
        y: area.y,
        width: Math.min(1100, area.width),
        height: Math.min(720, area.height),
      });
      win.maximize();
    });
    await desktop
      .evaluate(({ dialog, BrowserWindow }) => {
        dialog.showMessageBoxSync = () => 1;
        BrowserWindow.getAllWindows()[0]!.close();
      })
      .catch(() => {});
    await expect.poll(() => desktop!.process().exitCode).not.toBeNull();
    desktop = undefined;
    if (newInstaller) await install(newInstaller);
    desktop = await launch();
    page = await desktop.firstWindow();
    await expect(page.getByText('测试账套', { exact: true })).toBeVisible();
    expect(
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isMaximized(),
      ),
    ).toBe(true);
    if (newInstaller) expect(await desktop.evaluate(({ app }) => app.getVersion())).toBe('0.1.0');
    expect(hash()).toBe(originalBackup);
    expect(existsSync(path.join(fixture.dataDir, 'books', `${fixture.bookId}.caiwu`))).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(fixture.configDir, 'desktop-settings.json'), 'utf8'))
        .dataDir,
    ).toBe(fixture.dataDir);
    await desktop
      .evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.close();
      })
      .catch(() => {});
    await expect.poll(() => desktop!.process().exitCode).not.toBeNull();
    desktop = undefined;
    if (installed) {
      const uninstaller = readdirSync(path.dirname(executable)).find((name) =>
        /^Uninstall.*\.exe$/iu.test(name),
      );
      expect(uninstaller).toBeDefined();
      expect(
        await run(path.join(path.dirname(executable), uninstaller!), ['/S', '/currentuser']),
      ).toBe(0);
      await expect.poll(() => existsSync(executable)).toBe(false);
      expect(hash()).toBe(originalBackup);
      expect(existsSync(path.join(fixture.dataDir, 'books', `${fixture.bookId}.caiwu`))).toBe(true);
      expect(
        JSON.parse(readFileSync(path.join(fixture.configDir, 'desktop-settings.json'), 'utf8'))
          .dataDir,
      ).toBe(fixture.dataDir);
    }
  } finally {
    if (desktop) {
      for (const page of desktop.windows())
        await page
          .evaluate(() => {
            window.onbeforeunload = null;
          })
          .catch(() => {});
      await desktop.close().catch(() => {});
    }
    await new Promise<void>((resolve) => network.close(() => resolve()));
  }
});
