import { expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceFormula, emptyTemplate, type Report } from '../../shared';
import { test } from '../fixture';

const base = {
  account: '1001',
  metric: 'closing' as const,
  unit: 'cents' as const,
  currency: 'CNY',
  direction: 'signed' as const,
  dimension: 'none' as const,
  item: '',
};
const cash = (date: string, amount: number, status: 'posted' | 'pending' = 'posted') => ({
  date,
  status,
  lines: [
    { account: '1001', debit: amount },
    { account: '6001', credit: amount },
  ],
});

test('w_bb_proc 本年累计穿透从年中启用月份开始，组合式不能只穿透第一个科目', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { startMonth: 7 });
  await isolated.seed(bookId, [
    cash('2026-07-05', 10000),
    cash('2026-08-05', 20000),
    cash('2026-09-05', 30000),
  ]);
  const template = emptyTemplate({ code: '101', name: '累计穿透', rows: 2, cols: 2 });
  template.cells = [
    {
      address: 'A1',
      source: balanceFormula({ ...base, metric: 'ytdDebit' }),
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
    },
    {
      address: 'A2',
      source: `${balanceFormula(base)}+${balanceFormula({ ...base, account: '100201' })}`,
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202609`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '60000',
  );
  await expect(page.getByRole('link', { name: 'A1 查看科目 1001 明细' })).toHaveAttribute(
    'href',
    '/m/ledgers/detail?account=1001&from=202607&to=202609',
  );
  await expect(page.getByRole('link', { name: /A2 查看科目/ })).toHaveCount(0);
  await expect(page.getByText('A2 明细穿透已暂停', { exact: true })).toBeVisible();
});

test('w_bb_proc 明确含未过账的实际金额与明细入口保持相同口径', async ({ page, isolated }) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, [cash('2026-01-05', 100), cash('2026-01-06', 20, 'pending')]);
  const template = emptyTemplate({ code: '101', name: '含未过账穿透', rows: 1, cols: 1 });
  template.cells = [
    {
      address: 'A1',
      source: balanceFormula(base),
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(
    `${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202601&includeUnposted=true`,
  );
  await page.getByRole('button', { name: '生成/重算' }).click();
  const confirm = page.getByRole('dialog', { name: '生成前发现未过账凭证' });
  await expect(confirm).toContainText('1 张未过账凭证');
  await expect(page.getByTestId('result-A1')).toHaveCount(0);
  await confirm.getByRole('button', { name: '按所选口径继续生成' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '120',
  );
  await expect(page.getByRole('link', { name: 'A1 查看科目 1001 明细' })).toHaveAttribute(
    'href',
    '/m/ledgers/detail?account=1001&from=202601&to=202601&includeUnposted=1',
  );
});
