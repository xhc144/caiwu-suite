import { expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedAuxiliaryQuantityCases } from '../test/fixtures';
import { test } from './fixture';

async function workbook(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await downloaded).path())!);
  return wb;
}

test('w_zw_fhye：无效 URL 核算类型显示纠正提示，选择有效类型后恢复查询', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedAuxiliaryQuantityCases(svc);
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `${localServer.url}/m/balances/auxiliary?dimension=invalid&from=202602&to=202602`,
  );
  await expect(page.getByRole('alert')).toContainText('辅助核算类型无效');
  await page.getByLabel('核算类型', { exact: true }).selectOption('department');
  await expect(page.getByRole('region', { name: /^本位币余额 01 / })).toBeVisible();
  expect(errors).toEqual([]);
});

test('w_zw_slye：菜单入口、同父不同单位展开、红字数量发生、精确 XLSX 与 URL 恢复', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedAuxiliaryQuantityCases(svc);
  });
  await page.goto(`${localServer.url}/m/balances`);
  await page.getByRole('menuitem', { name: '数量余额表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '数量余额表', exact: true })).toBeVisible();
  const panel = page.getByRole('tabpanel', { name: '数量余额表', exact: true });
  await panel.getByLabel('开始期间', { exact: true }).fill('202602');
  await panel.getByLabel('结束期间', { exact: true }).fill('202602');
  await panel.getByRole('button', { name: /查询/ }).click();
  await page.getByRole('button', { name: '展开到末级', exact: true }).click();
  const kg = page.getByRole('region', { name: '本位币余额 千克', exact: true });
  const pieces = page.getByRole('region', { name: '本位币余额 件', exact: true });
  await expect(kg).toContainText('2.500003');
  await expect(pieces).toContainText('102.000002');
  const parent = kg
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '原材料', exact: true }) });
  await expect(parent).toContainText('2.500003');
  await expect(parent.getByRole('link')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '只显示有发生额', exact: true }).check();
  const leaf = kg
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: '明细 140301', exact: true }) });
  await expect(leaf).toContainText('0.000002');
  await page.reload();
  await expect(leaf).toContainText('1.000003');
  await expect(page.getByRole('checkbox', { name: '只显示有发生额', exact: true })).toBeChecked();
  const wb = await workbook(page);
  expect(wb.worksheets).toHaveLength(2);
  const sheet = wb.worksheets.find((ws) => ws.getCell('A2').text.includes('数量单位：千克'))!;
  expect(sheet.getCell('K4').text).toContain('期初数量');
  const rows = sheet.getRows(5, sheet.rowCount - 4)!;
  expect(rows.find((r) => r.getCell(1).text === '140301')!.getCell(12).value).toBe('0.000002');
  expect(rows.find((r) => r.getCell(1).text === '合计')!.getCell(14).value).toBe('2.500003');
  expect(
    wb.worksheets.find((ws) => ws.getCell('A2').text.includes('数量单位：件'))!.lastRow!.getCell(14)
      .value,
  ).toBe('102.000002');
  await leaf.getByRole('link').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/m/ledgers/detail');
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({
    account: '140301',
    from: '202602',
    to: '202602',
    currency: '',
    dims: '{}',
  });
});

test('w_zw_fhye：四类辅助入口、部门范围与空范围、独立合计、导出及精确钻取', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  let department = 0;
  await localServer.seed(bookId, async (svc) => {
    department = (await seedAuxiliaryQuantityCases(svc)).department;
  });
  await page.goto(
    `${localServer.url}/m/balances/auxiliary?from=202602&to=202602&codeFrom=1403&codeTo=1403`,
  );
  await expect(page.getByRole('heading', { name: '辅助余额表', exact: true })).toBeVisible();
  await page.getByLabel('核算类型', { exact: true }).selectOption('department');
  await page.getByLabel('开始辅助项', { exact: true }).fill('01');
  await page.keyboard.press('Enter');
  await page.getByLabel('结束辅助项', { exact: true }).fill('01');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '展开到末级', exact: true }).click();
  const group = page.getByRole('region', { name: /^本位币余额 01 / });
  await expect(group).toContainText('91.00');
  await expect(page.getByRole('region', { name: /^本位币余额 02 / })).toHaveCount(0);
  await page.reload();
  await expect(group).toContainText('91.00');
  const wb = await workbook(page);
  expect(wb.worksheets).toHaveLength(1);
  expect(wb.worksheets[0]!.getCell('A2').text).toContain('辅助项：01');
  const total = wb.worksheets[0]!.lastRow!;
  expect(total.getCell(5).value).toBe(0);
  expect(total.getCell(6).value).toBe(10);
  const href = await group
    .getByRole('link', { name: '明细 140301', exact: true })
    .getAttribute('href');
  expect(JSON.parse(new URL(href!, 'http://local').searchParams.get('dims')!)).toEqual({
    department,
  });
});

