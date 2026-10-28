import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';

test.describe.configure({ retries: 0 });

async function setup(page: Page, request: APIRequestContext, count = 2) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成逐格工资',
      fields: [
        ...DEFAULT_FIELDS,
        {
          key: 'copy_amount',
          name: '公式副本',
          kind: 'calculated',
          role: 'memo',
          visible: true,
          print: true,
          carry: false,
          disabled: false,
        },
      ],
      formulas: [{ name: '合成副本公式', target: 'copy_amount', expression: 'base + bonus' }],
    },
    { token },
  );
  const departments = await callApi<{ id: number; code: string }[]>(
    request,
    'm.payroll.departments',
    undefined,
    { token, method: 'GET' },
  );
  const employees: Employee[] = [];
  for (let i = 0; i < count; i++)
    employees.push(
      await callApi<Employee>(
        request,
        'm.payroll.saveEmployee',
        {
          code: `GRID00${i + 1}`,
          name: `合成逐格人员${i + 1}`,
          departmentId: departments.find((d) => d.code === `0${(i % 2) + 1}`)!.id,
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
      rows: employees.map((employee, i) => ({
        employeeId: employee.id,
        values: { base: (i + 1) * 1000000, bonus: 10000 },
        tax: { confirmed: true },
      })),
    },
    { token },
  );
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' });
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  const grid = page.getByRole('region', { name: '工资逐格编辑' });
  await expect(grid).toBeVisible();
  await expect(grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true })).toHaveValue(
    '10,000.00',
  );
  return { token, batch, employees, read, grid };
}

const savedResponse = (response: { url(): string; request(): { method(): string } }) =>
  response.request().method() === 'POST' && response.url().includes('/trpc/m.payroll.saveBatch');

test('w_gz_gzgl 非法金额草稿阻止整批旧值混存，保留原文和修改标志，修正后才保存', async ({
  page,
  request,
}) => {
  const { grid, employees, batch, read } = await setup(page, request);
  const base = grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true });
  const bonus = grid.getByLabel(`工资-${employees[0]!.id}-bonus`, { exact: true });
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/trpc/m.payroll.saveBatch')) writes++;
  });
  await bonus.fill('200');
  await base.fill('12..34');
  await grid.getByRole('button', { name: '保存表格工资', exact: true }).click();
  await expect(base).toHaveValue('12..34');
  await expect(grid.getByText(/金额格式无效/)).toBeVisible();
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
  await expect(page.getByRole('button', { name: '计算工资', exact: true })).toBeDisabled();
  await expect(grid.getByRole('button', { name: '放弃表格修改', exact: true })).toBeEnabled();
  await base.focus();
  await page.keyboard.press('Control+s');
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
  await base.fill('99999999999999999999999999999');
  await grid.getByRole('button', { name: '保存表格工资', exact: true }).click();
  await expect(base).toHaveValue('99999999999999999999999999999');
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
  await base.fill('11000.25');
  const [response] = await Promise.all([
    page.waitForResponse(savedResponse),
    base.press('Control+s'),
  ]);
  expect(response.ok()).toBe(true);
  const saved = await read();
  expect(saved.revision).toBe(batch.revision + 1);
  expect(saved.rows[0]!.values).toEqual({ base: 1100025, bonus: 20000 });
  expect(saved.rows[1]).toEqual(batch.rows[1]);
  expect(writes).toBe(1);
});

