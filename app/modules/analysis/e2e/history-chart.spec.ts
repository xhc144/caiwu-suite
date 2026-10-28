import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test, expect } from './fixture';

test('w_fx_nd_1 年中启用的结果图保留真实月份，不把启用前空值绘成零', async ({ page, isolated }) => {
  const book = await loginWithNewBook(page, isolated.request, {
    startMonth: 3,
    seed: false,
    product: 'chengben',
  });
  await isolated.seed(book.bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-03-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 12345 },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
  });
  await page.goto(
    `${isolated.origin}/m/analysis?accountCode=1001&period=202603&mode=annual&metric=debit`,
  );
  await page.getByRole('button', { name: '编辑并保存结果', exact: true }).click();
  const result = page.getByRole('dialog', { name: '分析结果编辑与保存', exact: true });
  await expect(result.getByLabel('1001-202603', { exact: true })).toHaveValue('123.45');
  await expect(result.getByLabel('1001-202601', { exact: true })).toHaveCount(0);
  await expect(result.getByLabel('1001-202602', { exact: true })).toHaveCount(0);
  const chart = result.getByRole('img', { name: /图表类型是柱状图/ });
  await expect(chart).toBeVisible();
  const description = await chart.getAttribute('aria-label');
  expect(description).toContain('202603');
  expect(description).toContain('123.45');
  expect(description).not.toContain('202601');
  expect(description).not.toContain('202602');
  await expect(result.getByText(/启用前及未完成输入不绘制/)).toBeVisible();
});
