import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';
import { postedBook, reconciliation } from './scenarios';

const feedback = { timeout: 5000 };
const reconcileRoute = '**/trpc/*m.cashier.reconcile*';
const reads = ['m.cashier.accounts', 'm.cashier.reconcile'];
const readNames = (url: string) =>
  new URL(url).pathname
    .split('/')
    .at(-1)!
    .split(',')
    .filter((name) => reads.includes(name));

async function failAccountReads(page: Page) {
  const failed: string[] = [];
  let online = false;
  await page.route('**/trpc/**', async (route) => {
    const names = readNames(route.request().url());
    if (!online && names.includes('m.cashier.accounts')) {
      failed.push(...names);
      await route.abort('failed');
    } else await route.continue();
  });
  return { failed, recover: () => (online = true) };
}

function successfulReads(page: Page) {
  const completed: string[] = [];
  page.on('response', (response) => {
    if (response.ok() && response.request().method() === 'GET')
      completed.push(...readNames(response.url()));
  });
  return completed;
}

// 先向独占真实服务取结果，再暂缓交付浏览器；不伪造成功数据或修改接口。
async function holdReconcile(page: Page, fail = false) {
  const fetched = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  await page.route(
    reconcileRoute,
    async (route) => {
      const started = performance.now();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      fetched.resolve(performance.now() - started);
      await release.promise;
      if (fail) await route.abort('failed');
      else {
        const received = page.waitForResponse((r) => r.request() === route.request());
        await route.fulfill({ response });
        await (await received).finished();
      }
      delivered.resolve();
    },
    { times: 1 },
  );
  return { fetched: fetched.promise, release: () => release.resolve(), done: delivered.promise };
}

test('w_cn_dz 延迟刷新：旧表格、选择和余额持续可见，真实新数据成功后替换', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  await page.goto('/m/cashier/reconcile');
  const balance = page.getByRole('row', { name: /调节后余额/ });
  await expect(balance).toContainText('1,290.00');
  const selected = page.getByRole('row', { name: /CN-000001/ }).getByRole('checkbox');
  await selected.check();
  const oldRow = await balance.elementHandle();
  expect(oldRow).not.toBeNull();
  const oppositeAccountId = await cashier.withServices(
    book.bookId,
    async (svc) => (await svc.accounts.require('6603')).id,
  );
  await callApi(
    cashier.request,
    'm.cashier.createDocument',
    {
      accountId: book.accountId,
      period: 202601,
      date: '2026-01-11',
      direction: 'receipt',
      amount: 1100,
      summary: '延迟刷新新增收款',
      oppositeAccountId,
      dimensions: { cashflow: book.cashflow },
      requestKey: randomUUID(),
    },
    { token: book.token },
  );
  const gate = await holdReconcile(page);
  try {
    await test.step(
      '刷新等待时5秒内反馈忙状态且旧表格没有卸载',
      async () => {
        await page.getByRole('button', { name: '刷新财务分录' }).click();
        const networkMs = await gate.fetched;
        const connected = await oldRow!.evaluate((row) => row.isConnected);
        console.log(
          JSON.stringify({ refreshNetworkMs: networkMs, oldBalanceConnected: connected }),
        );
        expect(connected, '后台刷新不能卸载已有余额表').toBe(true);
        await expect(page.getByRole('status')).toHaveText('正在刷新，当前显示上次成功数据');
        await expect(balance).toContainText('1,290.00');
        await expect(selected).toBeChecked();
        await expect(page.getByText('所选出纳净额：200.00；财务净额：0.00')).toBeVisible();
        await expect(page.getByRole('button', { name: '确认手动勾账' })).toBeDisabled();
        // 连续点击只复用当前请求，不能取消后以旧快照覆盖新结果。
        const refresh = page.getByRole('button', { name: '刷新财务分录' });
        await expect(refresh).toBeDisabled();
        await refresh.evaluate((button: HTMLButtonElement) => button.click());
        await expect(balance).toContainText('1,290.00');
      },
      feedback,
    );
  } finally {
    gate.release();
  }
  await gate.done;
  await test.step(
    '真实响应交付后5秒内显示新余额并保留选择',
    async () => {
      await expect(balance).toContainText('1,301.00');
      await expect(page.getByRole('row', { name: /延迟刷新新增收款/ })).toBeVisible();
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(selected).toBeChecked();
      expect(await oldRow!.evaluate((row) => row.isConnected)).toBe(true);
    },
    feedback,
  );
  expect((await reconciliation(cashier, book)).adjustment).toMatchObject({
    cashBalance: 115600,
    coreBalance: 114500,
    adjustedCash: 130100,
    adjustedCore: 130100,
    difference: 0,
  });
});

