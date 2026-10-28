import ExcelJS from 'exceljs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';

test.describe.configure({ retries: 0 });
async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成Excel界面', fields: DEFAULT_FIELDS },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employee = await callApi<Employee>(
    request,
    'm.payroll.saveEmployee',
    {
      code: 'E001',
      name: '合成Excel界面人员',
      startDate: '2026-01-01',
      departmentId: departments[0]!.id,
    },
    { token },
  );
  const batch = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [
        {
          employeeId: employee.id,
          values: { base: 1000000, bonus: 10000 },
          tax: { confirmed: true },
        },
      ],
    },
    { token },
  );
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' });
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: 'Excel 工资转入', exact: true }).click();
  return { batch, read, drawer: page.getByRole('dialog', { name: 'Excel 工资转入', exact: true }) };
}
async function workbook(amount: string) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('工资');
  sheet.addRow(['编号', 'base', 'bonus']);
  sheet.addRow(['E001', amount, '']);
  return Buffer.from(await book.xlsx.writeBuffer());
}
test('w_gz_gzgl 真实xlsx文件→栏目映射→预览→确认→刷新持久化，空格保留工资且只提交一次', async ({
  page,
  request,
}) => {
  const { batch, read, drawer } = await setup(page, request);
  await drawer.getByLabel('Excel 工资文件', { exact: true }).setInputFiles({
    name: '工资.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await workbook('￥１２３．４５'),
  });
  await expect(drawer.getByRole('combobox', { name: 'Excel 工作表' })).toBeVisible();
  await drawer.getByRole('button', { name: '预览 Excel 转入', exact: true }).click();
  await expect(drawer.getByRole('row').filter({ hasText: '合成Excel界面人员' })).toContainText(
    '123.45',
  );
  expect(await read()).toEqual(batch);
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('m.payroll.applyImport')) writes++;
  });
  await drawer.getByRole('button', { name: '确认 Excel 转入', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .dblclick();
  await expect(drawer).not.toBeVisible();
  const saved = await read();
  expect(saved.revision).toBe(batch.revision + 1);
  expect(saved.rows[0]!.values).toEqual({ base: 12345, bonus: 10000 });
  expect(writes).toBe(1);
  await page.reload();
  await expect(
    page.getByLabel(`工资-${saved.rows[0]!.employeeId}-base`, { exact: true }),
  ).toHaveValue('123.45');
});
test('w_gz_gzgl 非法Excel金额不能沿用旧值确认，取消离开保留文件；网络失败保留选择并可重试', async ({
  page,
  request,
}) => {
  const { batch, read, drawer } = await setup(page, request);
  await drawer.getByLabel('Excel 工资文件', { exact: true }).setInputFiles({
    name: '非法.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await workbook('12..34'),
  });
  await expect(drawer.getByRole('button', { name: '预览 Excel 转入', exact: true })).toBeEnabled();
  await drawer.getByRole('button', { name: '预览 Excel 转入', exact: true }).click();
  await expect(drawer.getByText(/不是有效金额/).first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: '确认 Excel 转入', exact: true })).toHaveCount(0);
  expect(await read()).toEqual(batch);
  page.once('dialog', (dialog) => dialog.dismiss());
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('文件：非法.xlsx', { exact: true })).toBeVisible();
  await drawer.getByLabel('Excel 工资文件', { exact: true }).setInputFiles({
    name: '修正.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await workbook('800.25'),
  });
  await expect(drawer.getByRole('button', { name: '预览 Excel 转入', exact: true })).toBeEnabled();
  await drawer.getByRole('button', { name: '预览 Excel 转入', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '确认 Excel 转入', exact: true })).toBeVisible();
  const pattern = '**/trpc/m.payroll.applyImport*';
  await page.route(pattern, (route) => route.abort('connectionfailed'));
  await drawer.getByRole('button', { name: '确认 Excel 转入', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer.getByText(/Excel 转入未完成，文件和栏目选择已保留/)).toBeVisible();
  expect(await read()).toEqual(batch);
  await expect(drawer.getByText('文件：修正.xlsx', { exact: true })).toBeVisible();
  await page.unroute(pattern);
  await drawer.getByRole('button', { name: '确认 Excel 转入', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  expect((await read()).rows[0]!.values).toEqual({ base: 80025, bonus: 10000 });
});
