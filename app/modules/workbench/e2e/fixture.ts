import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { createTestBook, seedVouchers } from '@caiwu/testkit';
import { createCoreServices, emptyModuleLookup, loadServiceUser } from '@caiwu/core/server';
import { callApi } from '@caiwu/testkit/e2e';
import type { SessionState } from '@caiwu/web-kit';
import { migrations } from '../server/migrations';

type Seeded = {
  origin: string;
  api: APIRequestContext;
  bookId: string;
  otherBookId: string;
  counts: { pending: number; audited: number };
  setPassword: (code: string, password: string) => Promise<void>;
  login: (page: Page, bookId?: string, userCode?: string) => Promise<SessionState>;
};
export const test = base.extend<{ seeded: Seeded }>({
  seeded: async ({ browserName: _browserName }, use) => {
    const t = await createTestBook({ migrationSets: [{ scope: 'workbench', migrations }] });
    const created = await seedVouchers(
      t.svc,
      (['pending', 'audited', 'posted', 'draft', 'pending'] as const).map((status) => ({
        date: '2026-01-10',
        status,
        summary: '独立工作台摘要',
        lines: [
          { account: '1001', debit: 12345 },
          { account: '6001', credit: 12345 },
        ],
      })),
    );
    await t.svc.vouchers.setVoided(created[4]!.id, true);
    await t.addUser('clerk', {
      password: 'clerk',
      permissions: ['workbench.search', 'workbench.overview.view', 'workbench.settings'],
    });
    const counts = {
      pending: (
        await t.svc.vouchers.list({ periodFrom: 202601, periodTo: 202601, statuses: ['pending'] })
      ).total,
      audited: (
        await t.svc.vouchers.list({ periodFrom: 202601, periodTo: 202601, statuses: ['audited'] })
      ).total,
    };
    const other = await t.store.create({
      name: '隔离账套',
      orgName: '隔离单位',
      templateId: 'demo-enterprise',
      product: 'chengben',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'admin',
    });
    const second = t.store.open(other.id);
    const otherSvc = createCoreServices({
      db: second.db,
      user: (await loadServiceUser(second.db, 1))!,
      moduleId: null,
      now: () => new Date(),
      modules: emptyModuleLookup,
    });
    await second.db
      .updateTable('account')
      .set({ name: '隔离专用现金', full_name: '隔离专用现金', pinyin: 'glzyxj' })
      .where('code', '=', '1001')
      .execute();
    await seedVouchers(otherSvc, [
      {
        date: '2026-01-10',
        summary: '隔离账套凭证',
        lines: [
          { account: '1001', debit: 100 },
          { account: '6001', credit: 100 },
        ],
      },
    ]);
    await t.store.closeAll();
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_DATA_DIR: t.dataDir,
        CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let api: APIRequestContext | undefined;
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => reject(new Error(`独立测试服务启动超时：${stderr}`)), 20000);
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`独立测试服务退出 ${code}：${stderr}`));
        });
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          const match = /CAIWU_READY (\{[^\n]+\})/.exec(stdout);
          if (match) {
            clearTimeout(timer);
            resolve((JSON.parse(match[1]!) as { port: number }).port);
          }
        });
      });
      const origin = `http://127.0.0.1:${port}`;
      api = await playwrightRequest.newContext({ baseURL: origin });
      const request = api;
      await use({
        origin,
        api: request,
        bookId: t.info.id,
        otherBookId: other.id,
        counts,
        setPassword: async (code, password) => {
          const opened = t.store.open(t.info.id);
          const svc = createCoreServices({
            db: opened.db,
            user: (await loadServiceUser(opened.db, 1))!,
            moduleId: null,
            now: () => new Date(),
            modules: emptyModuleLookup,
          });
          const user = (await svc.users.list()).find((u) => u.code === code);
          if (!user) throw new Error(`测试用户不存在：${code}`);
          await svc.users.setPassword(user.id, password);
          await t.store.closeAll();
        },
        login: async (page, bookId = t.info.id, userCode = 'admin') => {
          const login = await callApi<Omit<SessionState, 'bookId'>>(request, 'core.auth.login', {
            bookId,
            userCode,
            password: userCode,
          });
          const session = { ...login, bookId };
          await page.goto(origin);
          await page.evaluate(
            (s) => sessionStorage.setItem('caiwu.session', JSON.stringify(s)),
            session,
          );
          await page.goto(`${origin}/home`);
          return session;
        },
      });
    } finally {
      await api?.dispose();
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
      await t.close();
    }
  },
});
export { expect };
