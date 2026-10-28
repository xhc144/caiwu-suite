import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Account, DimensionItem, Voucher } from '@caiwu/core';
import { DEFAULT_FIELDS, type Batch, type Category } from '../shared';
import type { VoucherMapping } from '../shared-voucher';

test.describe.configure({ retries: 0 });
test('w_pz_sz / w_pz_build_gz 辅助设置界面保存、红字凭证落库、预览确认撤销保留工资', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成红字辅助工资',
      fields: [
        ...DEFAULT_FIELDS,
        { ...DEFAULT_FIELDS[0]!, key: 'adjustment', name: '合成调整额', role: 'memo' },
      ],
    },
    { token },
  );
  const departments = await callApi<DimensionItem[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employee = await callApi<{ id: number }>(
    request,
    'm.payroll.saveEmployee',
    {
      code: 'VEX001',
      name: '合成红字人员',
      departmentId: departments[0]!.id,
      startDate: '2026-01-01',
    },
    { token },
  );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  let batch = await callApi<Batch>(
    request,
    'm.payroll.saveBatch',
    {
      period: 202601,
      categoryId: category.id,
      categoryRevision: category.revision,
      rows: [
        {
          employeeId: employee.id,
          values: { base: 1_000_000, adjustment: -12345 },
          tax: { confirmed: true },
        },
      ],
    },
    { token },
  );
  batch = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: batch.id, revision: batch.revision },
    { token },
  );
  const accounts = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
    token,
    method: 'GET',
  });
  const account = (code: string) => accounts.find((a) => a.code === code)!;
  await callApi(
    request,
    'm.payroll.saveMapping',
    {
      categoryId: category.id,
      mapping: {
        payableAccountId: account('2211').id,
        bankAccountId: account('1001').id,
        taxAccountId: account('1001').id,
        deductionAccountId: account('1001').id,
        expenseAccountId: account('6602').id,
        amountField: 'gross',
        allocationField: 'department',
        rules: [
          {
            kind: 'allocation',
            field: 'adjustment',
            debitAccountId: account('6602').id,
            creditAccountId: account('2211').id,
          },
        ],
      },
    },
    { token },
  );
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: '凭证设置与生成', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '工资凭证设置与生成', exact: true });
  await drawer.getByRole('button', { name: '增加辅助核算设置', exact: true }).click();
  const expense = drawer.getByLabel('辅助核算科目1', { exact: true });
  await expense.fill('6602');
  await expect(
    page.locator('.ant-select-dropdown:visible').getByText(/6602/).first(),
  ).toBeVisible();
  await expense.press('Enter');
  const department = drawer.getByLabel('部门1', { exact: true });
  await department.fill(departments[1]!.code);
  await expect(
    page
      .locator('.ant-select-dropdown:visible')
      .getByText(new RegExp(departments[1]!.name))
      .first(),
  ).toBeVisible();
  await department.press('Enter');
  await drawer.getByRole('button', { name: '保存凭证设置', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeEnabled();
  const mapping = await callApi<VoucherMapping>(
    request,
    'm.payroll.mapping',
    { categoryId: category.id },
    { token, method: 'GET' },
  );
  expect(mapping.auxiliaries).toEqual([
    { accountId: account('6602').id, values: { department: departments[1]!.id } },
  ]);
  await drawer.getByRole('combobox', { name: '凭证种类', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('工资分配凭证', { exact: true })
    .click();
  await drawer.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(
    drawer.getByText('借方合计 -123.45 / 贷方合计 -123.45', { exact: true }),
  ).toBeVisible();
  await drawer.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(drawer).not.toBeVisible();
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' });
  const generated = await read();
  expect(generated.vouchers).toHaveLength(1);
  const voucher = await callApi<Voucher>(
    request,
    'core.vouchers.get',
    { id: generated.vouchers[0]!.id },
    { token, method: 'GET' },
  );
  expect(voucher.lines.map((line) => [line.entrySide, line.debit, line.credit])).toEqual([
    ['debit', -12345, 0],
    ['credit', 0, -12345],
  ]);
  expect(voucher.lines[0]!.dimensions.department).toBe(departments[1]!.id);
  expect(generated.snapshots).toEqual(batch.snapshots);
  await page.getByRole('button', { name: '凭证设置与生成', exact: true }).click();
  await drawer.getByRole('button', { name: '撤销分配凭证', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: '确认撤销工资凭证及编号影响',
    exact: true,
  });
  await expect(confirmation.getByText('其它凭证编号不会变化。', { exact: true })).toBeVisible();
  await expect(
    confirmation.getByRole('button', { name: '确认撤销并删除凭证', exact: true }),
  ).toBeEnabled();
  expect((await read()).vouchers).toHaveLength(1);
  await confirmation.getByRole('button', { name: '确认撤销并删除凭证', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  const revoked = await read();
  expect(revoked.vouchers).toEqual([]);
  expect(revoked.snapshots).toEqual(batch.snapshots);
});

async function mappingDraftSetup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成凭证设置草稿', fields: DEFAULT_FIELDS },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const employee = await callApi<{ id: number }>(
    request,
    'm.payroll.saveEmployee',
    {
      code: 'MDR001',
      name: '合成设置草稿人员',
      startDate: '2026-01-01',
      departmentId: departments[0]!.id,
    },
    { token },
  );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
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
          values: { base: 1000000, bonus: 12345 },
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
  const accounts = await callApi<Account[]>(request, 'core.accounts.list', undefined, {
    token,
    method: 'GET',
  });
  const account = (code: string) => accounts.find((a) => a.code === code)!;
  const mapping = await callApi<VoucherMapping>(
    request,
    'm.payroll.saveMapping',
    {
      categoryId: category.id,
      mapping: {
        payableAccountId: account('2211').id,
        bankAccountId: account('1001').id,
        taxAccountId: account('1001').id,
        deductionAccountId: account('1001').id,
        expenseAccountId: account('6602').id,
        amountField: 'gross',
        allocationField: 'department',
      },
    },
    { token },
  );
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: '凭证设置与生成', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '工资凭证设置与生成', exact: true });
  await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeEnabled();
  return {
    token,
    category,
    batch,
    mapping,
    drawer,
    read: () =>
      callApi<VoucherMapping>(
        request,
        'm.payroll.mapping',
        { categoryId: category.id },
        { token, method: 'GET' },
      ),
  };
}

