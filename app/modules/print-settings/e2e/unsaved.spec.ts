import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { PrintTemplate, Settings } from '../shared';

test('w_xt_tz_zc：设置关闭取消与放弃，顶栏重开保留当前编辑', async ({ page, request }) => {
  const book = await loginWithNewBook(page, request);
  await page.goto('/m/print-settings/preview');
  await page.getByRole('button', { name: '打印格式设置', exact: true }).click();
  const name = page.getByLabel('打印单位名称', { exact: true });
  await name.fill('尚未保存的单位');
  await page.getByRole('button', { name: '打印格式设置', exact: true }).click();
  await expect(name).toHaveValue('尚未保存的单位');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '打印设置尚未保存' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(name).toHaveValue('尚未保存的单位');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await dialog.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(name).toHaveCount(0);
  await page.getByRole('button', { name: '打印格式设置', exact: true }).click();
  await expect(name).toHaveValue('');
  const stored = await callApi<Settings>(request, 'm.print-settings.settings', undefined, {
    token: book.token,
    method: 'GET',
  });
  expect(stored.voucher.unitName).toBe('');
});

test('w_xt_tz_zc / w_bb_def_gs：关闭所有只列有修改页面，保存失败保留并可重试', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await page.goto('/m/print-settings/preview');
  await page.getByRole('button', { name: '打印格式设置', exact: true }).click();
  await page.getByLabel('打印单位名称', { exact: true }).fill('关页保存单位');
  await page.getByRole('link', { name: '特殊打印格式', exact: true }).click();
  await expect(page).toHaveURL(/\/formats$/);
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(dialog.getByText('打印格式设置', { exact: true })).toBeVisible();
  await expect(dialog.getByText('特殊打印格式', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await page.route('**/trpc/m.print-settings.saveSettings*', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await dialog.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '打印与导出', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '特殊打印格式', exact: true })).toBeVisible();
  const before = await callApi<Settings>(request, 'm.print-settings.settings', undefined, {
    token: book.token,
    method: 'GET',
  });
  expect(before.voucher.unitName).toBe('');
  await page.getByRole('tab', { name: '打印与导出', exact: true }).click();
  await expect(page.getByLabel('打印单位名称', { exact: true })).toHaveValue('关页保存单位');
  await page.unroute('**/trpc/m.print-settings.saveSettings*');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await dialog.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('tab')).toHaveCount(1);
  const after = await callApi<Settings>(request, 'm.print-settings.settings', undefined, {
    token: book.token,
    method: 'GET',
  });
  expect(after.voucher.unitName).toBe('关页保存单位');
});

test('w_bb_def_gs：新格式保存期间继续编辑，关闭所有保留新内容并按新版本再次保存', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await page.goto('/m/print-settings/formats');
  await page.getByRole('button', { name: '新建格式', exact: true }).click();
  const name = page.getByLabel('格式名称', { exact: true });
  await name.fill('首批格式内容');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/trpc/m.print-settings.saveFormat*', async (route) => {
    requests++;
    if (requests === 1) await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(dialog.getByText('特殊打印格式', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('格式编码', { exact: true })).toBeDisabled();
  await name.fill('保存期间的新内容');
  release();
  await expect(page.getByText('格式已保存', { exact: true })).toBeVisible();
  await expect(name).toHaveValue('保存期间的新内容');
  await expect(page.getByRole('tab', { name: '特殊打印格式', exact: true })).toBeVisible();
  const first = await callApi<(PrintTemplate & { revision: number })[]>(
    request,
    'm.print-settings.formats',
    undefined,
    {
      token: book.token,
      method: 'GET',
    },
  );
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ name: '首批格式内容', revision: 1 });
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await dialog.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  const second = await callApi<(PrintTemplate & { revision: number })[]>(
    request,
    'm.print-settings.formats',
    undefined,
    {
      token: book.token,
      method: 'GET',
    },
  );
  expect(second).toHaveLength(1);
  expect(second[0]).toMatchObject({ name: '保存期间的新内容', revision: 2 });
});

test('w_bb_def_gs：Ctrl+S 存储规范化名称后直接关闭，放弃后续修改保留原格式', async ({
  page,
  request,
}) => {
  const book = await loginWithNewBook(page, request);
  await page.goto('/m/print-settings/formats');
  await page.getByRole('button', { name: '新建格式', exact: true }).click();
  const name = page.getByLabel('格式名称', { exact: true });
  await name.fill('  键盘保存的格式  ');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('格式已保存', { exact: true })).toBeVisible();
  await expect(name).toHaveValue('键盘保存的格式');
  await page.getByRole('button', { name: '关闭定义', exact: true }).click();
  await expect(name).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '定义 / 修改', exact: true }).click();
  await name.fill('需要放弃的后续内容');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(dialog.getByText('特殊打印格式', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '放弃修改并继续', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  const stored = await callApi<(PrintTemplate & { revision: number })[]>(
    request,
    'm.print-settings.formats',
    undefined,
    {
      token: book.token,
      method: 'GET',
    },
  );
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ name: '键盘保存的格式', revision: 1 });
});
