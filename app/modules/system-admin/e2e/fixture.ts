import {
  test as base,
  expect,
  request as requestFactory,
  type APIRequestContext,
} from '@playwright/test';
import { createTestBook, seedVouchers } from '@caiwu/testkit';
import { callApi, E2E_APP_TOKEN } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type IsolatedBook = {
  bookId: string;
  dataDir: string;
  voucherId: number;
  token: string;
  request: APIRequestContext;
  baseURL: string;
  advanceClock?: (milliseconds: number) => void;
};

export const test = base.extend<{ isolated: IsolatedBook; controlledClock: boolean }>({
  controlledClock: [false, { option: true }],
  isolated: async ({ page, controlledClock }, use) => {
    const book = await createTestBook();
    let service: ReturnType<typeof spawnLocalServer> | undefined;
    let request: APIRequestContext | undefined;
    try {
      const [voucher] = await seedVouchers(book.svc, [
        {
          date: '2026-01-10',
          status: 'posted',
          lines: [
            { account: '1122', dims: { partner: 'C001' }, debit: 90 },
            { account: '100202', currency: 'USD', rate: '7.1', fcAmount: 100, debit: 710 },
            { account: '1403', quantity: '2.5', debit: 200 },
            { account: '6001', credit: 1000 },
          ],
        },
      ]);
      const cash = await book.svc.accounts.require('1001');
      // core 允许造出此合成期初；综合检查应指出未启用的外币/数量核算。
      await book.svc.opening.upsert({
        year: 2026,
        accountId: cash.id,
        balance: 0,
        currency: 'USD',
        fcBalance: 15,
        quantity: '0.25',
      });
      await book.store.closeAll(); // 在服务取得独占目录租约前关闭造数连接。
      const offsetFile = path.join(book.dataDir, 'clock-offset.txt');
      const entry = controlledClock ? path.join(book.dataDir, 'controlled-clock.mjs') : undefined;
      if (entry) {
        writeFileSync(offsetFile, '0');
        writeFileSync(
          entry,
          `import { readFileSync } from 'node:fs';
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + Number(readFileSync(${JSON.stringify(offsetFile)}, 'utf8'));
await import(${JSON.stringify(pathToFileURL(path.resolve('apps/server/src/main.ts')).href)});
`,
        );
      }
      service = spawnLocalServer({
        dataDir: book.dataDir,
        shutdownProtocol: 'native',
        entry,
        env: {
          CAIWU_PORT: '0',
          CAIWU_TOKEN: E2E_APP_TOKEN,
          CAIWU_DEV: '1',
          CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
        },
      });
      const baseURL = `http://127.0.0.1:${await service.ready()}`;
      request = await requestFactory.newContext({ baseURL });
      const session = await callApi<{ token: string; user: unknown; book: unknown }>(
        request,
        'core.auth.login',
        {
          bookId: book.info.id,
          userCode: 'admin',
          password: 'admin',
        },
      );
      await page.addInitScript(
        (value) => sessionStorage.setItem('caiwu.session', JSON.stringify(value)),
        {
          ...session,
          bookId: book.info.id,
        },
      );
      await use({
        bookId: book.info.id,
        dataDir: book.dataDir,
        voucherId: voucher!.id,
        token: session.token,
        request,
        baseURL,
        advanceClock: controlledClock
          ? (milliseconds) => writeFileSync(offsetFile, String(milliseconds))
          : undefined,
      });
    } finally {
      await request?.dispose();
      if (service) await service.close(); // 仅真实正常退出后删除本测试的合成数据目录。
      await book.close();
    }
  },
});
export { expect };
