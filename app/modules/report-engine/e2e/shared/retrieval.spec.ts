import { expect } from '@playwright/test';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import {
  balanceFormula,
  emptyTemplate,
  type BalanceFunction,
  type Report,
  type ReportSnapshot,
} from '../../shared';
import { test } from './e2e-fixture';

const formula = (patch: Partial<BalanceFunction> = {}) =>
  balanceFormula({
    account: '1001',
    metric: 'closing',
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: 'none',
    item: '',
    ...patch,
  });
test('w_bb_proc 浏览器真实生成跨年/排除结转/IF/MAX整数结果，刷新后从持久化快照读取', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { startYear: 2025 });
  await isolated.seed(bookId, async (svc) => {
    await svc.periods.ensureYear(2026);
    await svc.opening.upsert({
      year: 2025,
      accountId: (await svc.accounts.require('1001')).id,
      balance: 101,
    });
    await seedVouchers(svc, [
      {
        date: '2025-02-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 203 },
          { account: '6001', credit: 203 },
        ],
      },
      {
        date: '2025-12-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 307 },
          { account: '6001', credit: 307 },
        ],
      },
      {
        date: '2026-01-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 409 },
          { account: '6001', credit: 409 },
        ],
      },
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 503 },
          { account: '6001', credit: 503 },
        ],
      },
    ]);
    const closing = await svc.vouchers.create({
      ...(await voucherInputFromSpec(svc, {
        date: '2026-02-28',
        lines: [
          { account: '6001', debit: 912 },
          { account: '4103', credit: 912 },
        ],
      })),
      closingKind: 'pnl',
    });
    await svc.vouchers.changeStatus({ ids: [closing.id], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [closing.id], to: 'posted' });
  });
  const template = emptyTemplate({ code: '101', name: '共享取数端到端', rows: 5, cols: 1 });
  const netRevenue = (closing: 'include' | 'exclude' | 'excludePnl') =>
    `${formula({ account: '6001', metric: 'ytdCredit', options: { closing } })}-${formula({ account: '6001', metric: 'ytdDebit', options: { closing } })}`;
  const sources = [
    formula({ metric: 'opening', options: { from: 'yearStart', to: 'current' } }),
    formula({ metric: 'debit', options: { from: 'previousYear', to: 'previousYear' } }),
    netRevenue('excludePnl'),
    netRevenue('include'),
    `IF(${formula()}>0,MAX(${formula()},0)*0.5,0)`,
  ];
  template.cells = sources.map((source, i) => ({
    address: `A${i + 1}`,
    kind: 'formula',
    source,
    unit: 'cents',
    currency: 'CNY',
  }));
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  const expected = ['611', '203', '912', '0', '762'];
  for (const [i, amount] of expected.entries())
    await expect(page.getByTestId(`result-A${i + 1}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      amount,
    );
  const snapshot = await callApi<ReportSnapshot>(
    isolated.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202602 },
    { token, method: 'GET' },
  );
  expect(snapshot.cells.map((c) => c.value)).toEqual(expected);
  await page.reload();
  await expect(page.getByTestId('result-A3').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '912',
  );
});

test('w_bb_proc 往来明细先分借贷；未知科目生成失败后仍保留原快照', async ({ page, isolated }) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, async (svc) => {
    await svc.dimensions.create({ type: 'partner', code: 'C002', name: '另一客户' });
    await seedVouchers(svc, [
      {
        date: '2026-01-01',
        status: 'posted',
        lines: [
          { account: '1122', debit: 10001, dims: { partner: 'C001' } },
          { account: '4001', credit: 10001 },
        ],
      },
      {
        date: '2026-01-01',
        status: 'posted',
        lines: [
          { account: '1122', credit: 6003, dims: { partner: 'C002' } },
          { account: '4001', debit: 6003 },
        ],
      },
    ]);
  });
  const template = emptyTemplate({ code: '101', name: '明细重分类端到端', rows: 3, cols: 1 });
  template.cells = ['debit', 'credit', 'net'].map((side, i) => ({
    address: `A${i + 1}`,
    kind: 'formula',
    unit: 'cents',
    currency: 'CNY',
    source: formula({
      account: '1122',
      options: { side: side as 'debit' | 'credit' | 'net', groupBy: ['partner'] },
    }),
  }));
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  for (const [i, amount] of ['10001', '6003', '3998'].entries())
    await expect(page.getByTestId(`result-A${i + 1}`).locator('[data-cents]')).toHaveAttribute(
      'data-cents',
      amount,
    );
  const original = await callApi<ReportSnapshot>(
    isolated.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202601 },
    { token, method: 'GET' },
  );
  await callApi(
    isolated.request,
    'm.report-engine.save',
    {
      id: r.id,
      expectedRevision: 1,
      template: {
        ...template,
        cells: [{ ...template.cells[0]!, source: formula({ account: '9999' }) }],
      },
    },
    { token },
  );
  await page.reload();
  await page.getByRole('button', { name: '生成/重算' }).click();
  const generationError = page
    .getByRole('alert')
    .filter({ hasText: '失败操作不会覆盖上次成功结果。' });
  await expect(generationError).toBeVisible();
  await expect(generationError).toContainText(/科目.*不存在/);
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '10001',
  );
  const after = await callApi<ReportSnapshot>(
    isolated.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202601 },
    { token, method: 'GET' },
  );
  expect(after.id).toBe(original.id);
});