test('w_gz_gzgl 抽屉工资及累计扣除非法原文均阻止整批保存，修正后一次提交', async ({
  page,
  request,
}) => {
  const { employees, batch, read } = await setup(page, request);
  await page.getByRole('button', { name: '编辑工资', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑工资', exact: true });
  const base = drawer.getByLabel(`${employees[0]!.id}-base`, { exact: true });
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/trpc/m.payroll.saveBatch')) writes++;
  });
  await drawer.getByLabel(`${employees[0]!.id}-bonus`, { exact: true }).fill('200');
  await base.fill('12..34');
  await drawer.getByRole('button', { name: '保存工资', exact: true }).click();
  await expect(base).toHaveValue('12..34');
  await expect(drawer.getByText(/金额格式无效/)).toBeVisible();
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
  await base.fill('11000');
  await drawer.locator('summary').first().click();
  const additional = drawer.getByLabel(`${employees[0]!.id}-additional`, { exact: true });
  await additional.fill('-10');
  await drawer.getByRole('button', { name: '保存工资', exact: true }).click();
  await expect(additional).toHaveValue('-10');
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
  await additional.fill('100.50');
  const [response] = await Promise.all([
    page.waitForResponse(savedResponse),
    drawer.getByRole('button', { name: '保存工资', exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(drawer).not.toBeVisible();
  const saved = await read();
  expect(saved.revision).toBe(batch.revision + 1);
  expect(saved.rows[0]!.values).toEqual({ base: 1100000, bonus: 20000 });
  expect(saved.rows[0]!.tax.additional).toBe(10050);
  expect(saved.rows[1]!.values.base).toBe(batch.rows[1]!.values.base);
  expect(writes).toBe(1);
});

test('w_gz_gzgl 翻页卸载不丢非法金额原文，隐藏页错误仍阻止整批保存', async ({ page, request }) => {
  const { grid, employees, batch, read } = await setup(page, request, 21);
  const base = grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true });
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/trpc/m.payroll.saveBatch')) writes++;
  });
  await grid.getByLabel(`工资-${employees[0]!.id}-bonus`, { exact: true }).fill('200');
  await base.fill('12..34');
  await grid.locator('.ant-pagination-next').click();
  await expect(grid.getByLabel(`工资-${employees[20]!.id}-base`, { exact: true })).toBeVisible();
  await grid.getByRole('button', { name: '保存表格工资', exact: true }).click();
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
  await grid.locator('.ant-pagination-prev').click();
  await expect(base).toHaveValue('12..34');
  await base.fill('11000');
  const [response] = await Promise.all([
    page.waitForResponse(savedResponse),
    base.press('Control+s'),
  ]);
  expect(response.ok()).toBe(true);
  const saved = await read();
  expect(saved.rows).toHaveLength(21);
  expect(saved.rows[0]!.values).toEqual({ base: 1100000, bonus: 20000 });
  expect(saved.rows.slice(1)).toEqual(batch.rows.slice(1));
  expect(writes).toBe(1);
});

test('w_gz_gzgl 仅非法原文也标为未保存，取消放弃保留、明确放弃恢复原工资', async ({
  page,
  request,
}) => {
  const { grid, employees, batch, read } = await setup(page, request);
  const base = grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true });
  await base.fill('12..34');
  await base.press('Tab');
  await expect(base).toHaveValue('12..34');
  await expect(grid.getByRole('button', { name: '保存表格工资', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '计算工资', exact: true })).toBeDisabled();
  await grid.getByRole('button', { name: '放弃表格修改', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(base).toHaveValue('12..34');
  await grid.getByRole('button', { name: '放弃表格修改', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(base).toHaveValue('10,000.00');
  await expect(grid.getByRole('button', { name: '保存表格工资', exact: true })).toBeDisabled();
  expect(await read()).toEqual(batch);
});

test('w_gz_edit_set 非法统一金额使预览失效并阻止旧金额应用，全角金额修正可保存', async ({
  page,
  request,
}) => {
  const { grid, batch, read } = await setup(page, request);
  await grid.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '统一置数 / 粘贴', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '统一置数 / Excel 粘贴', exact: true });
  const amount = drawer.getByLabel('统一金额', { exact: true });
  let previews = 0,
    writes = 0;
  page.on('request', (r) => {
    if (r.url().includes('/trpc/m.payroll.previewBulk')) previews++;
    if (r.method() === 'POST' && r.url().includes('/trpc/m.payroll.applyBulk')) writes++;
  });
  await amount.fill('200');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '确认批量修改', exact: true })).toBeVisible();
  expect(previews).toBe(1);
  await amount.fill('12..34');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await expect(amount).toHaveValue('12..34');
  await expect(drawer.getByText(/金额格式无效/)).toBeVisible();
  await expect(drawer.getByRole('button', { name: '确认批量修改', exact: true })).toHaveCount(0);
  expect(previews).toBe(1);
  expect(writes).toBe(0);
  expect(await read()).toEqual(batch);
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
  await expect(amount).toHaveValue('12..34');
  await amount.fill('￥１２３．４５');
  await drawer.getByRole('button', { name: '预览修改范围', exact: true }).click();
  await expect(drawer.getByRole('row').filter({ hasText: 'GRID001' })).toContainText('123.45');
  await drawer.getByRole('button', { name: '确认批量修改', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  const saved = await read();
  expect(saved.revision).toBe(batch.revision + 1);
  expect(saved.rows.map((row) => row.values.base)).toEqual([12345, 12345]);
  expect(saved.rows.map((row) => row.values.bonus)).toEqual([10000, 10000]);
  expect(writes).toBe(1);
});

