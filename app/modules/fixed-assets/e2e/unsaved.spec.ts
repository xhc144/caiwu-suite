import { expect, test, type APIRequestContext } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Account, DimensionItem } from '@caiwu/core';

async function prepare(request: APIRequestContext, token: string) {
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, name, input, { token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const accounts = await get<Account[]>('core.accounts.list');
  const departments = await get<DimensionItem[]>('core.dimensions.items', { type: 'department' });
  const types = await get<{ id: number }[]>('core.reference.voucherTypes');
  const account = (code: string) => accounts.find((item) => item.code === code)!.id;
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '办公设备', accountId: account('1601'), rate: '0' },
  });
  const purposeId = await post<number>('saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用', accountId: account('6602') },
  });
  const statusId = await post<number>('saveMaster', {
    data: { kind: 'status', code: '01', name: '在用' },
  });
  await post('saveSettings', {
    depreciationAccountId: account('1602'),
    clearingAccountId: account('1601'),
    voucherTypeId: types[0]!.id,
  });
  return {
    get,
    post,
    account,
    categoryId,
    purposeId,
    statusId,
    departmentId: departments.find((item) => item.code === '01')!.id,
  };
}

test('w_zcgl_kp：取消编辑先询问，重复编号保存失败保留主卡与附属设备，修正后保存', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await p.post('save', {
    data: {
      code: 'DUP',
      name: '既有资产',
      categoryId: p.categoryId,
      purposeId: p.purposeId,
      statusId: p.statusId,
      departmentId: p.departmentId,
      acquired: '2026-01-01',
      useDate: '2026-01-01',
      original: 10000,
      rate: '0',
      method: '1',
      lifeMonths: 60,
    },
  });
  await page.goto('/m/fixed-assets/cards');
  await page.getByRole('button', { name: '新增资产', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增资产卡片' });
  await drawer.getByLabel('设备编号', { exact: true }).fill('DUP');
  await drawer.getByLabel('设备名称', { exact: true }).fill('保留中的新资产');
  for (const [label, value] of [
    ['类别', '01 办公设备'],
    ['状态', '01 在用'],
    ['用途', '01 管理用'],
  ]) {
    await drawer.getByLabel(label!, { exact: true }).click();
    await page.getByText(value!, { exact: true }).last().click();
  }
  await drawer.getByLabel('部门', { exact: true }).fill('行政');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('原值（元）', { exact: true }).fill('6000');
  await drawer.getByLabel('残值率（0 至 1）').fill('0');
  await drawer.getByRole('button', { name: '增加附属设备' }).click();
  await drawer.getByLabel('附属编号').fill('A01');
  await drawer.getByLabel('附属名称').fill('保留中的附属设备');
  await drawer.getByLabel('附属数量').fill('0.1');
  await drawer.getByLabel('单价（元）', { exact: true }).fill('0.20');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  let guard = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(guard).toContainText('新增资产卡片');
  await guard.getByRole('button', { name: '继续编辑' }).click();
  await expect(guard).toBeHidden();
  await expect(drawer.getByLabel('设备名称', { exact: true })).toHaveValue('保留中的新资产');
  await drawer.getByRole('button', { name: '保存卡片' }).click();
  await expect(page.getByText('设备编号 DUP 已存在', { exact: true })).toBeVisible();
  await expect(drawer.getByLabel('附属名称')).toHaveValue('保留中的附属设备');
  await drawer.getByLabel('设备编号', { exact: true }).fill('NEW');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  guard = page.getByRole('dialog', { name: '有未保存内容' });
  await guard.getByRole('button', { name: '保存并关闭' }).click();
  await expect(drawer).toBeHidden();
  const cards = await p.get<{ id: number; code: string }[]>('m.fixed-assets.list', {});
  expect(cards.map((card) => card.code)).toEqual(['DUP', 'NEW']);
  const detail = await p.get<{ accessories: { name: string; amount: number }[] }>(
    'm.fixed-assets.detail',
    {
      id: cards.find((card) => card.code === 'NEW')!.id,
    },
  );
  expect(detail.accessories).toMatchObject([{ name: '保留中的附属设备', amount: 2 }]);
});

test('w_xt_kgzb_1_zc：关闭所有只列未保存设置，取消和请求失败保留，重试成功后才关闭', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request, { product: 'chengben' });
  const p = await prepare(request, token);
  await page.goto('/m/fixed-assets/settings');
  const active = () => page.getByRole('tabpanel').filter({ visible: true });
  await active().getByLabel('固定资产清理科目', { exact: true }).fill('6602');
  await page.keyboard.press('Enter');
  await expect(active().locator('.ant-select').nth(1)).toContainText('6602 管理费用');
  await page.getByRole('menuitem', { name: '资产报表与标签', exact: true }).click();
  await expect(active().getByRole('heading', { name: '资产报表与标签' })).toBeVisible();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  let guard = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(guard.getByText('资产凭证设置', { exact: true })).toBeVisible();
  await expect(guard.getByText('资产报表与标签', { exact: true })).toHaveCount(0);
  await guard.getByRole('button', { name: /取\s*消/ }).click();
  await page.getByRole('tab', { name: '资产凭证设置', exact: true }).click();
  await expect(active().locator('.ant-select').nth(1)).toContainText('6602 管理费用');
  let attempts = 0;
  await page.route(/\/trpc\/m\.fixed-assets\.saveSettings(?:\?|$)/, async (route) => {
    attempts++;
    if (attempts === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  guard = page.getByRole('dialog', { name: '有未保存内容' });
  await guard.getByRole('button', { name: '保存并继续' }).click();
  await expect(guard).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(active().locator('.ant-select').nth(1)).toContainText('6602 管理费用');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: '保存并继续' })
    .click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  expect(await p.get('m.fixed-assets.getSettings')).toMatchObject({
    clearingAccountId: p.account('6602'),
  });
  expect(attempts).toBe(2);
});

