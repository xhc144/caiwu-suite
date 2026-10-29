import ExcelJS from 'exceljs';
import type { Request } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test, expect } from './fixture';

test('m_work_fx_def：键盘增复制删确认、记录选择保留编号、定义打印和Excel回读', async ({
  page,
  isolated,
}) => {
  await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await page.goto(`${isolated.origin}/m/analysis/custom`);
  await page.getByRole('button', { name: '新增分析表', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '自定义分析定义', exact: true });
  await editor.getByLabel('分析编号', { exact: true }).fill('831');
  await editor.getByLabel('分析名称', { exact: true }).fill('快捷键定义');
  const first = editor.getByLabel('项目1名称', { exact: true });
  await first.fill('第一项');
  await editor.getByLabel('项目1公式', { exact: true }).fill('1 + 2');
  await first.focus();
  await page.keyboard.press('Control+a');
  expect(
    await first.evaluate((node) => [
      (node as HTMLInputElement).selectionStart,
      (node as HTMLInputElement).selectionEnd,
    ]),
  ).toEqual([0, 3]);
  await expect(editor.getByLabel('项目2名称', { exact: true })).toHaveCount(0);
  const records = editor.locator('[aria-label="分析定义项目记录"]');
  await records.focus();
  await page.keyboard.press('Control+a');
  await expect(editor.getByLabel('项目2名称', { exact: true })).toBeFocused();
  await editor.getByLabel('项目2名称', { exact: true }).fill('第二项');
  await editor.getByLabel('项目2公式', { exact: true }).fill('4');
  await editor.getByLabel('项目2名称', { exact: true }).focus();
  await page.keyboard.press('Control+k');
  await expect(editor.getByLabel('项目3名称', { exact: true })).toHaveValue('第二项副本');
  await page.keyboard.press('Control+Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('Control+End');
  await expect(editor.getByLabel('项目3名称', { exact: true })).toBeFocused();
  await page.keyboard.press('Control+ArrowUp');
  await expect(editor.getByLabel('项目2名称', { exact: true })).toBeFocused();
  await page.keyboard.press('Control+ArrowDown');
  await expect(editor.getByLabel('项目3名称', { exact: true })).toBeFocused();
  await records.focus();
  await page.keyboard.press('ArrowUp');
  await expect(editor.getByLabel('项目2名称', { exact: true })).toBeFocused();
  await records.focus();
  await page.keyboard.press('ArrowDown');
  await expect(editor.getByLabel('项目3名称', { exact: true })).toBeFocused();
  await expect(editor.locator('tbody tr[data-row-key] td:first-child')).toHaveText(['1', '2', '3']);
  await editor.getByLabel('项目3名称', { exact: true }).focus();
  await page.keyboard.press('Control+d');
  let confirm = page.getByRole('dialog', { name: '删除项目3？', exact: true });
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(page.getByRole('dialog', { name: '删除项目3？', exact: true })).toHaveCount(1);
  let prematureSave = 0;
  const countSave = (request: Request) => {
    if (request.url().includes('m.analysis.definitions.save')) prematureSave++;
  };
  page.on('request', countSave);
  await page.keyboard.press('Control+s');
  await expect(editor.getByText('新建分析表', { exact: false })).toBeVisible();
  expect(prematureSave).toBe(0);
  await expect(editor.getByRole('button', { name: '保存分析定义', exact: true })).toBeEnabled();
  page.off('request', countSave);
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor.getByLabel('项目3名称', { exact: true })).toHaveValue('第二项副本');
  await expect(confirm).toHaveCount(0);
  await records.focus();
  await page.keyboard.press('Control+d');
  confirm = page.getByRole('dialog', { name: '删除项目3？', exact: true });
  await confirm.getByRole('button', { name: '删除项目', exact: true }).click();
  await expect(editor.getByLabel('项目3名称', { exact: true })).toHaveCount(0);
  await expect(editor.locator('tbody tr[data-row-key] td:first-child')).toHaveText(['1', '2']);
  await editor.getByRole('button', { name: '保存分析定义', exact: true }).click();
  await expect(editor.getByText('已保存版本 1', { exact: false })).toBeVisible();
  await expect(editor.getByLabel('项目1公式', { exact: true })).toHaveValue('1 + 2');
  await page.evaluate(() => {
    window.caiwuDesktop = {
      print: async (html) => {
        document.body.dataset.definitionPrinted = html;
      },
      printToPdf: async () => null,
    };
  });
  const permission = page.waitForResponse((response) =>
    response.url().includes('m.analysis.printAllowed'),
  );
  await page.keyboard.press('Control+p');
  expect((await permission).ok()).toBe(true);
  await expect
    .poll(() => page.locator('body').getAttribute('data-definition-printed'))
    .toContain('分析定义稿');
  const printed = await page.locator('body').getAttribute('data-definition-printed');
  expect(printed).toContain('不是分析结果');
  expect(printed).toContain('1 + 2');
  const downloading = page.waitForEvent('download');
  await editor.getByRole('button', { name: '另存定义 Excel', exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await (await downloading).path())!);
  const sheet = workbook.getWorksheet('分析定义稿')!;
  const values: unknown[] = [];
  sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  expect(values).toContain('1 + 2');
  expect(values).toContain('第二项');
  expect(values).not.toContain('第二项副本');
  await editor.getByRole('button', { name: '保存分析定义', exact: true }).click();
  await expect(editor.getByText('已保存版本 2', { exact: false })).toBeVisible();
});

test('m_work_fx_nd/m_work_fx_demo CtrlP仅聚焦各自图形选择，不打印整页', async ({
  page,
  isolated,
}) => {
  const { bookId } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1122', debit: 12345, dims: { partner: 'C001' } },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
  });
  await page.goto(
    `${isolated.origin}/m/analysis?accountCode=1122&period=202601&mode=monthly&metric=debit`,
  );
  await expect(page.getByRole('img', { name: /图表类型是柱状图/ })).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.nativePrintCalled = 'yes';
    };
  });
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('combobox', { name: '图形', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '编辑并保存结果', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '分析结果编辑与保存', exact: true });
  await editor.getByLabel('结果名称', { exact: true }).focus();
  await page.keyboard.press('Control+p');
  await expect(editor.getByRole('combobox', { name: '图形', exact: true })).toBeFocused();
  expect(await page.locator('body').getAttribute('data-native-print-called')).toBeNull();
});
