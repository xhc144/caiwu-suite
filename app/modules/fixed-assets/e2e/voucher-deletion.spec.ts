import { expect, test, type APIRequestContext } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '@caiwu/server-kit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import type { Account, DimensionItem, Voucher } from '@caiwu/core';
import fixedAssets from '../server';

async function prepare(request: APIRequestContext, token: string, work = false) {
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, name, input, { token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const accounts = await get<Account[]>('core.accounts.list');
  const departments = await get<DimensionItem[]>('core.dimensions.items', { type: 'department' });
  const types = await get<{ id: number }[]>('core.reference.voucherTypes');
  const account = (code: string) => accounts.find((a) => a.code === code)!.id;
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '设备类', accountId: account('1601') },
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
  const assetId = await post<number>('save', {
    data: {
      code: 'DELETE001',
      name: work ? '工作量保护设备' : '编号影响设备',
      categoryId,
      purposeId,
      statusId,
      departmentId: departments[0]!.id,
      acquired: '2026-01-01',
      useDate: '2026-01-01',
      original: 600000,
      rate: '0',
      method: work ? '2' : '1',
      lifeMonths: 60,
      totalWork: work ? '100' : '0',
    },
  });
  return { get, post, assetId };
}

async function addLaterVoucher(bookId: string) {
  const dataDir = readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('caiwu-e2e-'))
    .map((name) => path.join(os.tmpdir(), name))
    .find((dir) => existsSync(path.join(dir, 'books', `${bookId}.caiwu`)));
  if (!dataDir) throw new Error('未找到本次合成账套');
  const runtime = createRuntime({ dataDir, modules: [fixedAssets], devMode: true });
  try {
    const book = runtime.bookStore.open(bookId);
    const svc = createCoreServices({
      db: book.db,
      user: (await loadServiceUser(book.db, 1))!,
      moduleId: null,
      now: runtime.now,
      modules: runtime.modules.lookup,
    });
    return await svc.vouchers.create({
      date: '2026-02-28',
      voucherTypeId: (await svc.reference.voucherTypes())[0]!.id,
      lines: [
        {
          summary: '编号影响合成凭证',
          accountId: (await svc.accounts.require('1001')).id,
          debit: 100,
        },
        {
          summary: '编号影响合成凭证',
          accountId: (await svc.accounts.require('6001')).id,
          credit: 100,
        },
      ],
    });
  } finally {
    await runtime.bookStore.closeAll();
  }
}

