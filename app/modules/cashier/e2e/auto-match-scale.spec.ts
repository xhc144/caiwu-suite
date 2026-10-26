import { randomUUID } from 'node:crypto';
import { seedVouchers } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import type { CashierTables } from '../server/migrations';
import { test, expect } from './fixture';
import { bankBook } from './scenarios';
import type { Outputs } from '../web/api';

for (const duplicate of [false, true]) {
  test(`w_cn_dz 真实10k${duplicate ? '重复' : '唯一'}金额：打开、选择及末页候选均在5秒内可交互`, async ({
    cashier,
  }) => {
    const book = await bankBook(cashier);
    const { page } = cashier;
    await cashier.withServices(book.bookId, async (svc) => {
      await svc.tx(async (t) => {
        const oppositeId = (await t.accounts.require('6603')).id;
        for (let start = 0; start < 10000; start += 200) {
          await t.db
            .withTables<CashierTables>()
            .insertInto('cashier_document')
            .values(
              Array.from({ length: 200 }, (_, j) => ({
                request_key: randomUUID(),
                original_json: '{}',
                account_id: book.accountId,
                date: '2026-01-10',
                period: 202601,
                summary: `规模收款${start + j + 1}`,
                direction: 'receipt' as const,
                amount: duplicate ? 101 : start + j + 1,
                opposite_account_id: oppositeId,
                dimensions_json: JSON.stringify({ cashflow: book.cashflow }),
                ref_no: '',
                note: '',
              })),
            )
            .execute();
        }
        await seedVouchers(
          t,
          Array.from({ length: 20 }, (_, batch) => {
            const amounts = Array.from({ length: 500 }, (_, i) =>
              duplicate ? 101 : batch * 500 + i + 1,
            );
            return {
              date: '2026-01-10',
              status: 'posted' as const,
              lines: [
                ...amounts.map((amount) => ({
                  account: '100201',
                  debit: amount,
                  dims: { cashflow: 'CF01' },
                })),
                { account: '6603', credit: amounts.reduce((s, a) => s + a, 0) },
              ],
            };
          }),
        );
      });
    });
    const reads: Outputs['reconcile'] = await callApi(
      cashier.request,
      'm.cashier.reconcile',
      { accountId: book.accountId, cutoff: '2026-01-31' },
      { token: book.token, method: 'GET' },
    );
    expect(reads.documents.length).toBe(10000);
    expect(reads.entries.length).toBe(10000);
    await page.goto('/m/cashier/reconcile');
    await expect(page.getByRole('button', { name: '预览自动勾账建议', exact: true })).toBeEnabled();
    const times: Record<string, number> = {};
    const drawer = page.getByRole('dialog', { name: '自动勾账建议', exact: true });
    await test.step(
      '真实10k建议打开后5秒内可交互',
      async () => {
        const start = performance.now();
        await page.getByRole('button', { name: '预览自动勾账建议', exact: true }).click();
        await expect(drawer.getByText(/共 10000 张待勾单据/)).toBeVisible();
        await expect(drawer.getByLabel('匹配 CN-000001', { exact: true })).toBeVisible();
        if (!duplicate) await expect(drawer.getByText(/已预选日期顺序前 200 对/)).toBeVisible();
        times.open = performance.now() - start;
      },
      { timeout: 5000 },
    );
    await test.step(
      '10k条件下选择变化5秒内反馈且保留全部建议',
      async () => {
        const start = performance.now();
        if (!duplicate)
          await drawer.getByRole('button', { name: '清空匹配选择', exact: true }).click();
        const first = drawer.getByLabel('匹配 CN-000001', { exact: true });
        await first.click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(drawer.getByText(/已选择 1 对/)).toBeVisible();
        await expect(drawer.getByText(/共 10000 张待勾单据/)).toBeVisible();
        times.select = performance.now() - start;
      },
      { timeout: 5000 },
    );
    await test.step(
      '末页建议和重复金额末页分录5秒内可达，不静默截断',
      async () => {
        const start = performance.now();
        if (duplicate) {
          const group = drawer.getByRole('group', { name: '候选 CN-000001', exact: true });
          await expect(group.getByText('候选共 10000 条', { exact: false })).toBeVisible();
          const input = group.locator('.ant-pagination-simple-pager input');
          await input.fill('200');
          await input.press('Enter');
          await expect(group.getByText(/当前第 9951–10000 条/)).toBeVisible();
          await group.getByLabel('匹配 CN-000001', { exact: true }).click();
          const e = reads.entries[9950]!;
          const label = `${e.date} ${e.displayNo} 分录${e.lineId}`;
          await page
            .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
            .getByText(label, { exact: true })
            .click();
          await expect(group).toContainText(label);
          await expect(drawer.getByText(/已选择 1 对/)).toBeVisible();
        } else {
          await drawer.getByTitle('200', { exact: true }).click();
          const last = drawer.getByLabel('匹配 CN-010000', { exact: true });
          await expect(last).toBeVisible();
          await last.click();
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          await expect(drawer.getByText(/已选择 2 对/)).toBeVisible();
        }
        times.lastPage = performance.now() - start;
      },
      { timeout: 5000 },
    );
    console.log(JSON.stringify({ scale: duplicate ? 'duplicate-10k' : 'unique-10k', ...times }));
    await test.info().attach('auto-match-10k-timings', {
      body: JSON.stringify(times),
      contentType: 'application/json',
    });
  });
}
