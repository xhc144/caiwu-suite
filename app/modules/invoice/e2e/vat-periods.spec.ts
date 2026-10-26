import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import type { Page } from '@playwright/test';
import { midyearInvoices } from '../test/fixtures';
import { createInvoiceAccounts } from './data';
import { test, expect } from './isolated';

function vatRow(page: Page, period: number, direction = '进项') {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: direction, exact: true }) })
    .filter({ has: page.getByRole('cell', { name: String(period), exact: true }) });
}

test('w_fp_zzs_hz：3月启用的月/季度范围、红字和跨年确认', async ({ page, isolated }) => {
  const { origin, request, inBook } = isolated;
  const { bookId, token } = await loginWithNewBook(page, request, {
    product: 'chengben',
    startMonth: 3,
  });
  const cfg = await inBook(bookId, async (svc) => {
    const cfg = await createInvoiceAccounts(svc);
    await svc.periods.ensureYear(2027);
    await seedVouchers(svc, [
      {
        date: '2026-04-15',
        status: 'posted',
        lines: [
          { account: '7902', debit: 800 },
          { account: '7904', credit: 800 },
        ],
      },
      {
        date: '2027-01-31',
        status: 'posted',
        lines: [
          { account: '7902', debit: 300 },
          { account: '7904', credit: 300 },
        ],
      },
    ]);
    return cfg;
  });
  await callApi(request, 'm.invoice.saveSettings', cfg, { token });
  for (const data of midyearInvoices())
    await callApi(request, 'm.invoice.save', { data }, { token });
  await page.goto(`${origin}/m/invoice/vat?year=2026&groupBy=month`);
  const january = vatRow(page, 202601);
  await expect(january).toContainText('未启用（202603起）');
  await expect(january.getByRole('cell', { name: '0.00', exact: true })).toHaveCount(0);
  await expect(january.getByRole('button', { name: '查看票与分录', exact: true })).toBeDisabled();
  await expect(january.getByRole('link', { name: '明细账', exact: true })).toHaveCount(0);
  const april = vatRow(page, 202604);
  await expect(april.getByRole('cell', { name: '8.00', exact: true })).toHaveCount(2);
  await expect(april.getByRole('cell', { name: '0.00', exact: true })).toHaveCount(1);
  await april.getByRole('button', { name: '查看票与分录', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '账票差异明细' });
  await expect(detail.getByRole('row', { name: /MID-NORMAL/ })).toContainText('确认跨月');
  await expect(detail.getByRole('row', { name: /MID-RED/ })).toContainText('红字');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByLabel('汇总', { exact: true }).click();
  await page.getByText('按季', { exact: true }).click();
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  const firstQuarter = vatRow(page, 202601);
  await expect(firstQuarter).toContainText('部分期间：202603–202603');
  await expect(firstQuarter.getByRole('link', { name: '明细账', exact: true })).toHaveAttribute(
    'href',
    '/m/ledgers/detail?account=7902&from=202603&to=202603&dims=',
  );
  await expect(vatRow(page, 202604).getByRole('cell', { name: '8.00', exact: true })).toHaveCount(
    2,
  );
  await page.getByLabel('年度', { exact: true }).fill('2027');
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  const crossYear = vatRow(page, 202701);
  await expect(crossYear.getByRole('cell', { name: '3.00', exact: true })).toHaveCount(2);
  await expect(crossYear.getByRole('cell', { name: '0.00', exact: true })).toHaveCount(1);
  await crossYear.getByRole('button', { name: '查看票与分录', exact: true }).click();
  await expect(detail.getByRole('row', { name: /MID-CROSS-YEAR/ })).toContainText('2026-12-31');
  await expect(detail.getByRole('row', { name: /MID-CROSS-YEAR/ })).toContainText('2027-01-01');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByLabel('年度', { exact: true }).fill('2025');
  await page.getByRole('button', { name: /^(?:search )?查询$/ }).click();
  const beforeStart = vatRow(page, 202501);
  await expect(beforeStart).toContainText('未启用（202603起）');
  await expect(beforeStart.getByRole('cell', { name: '0.00', exact: true })).toHaveCount(0);
});
