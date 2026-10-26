import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DesktopHost } from '../src/bridge';

const load = createRequire(import.meta.url);
const events = (
  file: string,
): { event: string; title?: string; message?: string; detail?: string }[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

// 保留 desktop.e2e.ts 原有全部安装、SQLite、PDF、升级和 4/3/0 卸载断言。
for (const host of ['node', 'utility']) {
  for (const mode of ['delay', 'refuse', 'signal', 'hang']) {
    test(`真实 Electron ${host}：目录切换 ${mode}，正常完成才保存/请求重启`, async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'm21-electron-stop-'));
      const config = path.join(root, 'config');
      const data = path.join(root, 'data');
      const next = path.join(root, 'next');
      const resources = path.join(root, 'resources');
      for (const dir of [config, data, next, resources]) mkdirSync(dir);
      symlinkSync(
        path.resolve('apps/web/dist'),
        path.join(resources, 'web'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const settings = path.join(config, 'desktop-settings.json');
      const initial = `${JSON.stringify({ version: 1, dataDir: data })}\n`;
      writeFileSync(settings, initial);
      const marker = path.join(root, 'service-events');
      const hostEvents = path.join(root, 'host-events');
      const lock = path.join(data, 'synthetic-lock');
      let desktop: ElectronApplication | undefined;
      try {
        desktop = await _electron.launch({
          executablePath: load('electron') as string,
          args: [path.resolve('apps/desktop/qa/shutdown-harness.cjs')],
          cwd: process.cwd(),
          env: {
            ...process.env,
            CAIWU_NODE: process.execPath,
            CAIWU_DATA_DIR: '',
            CAIWU_DESKTOP_USER_DATA_DIR: config,
            M21_QA_HOST: host,
            M21_QA_STOP_MODE: mode,
            M21_QA_STOP_DELAY: '6500',
            M21_QA_MARKER: marker,
            M21_QA_HOST_EVENTS: hostEvents,
            M21_QA_LOCK: lock,
            M21_QA_NEXT_DIR: next,
            M21_QA_RESOURCES: resources,
          },
        });
        const page = await desktop.firstWindow();
        await expect(page.getByText('合成退出测试')).toBeVisible();
        const processHandle = desktop.process();
        if (mode === 'delay') {
          // 同时覆盖目录切换的 beforeunload 取消：窗口、服务、配置均保留。
          await page.getByRole('button', { name: '编辑' }).click();
          await page.evaluate(() => {
            window.onbeforeunload = (event) => {
              event.preventDefault();
              event.returnValue = '';
            };
          });
          await page.evaluate(() =>
            (window.caiwuDesktopHost as DesktopHost).dataDirectory.choose(),
          );
          expect(page.isClosed()).toBe(false);
          expect(readFileSync(settings, 'utf8')).toBe(initial);
          expect(readFileSync(marker, 'utf8')).toBe('ready\n');
          await page.evaluate(() => {
            window.onbeforeunload = null;
          });
        }
        const start = Date.now();
        // 真正通过 preload/IPC 选择目录；窗口关闭后仍有可调试的 Electron 主进程。
        await page
          .evaluate(() => (window.caiwuDesktopHost as DesktopHost).dataDirectory.choose())
          .catch(() => {});
        await desktop
          .evaluate(({ app }) => {
            app.quit();
            app.quit();
          })
          .catch(() => {});
        if (mode === 'delay') {
          await expect
            .poll(
              () => existsSync(marker) && readFileSync(marker, 'utf8').includes('stop-requested'),
            )
            .toBe(true);
          expect(processHandle.exitCode).toBeNull();
          expect(readFileSync(settings, 'utf8')).toBe(initial);
          expect(events(hostEvents)).toEqual([]);
          await expect.poll(() => processHandle.exitCode, { timeout: 15_000 }).toBe(0);
          expect(Date.now() - start).toBeGreaterThanOrEqual(6000);
          expect(readFileSync(marker, 'utf8')).toBe(
            'ready\nstop-requested\njob-complete\nterminal-written\nlog-written\n',
          );
          expect(JSON.parse(readFileSync(settings, 'utf8')).dataDir).toBe(next);
          expect(events(hostEvents)).toEqual([{ event: 'relaunch-requested' }]);
        } else {
          await expect
            .poll(() => events(hostEvents).filter((e) => e.title === '正常退出未完成').length, {
              timeout: 45_000,
            })
            .toBe(1);
          expect(processHandle.exitCode).toBeNull();
          expect(readFileSync(settings, 'utf8')).toBe(initial);
          expect(events(hostEvents).some((e) => e.event === 'relaunch-requested')).toBe(false);
          expect(readFileSync(lock, 'utf8')).toBe('synthetic-owned-lock');
          const failure = events(hostEvents).find((e) => e.title === '正常退出未完成')!;
          if (mode === 'hang') {
            expect(failure.message).toContain('超时');
            expect(failure.detail).toContain('继续等待只等待当前任务');
            // 取消强制退出会继续等当前任务；再超时后显式确认强制退出。
            await desktop.evaluate(() =>
              (globalThis as unknown as { __m21Respond: (n: number) => void }).__m21Respond(2),
            );
            await expect
              .poll(() => events(hostEvents).filter((e) => e.title === '确认强制退出').length)
              .toBe(1);
            await desktop.evaluate(() =>
              (globalThis as unknown as { __m21Respond: (n: number) => void }).__m21Respond(0),
            );
            await expect
              .poll(() => events(hostEvents).filter((e) => e.title === '正常退出未完成').length, {
                timeout: 45_000,
              })
              .toBe(2);
            await desktop.evaluate(() =>
              (globalThis as unknown as { __m21Respond: (n: number) => void }).__m21Respond(2),
            );
            await expect
              .poll(() => events(hostEvents).filter((e) => e.title === '确认强制退出').length)
              .toBe(2);
            await desktop
              .evaluate(() =>
                (globalThis as unknown as { __m21Respond: (n: number) => void }).__m21Respond(1),
              )
              .catch(() => {});
          } else {
            expect(failure.detail).toContain('服务已退出');
            await desktop
              .evaluate(() =>
                (globalThis as unknown as { __m21Respond: (n: number) => void }).__m21Respond(1),
              )
              .catch(() => {});
          }
          await expect.poll(() => processHandle.exitCode).toBe(1);
          expect(readFileSync(settings, 'utf8')).toBe(initial);
          expect(events(hostEvents).some((e) => e.event === 'relaunch-requested')).toBe(false);
          expect(readFileSync(lock, 'utf8')).toBe('synthetic-owned-lock');
        }
        desktop = undefined;
        console.log(`退出结果回归 ${host}/${mode}：真实 Electron 进程与子进程断言通过`);
      } finally {
        await desktop?.close().catch(() => {});
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
