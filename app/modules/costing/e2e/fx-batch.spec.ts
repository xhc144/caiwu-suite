import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function fixture(page: Page, request: APIRequestContext) {
  const book = await loginWithNewBook(page, request, { product: 'chengben' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(request, name, input, { token: book.token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, name, input, { token: book.token, method: 'POST' });
  const accounts = await get<{ code: string; id: number }[]>('core.accounts.list');
  const id = (code: string) => accounts.find((a) => a.code === code)!.id;
  const warehouseId = await post<number>('m.inventory.saveWarehouse', {
    code: '01',
    name: '原币批量测试仓',
  });
  await post('m.inventory.saveProduct', {
    code: 'P1',
    name: '批量产品',
    inventoryAccountId: id('1405'),
    salesAccountId: id('6001'),
  });
  const document = (
    number: string,
    date: string,
    unitPrice: string,
    options: { taxRate?: string; foreign?: boolean; issue?: boolean } = {},
  ) =>
    post<{ id: number; revision: number }>('m.inventory.saveDocument', {
      requestKey: `fx-batch-${number}`,
      kind: options.issue ? 'issue' : 'receipt',
      warehouseId,
      number,
      date,
      category: options.issue ? '销售' : '采购',
      accountId: id(options.foreign ? '100202' : '1001'),
      costAccountId: id('6401'),
      taxRate: options.taxRate ?? '0',
      lines: [{ productCode: 'P1', quantity: '1', unitPrice }],
    });
  const voucherTypeId = (await get<{ id: number }[]>('core.reference.voucherTypes'))[0]!.id;
  const generate = async (documentId: number) => {
    const input = { documentId, purpose: 'receipt' };
    const preview = await get<{ fingerprint: string; expectedRevision: number }>(
      'm.costing.previewVoucher',
      input,
    );
    return post('m.costing.generateVoucher', {
      ...input,
      fingerprint: preview.fingerprint,
      expectedRevision: preview.expectedRevision,
      voucherTypeId,
      confirmed: true,
    });
  };
  return { ...book, id, get, post, document, generate, warehouseId };
}

test('w_cb_pz：原币保存重载、非法金额和离开守卫保护已保存金额，再真实制证', async ({
  page,
  request,
}) => {
  const t = await fixture(page, request);
  const document = await t.document('FX01', '2026-01-10', '7.10', { taxRate: '13', foreign: true });
  await page.goto(`/m/costing/vouchers?documentId=${document.id}&purpose=receipt`);
  await page.getByRole('combobox', { name: '来源币种', exact: true }).click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: 'USD' }).click();
  await page.getByLabel('来源汇率', { exact: true }).fill('7.1');
  await page.getByLabel('原币净额', { exact: true }).fill('1.00');
  await page.getByLabel('原币税额', { exact: true }).fill('0.13');
  await page.getByLabel('原币价税合计', { exact: true }).fill('1.13');
  await page.getByRole('button', { name: '保存原币资料', exact: true }).click();
  await expect(page.getByText('原币资料已保存，请重新预览凭证', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('原币净额', { exact: true })).toHaveValue('1.00');
  await expect(page.getByLabel('原币税额', { exact: true })).toHaveValue('0.13');
  await expect(page.getByLabel('原币价税合计', { exact: true })).toHaveValue('1.13');
  await page.getByLabel('原币净额', { exact: true }).fill('坏金额');
  await page.getByLabel('来源汇率', { exact: true }).click();
  await expect(page.getByLabel('原币净额', { exact: true })).toHaveValue('坏金额');
  await expect(page.getByRole('button', { name: '保存原币资料', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '预览凭证', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
  await expect(guard).toContainText('出入库单原币资料');
  await guard.getByRole('button', { name: /取\s*消/ }).click();
  await expect(page.getByLabel('原币净额', { exact: true })).toHaveValue('坏金额');
  const saved = await t.get<{ data: { net_fc_cents: number } }>('m.costing.sourceCurrency', {
    documentId: document.id,
  });
  expect(saved.data.net_fc_cents).toBe(100);
  await page.getByRole('button', { name: '放弃原币修改', exact: true }).click();
  await expect(page.getByLabel('原币净额', { exact: true })).toHaveValue('1.00');
  await page.getByRole('combobox', { name: '税额科目', exact: true }).fill('22210101');
  await page.getByRole('combobox', { name: '税额科目', exact: true }).press('Enter');
  await page.getByRole('button', { name: '预览凭证', exact: true }).click();
  await expect(page.getByText('预览借方 8.02；贷方 8.02', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '美元户' })).toContainText('1.13');
  await page.getByRole('button', { name: '生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成凭证', exact: true })).toBeDisabled();
  const vouchers = await t.get<{ total: number; items: { id: number }[] }>(
    'core.vouchers.list',
    {},
  );
  expect(vouchers.total).toBe(1);
  const voucher = await t.get<{
    lines: { accountCode: string; fcAmount: number | null; exchangeRate: string | null }[];
  }>('core.vouchers.get', { id: vouchers.items[0]!.id });
  expect(voucher.lines.find((l) => l.accountCode === '100202')).toMatchObject({
    fcAmount: 113,
    exchangeRate: '7.1',
  });
  await page.reload();
  await expect(page.getByLabel('原币净额', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('原币净额', { exact: true })).toHaveValue('1.00');
});

test('w_cb_pz：批量预览和执行分别列出成功、失败与跳过，失败修正后可继续', async ({
  page,
  request,
}) => {
  const t = await fixture(page, request);
  await t.document('BATCH-TAX', '2026-01-05', '1', { taxRate: '13' });
  await t.document('BATCH-GOOD', '2026-01-06', '2');
  const existing = await t.document('BATCH-EXISTING', '2026-01-07', '3');
  await t.generate(existing.id);
  await page.goto('/m/costing/voucher-batch');
  await page.getByRole('button', { name: '预览批量凭证', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'BATCH-TAX' })).toContainText('失败');
  await expect(page.getByRole('row').filter({ hasText: 'BATCH-GOOD' })).toContainText('生成');
  await expect(page.getByRole('row').filter({ hasText: 'BATCH-EXISTING' })).toContainText('跳过');
  await page.getByRole('button', { name: '确认批量处理', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByText('成功 1 张，失败 1 张，跳过 1 张', { exact: true })).toBeVisible();
  expect((await t.get<{ total: number }>('core.vouchers.list', {})).total).toBe(2);
  await page.getByRole('combobox', { name: '批量税额科目', exact: true }).fill('22210101');
  await page.getByRole('combobox', { name: '批量税额科目', exact: true }).press('Enter');
  await page.getByRole('button', { name: '预览批量凭证', exact: true }).click();
  await page.getByRole('button', { name: '确认批量处理', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByText('成功 1 张，失败 0 张，跳过 2 张', { exact: true })).toBeVisible();
  expect((await t.get<{ total: number }>('core.vouchers.list', {})).total).toBe(3);
});

test('w_cb_pz：批量销售收入显式跳过合成发票来源，保留其收入制证权属', async ({ page, request }) => {
  const t = await fixture(page, request);
  await t.post('m.inventory.saveOpening', {
    warehouseId: t.warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '1' }],
  });
  const invoice = await t.document('INVOICE-SOURCE', '2026-01-05', '1', { issue: true });
  await t.document('NORMAL-SALE', '2026-01-06', '2', { issue: true });
  // 只定位本测试刚创建的 UUID 账套，用真实来源字段构造前置；不读取其它账套内容。
  const file = readdirSync(os.tmpdir())
    .filter((name) => name.startsWith('caiwu-e2e-'))
    .map((name) => path.join(os.tmpdir(), name, 'books', `${t.bookId}.caiwu`))
    .find((candidate) => existsSync(candidate));
  expect(file).toBeTruthy();
  const db = new Database(file!, { fileMustExist: true });
  try {
    db.transaction(() => {
      expect(
        db
          .prepare(
            "UPDATE inventory_document SET source_type='invoice',source_id=7001,revision=revision+1 WHERE id=?",
          )
          .run(invoice.id).changes,
      ).toBe(1);
      db.prepare('UPDATE inventory_control SET stock_revision=stock_revision+1 WHERE id=1').run();
    })();
  } finally {
    db.close();
  }
  await page.goto('/m/costing/voucher-batch');
  await page.getByRole('combobox', { name: '批量凭证用途', exact: true }).click();
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^销售收入$/ })
    .click();
  await page.getByRole('button', { name: '预览批量凭证', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'INVOICE-SOURCE' })).toContainText(
    '来自销售发票',
  );
  await page.getByRole('button', { name: '确认批量处理', exact: true }).click();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByText('成功 1 张，失败 0 张，跳过 1 张', { exact: true })).toBeVisible();
  const listed = await t.get<{ documentId?: number; sources: unknown[] }[]>(
    'm.costing.voucherDocuments',
  );
  expect(listed.find((d) => d.documentId === invoice.id)?.sources).toEqual([]);
  expect((await t.get<{ total: number }>('core.vouchers.list', {})).total).toBe(1);
});
