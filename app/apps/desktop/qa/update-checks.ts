import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DesktopHost } from '../src/bridge';

/** 真实已安装的旧版进程 + 本分支真实新版 NSIS；仅替换远端传输和原生对话框响应。 */
export async function checkInstalledUpdates(
  desktop: ElectronApplication,
  page: Page,
  installer: string,
  version: string,
  dataDir: string,
): Promise<Page> {
  // 等待启动时那一次检查完成；之后本用例的更新传输全部使用下面的适配器。
  await expect
    .poll(
      async () => (await page.evaluate(() => window.caiwuDesktopHost!.updates.status())).state,
      { timeout: 40_000 },
    )
    .not.toBe('checking');
  const sha256 = createHash('sha256').update(readFileSync(installer)).digest('hex');
  const size = readFileSync(installer).length;
  await desktop.evaluate(
    async (_electron, input) => {
      const fs = process.getBuiltinModule('fs');
      const scope = globalThis as typeof globalThis & { __w2Truncate?: boolean };
      const original = globalThis.fetch;
      const base = 'https://github.com/xhc144/caiwu-suite';
      const name = `caiwu-desktop-${input.version}-x64-setup.exe`;
      const manifest = `caiwu-desktop-${input.version}-x64-update.json`;
      const url = `${base}/releases/download/v${input.version}/${name}`;
      const manifestUrl = `${base}/releases/download/v${input.version}/${manifest}`;
      globalThis.fetch = async (target, init) => {
        if (target === 'https://api.github.com/repos/xhc144/caiwu-suite/releases/latest')
          return Response.json({
            tag_name: `v${input.version}`,
            html_url: `${base}/releases/tag/v${input.version}`,
            draft: false,
            prerelease: false,
            assets: [
              {
                name,
                browser_download_url: url,
                size: input.size,
                digest: `sha256:${input.sha256}`,
              },
              { name: manifest, browser_download_url: manifestUrl },
            ],
          });
        if (target === manifestUrl)
          return Response.json({
            schema: 1,
            version: input.version,
            file: name,
            size: input.size,
            sha256: input.sha256,
          });
        if (target === url) {
          const data = fs.readFileSync(input.installer);
          return new Response(scope.__w2Truncate ? data.subarray(0, 32) : data);
        }
        return original(target, init);
      };
    },
    { installer, version, size, sha256 },
  );
  expect((await page.evaluate(() => window.caiwuDesktopHost!.updates.check())).state).toBe(
    'available',
  );
  await desktop.evaluate(() => {
    (globalThis as { __w2Truncate?: boolean }).__w2Truncate = true;
  });
  expect((await page.evaluate(() => window.caiwuDesktopHost!.updates.download())).state).toBe(
    'error',
  );
  expect(
    await page.evaluate(async () => {
      try {
        await window.caiwuDesktopHost!.updates.install();
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/healthz')).ok)).toBe(true);
  await desktop.evaluate(() => {
    (globalThis as { __w2Truncate?: boolean }).__w2Truncate = false;
  });
  await page.evaluate(() => window.caiwuDesktopHost!.updates.check());
  const downloaded = await page.evaluate(() => window.caiwuDesktopHost!.updates.download());
  expect(downloaded.state).toBe('downloaded');
  expect(downloaded.update?.sha256).toBe(sha256);
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  });
  expect(await page.evaluate(() => window.caiwuDesktopHost!.updates.install())).toBe(false);
  // 真实 beforeunload 取消更新，服务不能提前停止，页面和已下载状态均保留。
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.evaluate(() => {
    window.onbeforeunload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
  });
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    dialog.showMessageBoxSync = () => 0;
  });
  await page.evaluate(() => window.caiwuDesktopHost!.updates.install());
  expect(page.isClosed()).toBe(false);
  expect(await page.evaluate(async () => (await fetch('/healthz')).ok)).toBe(true);
  expect((await page.evaluate(() => window.caiwuDesktopHost!.updates.status())).state).toBe(
    'downloaded',
  );
  await page.evaluate(() => {
    window.onbeforeunload = null;
  });

  // 服务正常退出后，损坏账套必须使真实备份失败并恢复窗口，安装器不得启动。
  const corrupt = path.join(dataDir, 'books', `${randomUUID()}.caiwu`);
  writeFileSync(corrupt, 'synthetic corrupt database', { flag: 'wx' });
  await desktop.evaluate(({ dialog }) => {
    const scope = globalThis as { __w2UpdateErrors?: string[] };
    scope.__w2UpdateErrors = [];
    dialog.showErrorBox = (title) => {
      scope.__w2UpdateErrors!.push(title);
    };
  });
  try {
    const reopened = desktop.waitForEvent('window');
    await page
      .evaluate(() => (window.caiwuDesktopHost as DesktopHost).updates.install())
      .catch(() => {});
    page = await reopened;
    await expect(page.getByText(/测试账套/).first()).toBeVisible();
    expect(
      await desktop.evaluate(
        () => (globalThis as { __w2UpdateErrors?: string[] }).__w2UpdateErrors,
      ),
    ).toContain('更新安装未启动');
    expect(readFileSync(corrupt, 'utf8')).toBe('synthetic corrupt database');
    expect(await page.evaluate(async () => (await fetch('/healthz')).ok)).toBe(true);
    expect(existsSync(installer)).toBe(true);
  } finally {
    unlinkSync(corrupt);
  }
  return page;
}
