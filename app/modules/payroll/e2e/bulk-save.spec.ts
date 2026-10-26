import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category } from '../shared';

const title = '统一置数 / Excel 粘贴';
async function chooseMode(page: Page, drawer: Locator, mode: 'bulk' | 'paste') {
  await drawer.getByRole('combobox', { name: '批量操作' }).click();
  await page
    .locator('.ant-select-item-option-content')
    .getByText(mode === 'bulk' ? '统一置数 / 空值设零' : 'Excel 粘贴', { exact: true })
    .click();
}
async function setDraft(drawer: Locator, mode: 'bulk' | 'paste', amount: number) {
  if (mode === 'bulk') await drawer.getByLabel('统一金额', { exact: true }).fill(String(amount));
  else
    await drawer.getByLabel('Excel 粘贴内容', { exact: true }).fill(`编号\tbase\nB001\t${amount}`);
}
async function assertLocked(drawer: Locator, mode: 'bulk' | 'paste') {
  await expect(drawer.getByRole('combobox', { name: '批量操作' })).toBeDisabled();
  await expect(drawer.getByRole('button', { name: '预览修改范围' })).toBeDisabled();
  await expect(drawer.getByRole('button', { name: '确认批量修改' })).toBeDisabled();
  await expect(drawer.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
  if (mode === 'bulk') {
    await expect(drawer.getByRole('combobox', { name: '置数栏目' })).toBeDisabled();
    await expect(drawer.getByLabel('统一金额', { exact: true })).toBeDisabled();
    await expect(drawer.getByRole('checkbox')).toBeDisabled();
  } else await expect(drawer.getByLabel('Excel 粘贴内容', { exact: true })).toBeDisabled();
}
async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成批量竞态', fields: DEFAULT_FIELDS },
    { token },
  );
  const departments = await callApi<{ id: number }[]>(request, 'm.payroll.departments', undefined, {
    token,
    method: 'GET',
  });
  const person = await callApi<{ id: number }>(
    request,
    'm.payroll.saveEmployee',
    {
      code: 'B001',
      name: '合成批量人员',
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
      rows: [{ employeeId: person.id, values: { base: 1000000 }, tax: { confirmed: true } }],
    },
    { token },
  );
  batch = await callApi<Batch>(
    request,
    'm.payroll.calculate',
    { id: batch.id, revision: batch.revision },
    { token },
  );
  return { token, batch };
}
async function open(page: Page, id: number, mode: 'bulk' | 'paste') {
  await page.goto(`/m/payroll/batch?id=${id}`);
  await page.locator('.cw-data-table').last().getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '统一置数 / 粘贴' }).click();
  const drawer = page.getByRole('dialog', { name: title });
  if (mode === 'paste') await chooseMode(page, drawer, mode);
  return drawer;
}

for (const mode of ['bulk', 'paste'] as const) {
  test(`w_gz_edit_set ${mode === 'bulk' ? '统一置数' : 'Excel粘贴'}：延迟成功/失败冻结草稿和关闭，连续确认仅写一次，失败重试保留新输入`, async ({
    page,
    request,
  }) => {
    test.setTimeout(60000);
    const { token, batch } = await setup(page, request);
    const read = () =>
      callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' });
    const pattern = `**/trpc/m.payroll.${mode === 'bulk' ? 'applyBulk' : 'applyPaste'}*`;
    let drawer = await open(page, batch.id, mode);
    await setDraft(drawer, mode, 100);
    await drawer.getByRole('button', { name: '预览修改范围' }).click();
    await expect(drawer.getByRole('row').filter({ hasText: '合成批量人员' })).toContainText(
      '100.00',
    );
    let release!: () => void, arrived!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      reached = new Promise<void>((resolve) => {
        arrived = resolve;
      });
    let requests = 0;
    await page.route(pattern, async (route) => {
      requests++;
      const response = await route.fetch();
      arrived();
      await gate;
      await route.fulfill({ response });
    });
    await drawer.getByRole('button', { name: '确认批量修改' }).click();
    await page.getByRole('button', { name: '确定', exact: true }).dblclick();
    try {
      await reached;
      await assertLocked(drawer, mode);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Control+F4');
      await expect(drawer).toBeVisible();
      await page.locator('.ant-drawer-mask').click({ position: { x: 2, y: 2 } });
      await expect(drawer).toBeVisible();
      const during = await read();
      expect(during.rows[0]!.values.base).toBe(10000);
      expect(during.revision).toBe(batch.revision + 1);
      expect(requests).toBe(1);
    } finally {
      release();
    }
    await expect(drawer).not.toBeVisible();
    await page.unroute(pattern);
    const stored = await read();
    expect(stored.rows[0]!.values.base).toBe(10000);
    expect(requests).toBe(1);
    await callApi(
      request,
      'm.payroll.calculate',
      { id: batch.id, revision: stored.revision },
      { token },
    );
    drawer = await open(page, batch.id, mode);
    await setDraft(drawer, mode, 150);
    await drawer.getByRole('button', { name: '预览修改范围' }).click();
    await expect(drawer.getByRole('row').filter({ hasText: '合成批量人员' })).toContainText(
      '150.00',
    );
    let fail!: () => void, sent!: () => void;
    const failGate = new Promise<void>((resolve) => {
        fail = resolve;
      }),
      sentRequest = new Promise<void>((resolve) => {
        sent = resolve;
      });
    let failedRequests = 0;
    // Transport failure before reaching the real server; no balance or voucher endpoint is replaced.
    await page.route(pattern, async (route) => {
      failedRequests++;
      sent();
      await failGate;
      await route.abort('connectionfailed');
    });
    await drawer.getByRole('button', { name: '确认批量修改' }).click();
    await page.getByRole('button', { name: '确定', exact: true }).dblclick();
    try {
      await sentRequest;
      await assertLocked(drawer, mode);
      expect(failedRequests).toBe(1);
    } finally {
      fail();
    }
    await expect(drawer.getByText(/批量修改未完成，草稿已保留/)).toBeVisible();
    const input = drawer.getByLabel(mode === 'bulk' ? '统一金额' : 'Excel 粘贴内容', {
      exact: true,
    });
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue(mode === 'bulk' ? '150.00' : '编号\tbase\nB001\t150');
    expect((await read()).rows[0]!.values.base).toBe(10000);
    await page.unroute(pattern);
    await chooseMode(page, drawer, mode === 'bulk' ? 'paste' : 'bulk');
    await chooseMode(page, drawer, mode);
    await expect(input).toHaveValue(mode === 'bulk' ? '150.00' : '编号\tbase\nB001\t150');
    await setDraft(drawer, mode, 200);
    await drawer.getByRole('button', { name: '预览修改范围' }).click();
    await expect(drawer.getByRole('row').filter({ hasText: '合成批量人员' })).toContainText(
      '200.00',
    );
    let retries = 0;
    await page.route(pattern, async (route) => {
      retries++;
      await route.continue();
    });
    await drawer.getByRole('button', { name: '确认批量修改' }).click();
    await page.getByRole('button', { name: '确定', exact: true }).dblclick();
    await expect(drawer).not.toBeVisible();
    await page.unroute(pattern);
    expect(retries).toBe(1);
    expect((await read()).rows[0]!.values.base).toBe(20000);
  });
}