test('w_zcgl_kp：首保存回包前继续编辑保留新内容，再保存更新同一卡片', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await page.goto('/m/fixed-assets/cards');
  await page.getByRole('button', { name: '新增资产', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增资产卡片' });
  await drawer.getByLabel('设备编号', { exact: true }).fill('ASYNC');
  await drawer.getByLabel('设备名称', { exact: true }).fill('第一版设备名称');
  for (const [label, value] of [
    ['类别', '01 办公设备'],
    ['状态', '01 在用'],
    ['用途', '01 管理用'],
  ]) {
    await drawer.getByLabel(label!, { exact: true }).click();
    await page.getByText(value!, { exact: true }).last().click();
  }
  await drawer.getByLabel('部门', { exact: true }).fill('行政');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('原值（元）', { exact: true }).fill('6000');
  await drawer.getByLabel('残值率（0 至 1）').fill('0');
  let release!: () => void;
  let captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let saves = 0;
  await page.route(/\/trpc\/m\.fixed-assets\.save(?:\?|$)/, async (route) => {
    saves++;
    if (saves !== 1) return route.continue();
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await drawer.getByRole('button', { name: '保存卡片' }).click();
    await started;
    await drawer.getByLabel('设备名称', { exact: true }).fill('保存期间的新设备名称');
    await page.keyboard.press('Control+s');
    release();
    await expect(drawer.getByRole('button', { name: '保存卡片' })).not.toHaveClass(
      /ant-btn-loading/,
    );
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('设备名称', { exact: true })).toHaveValue(
      '保存期间的新设备名称',
    );
    const first = await p.get<{ id: number; name: string; revision: number }[]>(
      'm.fixed-assets.list',
      {},
    );
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: '第一版设备名称', revision: 1 });
    expect(saves).toBe(1);
    await drawer.getByRole('button', { name: '保存卡片' }).click();
    await expect(drawer).toBeHidden();
    const last = await p.get<{ id: number; name: string; revision: number }[]>(
      'm.fixed-assets.list',
      {},
    );
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ id: first[0]!.id, name: '保存期间的新设备名称', revision: 2 });
    expect(saves).toBe(2);
  } finally {
    release();
  }
});
