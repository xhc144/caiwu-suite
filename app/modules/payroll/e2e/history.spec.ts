import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';
test.describe.configure({ retries: 0 });

async function fixture(page: Page, request: APIRequestContext, year = 2026) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei', startYear: year });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成历史工资', fields: DEFAULT_FIELDS },
    { token },
  );
  const department = (
    await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
      token,
      method: 'GET',
    })
  )[0]!;
  const employee = await callApi<Employee>(
    request,
    'm.payroll.saveEmployee',
    {
      code: 'HIS001',
      name: '合成历史人员',
      departmentId: department.id,
      startDate: `${year}-01-01`,
    },
    { token },
  );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  const save = async (period: number, amount: number) => {
    const b = await callApi<Batch>(
      request,
      'm.payroll.saveBatch',
      {
        period,
        categoryId: category.id,
        categoryRevision: category.revision,
        rows: [{ employeeId: employee.id, values: { base: amount }, tax: { confirmed: true } }],
      },
      { token },
    );
    return callApi<Batch>(
      request,
      'm.payroll.calculate',
      { id: b.id, revision: b.revision },
      { token },
    );
  };
  const read = (id: number) =>
    callApi<Batch>(request, 'm.payroll.batch', { id }, { token, method: 'GET' });
  return { token, category, employee, save, read };
}

