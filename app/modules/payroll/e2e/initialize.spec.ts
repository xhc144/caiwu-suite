import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';

test.describe.configure({ retries: 0 });

test('w_xt_kgzb_gz 密码校验处理中预览按钮名称稳定，拒绝后可使用同一按钮重新预览', async ({
  page,
  request,
}) => {
  await loginWithNewBook(page, request, { product: 'minfei' });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let previewRequests = 0;
  await page.route('**/trpc/m.payroll.previewInitialization**', async (route) => {
    const response = await route.fetch();
    if (++previewRequests === 1) await responseGate;
    await route.fulfill({ response });
  });
  await page.goto('/m/payroll/initialize');
  const password = page.getByLabel('当前管理员完整密码', { exact: true });
  const preview = page.locator('button[type="submit"]').filter({ hasText: '预览初始化影响' });
  await password.fill('incorrect');
  await preview.click();
  try {
    await expect(password).toBeDisabled();
    await expect(preview).toBeDisabled();
    await expect(preview).toHaveAccessibleName('预览初始化影响');
  } finally {
    releaseResponse();
  }
  await expect(page.getByText(/当前管理员密码不正确或权限已变化/).first()).toBeVisible();
  await expect(preview).toBeEnabled();
  await password.fill('admin');
  await page.getByRole('button', { name: '预览初始化影响', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认工资模块初始化', exact: true })).toBeVisible();
  expect(previewRequests).toBe(2);
});

test('w_xt_kgzb_gz 保留初始化提示前期待计算，完成后重新确认并继续后期累计', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成初始化前期待计算', fields: DEFAULT_FIELDS },
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
      code: 'INIPENDING001',
      name: '合成前期待计算人员',
      departmentId: departments[0]!.id,
      startDate: '2026-01-01',
    },
    { token },
  );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  const batches: Batch[] = [];
  for (const period of [202601, 202602])
    batches.push(
      await callApi<Batch>(
        request,
        'm.payroll.saveBatch',
        {
          period,
          categoryId: category.id,
          categoryRevision: category.revision,
          rows: [
            { employeeId: employee.id, values: { base: 1_000_000 }, tax: { confirmed: true } },
          ],
        },
        { token },
      ),
    );
  const read = (id: number) =>
    callApi<Batch>(request, 'm.payroll.batch', { id }, { token, method: 'GET' });
  await page.goto('/m/payroll/initialize');
  await page.getByLabel('工资新启用期间', { exact: true }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: '2026年02月' }).click();
  await page.getByRole('checkbox', { name: '保留原启用期间及以后的全部工资和档案' }).check();
  await page.getByLabel('当前管理员完整密码', { exact: true }).fill('admin');
  await page.getByRole('button', { name: '预览初始化影响', exact: true }).click();
  await expect(page.getByText(/保留数据中有早于新启用期间的未计算工资批次/).first()).toBeVisible();
  const modal = page.getByRole('dialog', { name: '确认工资模块初始化', exact: true });
  await expect(modal).not.toBeVisible();
  expect(await read(batches[0]!.id)).toEqual(batches[0]);
  expect(await read(batches[1]!.id)).toEqual(batches[1]);
  expect(
    await callApi(request, 'm.payroll.transferBackups', undefined, { token, method: 'GET' }),
  ).toEqual([]);

  const january = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: batches[0]!.id, revision: batches[0]!.revision },
    { token },
  );
  await page.getByRole('button', { name: '预览初始化影响', exact: true }).click();
  await expect(modal.getByText('现有 2 批，保留 2 批，删除 0 批', { exact: true })).toBeVisible();
  await modal.getByLabel('初始化确认文字', { exact: true }).fill('初始化工资');
  await modal.getByRole('button', { name: '确认初始化工资', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByText(/工资模块初始化完成，启用期间 202602/)).toBeVisible();
  const february = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: batches[1]!.id, revision: batches[1]!.revision },
    { token },
  );
  expect(february.snapshots[0]!.detail).toMatchObject({
    income: 2_000_000,
    allocatedTax: january.snapshots[0]!.taxAmount,
  });
  expect(await read(january.id)).toEqual(january);
});

test('w_xt_kgzb_gz 密码与取消保护、初始化前备份、清空后界面恢复真实工资', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成初始化界面', fields: DEFAULT_FIELDS },
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
      code: 'INIUI001',
      name: '合成初始化界面人员',
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
      rows: [{ employeeId: employee.id, values: { base: 1234567 }, tax: { confirmed: true } }],
    },
    { token },
  );
  const batch = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: saved.id, revision: saved.revision },
    { token },
  );
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' });
  await page.goto('/m/payroll/initialize');
  await expect(page.getByRole('heading', { name: '工资系统初始化', exact: true })).toBeVisible();
  await page
    .getByRole('checkbox', { name: '保留人事档案、工资结构、公式及设置', exact: true })
    .uncheck();
  const password = page.getByLabel('当前管理员完整密码', { exact: true });
  await password.fill('incorrect');
  await page.getByRole('button', { name: '预览初始化影响', exact: true }).click();
  await expect(page.getByText(/当前管理员密码不正确或权限已变化/).first()).toBeVisible();
  expect(await read()).toEqual(batch);
  await password.fill('admin');
  await page.getByRole('button', { name: '预览初始化影响', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '确认工资模块初始化', exact: true });
  await expect(modal.getByText('现有 1 批，保留 0 批，删除 1 批', { exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: '确认初始化工资', exact: true })).toBeDisabled();
  await modal.getByRole('button', { name: '取消初始化', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(await read()).toEqual(batch);
  expect(
    await callApi(request, 'm.payroll.transferBackups', undefined, { token, method: 'GET' }),
  ).toEqual([]);
  await page.getByRole('button', { name: '预览初始化影响', exact: true }).click();
  await modal.getByLabel('初始化确认文字', { exact: true }).fill('初始化工资');
  await modal.getByRole('button', { name: '确认初始化工资', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByText(/工资模块初始化完成/)).toBeVisible();
  expect(await callApi(request, 'm.payroll.batches', {}, { token, method: 'GET' })).toEqual([]);
  expect(
    await callApi(request, 'm.payroll.employees', undefined, { token, method: 'GET' }),
  ).toEqual([]);
  const backups = await callApi<{ id: number; reason: string }[]>(
    request,
    'm.payroll.transferBackups',
    undefined,
    { token, method: 'GET' },
  );
  expect(backups).toHaveLength(1);
  expect(backups[0]!.reason).toBe('工资模块初始化前自动保护副本');
  await page.getByRole('link', { name: '核对或恢复保护副本', exact: true }).click();
  const backupRow = page.getByRole('row').filter({ hasText: '工资模块初始化前自动保护副本' });
  await backupRow.getByRole('button', { name: '预览恢复工资', exact: true }).click();
  const plan = await callApi<{ targetName: string }>(
    request,
    'm.payroll.previewTransferRestore',
    { id: backups[0]!.id },
    { token },
  );
  await page.getByLabel('恢复目标账套名称确认', { exact: true }).fill(plan.targetName);
  await page.getByRole('button', { name: '确认恢复工资模块', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(page.getByText('工资模块保护副本已恢复并核验。', { exact: true })).toBeVisible();
  expect(await read()).toEqual(batch);
  expect(
    (
      await callApi<Employee[]>(request, 'm.payroll.employees', undefined, { token, method: 'GET' })
    ).map((person) => person.code),
  ).toEqual([employee.code]);
});
