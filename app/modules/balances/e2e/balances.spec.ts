import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import type { BalanceRow } from '@caiwu/core';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Settings } from '../shared';
import { seedBalanceCases, seedForeignZeroBaseCase } from '../test/fixtures';
import { test } from './fixture';

test('w_zw_ye：真实账套查询、状态口径、树、合计、URL 恢复、Excel 与明细地址', async ({
  page,
  localServer,
}) => {
  const { bookId, token } = await loginWithNewBook(page, localServer.request, {
    product: 'chengben',
  });
  await localServer.seed(bookId, seedBalanceCases);
  await page.goto(`${localServer.url}/m/balances?from=202602&to=202602`);
  await expect(page.getByRole('heading', { name: '汇总余额表' })).toBeVisible();
  const total = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '合计', exact: true }) });
  await expect(total).toContainText('738.34');
  await expect(page.getByRole('link', { name: '明细 100201', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '展开到末级' }).click();
  const bank = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: '明细 100201', exact: true }) });
  await expect(bank).toContainText('1,100.00');
  await expect(bank).toContainText('1,150.00');
  await page.getByRole('checkbox', { name: '包含未过账凭证', exact: true }).check();
  await expect(total).toContainText('918.34');
  await page.getByRole('checkbox', { name: '只显示有发生额', exact: true }).check();
  await expect(page.getByRole('link', { name: '明细 4001', exact: true })).toHaveCount(0);
  await expect(total).toContainText('918.34');
  const codeHeader = page.getByRole('columnheader', { name: '科目编码 拖动调整列宽', exact: true });
  const handle = await codeHeader.getByRole('separator').boundingBox();
  expect(handle).not.toBeNull();
  const dragX = handle!.x + handle!.width / 2;
  const dragY = handle!.y + handle!.height / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 40, dragY);
  await page.mouse.up();
  const storedWidth = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('caiwu.table.balances.summary.widths') ?? '{}')
        .code as number,
  );
  expect(storedWidth).toBeGreaterThan(140);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '包含未过账凭证', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '只显示有发生额', exact: true })).toBeChecked();
  await expect(page.getByLabel('显示级次', { exact: true })).toHaveValue('0');
  await expect(bank).toContainText('1,330.00');
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('caiwu.table.balances.summary.widths') ?? '{}')
          .code as number,
    ),
  ).toBe(storedWidth);
  const core = await callApi<BalanceRow[]>(
    localServer.request,
    'core.ledger.balances',
    { periodFrom: 202602, periodTo: 202602, includeUnposted: true, rollup: false },
    { token, method: 'GET' },
  );
  expect(core.filter((r) => r.isLeaf).reduce((sum, r) => sum + r.debit, 0)).toBe(91_834);
  expect(core.find((r) => r.accountCode === '100201')?.closing).toBe(133_000);
  await expect(total).toContainText('918.34');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadWait;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await download.path())!);
  const ws = wb.worksheets[0]!;
  expect(ws.getCell('A2').text).toContain('E2E 测试单位');
  expect(ws.getCell('A2').text).toContain('202602');
  expect(ws.getCell('A2').text).toContain('含待审核、已审核、已过账');
  const exportedRows = ws.getRows(5, ws.rowCount - 4)!;
  expect(exportedRows.find((row) => row.getCell(1).text === '100201')?.getCell(5).value).toBe(430);
  expect(exportedRows.find((row) => row.getCell(1).text === '合计')?.getCell(5).value).toBe(918.34);
  expect(exportedRows.some((row) => row.getCell(1).text === '4001')).toBe(false);
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.lastPrint = html;
      },
      printToPdf: async () => null,
    };
  });
  await page.getByRole('button', { name: '打印', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.lastPrint ?? ''))
    .toContain('918.34');
  expect(await page.evaluate(() => document.body.dataset.lastPrint)).toContain('E2E 测试单位');
  await page.getByLabel('显示级次', { exact: true }).selectOption('1');
  await expect(total).toContainText('918.34');
  await page.getByLabel('开始科目', { exact: true }).fill('100201');
  await page.keyboard.press('Enter');
  await page.getByLabel('结束科目', { exact: true }).fill('100201');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '查询', exact: false }).click();
  await expect(bank).toContainText('1,330.00');
  await expect(total).toContainText('430.00');
  await page.getByRole('link', { name: '明细 100201', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/m/ledgers/detail');
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
    account: '100201',
    from: '202602',
    to: '202602',
    dims: '{}',
    includeUnposted: '1',
    currency: '',
  });
});

