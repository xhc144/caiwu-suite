import { expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedCashflowCases } from '../test/cashflow-fixtures';
import { test } from './fixture';

async function download(page: Page, label: string) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await event).path())!);
  return wb;
}

test('w_zc_xjll：真实菜单与工作台入口，现金银行试算、项目累计及凭证追查', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedCashflowCases(svc);
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${localServer.url}/m/workbench`);
  await page.getByRole('button', { name: '现金流量试算平衡表', exact: true }).last().click();
  await expect(
    page.getByRole('heading', { name: '现金流量试算平衡表', exact: true }),
  ).toBeVisible();
  await page.getByLabel('开始期间', { exact: true }).fill('202602');
  await page.getByLabel('结束期间', { exact: true }).fill('202602');
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  const totals = page.getByRole('region', { name: '现金流量核对', exact: true });
  await expect(totals).toContainText('244.10');
  await expect(totals).toContainText('未分配 1 行');
  await expect(totals).toContainText('余额与分录净变动一致');
  const details = page.getByRole('region', { name: '现金流量明细', exact: true });
  await expect(details.getByRole('row')).toHaveCount(8);
  await page.getByLabel('明细定位', { exact: true }).fill('历史流向为空');
  await page.getByLabel('明细定位', { exact: true }).press('Enter');
  await expect(details.getByRole('row')).toHaveCount(2);
  await expect(details).toContainText('未分配');
  const link = details.getByRole('link', { name: /^追查 / });
  await expect(link).toHaveAttribute('href', /^\/m\/voucher-entry\/edit\?id=\d+$/);
  await link.click();
  await expect(page).toHaveURL(/\/m\/voucher-entry\/edit\?id=/);
  await expect(page.locator('input[value="历史流向为空"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('w_zc_xjll_1：未过账确认/取消、项目筛选和 URL 恢复、完整 XLSX 批量转出', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedCashflowCases(svc);
  });
  await page.goto(`${localServer.url}/m/balances/cashflow?from=202602&to=202602`);
  await page.getByRole('checkbox', { name: '包含未过账凭证', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '包含未过账凭证', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('checkbox', { name: '包含未过账凭证', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('region', { name: '现金流量核对', exact: true })).toContainText(
    '257.10',
  );
  await page.getByLabel('现金流量项目', { exact: true }).fill('未分配');
  await page.keyboard.press('Enter');
  const details = page.getByRole('region', { name: '现金流量明细', exact: true });
  await expect(details.getByRole('row')).toHaveCount(2);
  await page.reload();
  await expect(details).toContainText('历史流向为空');
  const current = await download(page, '另存 Excel');
  expect(current.worksheets[1]!.rowCount).toBe(5);
  expect(current.worksheets[1]!.getCell('G5').value).toBe('未分配');
  const batch = await download(page, '批量转出各项目');
  expect(batch.worksheets).toHaveLength(5);
  const outflow = batch.worksheets.find(
    (w) => w.getCell('A1').text.includes('支付') || w.getCell('A1').text.includes('购买'),
  );
  expect(batch.worksheets.slice(1).reduce((n, w) => n + w.rowCount - 4, 0)).toBe(9);
  expect(outflow).toBeDefined();
  expect(outflow!.getCell('L5').value).toBe(-20);
});

test('w_zc_xjll_1：保存/恢复格式确认、冲突保留视图、读取新格式，排序及首末移动', async ({
  page,
  localServer,
}) => {
  const { bookId, token } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedCashflowCases(svc);
  });
  await page.goto(`${localServer.url}/m/balances/cashflow?from=202602&to=202602`);
  await page.getByLabel('排序', { exact: true }).selectOption('amount');
  await page.getByLabel('每页行数', { exact: true }).selectOption('20');
  await page.getByRole('button', { name: '保存格式', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const settings = await callApi<{ settings: { revision: number } }>(
    localServer.request,
    'm.balances.cashflowMetadata',
    undefined,
    { token, method: 'GET' },
  );
  expect(settings.settings.revision).toBe(0);
  await callApi(
    localServer.request,
    'm.balances.saveCashflowSettings',
    { revision: 0, display: { sort: 'account', pageSize: 100, showAccount: true } },
    { token, method: 'POST' },
  );
  await page.getByRole('button', { name: '保存格式', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('窗口格式已被其他窗口保存');
  await expect(page.getByLabel('排序', { exact: true })).toHaveValue('amount');
  await page.getByRole('button', { name: '读取已存格式', exact: true }).click();
  await expect(page.getByLabel('排序', { exact: true })).toHaveValue('account');
  await expect(page.getByLabel('每页行数', { exact: true })).toHaveValue('100');
  await page.getByRole('button', { name: '恢复标准格式', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByLabel('排序', { exact: true })).toHaveValue('date');
  const details = page.getByRole('region', { name: '现金流量明细', exact: true });
  await page.getByRole('button', { name: '末项', exact: true }).click();
  await expect(details.getByRole('row').last()).toHaveAttribute('style', /background/);
  await page.getByRole('button', { name: '首项', exact: true }).click();
  await expect(details.getByRole('row').nth(1)).toHaveAttribute('style', /background/);
  const manage = page.getByRole('link', { name: '审核及删除所选凭证', exact: true });
  await expect(manage).toHaveAttribute('href', /^\/m\/voucher-book\?id=\d+$/);
  await manage.click();
  await expect(page).toHaveURL(/\/m\/voucher-book\?id=/);
  await expect(page.getByRole('heading', { name: '凭证序时簿', exact: true })).toBeVisible();
  await expect(page.getByText('合成销售收款').first()).toBeVisible();
});

test('w_zc_xjll_1：无符合科目和错误期间可纠正，刷新确认取消保持结果，真实预览及连续打印', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedCashflowCases(svc);
  });
  await page.goto(
    `${localServer.url}/m/balances/cashflow?from=202602&to=202602&codeFrom=6001&codeTo=6001`,
  );
  await expect(page.getByRole('alert')).toContainText('无符合条件的现金或银行科目');
  await page.getByLabel('开始科目', { exact: true }).clear();
  await page.getByLabel('结束科目', { exact: true }).clear();
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  await expect(page.getByRole('region', { name: '现金流量核对', exact: true })).toContainText(
    '244.10',
  );
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('region', { name: '现金流量核对', exact: true })).toContainText(
    '244.10',
  );
  await page.getByRole('button', { name: '打印预览', exact: true }).click();
  const frame = page.frameLocator('iframe[title="现金流量试算打印预览"]');
  await expect(
    frame.getByRole('heading', { name: '现金流量试算平衡表', exact: true }),
  ).toBeVisible();
  await expect(frame.locator('body')).toContainText('244.10');
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.cashflowPrinted = html;
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '连续打印各项目', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.cashflowPrinted))
    .toContain('现金银行内部互转');
});

test('现金流量试算：1366×768 与 150% 缩放下入口及表格可用，页面不横向溢出', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedCashflowCases(svc);
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${localServer.url}/m/balances/cashflow?from=202602&to=202602`);
  await expect(page.getByRole('region', { name: '现金流量明细', exact: true })).toContainText(
    '历史流向为空',
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/caiwu-balances-cashflow-1366.png', fullPage: true });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1.5';
  });
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/caiwu-balances-cashflow-150.png', fullPage: true });
});
