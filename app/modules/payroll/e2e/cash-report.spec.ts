import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { TaxInputSchema, type Batch, type Category, type Employee } from '../shared';

test('w_gz_prt_pm 独立账套选择金额栏目和面额，跨月余款、刷新、Excel/打印及空面额拒绝', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成票面工资',
      fields: [
        { key: 'base', name: '基本工资', kind: 'money', role: 'earning' },
        { key: 'cashpay', name: '现金发放', kind: 'money', role: 'memo' },
      ],
    },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const people: Employee[] = [];
  for (let i = 1; i <= 2; i++)
    people.push(
      await callApi<Employee>(
        request,
        'm.payroll.saveEmployee',
        {
          code: `CASH${i}`,
          name: `合成票面人员${i}`,
          departmentId: departments[0]!.id,
          startDate: '2026-01-01',
        },
        { token },
      ),
    );
  await callApi(request, 'm.payroll.confirmTax', {}, { token });
  const batches: Batch[] = [];
  for (const period of [202601, 202602]) {
    const batch = await callApi<Batch>(
      request,
      'm.payroll.saveBatch',
      {
        period,
        categoryId: category.id,
        categoryRevision: category.revision,
        rows: people.map((e, i) => ({
          employeeId: e.id,
          values: { base: 200000, cashpay: i === 0 ? 6001 : 12002 },
          tax: TaxInputSchema.parse({ confirmed: true }),
        })),
      },
      { token },
    );
    batches.push(
      await callApi<Batch>(
        request,
        'm.payroll.calculate',
        { id: batch.id, revision: batch.revision },
        { token },
      ),
    );
  }
  await page.goto('/m/payroll/reports');
  await page.getByLabel('报表', { exact: true }).click();
  await page
    .locator('.ant-select-item-option-content')
    .getByText('票面计算', { exact: true })
    .click();
  await page.getByLabel('结束期间', { exact: true }).click();
  await page
    .locator('.ant-select-item-option-content')
    .getByText('2026年02月', { exact: true })
    .click();
  for (const e of people) {
    const control = page.getByRole('combobox', { name: '报告人员' });
    await control.fill(e.code);
    await control.press('Enter');
  }
  await page.getByLabel('汇总栏目', { exact: true }).click();
  await page
    .locator('.ant-select-item-option-content')
    .getByText('现金发放', { exact: true })
    .click();
  await page.getByLabel('汇总栏目', { exact: true }).press('Escape');
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
  await page.getByLabel('票面工资栏目', { exact: true }).click();
  await page
    .locator('.ant-select-item-option-content:visible')
    .getByText('现金发放', { exact: true })
    .click();
  // 多选清空/选择仍通过真实指针操作；只保留一百元，显式呈现不足一百元的余款。
  const denominations = page
    .locator('.ant-form-item')
    .filter({ has: page.getByRole('combobox', { name: '票面面额' }) });
  while (await denominations.locator('.ant-select-selection-item-remove').count())
    await denominations.locator('.ant-select-selection-item-remove').first().click();
  await page.getByRole('combobox', { name: '票面面额' }).click();
  await page
    .locator('.ant-select-item-option-content')
    .getByText('100.00元', { exact: true })
    .click();
  await page.getByRole('combobox', { name: '票面面额' }).press('Escape');
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  await expect(page.getByText('票面工资栏目：现金发放。', { exact: false })).toBeVisible();
  const first = page.getByRole('row').filter({ hasText: '合成票面人员1' });
  await expect(first).toContainText('120.02');
  await expect(first.getByRole('cell').last()).toHaveText('120.02');
  const second = page.getByRole('row').filter({ hasText: '合成票面人员2' });
  await expect(second).toContainText('240.04');
  await expect(second.getByRole('cell').last()).toHaveText('40.04');
  await expect(page).toHaveURL(/cashField=cashpay/);
  await expect(page).toHaveURL(/denominations=10000/);
  await page.reload();
  await expect(first.getByRole('cell').last()).toHaveText('120.02');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报表 Excel', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('票面计算表.xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await download.path())!);
  const sheet = book.worksheets[0]!;
  expect(sheet.getRow(1).values).toContain('票面工资栏目');
  expect(sheet.getRow(1).values).toContain('100.00元（张）');
  expect(sheet.getRow(1).values).not.toContain('50.00元（张）');
  expect(sheet.getRow(2).values).toContain('现金发放');
  expect(sheet.getRow(2).getCell(sheet.columnCount - 1).value).toBe(0);
  expect(sheet.getRow(2).getCell(sheet.columnCount).value).toBe(120.02);
  expect(sheet.getRow(3).getCell(sheet.columnCount - 1).value).toBe(2);
  expect(sheet.getRow(3).getCell(sheet.columnCount).value).toBe(40.04);
  const printed = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const observer = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (node instanceof HTMLIFrameElement) {
                node.addEventListener(
                  'load',
                  () => {
                    observer.disconnect();
                    resolve(node.contentDocument?.body.textContent ?? '');
                  },
                  { once: true },
                );
              }
        });
        observer.observe(document.body, { childList: true });
      }),
  );
  await page.getByRole('button', { name: '打印报表', exact: true }).click();
  const text = await printed;
  expect(text).toContain('现金发放');
  expect(text).toContain('100.00元（张）');
  expect(text).toContain('120.02');
  for (const batch of batches)
    expect(
      await callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' }),
    ).toEqual(batch);
  await denominations.locator('.ant-select-selection-item-remove').click();
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '至少选择一种票面面额' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出报表 Excel', exact: true })).toBeDisabled();
  await page.getByLabel('报表', { exact: true }).click();
  await page
    .locator('.ant-select-item-option-content:visible')
    .getByText('人员累计汇总', { exact: true })
    .click();
  await page.getByRole('button', { name: 'search 查询', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '至少选择一种票面面额' })).toHaveCount(0);
  await expect(first).toContainText('120.02');
  await expect(page.getByRole('button', { name: '导出报表 Excel', exact: true })).toBeEnabled();
  await expect(page.getByRole('columnheader', { name: '100.00元（张）', exact: true })).toHaveCount(
    0,
  );
});
