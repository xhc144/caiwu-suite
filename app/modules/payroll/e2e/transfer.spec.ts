import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category, type Employee } from '../shared';

test.describe.configure({ retries: 0 });
async function setup(page: Page, request: APIRequestContext, prefix: string, amount: number) {
  const session = await loginWithNewBook(page, request, { product: 'minfei' }),
    token = session.token;
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    {
      name: `合成${prefix}工资`,
      fields: [
        ...DEFAULT_FIELDS,
        {
          ...DEFAULT_FIELDS[0]!,
          key: 'hours',
          name: '合成工时',
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
  const employee = await callApi<Employee>(
    request,
    'm.payroll.saveEmployee',
    {
      code: `${prefix}001`,
      name: `合成${prefix}人员`,
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
      rows: [
        {
          employeeId: employee.id,
          values: { base: amount },
          quantities: { hours: '160.123456' },
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
  const read = (id = batch.id) =>
    callApi<Batch>(request, 'm.payroll.batch', { id }, { token, method: 'GET' });
  return { ...session, category, employee, batch, read };
}
const confirm = async (page: Page) =>
  page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确定', exact: true })
    .click();
test('w_xt_kmwh_copy 双合成账套真实转出文件→映射→覆盖→导入历史→恢复模块保护副本，源账套及目标原工资可核对', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const source = await setup(page, request, '来源', 1000000);
  await page.goto('/m/payroll/transfer');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '转出工资专用文件', exact: true }).click(),
  ]);
  const file = await readFile((await download.path())!);
  const target = await setup(page, request, '目标', 2000000);
  await page.goto('/m/payroll/transfer');
  await page.getByLabel('跨账套工资文件', { exact: true }).setInputFiles({
    name: '工资.caiwu-payroll',
    mimeType: 'application/octet-stream',
    buffer: file,
  });
  await expect(page.getByText(`来源账套：${source.bookName}`, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '预览工资覆盖范围', exact: true }).click();
  await expect(page.getByText(`目标账套：${target.bookName}`, { exact: true })).toBeVisible();
  expect(await target.read()).toEqual(target.batch);
  await page.getByLabel('转入目标账套名称确认', { exact: true }).fill(target.bookName);
  await page.getByRole('button', { name: '确认覆盖转入工资', exact: true }).click();
  await confirm(page);
  await expect(page.getByText(/工资转入完成，覆盖前工资模块保护副本编号/)).toBeVisible();
  const batches = await callApi<{ id: number }[]>(
    request,
    'm.payroll.batches',
    {},
    { token: target.token, method: 'GET' },
  );
  expect(batches).toHaveLength(1);
  expect(batches[0]!.id).not.toBe(target.batch.id);
  const imported = await target.read(batches[0]!.id);
  expect(imported.snapshots[0]).toMatchObject({
    gross: source.batch.snapshots[0]!.gross,
    taxAmount: source.batch.snapshots[0]!.taxAmount,
    net: source.batch.snapshots[0]!.net,
    calculatedQuantities: { hours: '160.123456' },
  });
  expect(await source.read()).toEqual(source.batch);
  await page.goto(`/m/payroll/batch?id=${imported.id}`);
  await expect(
    page.getByText(`导入历史：${source.bookName}，原批次 ${source.batch.id}`, { exact: true }),
  ).toBeVisible();
  await page.goto('/m/payroll/transfer');
  await page.getByRole('button', { name: '预览恢复工资', exact: true }).first().click();
  await page.getByLabel('恢复目标账套名称确认', { exact: true }).fill(target.bookName);
  await page.getByRole('button', { name: '确认恢复工资模块', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('工资模块保护副本已恢复并核验。', { exact: true })).toBeVisible();
  expect(await target.read()).toEqual(target.batch);
  expect(await source.read()).toEqual(source.batch);
});
test('w_xt_kmwh_copy 覆盖网络失败保留文件/编码/目标确认及原工资，修复后重试成功且只产生一个保护副本', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const source = await setup(page, request, '来源', 1000000);
  const file = await callApi<{ base64: string }>(request, 'm.payroll.exportTransfer', undefined, {
    token: source.token,
    method: 'GET',
  });
  const target = await setup(page, request, '目标', 2000000);
  await page.goto('/m/payroll/transfer');
  await page.getByLabel('跨账套工资文件', { exact: true }).setInputFiles({
    name: '重试工资.caiwu-payroll',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(file.base64, 'base64'),
  });
  await expect(page.getByRole('button', { name: '预览工资覆盖范围', exact: true })).toBeVisible();
  await page.getByLabel('目标编码-department-01', { exact: true }).fill('01');
  await page.getByLabel('跨账套工资文件', { exact: true }).setInputFiles({
    name: '错误文件.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invalid'),
  });
  await expect(page.getByText(/先前文件和编码映射已保留/)).toBeVisible();
  await expect(page.getByText('文件：重试工资.caiwu-payroll', { exact: true })).toBeVisible();
  await expect(page.getByLabel('目标编码-department-01', { exact: true })).toHaveValue('01');
  await page.getByRole('button', { name: '预览工资覆盖范围', exact: true }).click();
  await page.getByLabel('转入目标账套名称确认', { exact: true }).fill(target.bookName);
  const pattern = '**/trpc/m.payroll.applyTransfer*';
  await page.route(pattern, (route) => route.abort('connectionfailed'));
  await page.getByRole('button', { name: '确认覆盖转入工资', exact: true }).click();
  await confirm(page);
  await expect(page.getByText(/操作未完成，文件和选择已保留/)).toBeVisible();
  expect(await target.read()).toEqual(target.batch);
  await expect(page.getByText('文件：重试工资.caiwu-payroll', { exact: true })).toBeVisible();
  await expect(page.getByLabel('转入目标账套名称确认', { exact: true })).toHaveValue(
    target.bookName,
  );
  await page.unroute(pattern);
  await page.getByRole('button', { name: '确认覆盖转入工资', exact: true }).click();
  await confirm(page);
  await expect(page.getByText(/工资转入完成，覆盖前工资模块保护副本编号/)).toBeVisible();
  expect(
    await callApi(request, 'm.payroll.transferBackups', undefined, {
      token: target.token,
      method: 'GET',
    }),
  ).toHaveLength(1);
  expect(await source.read()).toEqual(source.batch);
});
