import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';

test.describe.configure({ retries: 0 });

test('w_gz_gzgl 数量逐格编辑保留六位小数，非法及隐藏页草稿阻止旧值保存，重算刷新保留正确工资', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成计时工资',
      fields: [
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'hours',
          name: '工时',
          kind: 'quantity',
          role: 'memo',
          unit: '小时',
          width: 170,
          carry: true,
        },
        { ...DEFAULT_FIELDS[0]!, key: 'rate', name: '时薪', role: 'memo' },
        { ...DEFAULT_FIELDS[0]!, key: 'pay', name: '计时工资', kind: 'calculated' },
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'hire',
          name: '任职日期',
          kind: 'basic',
          basicSource: 'startDate',
          role: 'memo',
        },
      ],
      formulas: [{ name: '计时工资', target: 'pay', expression: 'hours * rate' }],
    },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employees: Employee[] = [];
  for (let index = 0; index < 21; index++)
    employees.push(
      await callApi<Employee>(
        request,
        'm.payroll.saveEmployee',
        {
          code: `Q${String(index).padStart(3, '0')}`,
          name: `合成工时人员${index}`,
          departmentId: departments[0]!.id,
          startDate: '2026-01-01',
        },
        { token },
      ),
    );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  const b = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: employees.map((employee) => ({
        employeeId: employee.id,
        values: { rate: 12345 },
        quantities: { hours: '1.234567' },
        tax: { confirmed: true },
      })),
    },
    { token },
  );
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: b.id }, { token, method: 'GET' });
  await page.goto(`/m/payroll/batch?id=${b.id}`);
  const grid = page.getByRole('region', { name: '工资逐格编辑' });
  const hours = grid.getByLabel(`工资-${employees[0]!.id}-hours`, { exact: true });
  await expect(hours).toHaveValue('1.234567');
  await expect(grid.getByRole('columnheader', { name: '工时（小时）' })).toBeVisible();
  await expect(grid.getByRole('cell', { name: '2026-01-01', exact: true }).first()).toBeVisible();
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/trpc/m.payroll.saveBatch'))
      writes++;
  });
  await hours.fill('1.2345678');
  await grid.getByRole('button', { name: '保存表格工资', exact: true }).click();
  await expect(grid.getByText(/数量格式无效/)).toBeVisible();
  expect(writes).toBe(0);
  expect(await read()).toEqual(b);
  await grid.locator('.ant-pagination-next').click();
  await expect(grid.getByLabel(`工资-${employees[20]!.id}-hours`, { exact: true })).toBeVisible();
  await grid.getByRole('button', { name: '保存表格工资', exact: true }).click();
  expect(writes).toBe(0);
  await grid.locator('.ant-pagination-prev').click();
  await expect(hours).toHaveValue('1.2345678');
  await hours.fill('１２．５０００００');
  const [savedResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/trpc/m.payroll.saveBatch'),
    ),
    hours.press('Control+s'),
  ]);
  expect(savedResponse.ok()).toBe(true);
  expect(writes).toBe(1);
  const saved = await read();
  expect(saved.rows[0]!.quantities).toEqual({ hours: '12.5' });
  expect(saved.rows.slice(1)).toEqual(b.rows.slice(1));
  await page.getByRole('button', { name: '计算工资', exact: true }).click();
  await expect.poll(async () => (await read()).calculated).toBe(true);
  const computed = await read();
  expect(computed.snapshots[0]!.gross).toBe(154313);
  expect(computed.snapshots[0]!.calculatedQuantities).toEqual({ hours: '12.5' });
  await page.reload();
  await expect(hours).toHaveValue('12.5');
  await expect(grid.getByRole('row').filter({ hasText: 'Q000' })).toContainText('1,543.13');
  const exported = await callApi<{ rows: Batch['snapshots'] }>(
    request,
    'm.payroll.exportRows',
    { id: b.id, employeeIds: [employees[0]!.id] },
    { token, method: 'GET' },
  );
  expect(exported.rows[0]!.calculatedQuantities).toEqual({ hours: '12.5' });
  expect(exported.rows[0]!.gross).toBe(154313);
  await hours.focus();
  await hours.press('ArrowDown');
  await expect(hours).toBeFocused();
  await expect(hours).toHaveValue('12.5');
  await hours.press('Control+End');
  const lastHours = grid.getByLabel(`工资-${employees[20]!.id}-hours`, { exact: true });
  await expect(lastHours).toBeVisible();
  await expect(grid.getByText(/当前记录：Q020/)).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(grid.getByText(/当前记录：Q019/)).toBeVisible();
  await page.keyboard.press('Control+Home');
  await expect(hours).toBeVisible();
  await expect(grid.getByText(/当前记录：Q000/)).toBeVisible();
  await page.keyboard.press('Control+q');
  const locator = page.getByRole('dialog', { name: '工资定位查询', exact: true });
  await locator.getByLabel('工资定位条件', { exact: true }).fill('Q020');
  await locator.getByRole('button', { name: '定位此人', exact: true }).click();
  await expect(locator).not.toBeVisible();
  await expect(lastHours).toBeVisible();
  expect(await read()).toEqual(computed);
});

test('w_gz_gzgl 抽屉数量非法原文使整批保存停留，修正六位小数后金额和数量一并保存', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成抽屉数量',
      fields: [
        DEFAULT_FIELDS[0],
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'days',
          name: '天数',
          kind: 'quantity',
          role: 'memo',
          unit: '天',
        },
      ],
    },
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
      code: 'DQ01',
      name: '合成抽屉人员',
      departmentId: departments[0]!.id,
      startDate: '2026-01-01',
    },
    { token },
  );
  const b = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [{ employeeId: employee.id, values: { base: 1000000 }, quantities: { days: '21.5' } }],
    },
    { token },
  );
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: b.id }, { token, method: 'GET' });
  await page.goto(`/m/payroll/batch?id=${b.id}`);
  await page.getByRole('button', { name: '编辑工资', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑工资', exact: true });
  const days = drawer.getByLabel(`${employee.id}-days`, { exact: true });
  await days.fill('0.1234567');
  await drawer.getByLabel(`${employee.id}-base`, { exact: true }).fill('12000.25');
  await drawer.getByRole('button', { name: '保存工资', exact: true }).click();
  await expect(days).toHaveValue('0.1234567');
  await expect(drawer.getByText(/数量格式无效/)).toBeVisible();
  expect(await read()).toEqual(b);
  await days.fill('21.123456');
  await drawer.getByRole('button', { name: '保存工资', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect((await read()).rows[0]).toMatchObject({
    values: { base: 1200025 },
    quantities: { days: '21.123456' },
  });
});