test('w_gz_gzgl 主表逐格录入元、清空、Ctrl+S保存完整人员及重算持久化，公式栏只读', async ({
  page,
  request,
}) => {
  const { grid, employees, batch, read } = await setup(page, request);
  await page.goto(`/m/payroll/batch?id=${batch.id}&department=${employees[0]!.departmentId}`);
  const firstBase = grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true });
  const firstBonus = grid.getByLabel(`工资-${employees[0]!.id}-bonus`, { exact: true });
  await expect(firstBase).toHaveValue('10,000.00');
  await expect(grid.getByLabel(`工资-${employees[1]!.id}-base`, { exact: true })).toHaveCount(0);
  await firstBase.fill('12345.67');
  await firstBase.press('Tab');
  await expect(firstBase).toHaveValue('12,345.67');
  await firstBonus.fill('');
  await expect(grid.getByRole('button', { name: '保存表格工资', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '计算工资', exact: true })).toBeDisabled();
  const [saved] = await Promise.all([
    page.waitForResponse(savedResponse),
    firstBonus.press('Control+s'),
  ]);
  expect(saved.ok()).toBe(true);
  await expect(grid.getByRole('button', { name: '保存表格工资', exact: true })).toBeDisabled();
  const modified = await read();
  expect(modified.revision).toBe(batch.revision + 1);
  expect(modified.rows).toHaveLength(2);
  expect(modified.rows[0]!.values).toEqual({ base: 1234567 });
  expect(modified.rows[1]).toEqual(batch.rows[1]);
  expect(modified.calculated).toBe(false);
  await expect(grid.getByLabel(`工资-${employees[0]!.id}-copy_amount`)).toHaveCount(0);
  await page.getByRole('button', { name: '计算工资', exact: true }).click();
  await expect(page.getByRole('heading', { name: /202601 合成逐格工资.*已计算/ })).toBeVisible();
  const calculated = await read();
  expect(calculated.snapshots[0]!.calculatedValues.copy_amount).toBe(1234567);
  expect(calculated.snapshots[1]!.gross).toBe(2010000);
  await page.reload();
  await expect(firstBase).toHaveValue('12,345.67');
  expect((await read()).snapshots).toEqual(calculated.snapshots);
});

