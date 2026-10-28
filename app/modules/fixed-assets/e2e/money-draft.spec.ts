import { expect, test, type APIRequestContext } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { DimensionItem } from '@caiwu/core';

async function prepare(request: APIRequestContext, token: string) {
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'GET' });
  const departments = await callApi<DimensionItem[]>(
    request,
    'core.dimensions.items',
    { type: 'department' },
    { token, method: 'GET' },
  );
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '办公设备', rate: '0' },
  });
  const statusId = await post<number>('saveMaster', {
    data: { kind: 'status', code: '01', name: '在用' },
  });
  const purposeId = await post<number>('saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用' },
  });
  return {
    post,
    get,
    data: {
      code: 'MONEY',
      name: '非法金额草稿设备',
      categoryId,
      statusId,
      purposeId,
      departmentId: departments.find((item) => item.code === '01')!.id,
      acquired: '2026-01-01',
      useDate: '2026-01-01',
      original: 600000,
      rate: '0',
      residual: 0,
      method: '1',
      lifeMonths: 60,
    },
  };
}

test('w_zcgl_kp：原值6000改为12..34后点击保存不提交旧金额，原文和草稿保留', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await page.goto('/m/fixed-assets/cards');
  await page.getByRole('button', { name: '新增资产', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增资产卡片', exact: true });
  await editor.getByLabel('设备编号', { exact: true }).fill('MONEY');
  await editor.getByLabel('设备名称', { exact: true }).fill('非法金额草稿设备');
  for (const [label, value] of [
    ['类别', '01 办公设备'],
    ['状态', '01 在用'],
    ['用途', '01 管理用'],
  ]) {
    await editor.getByLabel(label!, { exact: true }).click();
    await page.getByText(value!, { exact: true }).last().click();
  }
  await editor.getByLabel('部门', { exact: true }).fill('行政');
  await page.keyboard.press('Enter');
  await editor.getByLabel('残值率（0 至 1）').fill('0');
  const original = editor.getByLabel('原值（元）', { exact: true });
  await original.fill('6000');
  await original.fill('12..34');
  let saves = 0;
  page.on('request', (event) => {
    if (event.method() === 'POST' && /\/trpc\/m\.fixed-assets\.save(?:\?|$)/.test(event.url()))
      saves++;
  });
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click();
  const error = page.getByText('原值金额格式不正确，请修正后再保存', { exact: true });
  await expect
    .poll(async () => (await error.isVisible()) || !(await editor.isVisible()))
    .toBe(true);
  const cards = await p.get<{ original: number }[]>('list', {});
  expect({ saves, persistedOriginals: cards.map((card) => card.original) }).toEqual({
    saves: 0,
    persistedOriginals: [],
  });
  await expect(editor).toBeVisible();
  await expect(original).toHaveValue('12..34');
  await expect(error).toBeVisible();
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await guard.getByRole('button', { name: '保存并关闭', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(original).toHaveValue('12..34');
  expect(saves).toBe(0);
  await guard.getByRole('button', { name: '继续编辑', exact: true }).click();
  await original.fill('1234.56');
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(await p.get('list', {})).toMatchObject([{ original: 123456 }]);
  expect(saves).toBe(1);
});

test('w_zcgl_kp：原卡片只改残值为非法文本，快捷保存拒绝且关闭仍提示未保存', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  const id = await p.post<number>('save', { data: p.data });
  await page.goto('/m/fixed-assets/cards');
  await page
    .getByRole('row', { name: /MONEY/ })
    .getByRole('button', { name: '修改', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '修改资产卡片', exact: true });
  const residual = editor.getByLabel('预计残值（元，留空按率计算）', { exact: true });
  await residual.fill('12..34');
  let saves = 0;
  page.on('request', (event) => {
    if (event.method() === 'POST' && /\/trpc\/m\.fixed-assets\.save(?:\?|$)/.test(event.url()))
      saves++;
  });
  await residual.press('Control+s');
  const error = page.getByText('预计残值金额格式不正确，请修正后再保存', { exact: true });
  await expect
    .poll(async () => (await error.isVisible()) || !(await editor.isVisible()))
    .toBe(true);
  const before = await p.get<{ card: { revision: number; residual: number } }>('detail', { id });
  expect({ saves, revision: before.card.revision, residual: before.card.residual }).toEqual({
    saves: 0,
    revision: 1,
    residual: 0,
  });
  await expect(residual).toHaveValue('12..34');
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(residual).toHaveValue('12..34');
  await residual.fill('123.45');
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click();
  await expect(editor).toBeHidden();
  expect(await p.get('detail', { id })).toMatchObject({
    card: { id, revision: 2, residual: 12345 },
  });
  expect(saves).toBe(1);
});

test('w_zcgl_yztz：非法调整金额不沿用旧输入保存，修正后才更新原值', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  const id = await p.post<number>('save', { data: p.data });
  await page.goto('/m/fixed-assets/cards');
  await page
    .getByRole('row', { name: /MONEY/ })
    .getByRole('button', { name: '原值调整', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '原值调整与查询', exact: true });
  const amount = editor.getByLabel('调整后原值（元）', { exact: true });
  await editor.getByLabel('调整说明', { exact: true }).fill('金额修正后才可调整');
  await amount.fill('7000');
  await amount.fill('12..34');
  let saves = 0;
  page.on('request', (event) => {
    if (event.method() === 'POST' && /\/trpc\/m\.fixed-assets\.adjust(?:\?|$)/.test(event.url()))
      saves++;
  });
  await editor.getByRole('button', { name: '确认原值调整', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(
    editor.getByText('调整后原值金额格式不正确，请修正后再保存', { exact: true }),
  ).toBeVisible();
  await expect(amount).toHaveValue('12..34');
  expect(saves).toBe(0);
  expect(await p.get('detail', { id })).toMatchObject({
    card: { original: 600000, revision: 1 },
    adjustments: [],
  });
  await amount.fill('7000.01');
  await editor.getByRole('button', { name: '确认原值调整', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(editor).toBeHidden();
  expect(await p.get('detail', { id })).toMatchObject({
    card: { original: 700001, revision: 2 },
    adjustments: [{ after_value: 700001 }],
  });
  expect(saves).toBe(1);
});
