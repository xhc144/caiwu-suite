import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_FIELDS, type Batch, type Category } from '../shared';

test.describe.configure({ retries: 0 });

async function setup(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const category = await callApi<Category>(
    request,
    'm.payroll.saveCategory',
    { name: '合成计算按钮回归', fields: DEFAULT_FIELDS },
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
      code: 'CALC001',
      name: '合成计算人员',
      departmentId: departments[0]!.id,
      startDate: '2026-01-01',
    },
    { token },
  );
  await callApi(request, 'm.payroll.confirmTax', undefined, { token });
  const batch = await callApi<Batch>(
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
  const read = () =>
    callApi<Batch>(request, 'm.payroll.batch', { id: batch.id }, { token, method: 'GET' });
  await page.goto(`/m/payroll/batch?id=${batch.id}`);
  await expect(
    page.getByRole('heading', { name: /202601 合成计算按钮回归.*待计算/ }),
  ).toBeVisible();
  return { batch, person, read };
}

const calculated = (response: { url(): string; request(): { method(): string } }) =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/trpc/m.payroll.calculate';

test('w_gz_edit：受控真实计算响应期间名称稳定、阻止重复提交，完成后可再次计算', async ({
  page,
  request,
}, info) => {
  const { batch, read } = await setup(page, request);
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = new Promise<void>((resolve) => {
      arrived = resolve;
    });
  const pattern = '**/trpc/m.payroll.calculate*';
  let requests = 0;
  await page.route(pattern, async (route) => {
    requests++;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: '计算工资', exact: true }).click();
    await reached;
    // 仅延迟真实服务响应；旧按钮在此被 loading 图标改名，不伪造计算结果或动画。
    const pending = page.locator('button').filter({ hasText: '计算工资' });
    await info.attach('真实计算 pending 的可访问快照', {
      body: await pending.ariaSnapshot(),
      contentType: 'text/plain',
    });
    await expect(pending).toHaveAccessibleName('计算工资');
    await expect(pending).toHaveAttribute('aria-busy', 'true');
    await expect(pending).toBeDisabled();
    const bounds = await pending.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    expect(requests).toBe(1);
    const first = await read();
    expect(first.calculated).toBe(true);
    expect(first.revision).toBe(batch.revision + 1);
    expect(first.rows).toEqual(batch.rows);
    const [response] = await Promise.all([
      page.waitForResponse(calculated, { timeout: 5_000 }),
      Promise.resolve().then(release),
    ]);
    expect(response.ok()).toBe(true);
    const calculate = page.getByRole('button', { name: '计算工资', exact: true });
    await expect(calculate).toHaveAttribute('aria-busy', 'false');
    await expect(calculate).toBeEnabled();
    await expect(
      page.getByRole('heading', { name: /202601 合成计算按钮回归.*已计算/ }),
    ).toBeVisible();
    await page.unroute(pattern);
    const [again] = await Promise.all([
      page.waitForResponse(calculated, { timeout: 5_000 }),
      calculate.click(),
    ]);
    expect(again.ok()).toBe(true);
    const repeated = await read();
    expect(repeated.revision).toBe(batch.revision + 2);
    expect(repeated.rows).toEqual(first.rows);
    expect(repeated.snapshots).toEqual(first.snapshots);
  } finally {
    release();
    await page.unroute(pattern);
  }
});

test('w_gz_edit：独立真实编辑工资后按中文按钮重算，金额与修订实际持久化', async ({
  page,
  request,
}) => {
  const { batch, person, read } = await setup(page, request);
  const calculate = page.getByRole('button', { name: '计算工资', exact: true });
  const [firstResponse] = await Promise.all([
    page.waitForResponse(calculated, { timeout: 5_000 }),
    calculate.click(),
  ]);
  expect(firstResponse.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: /202601 合成计算按钮回归.*已计算/ }),
  ).toBeVisible();
  const first = await read();
  expect(first.snapshots[0]!.gross).toBe(1000000);
  await page.getByRole('button', { name: '编辑工资', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑工资', exact: true });
  const amount = drawer.getByLabel(`${person.id}-base`, { exact: true });
  await amount.focus();
  await expect(amount).toBeFocused();
  await amount.fill('12000');
  await expect(amount).toHaveValue('12000');
  await amount.press('Tab');
  await expect(amount).toHaveValue('12,000.00');
  await drawer.getByRole('button', { name: '保存工资', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: /202601 合成计算按钮回归.*待计算/ }),
  ).toBeVisible();
  const modified = await read();
  expect(modified.calculated).toBe(false);
  expect(modified.rows[0]!.values.base).toBe(1200000);
  const [response] = await Promise.all([
    page.waitForResponse(calculated, { timeout: 5_000 }),
    calculate.click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: /202601 合成计算按钮回归.*已计算/ }),
  ).toBeVisible();
  const saved = await read();
  expect(saved.calculated).toBe(true);
  expect(saved.revision).toBe(batch.revision + 3);
  expect(saved.rows).toEqual(modified.rows);
  expect(saved.snapshots[0]!.gross).toBe(1200000);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: /202601 合成计算按钮回归.*已计算/ }),
  ).toBeVisible();
  expect((await read()).snapshots).toEqual(saved.snapshots);
});