test('w_pz_sz 未保存设置关闭可继续编辑，保存完整设置且请求期间冻结，明确放弃不改库', async ({
  page,
  request,
}) => {
  const { drawer, mapping, read } = await mappingDraftSetup(page, request);
  await drawer.getByRole('button', { name: '增加工资项映射', exact: true }).click();
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const close = page.getByRole('dialog', { name: '凭证设置尚未保存', exact: true });
  await expect(close).toBeVisible();
  await close.getByRole('button', { name: '继续编辑凭证设置', exact: true }).click();
  await expect(drawer.getByLabel('工资金额栏目', { exact: true })).toBeVisible();
  expect(await read()).toEqual(mapping);
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    reached = new Promise<void>((r) => {
      arrived = r;
    });
  let writes = 0;
  await page.route('**/trpc/m.payroll.saveMapping*', async (route) => {
    writes++;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await drawer.getByRole('button', { name: '保存凭证设置', exact: true }).click();
    await reached;
    await expect(drawer.getByLabel('工资金额栏目', { exact: true })).toBeDisabled();
    await page.keyboard.press('Control+s');
    expect(writes).toBe(1);
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/trpc/m.payroll.saveMapping'),
      ),
      Promise.resolve().then(release),
    ]);
    expect(response.ok()).toBe(true);
    await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeEnabled();
    const persisted = await read();
    expect(persisted.revision).toBe(mapping.revision + 1);
    expect(persisted.rules).toHaveLength(1);
    expect(persisted.rules[0]?.field).toBe('net');
    await drawer.getByRole('button', { name: '增加辅助核算设置', exact: true }).click();
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(close).toBeVisible();
    await close.getByRole('button', { name: '放弃并关闭凭证设置', exact: true }).click();
    await expect(drawer).not.toBeVisible();
    expect(await read()).toEqual(persisted);
  } finally {
    release();
    await page.unroute('**/trpc/m.payroll.saveMapping*');
  }
});

test('w_pz_sz 并发设置版本冲突保留未存映射，明确放弃后才重新载入新版本', async ({
  page,
  request,
}) => {
  const { drawer, category, mapping, token, read } = await mappingDraftSetup(page, request);
  await drawer.getByRole('button', { name: '增加工资项映射', exact: true }).click();
  const changed = await callApi<VoucherMapping>(
    request,
    'm.payroll.saveMapping',
    { categoryId: category.id, mapping: { ...mapping, rules: [] } },
    { token },
  );
  await drawer.getByRole('button', { name: '保存凭证设置', exact: true }).click();
  await expect(drawer.getByText('工资资料已被其他操作修改', { exact: true })).toBeVisible();
  await expect(drawer.getByLabel('工资金额栏目', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeDisabled();
  expect(await read()).toEqual(changed);
  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const close = page.getByRole('dialog', { name: '凭证设置尚未保存', exact: true });
  await close.getByRole('button', { name: '放弃并关闭凭证设置', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: '凭证设置与生成', exact: true }).click();
  await expect(drawer.getByLabel('工资金额栏目', { exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeEnabled();
  expect(await read()).toEqual(changed);
  await drawer.getByRole('button', { name: '增加工资项映射', exact: true }).click();
  await drawer.getByRole('button', { name: '保存凭证设置', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeEnabled();
  const resaved = await read();
  expect(resaved.revision).toBe(changed.revision + 1);
  expect(resaved.rules).toHaveLength(1);
});