test('w_gz_gzgl 前期更正非法金额保留且不发请求，确认后真实保存级联税额及审计', async ({
  page,
  request,
}) => {
  const { employee, save, read } = await fixture(page, request);
  const jan = await save(202601, 4000000),
    feb = await save(202602, 4000000);
  await page.goto(`/m/payroll/batch?id=${jan.id}`);
  await page.getByRole('button', { name: '前期更正 / 更正记录', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '前期工资更正', exact: true });
  await drawer.getByLabel('更正原因', { exact: true }).fill('合成漏计补正');
  const amount = drawer.getByLabel(`更正-${employee.id}.values.base`, { exact: true });
  let previews = 0,
    writes = 0;
  page.on('request', (r) => {
    if (r.url().includes('/trpc/m.payroll.previewCorrection')) previews++;
    if (r.method() === 'POST' && r.url().includes('/trpc/m.payroll.applyCorrection')) writes++;
  });
  await amount.fill('12..34');
  await drawer.getByRole('button', { name: '预览级联更正', exact: true }).click();
  await expect(amount).toHaveValue('12..34');
  await expect(drawer.getByRole('alert').filter({ hasText: '金额格式无效' }).first()).toBeVisible();
  expect(previews).toBe(0);
  expect(writes).toBe(0);
  expect(await read(jan.id)).toEqual(jan);
  await amount.fill('50000');
  await drawer.getByRole('button', { name: '预览级联更正', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '确认前期更正', exact: true })).toBeVisible();
  expect(previews).toBe(1);
  await expect(drawer.getByRole('row').filter({ hasText: '202602' })).toContainText('3,500.00');
  expect(await read(jan.id)).toEqual(jan);
  await drawer.getByRole('button', { name: '确认前期更正', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  expect(writes).toBe(0);
  await drawer.getByRole('button', { name: '确认前期更正', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  expect(writes).toBe(1);
  const savedJan = await read(jan.id),
    savedFeb = await read(feb.id);
  expect(savedJan.snapshots[0]).toMatchObject({ gross: 5000000, taxAmount: 198000, net: 4802000 });
  expect(savedFeb.snapshots[0]!.taxAmount).toBe(350000);
  expect(savedJan.previous).toEqual(jan.snapshots);
  await page.getByRole('button', { name: '前期更正 / 更正记录', exact: true }).click();
  await drawer.locator('summary').filter({ hasText: '合成漏计补正' }).click();
  await expect(drawer).toContainText('应发 40,000.00 → 50,000.00');
  await page.reload();
  expect((await read(feb.id)).snapshots[0]!.taxAmount).toBe(350000);
});

test('w_xt_kgzb_1_gz 历史税制页面确认持久化并计算2018年工资', async ({ page, request }) => {
  const { save } = await fixture(page, request, 2018);
  await page.goto('/m/payroll/tax');
  const historical = page.getByRole('region', { name: '历史工资税制', exact: true });
  await expect(historical).toContainText('3,500.00');
  await expect(historical).toContainText('5,000.00');
  const rule = historical
    .locator('div')
    .filter({ has: page.locator('strong').filter({ hasText: '2018年10月至12月工资薪金' }) })
    .first();
  await rule.getByRole('button', { name: '确认此历史税制', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(rule.getByText('已确认', { exact: true })).toBeVisible();
  await page.reload();
  await expect(rule.getByText('已确认', { exact: true })).toBeVisible();
  const b = await save(201810, 1000000);
  expect(b.snapshots[0]!.detail).toMatchObject({
    expense: 500000,
    currentTax: 29000,
    version: 'cn-salary-monthly-2018-10',
  });
});

test('w_xt_gssz 界面显式选择自定义计税及唯一公式，真实计算一次扣税并持久化解释', async ({
  page,
  request,
}) => {
  const { token, employee, read } = await fixture(page, request);
  const c = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成自定义计税界面',
      fields: [
        ...DEFAULT_FIELDS,
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'custom_tax',
          name: '合成税额',
          kind: 'calculated',
          role: 'memo',
        },
      ],
      formulas: [
        { name: '合成示例5%税式', target: 'custom_tax', expression: 'base * 0.05', tax: false },
      ],
    },
    { token },
  );
  await page.goto('/m/payroll/structure');
  await page
    .getByRole('row')
    .filter({ hasText: c.name })
    .getByRole('button', { name: '编辑结构', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: '工资栏目与公式定义', exact: true });
  await drawer.getByRole('combobox', { name: '计税方式', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('使用本类别唯一自定义计税公式', { exact: true })
    .click();
  await drawer.getByRole('checkbox', { name: '本类别计税公式', exact: true }).check();
  await drawer.getByRole('button', { name: '保存结构', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const categories = await callApi<Category[]>(request, 'm.payroll.categories', undefined, {
    token,
    method: 'GET',
  });
  const category = categories.find((r) => r.id === c.id)!;
  expect(category.taxMode).toBe('custom');
  expect(category.formulas[0]!.tax).toBe(true);
  const batch = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [{ employeeId: employee.id, values: { base: 1000000 }, tax: { confirmed: true } }],
    },
    { token },
  );
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: '计算工资', exact: true }).click();
  await expect.poll(async () => (await read(batch.id)).calculated).toBe(true);
  const calculated = await read(batch.id);
  expect(calculated.snapshots[0]).toMatchObject({
    gross: 1000000,
    deductions: 0,
    taxAmount: 50000,
    net: 950000,
  });
  expect(calculated.snapshots[0]!.detail.version).toBe(
    `custom-formula-${category.id}-${category.revision}`,
  );
  expect(calculated.snapshots[0]!.formulaDetails.join('；')).toContain('自定义计税');
  await page.reload();
  expect((await read(batch.id)).snapshots).toEqual(calculated.snapshots);
});

test('w_gz_gzgl 数量工资更正保留非法原文，六位小数修正后真实重算落库', async ({
  page,
  request,
}) => {
  const { token, employee, read } = await fixture(page, request);
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成数量更正',
      fields: [
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'days',
          name: '天数',
          kind: 'quantity',
          role: 'memo',
          unit: '天',
        },
        { ...DEFAULT_FIELDS[0]!, key: 'pay', name: '数量工资', kind: 'calculated' },
      ],
      formulas: [{ name: '按天计算', target: 'pay', expression: 'days * 12345' }],
    },
    { token },
  );
  const saved = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [
        {
          employeeId: employee.id,
          values: {},
          quantities: { days: '1.234567' },
          tax: { confirmed: true },
        },
      ],
    },
    { token },
  );
  const batch = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: saved.id, revision: saved.revision },
    { token },
  );
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: '前期更正 / 更正记录', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '前期工资更正', exact: true });
  await drawer.getByLabel('更正原因', { exact: true }).fill('合成数量补正');
  const quantity = drawer.getByLabel(`更正-${employee.id}.quantities.days`, { exact: true });
  let previews = 0;
  page.on('request', (r) => {
    if (r.url().includes('/trpc/m.payroll.previewCorrection')) previews++;
  });
  await quantity.fill('2.2345671');
  await drawer.getByRole('button', { name: '预览级联更正', exact: true }).click();
  await expect(quantity).toHaveValue('2.2345671');
  await expect(drawer.getByRole('alert').filter({ hasText: '数量格式无效' }).first()).toBeVisible();
  expect(previews).toBe(0);
  expect(await read(batch.id)).toEqual(batch);
  await quantity.fill('2.234567');
  await drawer.getByRole('button', { name: '预览级联更正', exact: true }).click();
  await drawer.getByRole('button', { name: '确认前期更正', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  const corrected = await read(batch.id);
  expect(corrected.rows[0]!.quantities).toEqual({ days: '2.234567' });
  expect(corrected.snapshots[0]!.gross).toBe(27586);
  expect(corrected.previous).toEqual(batch.snapshots);
});