test('w_cn_dz 刷新失败：保留两侧勾账选择和余额，明确错误并可真实重试', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  await page.goto('/m/cashier/reconcile');
  const balance = page.getByRole('row', { name: /调节后余额/ });
  await expect(balance).toContainText('1,290.00');
  const selectAll = page.getByRole('checkbox', { name: 'Select all', exact: true });
  await selectAll.nth(0).check();
  await selectAll.nth(1).check();
  const before = await reconciliation(cashier, book);
  const gate = await holdReconcile(page, true);
  try {
    await page.getByRole('button', { name: '刷新财务分录' }).click();
    await gate.fetched;
    await expect(balance).toContainText('1,290.00');
    await expect(selectAll.nth(0)).toBeChecked();
    await expect(selectAll.nth(1)).toBeChecked();
  } finally {
    gate.release();
  }
  await gate.done;
  await test.step(
    '失败5秒内显示可重试错误且保留成功快照',
    async () => {
      await expect(page.getByText('刷新失败，当前仍显示上次成功数据')).toBeVisible();
      await expect(balance).toContainText('1,290.00');
      await expect(selectAll.nth(0)).toBeChecked();
      await expect(selectAll.nth(1)).toBeChecked();
      await expect(page.getByText('所选出纳净额：145.00；财务净额：145.00')).toBeVisible();
      await expect(page.getByRole('button', { name: '确认手动勾账' })).toBeDisabled();
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await expect(page.getByText('刷新失败，当前仍显示上次成功数据')).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '确认手动勾账' })).toBeEnabled();
    },
    feedback,
  );
  expect(await reconciliation(cashier, book)).toEqual(before);
  await expect(selectAll.nth(0)).toBeChecked();
  await expect(selectAll.nth(1)).toBeChecked();
});

test('w_cn_dz 延迟旧响应不能覆盖新截止日或新账户的真实结果', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  const timings: { phase: string; ms: number }[] = [];
  const origin = performance.now();
  const mark = (phase: string) => timings.push({ phase, ms: performance.now() - origin });
  page.on('request', (request) => {
    if (request.url().includes('m.cashier.reconcile')) mark('reconcile-request');
  });
  page.on('response', (response) => {
    if (response.url().includes('m.cashier.reconcile')) mark('reconcile-response');
  });
  const coreAccountId = await cashier.withServices(
    book.bookId,
    async (svc) => (await svc.accounts.require('1001')).id,
  );
  const second = await callApi<{ id: number }>(
    cashier.request,
    'm.cashier.saveAccount',
    { data: { name: '切换现金', coreAccountId, currency: 'CNY', opening: 33000 } },
    { token: book.token },
  );
  await page.goto('/m/cashier/reconcile');
  const balance = page.getByRole('row', { name: /调节后余额/ });
  await expect(balance).toContainText('1,290.00');
  await page
    .getByRole('row', { name: /CN-000001/ })
    .getByRole('checkbox')
    .check();
  const gate = await holdReconcile(page);
  try {
    await page.getByRole('button', { name: '刷新财务分录' }).click();
    await gate.fetched;
    await test.step(
      '切换截止日5秒内仅显示该条件结果',
      async () => {
        await page.getByLabel('截止日', { exact: true }).fill('2026-01-09');
        await page.getByRole('button', { name: /查询$/ }).click();
        await expect(balance).toContainText('1,000.00');
        await expect(page.getByText('闭环银行 · CNY · 截止 2026-01-09')).toBeVisible();
        await expect(page.getByRole('row', { name: /CN-000001/ })).toHaveCount(0);
      },
      feedback,
    );
    await test.step(
      '切换账户5秒内只显示新账户且清除旧选择',
      async () => {
        mark('select-start');
        await page.getByLabel('对账账户', { exact: true }).click();
        mark('select-open');
        await page
          .locator('.ant-select-item-option-content')
          .getByText('切换现金', { exact: true })
          .click();
        mark('select-option-done');
        mark('query-click-start');
        await page.getByRole('button', { name: /查询$/ }).click();
        mark('query-click-done');
        await expect(page).toHaveURL(new RegExp(`accountId=${second.id}`));
        await expect(page.getByText('切换现金 · CNY · 截止 2026-01-09')).toBeVisible();
        await expect(balance).toContainText('330.00');
        await expect(page.getByText('所选出纳净额：0.00；财务净额：0.00')).toBeVisible();
        mark('new-account-visible');
      },
      feedback,
    );
  } finally {
    gate.release();
    await test.info().attach('cashier-account-switch-timings', {
      body: JSON.stringify(timings, null, 2),
      contentType: 'application/json',
    });
  }
  await gate.done;
  // 交付旧响应后跨过浏览器渲染帧再检查，不能只检查切换瞬间。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByText('切换现金 · CNY · 截止 2026-01-09')).toBeVisible();
  await expect(balance).toContainText('330.00');
  await expect(balance).not.toContainText('1,290.00');
});

