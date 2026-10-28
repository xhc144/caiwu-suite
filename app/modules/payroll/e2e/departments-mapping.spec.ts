import { expect, test, type Locator } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Account, DimensionItem, Voucher } from '@caiwu/core';
import { DEFAULT_FIELDS, type Batch, type Category, type Mapping } from '../shared';

async function searchSelect(input: Locator, text: string) {
  await input.fill(text);
  await expect(
    input
      .page()
      .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
      .filter({ hasText: text })
      .first(),
  ).toBeVisible();
  await input.press('Enter');
}

test('w_gz_bmwh 部门修改、停用确认及引用删除保护均真实保存', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const department = await callApi<DimensionItem>(
    request,
    'm.payroll.createDepartment',
    { code: 'UIT01', name: '合成界面部门' },
    { token },
  );
  await callApi(
    request,
    'm.payroll.saveEmployee',
    { code: 'UIT001', name: '合成部门人员', departmentId: department.id, startDate: '2026-01-01' },
    { token },
  );
  await page.goto('/m/payroll/employees');
  await page.getByRole('button', { name: '部门管理', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '部门管理', exact: true });
  const row = drawer.getByRole('row').filter({ hasText: 'UIT01' });
  await row.getByRole('button', { name: '修改部门' }).click();
  await drawer.getByLabel('部门编码', { exact: true }).fill('UIT02');
  await drawer.getByLabel('部门名称', { exact: true }).fill('合成界面部门新名');
  await drawer.getByRole('button', { name: '保存部门', exact: true }).click();
  const updatedRow = drawer.getByRole('row').filter({ hasText: 'UIT02' });
  await expect(updatedRow).toContainText('合成界面部门新名');
  await updatedRow.getByRole('button', { name: '停用', exact: true }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: '取消', exact: true }).click();
  const read = () =>
    callApi<DimensionItem[]>(request, 'm.payroll.departments', undefined, { token, method: 'GET' });
  expect((await read()).find((d) => d.id === department.id)?.disabled).toBe(false);
  await updatedRow.getByRole('button', { name: '停用', exact: true }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: '确定', exact: true }).click();
  await expect(updatedRow.getByRole('button', { name: '启用', exact: true })).toBeVisible();
  expect((await read()).find((d) => d.id === department.id)).toMatchObject({
    code: 'UIT02',
    name: '合成界面部门新名',
    disabled: true,
  });
  // 状态操作会推进版本，当前编辑表单须同步新版本，随后仍能保存名称。
  await drawer.getByLabel('部门名称', { exact: true }).fill('合成停用后更名');
  await drawer.getByRole('button', { name: '保存部门', exact: true }).click();
  await expect(updatedRow).toContainText('合成停用后更名');
  expect((await read()).find((d) => d.id === department.id)?.disabled).toBe(true);
  await updatedRow.getByRole('button', { name: '删除', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认删除部门', exact: true });
  await expect(confirm.getByText('该部门已使用，不能删除', { exact: true })).toBeVisible();
  await expect(confirm.getByRole('button', { name: '确认删除部门', exact: true })).toBeDisabled();
  expect((await read()).some((d) => d.id === department.id)).toBe(true);
});

test('w_pz_sz 任意计算工资项通过界面映射并生成真实来源凭证', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: '合成自定义映射',
      fields: [
        ...DEFAULT_FIELDS,
        { ...DEFAULT_FIELDS[0]!, key: 'allowance', name: '合成津贴', kind: 'calculated' },
      ],
      formulas: [{ name: '津贴计算', target: 'allowance', expression: 'round(base * 0.1,0)' }],
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
      code: 'MAPUI001',
      name: '合成映射人员',
      departmentId: departments[0]!.id,
      startDate: '2026-01-01',
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
      rows: [{ employeeId: employee.id, values: { base: 1000000 }, tax: { confirmed: true } }],
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
      },
    },
    { token },
  );
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await page.getByRole('button', { name: '凭证设置与生成', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '工资凭证设置与生成', exact: true });
  await drawer.getByRole('button', { name: '增加工资项映射', exact: true }).click();
  await drawer.getByLabel('适用凭证', { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('工资分配', { exact: true }).click();
  await drawer.getByLabel('工资金额栏目', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('合成津贴（计算项）', { exact: true })
    .click();
  await searchSelect(drawer.getByLabel('借方科目', { exact: true }), '6602');
  await searchSelect(drawer.getByLabel('贷方科目', { exact: true }), '2211');
  await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeDisabled();
  await drawer.getByRole('button', { name: '保存凭证设置', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '预览凭证', exact: true })).toBeEnabled();
  const mapping = await callApi<Mapping>(
    request,
    'm.payroll.mapping',
    { categoryId: category.id },
    { token, method: 'GET' },
  );
  expect(mapping.rules).toEqual([
    {
      kind: 'allocation',
      field: 'allowance',
      debitAccountId: account('6602').id,
      creditAccountId: account('2211').id,
    },
  ]);
  await drawer.getByRole('combobox', { name: '凭证种类', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('工资分配凭证', { exact: true })
    .click();
  await drawer.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(
    drawer.getByText('借方合计 1,000.00 / 贷方合计 1,000.00', { exact: true }),
  ).toBeVisible();
  await drawer.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: '确定', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const generated = await callApi<Batch>(
    request,
    'm.payroll.batch',
    { id: batch.id },
    { token, method: 'GET' },
  );
  expect(generated.vouchers).toHaveLength(1);
  expect(generated.vouchers[0]).toMatchObject({ kind: 'allocation', status: 'pending' });
  const voucher = await callApi<Voucher>(
    request,
    'core.vouchers.get',
    { id: generated.vouchers[0]!.id },
    { token, method: 'GET' },
  );
  expect(voucher.lines).toHaveLength(2);
  expect(voucher.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
    [account('6602').id, 100000, 0],
    [account('2211').id, 0, 100000],
  ]);
  await expect(page.getByLabel(`工资-${employee.id}-base`, { exact: true })).toHaveCount(0);
});
