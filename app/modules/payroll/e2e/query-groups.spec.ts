import { test, expect, type Locator, type Page, type APIRequestContext } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Category, type Employee, type Batch } from '../shared';

async function choose(page: Page, control: Locator, label: string) {
  await control.click();
  await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click();
}
async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成分组工资', fields: DEFAULT_FIELDS },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employees: Employee[] = [];
  for (let i = 1; i <= 4; i++)
    employees.push(
      await callApi<Employee>(
        request,
        'm.payroll.saveEmployee',
        {
          code: `Q00${i}`,
          name: `合成查询${i}`,
          departmentId: departments[0]!.id,
          startDate: '2026-01-01',
        },
        { token },
      ),
    );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  const batch = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: employees.map((e, i) => ({
        employeeId: e.id,
        values: { base: [1000000, 2000000, 2000000, 4000000][i]! },
        tax: { confirmed: true },
      })),
    },
    { token },
  );
  await callApi(
    request,
    'm.payroll.calculate',
    { id: batch.id, revision: batch.revision },
    { token },
  );
  await page.goto(`/m/payroll/query?category=${category.id}`);
  return category;
}

test('w_gz_zhcx 分组条件与多列排序可操作、刷新保留，Excel顺序和金额一致', async ({
  page,
  request,
}) => {
  await setup(page, request);
  await page.getByRole('button', { name: '添加查询条件', exact: true }).click();
  await choose(page, page.getByLabel('条件字段1', { exact: true }), '编号');
  await choose(page, page.getByLabel('条件操作符1', { exact: true }), '不含有');
  await page.getByLabel('条件值1', { exact: true }).fill('Q004');
  await page.getByRole('button', { name: '添加条件组', exact: true }).click();
  await choose(page, page.getByLabel('组内关系1', { exact: true }), '满足任一条件');
  await choose(page, page.getByLabel('组1条件字段1', { exact: true }), '应发');
  await choose(page, page.getByLabel('组1条件操作符1', { exact: true }), '大于等于');
  await page.getByLabel('组1条件值1', { exact: true }).fill('20000');
  await page.getByRole('button', { name: '组内添加条件', exact: true }).click();
  await page.getByLabel('组1条件值2', { exact: true }).fill('1');
  await page.getByRole('button', { name: '添加排序', exact: true }).click();
  await page.getByRole('button', { name: '添加排序', exact: true }).click();
  await choose(page, page.getByLabel('排序字段2', { exact: true }), '编号');
  await choose(page, page.getByLabel('排序方向2', { exact: true }), '降序');
  await page.locator('.cw-filter-bar button[type=submit]').click();
  const codes = () =>
    page.locator('.ant-table-tbody > tr:not(.ant-table-measure-row)').filter({ hasText: /Q00/ });
  await expect(codes()).toHaveCount(3);
  await expect(codes().nth(0)).toContainText('Q003');
  await expect(codes().nth(1)).toContainText('Q002');
  await expect(codes().nth(2)).toContainText('Q001');
  await page.reload();
  await expect(codes()).toHaveCount(3);
  await expect(page.getByLabel('组1条件值1', { exact: true })).toHaveValue('20,000.00');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出查询 Excel', exact: true }).click();
  const download = await downloadPromise;
  const location = await download.path();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(location!);
  const sheet = workbook.worksheets[0]!;
  expect([2, 3, 4].map((n) => sheet.getRow(n).getCell(2).value)).toEqual(['Q003', 'Q002', 'Q001']);
  expect([2, 3, 4].map((n) => sheet.getRow(n).getCell(5).value)).toEqual([20000, 20000, 10000]);
});

test('w_gz_zhcx 删除前一条件保留后面非法金额，修正后才执行查询', async ({ page, request }) => {
  await setup(page, request);
  await page.getByRole('button', { name: '添加查询条件', exact: true }).click();
  await page.getByRole('button', { name: '添加查询条件', exact: true }).click();
  await choose(page, page.getByLabel('条件字段2', { exact: true }), '应发');
  await page.getByLabel('条件值2', { exact: true }).fill('12..34');
  await page.getByRole('button', { name: '移除条件', exact: true }).first().click();
  await expect(page.getByLabel('条件值1', { exact: true })).toHaveValue('12..34');
  let queries = 0;
  page.on('request', (r) => {
    if (r.url().includes('/trpc/m.payroll.querySalary')) queries++;
  });
  await page.locator('.cw-filter-bar button[type=submit]').click();
  await expect(page).not.toHaveURL(/[?&]run=/);
  expect(queries).toBe(0);
  await page.getByLabel('条件值1', { exact: true }).fill('10000');
  await page.locator('.cw-filter-bar button[type=submit]').click();
  await expect(page.locator('.ant-table-tbody').getByText('Q001', { exact: true })).toBeVisible();
  expect(queries).toBe(1);
});