test('w_pz_build / w_zc_qxfz：实际预览删除后重排、确认删除及取消折旧', async ({
  page,
  request,
}) => {
  const { bookId, token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await callApi(
    request,
    'core.voucherPolicy.set',
    {
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    },
    { token, method: 'POST' },
  );
  const preview = await p.get<{ token: string }>('m.fixed-assets.preview', { period: 202602 });
  const batchId = await p.post<number>('depreciate', {
    period: 202602,
    token: preview.token,
    confirm: true,
  });
  const voucherPreview = await p.get<{ token: string }>('m.fixed-assets.voucherPreview', {
    id: batchId,
  });
  const original = await p.post<Voucher>('generateVoucher', {
    id: batchId,
    token: voucherPreview.token,
  });
  const later = await addLaterVoucher(bookId);
  expect(later.number).toBe(2);
  await page.goto('/m/fixed-assets/depreciation');
  const row = page.getByRole('row', { name: /202602/ });
  await row.getByRole('button', { name: '凭证预览/生成' }).click();
  const drawer = page.getByRole('dialog', { name: '折旧凭证预览' });
  const impact = drawer.getByRole('region', { name: '凭证删除及编号影响' });
  await expect(impact).toContainText('删除后重排');
  const affectedRow = impact.getByRole('row', { name: /记-0002/ });
  await expect(affectedRow.getByRole('cell').nth(2)).toHaveText('2');
  await expect(affectedRow.getByRole('cell').nth(3)).toHaveText('1');
  await drawer.getByRole('button', { name: '删除待审核凭证' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).last().click();
  expect(await p.get('core.vouchers.get', { id: original.id })).not.toBeNull();
  await drawer.getByRole('button', { name: '删除待审核凭证' }).click();
  await page.getByRole('button', { name: '确认', exact: true }).last().click();
  await expect(drawer).toBeHidden();
  expect(await p.get('core.vouchers.get', { id: original.id })).toBeNull();
  expect((await p.get<Voucher>('core.vouchers.get', { id: later.id })).number).toBe(1);
  await row.getByRole('button', { name: '取消此月折旧' }).click();
  const cancel = page.getByRole('dialog', { name: '取消折旧预览' });
  await cancel.getByRole('button', { name: '确认取消最后月' }).click();
  await page.getByRole('button', { name: '确认', exact: true }).last().click();
  await expect(cancel).toBeHidden();
  expect(
    (
      await p.get<{ card: { depreciation: number; months: number } }>('m.fixed-assets.detail', {
        id: p.assetId,
      })
    ).card,
  ).toMatchObject({ depreciation: 0, months: 0 });
});

test('w_zjjs：月工作量关闭前保存失败保留输入，改正后保存并关闭', async ({ page, request }) => {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token, true);
  await page.goto('/m/fixed-assets/depreciation');
  await page.getByLabel('计提月份', { exact: true }).fill('202602');
  await page.getByLabel('工作量资产', { exact: true }).click();
  await page.getByText('DELETE001 工作量保护设备', { exact: true }).last().click();
  await page.getByLabel('当月工作量', { exact: true }).fill('101');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(unsaved).toContainText('固定资产月工作量');
  await unsaved.getByRole('button', { name: '保存并继续' }).click();
  await expect(
    page.getByText('DELETE001 本月工作量超过剩余总工作量', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('当月工作量', { exact: true })).toHaveValue('101');
  await page.getByLabel('当月工作量', { exact: true }).fill('10');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: '保存并继续' })
    .click();
  await expect(page.getByRole('heading', { name: '计提与取消折旧', exact: true })).toHaveCount(0);
  const saved = await p.get<{ rows: { assetId: number; workE6: number; amount: number }[] }>(
    'm.fixed-assets.preview',
    { period: 202602 },
  );
  expect(saved.rows.find((r) => r.assetId === p.assetId)).toMatchObject({
    workE6: 10000000,
    amount: 60000,
  });
});

test('w_zcgl_delete：撤销注销展示清理凭证删除与编号影响，确认后恢复同一卡片', async ({
  page,
  request,
}) => {
  const { bookId, token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const p = await prepare(request, token);
  await callApi(
    request,
    'core.voucherPolicy.set',
    {
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    },
    { token, method: 'POST' },
  );
  const reasonId = await p.post<number>('saveMaster', {
    data: { kind: 'reason', code: '01', name: '报废' },
  });
  const depreciation = await p.get<{ token: string }>('m.fixed-assets.preview', { period: 202602 });
  await p.post('depreciate', { period: 202602, token: depreciation.token, confirm: true });
  const preview = await p.get<{ token: string }>('m.fixed-assets.disposalPreview', {
    id: p.assetId,
    date: '2026-02-28',
    reasonId,
    generate: true,
  });
  const voucherId = await p.post<number>('dispose', {
    id: p.assetId,
    date: '2026-02-28',
    reasonId,
    generate: true,
    confirm: true,
    token: preview.token,
  });
  const later = await addLaterVoucher(bookId);
  expect(later.number).toBe(2);
  await page.goto('/m/fixed-assets/cards?includeDisposed=true');
  await page
    .getByRole('row', { name: /DELETE001/ })
    .getByRole('button', { name: '注销/撤销', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: '注销资产', exact: true });
  const impact = drawer.getByRole('region', { name: '凭证删除及编号影响', exact: true });
  await expect(impact).toContainText('记-0001');
  await expect(impact).toContainText('记-0002');
  await expect(impact).toContainText('删除后重排');
  await drawer.getByRole('button', { name: '撤销注销', exact: true }).click();
  await page
    .locator('.ant-popconfirm:visible')
    .getByRole('button', { name: '确认', exact: true })
    .click();
  await expect(drawer).toBeHidden();
  expect(
    (
      await p.get<{
        card: { disposal_date: string | null; voucher_id: number | null; depreciation: number };
      }>('m.fixed-assets.detail', { id: p.assetId })
    ).card,
  ).toMatchObject({ disposal_date: null, voucher_id: null, depreciation: 10000 });
  expect(await p.get('core.vouchers.get', { id: voucherId })).toBeNull();
  expect((await p.get<Voucher>('core.vouchers.get', { id: later.id })).number).toBe(1);
});
