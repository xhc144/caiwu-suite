import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, createBook } from '@caiwu/testkit/e2e';
import { seedHierarchyCases } from '../test/hierarchy-fixtures';
import { test } from './fixture';

test('w_zw_fhslye_1 辅助父项包含下级、级次合并及分项追查，按科目排列的 Excel 和完整账册预览', async ({
  page,
  localServer,
}) => {
  const { bookId } = await createBook(localServer.request);
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    localServer.request,
    'core.auth.login',
    { bookId, userCode: 'admin', password: 'admin' },
  );
  await callApi(localServer.request, 'core.dev.seedDemo', {}, { token: login.token });
  // 只向顶层页面写会话；通用登录助手的 initScript 也会注入无同源权限的打印预览。
  await page.goto(localServer.url);
  await page.evaluate(
    (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
    { ...login, bookId },
  );
  let a = 0;
  await localServer.seed(bookId, async (svc) => {
    a = (await seedHierarchyCases(svc)).a.id;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `${localServer.url}/m/balances/auxiliary/quantity?from=202602&to=202602&codeFrom=1403&codeTo=1403&dimension=department&dimensionFrom=G&dimensionTo=G`,
  );
  await page.getByRole('checkbox', { name: '选中父项时包含下级', exact: true }).check();
  await expect(page.getByRole('region', { name: /本位币余额 千克 A / })).toContainText('71.00');
  await expect(page.getByRole('region', { name: /本位币余额 千克 Q / })).toContainText('35.50');
  await expect(page.getByRole('region', { name: /本位币余额 千克 Y / })).toHaveCount(0);
  await page.getByLabel('辅助显示级次', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: '展开到末级', exact: true }).click();
  const group = page.getByRole('region', { name: /本位币余额 千克 G / });
  await expect(group).toContainText('35.50');
  await expect(group.getByRole('link', { name: '明细 140301', exact: true })).toHaveCount(0);
  await group.getByRole('button', { name: '明细 140301', exact: true }).click();
  const members = page.getByRole('dialog', { name: '选择辅助分项明细', exact: true });
  const aLink = members.getByRole('link', { name: 'A 合成甲组', exact: true });
  const url = new URL((await aLink.getAttribute('href'))!, localServer.url);
  expect(JSON.parse(url.searchParams.get('dims')!)).toEqual({ department: a });
  await expect(members.getByRole('link', { name: 'Q 合成乙组分队', exact: true })).toBeVisible();
  await members.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByLabel('排列方式', { exact: true }).selectOption('account');
  await expect(page.getByRole('columnheader', { name: /^辅助编码 / })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('排列方式', { exact: true })).toHaveValue('account');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await (await download).path())!);
  expect(wb.worksheets[0]!.getCell('C4').text).toBe('辅助编码');
  expect(wb.worksheets[0]!.getCell('D5').text).toBe('合成事业部');
  await page.getByRole('button', { name: '打印', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '选择打印科目', exact: true });
  await dialog.getByLabel('余额打印起始页码', { exact: true }).fill('7');
  await dialog.getByRole('button', { name: '预览所选科目', exact: true }).click();
  const frame = page.frameLocator('iframe[title="余额表打印预览"]');
  await expect(frame.locator('.balance-sheet')).toHaveCount(4);
  await expect(frame.locator('.balance-sheet').first().locator('footer')).toHaveText('第 7 页');
  await expect(frame.locator('body')).toContainText('结余单价');
  await expect(frame.locator('body')).toContainText('0.5');
  const dimensions = await frame.locator('.balance-sheet').evaluateAll((pages) =>
    pages.map((node) => ({
      width: node.clientWidth,
      scroll: node.scrollWidth,
      height: node.getBoundingClientRect().height,
    })),
  );
  for (const d of dimensions) {
    expect(d.scroll).toBeLessThanOrEqual(d.width + 1);
    expect(d.height).toBeLessThan(718);
  }
  await page
    .getByRole('dialog', { name: '余额表打印预览', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.balancesPrinted = html;
      },
      printToPdf: async () => null,
    };
  });
  await dialog.getByRole('button', { name: '开始打印', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.balancesPrinted ?? ''))
    .toContain('data-page="7"');
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.balancesPrinted ?? ''))
    .toContain('结余单价');
  expect(errors).toEqual([]);
});