test('w_zw_fhwbye：辅助外币入口保留红字原币、按币种导出及辅助项 ID 钻取', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  let project = 0;
  await localServer.seed(bookId, async (svc) => {
    project = (await seedAuxiliaryQuantityCases(svc)).project;
  });
  await page.goto(
    `${localServer.url}/m/balances/auxiliary/foreign?from=202602&to=202602&level=-1&onlyActivity=1`,
  );
  await expect(page.getByRole('heading', { name: '辅助外币余额表', exact: true })).toBeVisible();
  const group = page.getByRole('region', { name: /^USD余额 XM01 / });
  await expect(group).toContainText('-10.00');
  const wb = await workbook(page);
  expect(wb.worksheets).toHaveLength(1);
  expect(wb.worksheets[0]!.getCell('A2').text).toContain('币种：USD');
  expect(wb.worksheets[0]!.lastRow!.getCell(12).value).toBe(-10);
  await group.getByRole('link', { name: '明细 140301', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/m/ledgers/detail');
  expect(new URL(page.url()).searchParams.get('currency')).toBe('USD');
  expect(JSON.parse(new URL(page.url()).searchParams.get('dims')!)).toEqual({ project });
});

test('w_zw_fhslye：辅助数量入口、空辅助单列、单位隔离、未过账及联合导出', async ({
  page,
  localServer,
}) => {
  const { bookId } = await loginWithNewBook(page, localServer.request);
  await localServer.seed(bookId, async (svc) => {
    await seedAuxiliaryQuantityCases(svc);
  });
  await page.goto(
    `${localServer.url}/m/balances/auxiliary/quantity?from=202602&to=202602&codeFrom=1403&codeTo=1403&level=-1`,
  );
  await expect(page.getByRole('heading', { name: '辅助数量余额表', exact: true })).toBeVisible();
  const kg = page.getByRole('region', { name: /^本位币余额 千克 XM01 / });
  const empty = page.getByRole('region', { name: /本位币余额 件\s+未指定辅助项/ });
  await expect(kg).toContainText('2.500003');
  await expect(empty).toContainText('102.000002');
  await expect(empty.getByRole('link')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '包含未过账凭证', exact: true }).check();
  await expect(kg).toContainText('2.623459');
  const wb = await workbook(page);
  expect(wb.worksheets).toHaveLength(2);
  const kgSheet = wb.worksheets.find((ws) => ws.getCell('A2').text.includes('数量单位：千克'))!;
  expect(kgSheet.getCell('A1').text).toBe('辅助数量余额表');
  expect(kgSheet.getCell('A2').text).toContain('辅助项：XM01');
  expect(kgSheet.lastRow!.getCell(14).value).toBe('2.623459');
});

for (const [path, windowName] of [
  ['/quantity', 'w_zw_slye_1'],
  ['/auxiliary', 'w_zw_fhye_1/w_zw_fhye_1_bak'],
  ['/auxiliary/foreign', 'w_zw_fhwbye_1'],
  ['/auxiliary/quantity', 'w_zw_fhslye_1'],
] as const) {
  test(`${windowName}：未保存退出确认、过期保存失败保稿与取消不覆盖`, async ({
    page,
    localServer,
  }) => {
    const { token } = await loginWithNewBook(page, localServer.request);
    await page.goto(`${localServer.url}/m/balances${path}`);
    await page.getByRole('button', { name: '展示设置', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '展示设置', exact: true });
    await drawer.getByLabel('默认显示级次').selectOption('-1');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByText('放弃本次修改并关闭？余额查询结果不会被修改。')).toBeVisible();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
    await callApi(
      localServer.request,
      'm.balances.saveSettings',
      { revision: 0, display: { level: 2, onlyActivity: true } },
      { token, method: 'POST' },
    );
    await drawer.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(drawer).toContainText('展示设置已被其他窗口保存，本次没有覆盖');
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('-1');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await page.getByRole('button', { name: '展示设置', exact: true }).click();
    await expect(drawer.getByLabel('默认显示级次')).toHaveValue('2');
    await expect(drawer.getByRole('checkbox', { name: '默认只显示有发生额' })).toBeChecked();
  });
}
