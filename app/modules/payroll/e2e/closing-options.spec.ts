import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';

test.describe.configure({ retries: 0 });

test('w_gz_jz/qxfz 合并前预览并打印完整影响，过期版本拒绝后可重新确认，保留下月人工反结账不丢金额数量', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const capture = window as typeof window & { __closingPrint?: string };
    capture.caiwuDesktop = {
      print: async (html) => {
        capture.__closingPrint = html;
      },
      printToPdf: async () => null,
    };
  });
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成合并结账',
      fields: [
        ...DEFAULT_FIELDS,
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'days',
          name: '出勤天数',
          kind: 'quantity',
          role: 'memo',
          unit: '天',
          carry: true,
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
          code: `CUI${index}`,
          name: `合成结账人员${index}`,
          departmentId: departments[0]!.id,
          startDate: '2026-01-01',
        },
        { token },
      ),
    );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  const pending = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: employees.map((employee) => ({
        employeeId: employee.id,
        values: { base: 1000000 },
        quantities: { days: '21.123456' },
        tax: { confirmed: true },
      })),
    },
    { token },
  );
  const source = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: pending.id, revision: pending.revision },
    { token },
  );
  const target = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202602,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [
        {
          employeeId: employees[0]!.id,
          values: { base: 0, bonus: 12345 },
          tax: { additional: 10000, confirmed: false },
        },
      ],
    },
    { token },
  );
  const read = (id: number) =>
    callApi<Batch>(request, 'm.payroll.batch', { id }, { token, method: 'GET' });
  await page.goto(`/m/payroll/batch?id=${source.id}`);
  await page.getByRole('button', { name: '已有下月合并传递', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '已有下月工资合并传递', exact: true });
  await drawer.getByRole('button', { name: '预览合并传递', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '确认合并结账', exact: true })).toBeVisible();
  await expect(drawer.getByRole('row').filter({ hasText: 'CUI0' })).toContainText('21.123456天');
  expect(await read(source.id)).toEqual(source);
  expect(await read(target.id)).toEqual(target);
  const externallyChanged = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      ...target,
      categoryRevision: category.revision,
      rows: [{ ...target.rows[0]!, values: { base: 0, bonus: 98765 } }],
    },
    { token },
  );
  await drawer.getByRole('button', { name: '确认合并结账', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer.getByText('合并结账预览已经失效', { exact: true })).toBeVisible();
  expect(await read(source.id)).toEqual(source);
  expect(await read(target.id)).toEqual(externallyChanged);
  await drawer.getByRole('button', { name: '预览合并传递', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '确认合并结账', exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '打印结账影响', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __closingPrint?: string }).__closingPrint ?? '',
      ),
    )
    .toContain('21.123456天');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __closingPrint?: string }).__closingPrint ?? '',
      ),
    )
    .toContain('CUI1');
  await drawer.getByRole('button', { name: '确认合并结账', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  const merged = await read(target.id);
  expect((await read(source.id)).closed).toBe(true);
  expect(merged.rows[0]!.values).toEqual({ base: 0, bonus: 98765 });
  expect(merged.rows[0]!.tax).toEqual(target.rows[0]!.tax);
  expect(merged.rows[0]!.quantities).toEqual({ days: '21.123456' });
  expect(merged.rows[1]!.values).toEqual({ base: 1000000 });
  const edited = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      ...merged,
      categoryRevision: category.revision,
      rows: merged.rows.map((row, index) =>
        index === 0
          ? { ...row, values: { ...row.values, base: 234567 }, quantities: { days: '12.5' } }
          : row,
      ),
    },
    { token },
  );
  await page.getByRole('button', { name: '保留下月反结账', exact: true }).click();
  const keep = page.getByRole('dialog', { name: '保留下月数据反结账', exact: true });
  await keep.getByRole('button', { name: '预览保留下月反结账', exact: true }).click();
  await expect(keep.getByRole('row').filter({ hasText: 'CUI0' })).toContainText('2,345.67元');
  await expect(keep.getByRole('row').filter({ hasText: 'CUI0' })).toContainText('12.5天');
  await keep.getByRole('button', { name: '确认保留下月反结账', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(keep).not.toBeVisible();
  expect((await read(source.id)).closed).toBe(false);
  expect(await read(target.id)).toEqual(edited);
});
