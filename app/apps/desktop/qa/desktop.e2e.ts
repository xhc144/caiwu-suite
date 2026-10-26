import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'node:http';
import type { DesktopHost } from '../src/bridge';

// 测试侧结构契约；不修改或重新声明共享 print 包的 DesktopBridge。
type PrintApi = {
  printToPdf(html: string, options: { title: string; landscape?: boolean }): Promise<string | null>;
};
type PrintWindow = { caiwuDesktop: PrintApi };

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
  const executable = path.resolve(
    process.env.CAIWU_DESKTOP_EXECUTABLE || (loadModule('electron') as string),
  );
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
    const base = path.dirname(executable);
    const actual = existsSync(base)
      ? readdirSync(base, { recursive: true })
          .filter((name) => typeof name === 'string' && name.endsWith('.exe'))
          .slice(0, 20)
      : [];
    let registration = '';
    if (!existsSync(executable) && process.platform === 'win32') {
      registration = execFileSync(
        'pwsh',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq '财务软件' } | Select-Object InstallLocation,DisplayVersion | ConvertTo-Json -Compress",
        ],
        { encoding: 'utf8' },
      );
    }
    expect(
      existsSync(executable),
      `NSIS 必须安装到指定位置 ${base}；目录中的 exe：${JSON.stringify(actual)}；本应用安装注册项：${registration}`,
    ).toBe(true);
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
    await expect(page.getByText(/测试账套/).first()).toBeVisible();
    await expect
      .poll(() =>
        desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        async () => (await (window.caiwuDesktopHost as DesktopHost).dataDirectory.get()).path,
      ),
    ).toBe(fixture.dataDir);
    // 登录壳只依赖 core 的稳定路由/API，不依赖同波账套管理或系统管理的页面控件。
    await page.goto(`${new URL(page.url()).origin}/login/${fixture.bookId}`);
    const loggedIn = await page.evaluate(async (bookId) => {
      const boot = (window as unknown as { __CAIWU_BOOT__: { token: string } }).__CAIWU_BOOT__;
      const response = await fetch('/trpc/core.auth.login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-caiwu-token': boot.token },
        body: JSON.stringify({ bookId, userCode: 'admin', password: 'admin' }),
      });
      const result = (await response.json()) as { result?: { data?: { token?: string } } };
      return response.ok && typeof result.result?.data?.token === 'string';
    }, fixture.bookId);
    expect(loggedIn, '安装后的 utilityProcess 必须用真实 SQLite 完成 core 登录').toBe(true);
    console.log('② 安装后启动、账套显示和真实 SQLite 登录：通过');
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

    // 验证主窗口原有 Blob 导出仍可保存；适配原生保存路径，文件由真实下载管理器写入。
    const exported = path.join(root, '合成导出.txt');
    await desktop.evaluate(({ session }, file) => {
      session.defaultSession.once('will-download', (_event, item) => item.setSavePath(file));
    }, exported);
    await page.evaluate(() => {
      const url = URL.createObjectURL(new Blob(['合成导出'], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = '合成导出.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    await expect
      .poll(() => (existsSync(exported) ? readFileSync(exported, 'utf8') : ''))
      .toBe('合成导出');

    if (installed) {
      const installDir = path.dirname(executable);
      const candidates = [
        installDir,
        path.join(installDir, 'data'),
        path.dirname(installDir),
        installDir.toUpperCase(),
      ];
      for (const name of ['books', 'backups', 'backup']) {
        const data = path.join(root, `junction-${name}`);
        mkdirSync(data);
        symlinkSync(installDir, path.join(data, name), 'junction');
        candidates.push(data);
      }
      const originalConfig = readFileSync(
        path.join(fixture.configDir, 'desktop-settings.json'),
        'utf8',
      );
      for (const candidate of candidates) {
        await desktop.evaluate(({ dialog }, dir) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
          dialog.showErrorBox = () => {};
        }, candidate);
        expect(
          await page.evaluate(() =>
            (window.caiwuDesktopHost as DesktopHost).dataDirectory.choose(),
          ),
        ).toBeNull();
        expect(readFileSync(path.join(fixture.configDir, 'desktop-settings.json'), 'utf8')).toBe(
          originalConfig,
        );
        expect(await page.evaluate(async () => (await fetch('/healthz')).ok)).toBe(true);
      }
    }
    await desktop.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    expect(
      await page.evaluate(async () => {
        const host = window.caiwuDesktopHost as DesktopHost;
        return [
          await host.files.open(),
          await host.files.directory(),
          await host.dataDirectory.choose(),
        ];
      }),
    ).toEqual([null, null, null]);

    // 对话框响应由测试适配器提供；PDF 渲染、文件写入和打印窗安全在真实 Electron 运行。
    await desktop.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' });
    });
    expect(
      await page.evaluate(() =>
        (window as unknown as PrintWindow).caiwuDesktop.printToPdf('<p>取消</p>', {
          title: '取消',
        }),
      ),
    ).toBeNull();
    expect(
      await page.evaluate(() => (window.caiwuDesktopHost as DesktopHost).files.save('测试.txt')),
    ).toBeNull();
    expect(
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);
    const pdf = path.join(root, '中文横向.pdf');
    await desktop.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, pdf);
    const hostile = `<!doctype html><style>@page { size: A5 landscape; margin: 10mm; } .page { break-after: page; } .page:last-child { break-after: auto; }</style><div class="page"><p>中文横向账簿第一页</p><script>fetch('http://127.0.0.1:${address.port}/script')</script><img src="http://127.0.0.1:${address.port}/image"><iframe src="http://127.0.0.1:${address.port}/frame"></iframe></div><div class="page">中文账簿第二页</div>`;
    expect(
      await page.evaluate(
        ({ html }) =>
          (window as unknown as PrintWindow).caiwuDesktop.printToPdf(html, {
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
    expect(Math.abs(Number(box![1]) - 595.28), '@page A5 横向宽度（pt）').toBeLessThan(2);
    expect(Math.abs(Number(box![2]) - 419.53), '@page A5 横向高度（pt）').toBeLessThan(2);
    expect(
      (readFileSync(pdf, 'latin1').match(/\/Type\s*\/Page\b/gu) ?? []).length,
      'CSS 强制两页应与实际原生 PDF 分页一致',
    ).toBe(2);
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
        await (window as unknown as PrintWindow).caiwuDesktop.printToPdf('<p>失败</p>', {
          title: '失败',
        });
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
    if (newInstaller) {
      // 模拟旧用户误把账套放进安装树；覆盖安装必须停止，不能递归删除这些数据。
      const legacyDir = path.join(path.dirname(executable), 'books');
      mkdirSync(legacyDir);
      const legacyBook = path.join(legacyDir, 'legacy-qa.caiwu');
      cpSync(backup, legacyBook, { force: false, errorOnExist: true });
      expect(
        await run(newInstaller, ['/S', '/currentuser', `/D=${path.dirname(executable)}`]),
      ).not.toBe(0);
      expect(createHash('sha256').update(readFileSync(legacyBook)).digest('hex')).toBe(
        originalBackup,
      );
      rmSync(legacyBook);
      rmdirSync(legacyDir);
      await install(newInstaller);
    }
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
    if (newInstaller) console.log('③ 覆盖升级保留账套、备份、设置并重新启动：通过');
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
        await run(path.join(path.dirname(executable), uninstaller!), [
          '/S',
          '/currentuser',
          '--delete-app-data',
        ]),
      ).not.toBe(0);
      expect(existsSync(executable)).toBe(true);
      expect(existsSync(path.join(fixture.configDir, 'desktop-settings.json'))).toBe(true);
      const legacyBook = path.join(path.dirname(executable), 'legacy-uninstall-qa.caiwu');
      cpSync(backup, legacyBook, { force: false, errorOnExist: true });
      expect(
        await run(path.join(path.dirname(executable), uninstaller!), ['/S', '/currentuser']),
      ).not.toBe(0);
      expect(existsSync(executable)).toBe(true);
      expect(createHash('sha256').update(readFileSync(legacyBook)).digest('hex')).toBe(
        originalBackup,
      );
      rmSync(legacyBook);
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
      console.log('④ 正常卸载删除程序并保留账套、备份和用户配置：通过');
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