test('w_gz_gzgl 并发保存冲突保留表格输入、取消放弃仍保留、确认后读取真实最新工资', async ({
  page,
  request,
}) => {
  const { grid, employees, batch, token, read } = await setup(page, request);
  const firstBase = grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true });
  await firstBase.fill('15000');
  await firstBase.press('Tab');
  const foreign = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      ...batch,
      categoryRevision: batch.category.revision,
      rows: batch.rows.map((row, i) =>
        i === 0 ? { ...row, values: { ...row.values, base: 1300000 } } : row,
      ),
    },
    { token },
  );
  const [rejected] = await Promise.all([
    page.waitForResponse(savedResponse),
    grid.getByRole('button', { name: '保存表格工资', exact: true }).click(),
  ]);
  expect(rejected.ok()).toBe(false);
  await expect(grid.getByText(/工资资料已被其他操作修改/)).toBeVisible();
  await expect(grid.getByText(/本批工资已被其他操作修改/)).toBeVisible();
  await expect(firstBase).toHaveValue('15,000.00');
  expect(await read()).toEqual(foreign);
  await grid.getByRole('button', { name: '放弃表格修改', exact: true }).click();
  const confirmation = page.locator('.ant-popconfirm').filter({ hasText: '确认放弃表格中' });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(firstBase).toHaveValue('15,000.00');
  await grid.getByRole('button', { name: '放弃表格修改', exact: true }).click();
  await confirmation.getByRole('button', { name: '确定', exact: true }).click();
  await expect(firstBase).toHaveValue('13,000.00');
  await expect(grid.getByRole('button', { name: '保存表格工资', exact: true })).toBeDisabled();
  expect(await read()).toEqual(foreign);
});

test('w_gz_gzgl 真实保存响应待返回时冻结单元格，重复快捷键只写一次', async ({ page, request }) => {
  const { grid, employees, batch, read } = await setup(page, request);
  const firstBase = grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true });
  await firstBase.fill('16000');
  await firstBase.press('Tab');
  let release!: () => void, arrive!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = new Promise<void>((resolve) => {
      arrive = resolve;
    });
  const pattern = '**/trpc/m.payroll.saveBatch*';
  let requests = 0;
  await page.route(pattern, async (route) => {
    requests++;
    const response = await route.fetch();
    arrive();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await grid.getByRole('button', { name: '保存表格工资', exact: true }).click();
    await reached;
    await expect(firstBase).toBeDisabled();
    const save = grid.getByRole('button', { name: '保存表格工资', exact: true });
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Control+s');
    expect(requests).toBe(1);
    const persisted = await read();
    expect(persisted.revision).toBe(batch.revision + 1);
    expect(persisted.rows[0]!.values.base).toBe(1600000);
    const [response] = await Promise.all([
      page.waitForResponse(savedResponse),
      Promise.resolve().then(release),
    ]);
    expect(response.ok()).toBe(true);
    await expect(firstBase).toBeEnabled();
    await expect(save).toBeDisabled();
    expect((await read()).revision).toBe(persisted.revision);
  } finally {
    release();
    await page.unroute(pattern);
  }
});

test('w_gz_gzgl 关闭标签通过统一未保存保护，取消保留输入、保存并继续真实写入', async ({
  page,
  request,
}) => {
  const { grid, employees, batch, read } = await setup(page, request);
  const firstBase = grid.getByLabel(`工资-${employees[0]!.id}-base`, { exact: true });
  await firstBase.fill('18000');
  await firstBase.press('Tab');
  await page.keyboard.press('Control+F4');
  const leave = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: /^取\s*消$/ }).click();
  await expect(firstBase).toHaveValue('18,000.00');
  expect((await read()).revision).toBe(batch.revision);
  await page.keyboard.press('Control+F4');
  await expect(leave).toBeVisible();
  const [saved] = await Promise.all([
    page.waitForResponse(savedResponse),
    leave.getByRole('button', { name: '保存并继续', exact: true }).click(),
  ]);
  expect(saved.ok()).toBe(true);
  await expect(grid).not.toBeVisible();
  const persisted = await read();
  expect(persisted.revision).toBe(batch.revision + 1);
  expect(persisted.rows[0]!.values.base).toBe(1800000);
});