test('w_gz_gzgl 批次后台更新后核对保留非法金额与更正原因，继续预览拒绝覆盖新版本', async ({
  page,
  request,
}) => {
  const { token, employee, save, read } = await fixture(page, request);
  const batch = await save(202601, 4000000);
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: '前期更正 / 更正记录', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '前期工资更正', exact: true });
  const amount = drawer.getByLabel(`更正-${employee.id}.values.base`, { exact: true });
  await amount.fill('12..34');
  await drawer.getByLabel('更正原因', { exact: true }).fill('原版本合成更正');
  const newer = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: batch.id, revision: batch.revision },
    { token },
  );
  await drawer.getByRole('button', { name: '核对最新工资', exact: true }).click();
  await expect(
    drawer.getByText(
      '工资批次已在其他窗口更新，当前更正草稿已保留；请核对后重新打开，不能覆盖新版本。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(amount).toHaveValue('12..34');
  await expect(drawer.getByLabel('更正原因', { exact: true })).toHaveValue('原版本合成更正');
  await amount.fill('50000');
  await drawer.getByRole('button', { name: '预览级联更正', exact: true }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: '工资批次已变化' })).toBeVisible();
  await expect(amount).toHaveValue('50,000.00');
  expect(await read(batch.id)).toEqual(newer);
});

test('w_gz_gzgl 更正提交处理中统一离开放弃不得清空草稿或伪装取消，真实响应后仅保存一次', async ({
  page,
  request,
}) => {
  const { employee, save, read } = await fixture(page, request);
  const batch = await save(202601, 4000000);
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: '前期更正 / 更正记录', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '前期工资更正', exact: true });
  await drawer.getByLabel('更正原因', { exact: true }).fill('合成并发保存');
  const amount = drawer.getByLabel(`更正-${employee.id}.values.base`, { exact: true });
  await amount.fill('50000');
  await drawer.getByRole('button', { name: '预览级联更正', exact: true }).click();
  let arrived!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const pattern = '**/trpc/m.payroll.applyCorrection*';
  await page.route(pattern, async (route) => {
    writes++;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await drawer.getByRole('button', { name: '确认前期更正', exact: true }).click();
    await page
      .locator('.ant-popconfirm:visible')
      .getByRole('button', { name: '确定', exact: true })
      .click();
    await reached;
    await page.keyboard.press('Control+F4');
    const leave = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
    await expect(leave).not.toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(amount).toHaveValue('50,000.00');
    await expect(drawer.getByLabel('更正原因', { exact: true })).toHaveValue('合成并发保存');
    expect(writes).toBe(1);
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/trpc/m.payroll.applyCorrection'),
    );
    release();
    expect((await response).ok()).toBe(true);
    await expect(drawer).not.toBeVisible();
    expect((await read(batch.id)).snapshots[0]).toMatchObject({
      gross: 5000000,
      taxAmount: 198000,
    });
    expect(writes).toBe(1);
  } finally {
    release();
    await page.unroute(pattern);
  }
});