test('w_zw_wbye：外币与本位币，带币种/维度钻取；错误 URL 阻止查询', async ({
  page,
  localServer,
}) => {
  const { bookId, token } = await loginWithNewBook(page, localServer.request, {
    product: 'chengben',
  });
  let department = 0;
  await localServer.seed(bookId, async (svc) => {
    await seedBalanceCases(svc);
    department = (await svc.dimensions.getByCode('department', '01'))!.id;
  });
  await page.goto(`${localServer.url}/m/balances/foreign?from=202602&to=202602`);
  await expect(page.getByRole('heading', { name: '外币余额表' })).toBeVisible();
  await page.getByRole('button', { name: '展开到末级' }).click();
  const usd = page.getByRole('region', { name: 'USD余额' });
  const usdRow = usd
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: '明细 100202', exact: true }) });
  await expect(usdRow).toContainText('781.00');
  await expect(usdRow).toContainText('110.00');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await downloadWait).path())!);
  expect(wb.worksheets[0]!.getCell('A2').text).toContain('币种：USD');
  expect(wb.worksheets[0]!.getCell('K4').text).toContain('外币期初');
  await usdRow.dblclick();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/m/ledgers/detail');
  expect(new URL(page.url()).searchParams.get('currency')).toBe('USD');
  expect(new URL(page.url()).searchParams.get('includeUnposted')).toBe('0');
  const dims = encodeURIComponent(JSON.stringify({ department }));
  await page.goto(
    `${localServer.url}/m/balances?from=202602&to=202602&includeUnposted=1&dims=${dims}`,
  );
  await page.getByRole('link', { name: '明细 6602', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/m/ledgers/detail');
  expect(JSON.parse(new URL(page.url()).searchParams.get('dims')!)).toEqual({ department });
  await page.goto(`${localServer.url}/m/balances?dims=broken`);
  await expect(page.getByRole('alert').filter({ hasText: '辅助项条件无效' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出 Excel', exact: true })).toBeDisabled();
  await expect(
    callApi(
      localServer.request,
      'm.balances.query',
      { codeFrom: '9999' },
      { token, method: 'GET' },
    ),
  ).rejects.toThrow('不存在');
});

test('w_zw_wbye_1：跨年本位币为零、原币非零的行、合计与真实 XLSX 均显示贷方原币余额', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request, { product: 'chengben' });
  await localServer.seed(bookId, seedForeignZeroBaseCase);
  await page.goto(
    `${localServer.url}/m/balances/foreign?from=202701&to=202701&currency=USD&level=-1`,
  );
  const usd = page.getByRole('region', { name: 'USD余额' });
  const row = usd
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: '明细 100202', exact: true }) });
  const total = usd
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '合计', exact: true }) });
  await expect(row.getByRole('cell').nth(9)).toHaveText('0.00');
  await expect(row.getByRole('cell').nth(10)).toHaveText('-100.00');
  await expect(row.getByRole('cell').nth(13)).toHaveText('-100.00');
  await expect(total.getByRole('cell').nth(10)).toHaveText('-100.00');
  await expect(total.getByRole('cell').nth(13)).toHaveText('-100.00');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await downloadWait).path())!);
  const ws = wb.worksheets[0]!;
  const rows = ws.getRows(5, ws.rowCount - 4)!;
  const bank = rows.find((r) => r.getCell(1).text === '100202')!;
  const sum = rows.find((r) => r.getCell(1).text === '合计')!;
  expect(bank.getCell(10).value).toBe(0);
  expect(bank.getCell(11).value).toBe(-100);
  expect(bank.getCell(14).value).toBe(-100);
  expect(sum.getCell(11).value).toBe(-100);
  expect(sum.getCell(14).value).toBe(-100);
  await page.getByRole('checkbox', { name: '只显示有发生额', exact: true }).check();
  await expect(row).toHaveCount(0);
  await expect(total.getByRole('cell').nth(13)).toHaveText('-100.00');
});

test('w_zw_ye_1/w_zw_wbye_1：取消放弃确认、真实过期保存失败保留草稿、成功持久化', async ({
  page,
  localServer,
}) => {
  const { token } = await loginWithNewBook(page, localServer.request, { product: 'chengben' });
  await page.goto(`${localServer.url}/m/balances`);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
  await drawer.getByLabel('默认显示级次').selectOption('-1');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
  // 壳关闭标签没有模块拦截接口，未保存草稿仍须能恢复。
  await page.keyboard.press('Control+F4');
  await expect(drawer).toHaveCount(0);
  await page.goto(`${localServer.url}/m/balances`);
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  await expect(drawer.getByRole('status')).toContainText('已恢复');
  await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
  await callApi<Settings>(
    localServer.request,
    'm.balances.saveSettings',
    { revision: 0, display: { level: 2, onlyActivity: true } },
    { token, method: 'POST' },
  );
  await drawer.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('本次没有覆盖');
  await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
  const metadata = await callApi<{ settings: Settings }>(
    localServer.request,
    'm.balances.metadata',
    undefined,
    { token, method: 'GET' },
  );
  expect(metadata.settings.display).toEqual({ level: 2, onlyActivity: true });
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '展示设置', exact: true }).click();
  await drawer.getByLabel('默认显示级次').selectOption('-1');
  await drawer.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await page.goto(`${localServer.url}/m/balances`);
  await expect(page.getByLabel('显示级次', { exact: true })).toHaveValue('-1');
});
