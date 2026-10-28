import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';
test.describe.configure({ retries: 0 });

test('w_gz_edit_set 数量非法草稿及混合TSV在预览前同步拒绝，修正后按原单位与元整批保存', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成数量批量',
      fields: [
        ...DEFAULT_FIELDS,
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'hours',
          name: '工时',
          kind: 'quantity',
          role: 'memo',
          unit: '小时',
        },
      ],
    },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employees: Employee[] = [];
  for (let index = 0; index < 2; index++)
    employees.push(
      await callApi<Employee>(
        request,
        'm.payroll.saveEmployee',
        {
          code: `QBU${index}`,
          name: `合成批量人员${index}`,
          departmentId: departments[0]!.id,
          startDate: '2026-01-01',
        },
        { token },
      ),
    );
  const batch = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: employees.map((employee) => ({
        employeeId: employee.id,
        values: { base: 1000000 },
        quantities: { hours: '1.5' },
      })),
    },
    { token },
  );
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' });
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  const grid = page.getByRole('region', { name: '工资逐格编辑' });
  await grid.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '统一置数 / 粘贴', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '统一置数 / Excel 粘贴', exact: true });
  await drawer.getByRole('combobox', { name: '置数栏目' }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('工时', { exact: true }).click();
  const quantity = drawer.getByLabel('统一数量', { exact: true });
  let previews = 0,
    writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/trpc/m.payroll.previewBulk')) previews++;
    if (request.method() === 'POST' && /m\.payroll\.apply(?:Bulk|Paste)/.test(request.url()))
      writes++;
  });
  await quantity.fill('12.1234567');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await expect(drawer.getByText(/数量格式无效/)).toBeVisible();
  expect(previews).toBe(0);
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
  await quantity.fill('12.345678');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await expect(drawer.getByRole('row').filter({ hasText: 'QBU0' })).toContainText('12.345678小时');
  await quantity.fill('1..2');
  await expect(drawer.getByRole('button', { name: '确认批量修改', exact: true })).toHaveCount(0);
  await drawer.getByRole('combobox', { name: '批量操作' }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('Excel 粘贴', { exact: true })
    .click();
  await drawer.getByRole('combobox', { name: '批量操作' }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('统一置数 / 空值设零', { exact: true })
    .click();
  await expect(quantity).toHaveValue('1..2');
  await quantity.fill('２１．５０００００');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await drawer.getByRole('button', { name: '确认批量修改', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  const set = await read();
  expect(set.rows.map((row) => row.quantities?.hours)).toEqual(['21.5', '21.5']);
  expect(set.rows.map((row) => row.values.base)).toEqual([1000000, 1000000]);
  await page.getByRole('button', { name: '统一置数 / 粘贴', exact: true }).click();
  await drawer.getByRole('combobox', { name: '批量操作' }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('Excel 粘贴', { exact: true })
    .click();
  const pasted = drawer.getByLabel('Excel 粘贴内容', { exact: true });
  await pasted.fill('编号\tbase\thours\nQBU0\t12000.25\t0.1234567\nQBU1\t\t0');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await expect(drawer.getByText(/数量格式无效/)).toBeVisible();
  expect(await read()).toEqual(set);
  expect(writes).toBe(1);
  await pasted.fill('编号\tbase\thours\nQBU0\t12000.25\t0.123456\nQBU1\t\t0');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await expect(
    drawer.getByRole('row').filter({ hasText: 'QBU0' }).filter({ hasText: 'hours' }),
  ).toContainText('0.123456小时');
  await drawer.getByRole('button', { name: '确认批量修改', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  const saved = await read();
  expect(saved.rows[0]!.values.base).toBe(1200025);
  expect(saved.rows[1]!.values.base).toBe(1000000);
  expect(saved.rows.map((row) => row.quantities?.hours)).toEqual(['0.123456', '0']);
  expect(writes).toBe(2);
});
