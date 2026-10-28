import { expect } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedBalanceCases } from '../test/fixtures';
import { test } from './fixture';

test('w_zw_ye 定位折叠科目保持合计，w_zw_ye_kmxz 全部/指定打印、空选择阻止、独立预览及 Ctrl+P', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, seedBalanceCases);
  await page.goto(`${localServer.url}/m/balances?from=202602&to=202602`);
  const total = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '合计', exact: true }) });
  await expect(total).toContainText('738.34');
  await expect(page.getByRole('link', { name: '明细 100201', exact: true })).toHaveCount(0);
  await page.getByLabel('余额结果定位', { exact: true }).fill('100201');
  await page.getByLabel('余额结果定位', { exact: true }).press('Enter');
  await expect(page.getByRole('link', { name: '明细 100201', exact: true })).toBeVisible();
  await expect(total).toContainText('738.34');
  await page.getByRole('button', { name: '打印', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '选择打印科目', exact: true });
  await dialog.getByRole('radio', { name: '指定显示科目', exact: true }).check();
  await dialog.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '开始打印', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('至少选择一个');
  await dialog.getByRole('checkbox', { name: /^1001 / }).check();
  await dialog.getByRole('button', { name: '预览所选科目', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '余额表打印预览', exact: true });
  const frame = page.frameLocator('iframe[title="余额表打印预览"]');
  await expect(frame.getByRole('cell', { name: '1001', exact: true })).toHaveCount(2);
  await expect(frame.getByRole('cell', { name: '1001', exact: true }).first()).toBeVisible();
  await expect(frame.getByRole('cell', { name: '1002', exact: true })).toHaveCount(0);
  await expect(frame.locator('body')).toContainText('不另列选中科目合计');
  await preview.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('heading', { name: '汇总余额表', exact: true }).click();
  await page.keyboard.press('Control+p');
  await expect(dialog).toBeVisible();
});

test('w_zw_ye_ts 跨年提醒说明结束年度累计；数量与原币累计列在真实页面可见', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedBalanceCases(svc);
    await svc.periods.ensureYear(2027);
  });
  await page.goto(`${localServer.url}/m/balances?from=202612&to=202701`);
  await expect(page.getByRole('alert')).toContainText('查询跨越会计年度');
  await expect(page.getByRole('alert')).toContainText('结束期间所在年度');
  await page.goto(`${localServer.url}/m/balances/foreign?from=202602&to=202602`);
  await expect(page.getByRole('columnheader', { name: /^原币本年累计借方 / })).toBeVisible();
  await page.goto(`${localServer.url}/m/balances/quantity?from=202602&to=202602`);
  for (const unit of ['件', '千克']) {
    const group = page.getByRole('region', { name: `本位币余额 ${unit}`, exact: true });
    await expect(group.getByRole('columnheader', { name: /^本年累计借方数量 / })).toBeVisible();
    await expect(group.getByRole('columnheader', { name: /^结余单价/ })).toBeVisible();
  }
});