test('w_cn_dz 初次账户请求失败：有效条件URL的页面重试真实恢复账户与对账', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  const network = await failAccountReads(page);
  await page.goto(`/m/cashier/reconcile?accountId=${book.accountId}&cutoff=2026-01-31`);
  await expect.poll(() => network.failed).toContain('m.cashier.accounts');
  await expect(page.getByRole('row', { name: /调节后余额/ })).toHaveCount(0);
  const retry = page.getByRole('button', { name: '重试', exact: true });
  await expect(retry).toBeVisible();
  network.recover();
  const completed = successfulReads(page);
  await test.step(
    '重试5秒内完成真实账户及对账HTTP请求并清除错误',
    async () => {
      await retry.click();
      await expect.poll(() => completed).toEqual(expect.arrayContaining(reads));
      await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,290.00');
      await expect(page.getByTitle('闭环银行', { exact: true })).toBeVisible();
      await expect(retry).toHaveCount(0);
      const selectAll = page.getByRole('checkbox', { name: 'Select all', exact: true });
      await selectAll.nth(0).check();
      await selectAll.nth(1).check();
      await expect(page.getByRole('button', { name: '确认手动勾账' })).toBeEnabled();
    },
    feedback,
  );
});

test('w_cn_dz 账户刷新失败重试：保留表格及两侧选择，恢复真实勾账和取消', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  await page.goto(`/m/cashier/reconcile?accountId=${book.accountId}&cutoff=2026-01-31`);
  const balance = page.getByRole('row', { name: /调节后余额/ });
  await expect(balance).toContainText('1,290.00');
  const oldRow = await balance.elementHandle();
  expect(oldRow).not.toBeNull();
  const selectAll = page.getByRole('checkbox', { name: 'Select all', exact: true });
  await selectAll.nth(0).check();
  await selectAll.nth(1).check();
  const before = await reconciliation(cashier, book);
  const network = await failAccountReads(page);
  await page.getByRole('button', { name: '刷新财务分录' }).click();
  await expect.poll(() => network.failed).toContain('m.cashier.accounts');
  await expect(page.getByText('刷新失败，当前仍显示上次成功数据')).toBeVisible();
  await expect(balance).toContainText('1,290.00');
  await expect(selectAll.nth(0)).toBeChecked();
  await expect(selectAll.nth(1)).toBeChecked();
  await expect(page.getByRole('button', { name: '确认手动勾账' })).toBeDisabled();
  network.recover();
  const completed = successfulReads(page);
  const gate = await holdReconcile(page);
  try {
    await test.step(
      '重试等待时5秒内反馈忙状态并保留原表格和选择',
      async () => {
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await gate.fetched;
        await expect(page.getByRole('status')).toHaveText('正在刷新，当前显示上次成功数据');
        await expect(balance).toContainText('1,290.00');
        expect(await oldRow!.evaluate((row) => row.isConnected)).toBe(true);
        await expect(selectAll.nth(0)).toBeChecked();
        await expect(selectAll.nth(1)).toBeChecked();
        await expect(page.getByRole('button', { name: '确认手动勾账' })).toBeDisabled();
      },
      feedback,
    );
  } finally {
    gate.release();
  }
  await gate.done;
  await test.step(
    '实际账户与对账HTTP恢复后5秒内启用动作且保留选择和余额',
    async () => {
      await expect.poll(() => completed).toEqual(expect.arrayContaining(reads));
      await expect(page.getByText('刷新失败，当前仍显示上次成功数据')).toHaveCount(0);
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(balance).toContainText('1,290.00');
      await expect(selectAll.nth(0)).toBeChecked();
      await expect(selectAll.nth(1)).toBeChecked();
      expect(await oldRow!.evaluate((row) => row.isConnected)).toBe(true);
      await expect(page.getByRole('button', { name: '确认手动勾账' })).toBeEnabled();
    },
    feedback,
  );
  expect(await reconciliation(cashier, book)).toEqual(before);
  await page.getByRole('button', { name: '确认手动勾账' }).click();
  const match = page.getByRole('dialog', { name: '确认手动等额勾账' });
  await match.getByLabel('确认文字').fill('勾账');
  await test.step(
    '恢复后真实勾账5秒内反馈并启用取消',
    async () => {
      await match.getByRole('button', { name: '确定', exact: true }).click();
      await expect(balance).toContainText('1,145.00');
      await expect(page.getByRole('button', { name: '取消勾账', exact: true })).toBeEnabled();
    },
    feedback,
  );
  await page.getByRole('button', { name: '取消勾账', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: /取消勾账组/ });
  await cancel.getByLabel('确认文字').fill('取消勾账');
  await test.step(
    '恢复后真实取消5秒内反馈并保留原业务余额',
    async () => {
      await cancel.getByRole('button', { name: '确定', exact: true }).click();
      await expect(balance).toContainText('1,290.00');
      await expect(page.getByRole('button', { name: '取消勾账', exact: true })).toHaveCount(0);
    },
    feedback,
  );
  expect((await reconciliation(cashier, book)).adjustment).toEqual(before.adjustment);
});
