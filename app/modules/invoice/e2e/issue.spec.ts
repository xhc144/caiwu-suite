import { randomUUID } from 'node:crypto';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Page } from '@playwright/test';
import type { Invoice, IssueOptions } from '../shared';
import type { invoiceIssueService } from '../server/issue-service';
import { single } from '../test/fixtures';
import { test, expect, type Isolated } from './isolated';

type IssuePreview = Awaited<ReturnType<ReturnType<typeof invoiceIssueService>['preview']>>;
// 本文件通过真实 HTTP 做库存联测；不替换库存方法或返回假成功。
async function setup(page: Page, isolated: Isolated, newProduct = false) {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const accounts = await isolated.inBook(bookId, async (svc) => {
    const scheme = (await svc.book.info()).codeScheme;
    const create = async (
      code: string,
      name: string,
      categoryId: string,
      direction: 'debit' | 'credit' = 'debit',
    ) => (await svc.accounts.create({ code, name, categoryId, direction }, scheme)).id;
    return {
      cost: await create('9800', '合成出库销售成本', 'pnl'),
      inventory: await create('9801', '合成出库存货', 'asset'),
      sales: await create('9802', '合成出库收入', 'pnl', 'credit'),
      settlement: await create('9803', '合成出库结算', 'asset'),
    };
  });
  const warehouseId = await callApi<number>(
    isolated.request,
    'm.inventory.saveWarehouse',
    { code: 'INV-01', name: '合成发票仓库' },
    { token },
  );
  if (!newProduct) {
    for (const code of ['INV-A', 'INV-B'])
      await callApi(
        isolated.request,
        'm.inventory.saveProduct',
        {
          code,
          name: code === 'INV-A' ? '合成商品甲' : '合成商品乙',
          specification: 'SPEC-01',
          unit: '件',
          inventoryAccountId: accounts.inventory,
          salesAccountId: accounts.sales,
        },
        { token },
      );
    const opening = await callApi<{ revision: number }>(
      isolated.request,
      'm.inventory.opening',
      { warehouseId },
      { token, method: 'GET' },
    );
    await callApi(
      isolated.request,
      'm.inventory.saveOpening',
      {
        warehouseId,
        revision: opening.revision,
        rows: ['INV-A', 'INV-B'].map((productCode) => ({
          productCode,
          quantity: '20',
          unitPrice: '1',
        })),
      },
      { token },
    );
  }
  const lines = newProduct
    ? [
        {
          name: '合成新产品',
          specification: 'SPEC-NEW',
          unit: '件',
          quantity: '2',
          unitPrice: '50.005',
          taxRate: '0.13',
          taxMark: 'rate' as const,
          amount: 10001,
          tax: 1300,
          total: 11301,
        },
      ]
    : [
        {
          name: '合成商品甲',
          specification: 'SPEC-01',
          unit: '件',
          quantity: '2',
          unitPrice: '50.005',
          taxRate: '0.13',
          taxMark: 'rate' as const,
          amount: 10001,
          tax: 1300,
          total: 11301,
        },
        {
          name: '合成商品乙',
          specification: 'SPEC-01',
          unit: '件',
          quantity: '1',
          unitPrice: '20',
          taxRate: '0.05',
          taxMark: 'rate' as const,
          amount: 2000,
          tax: 100,
          total: 2100,
        },
      ];
  const data = single({
    direction: 'output',
    number: 'STOCK-E2E',
    date: '2026-02-05',
    confirmDate: null,
    amount: lines.reduce((s, l) => s + l.amount, 0),
    tax: lines.reduce((s, l) => s + l.tax, 0),
    total: lines.reduce((s, l) => s + l.total, 0),
    lines,
  });
  const invoiceId = await callApi<number>(isolated.request, 'm.invoice.save', { data }, { token });
  await callApi(
    isolated.request,
    'm.invoice.audit',
    { selection: [{ id: invoiceId, revision: 1 }], to: 'audited' },
    { token },
  );
  // 能力未接回时直接失败并指出真实缺口，不把联测记成跳过或成功。
  await callApi(isolated.request, 'm.invoice.issueReferences', undefined, { token, method: 'GET' });
  return { bookId, token, accounts, warehouseId, invoiceId };
}
async function choose(page: Page, label: string, code: string) {
  await page.getByLabel(label, { exact: true }).fill(code);
  await page.getByLabel(label, { exact: true }).press('Enter');
}
async function selectInvoice(page: Page, isolated: Isolated) {
  await page.goto(`${isolated.origin}/m/invoice/issue?period=202602`);
  await page.getByRole('row').filter({ hasText: 'STOCK-E2E' }).getByRole('radio').check();
  await choose(page, '结算科目', '9803');
  await choose(page, '销售成本科目', '9800');
}
async function confirm(page: Page) {
  const response = page.waitForResponse((r) => r.url().includes('m.invoice.saveIssue'));
  await page.getByRole('button', { name: '确认转出库', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  const saved = await response;
  const body = await saved.json();
  expect(saved.ok(), JSON.stringify(body)).toBe(true);
  expect(body.error).toBeUndefined();
}

test('w_fp_pz_ckd 真实库存联测：精确产品匹配、逐行不同税率与票面尾差、来源锁和库存扣减', async ({
  page,
  isolated,
}) => {
  const { token, warehouseId } = await setup(page, isolated);
  await selectInvoice(page, isolated);
  await expect(page.getByText('INV-A 合成商品甲 SPEC-01（件）', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览出库单', exact: true }).click();
  await expect(page.getByText('出库单预览（尚未保存）', { exact: true })).toBeVisible();
  expect(
    await callApi(
      isolated.request,
      'm.inventory.documents',
      { kind: 'issue' },
      { token, method: 'GET' },
    ),
  ).toEqual([]);
  await confirm(page);
  const [invoice] = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  expect(invoice).toMatchObject({ state: 'issued', revision: 3 });
  const document = await callApi<{
    source_type: string;
    source_id: number;
    revision: number;
    lines: {
      quantity: string;
      unitPrice: string;
      net_cents: number;
      tax_cents: number;
      gross_cents: number;
    }[];
  }>(
    isolated.request,
    'm.inventory.document',
    { id: invoice!.inventoryDocumentId },
    { token, method: 'GET' },
  );
  expect(document).toMatchObject({
    source_type: 'invoice',
    source_id: invoice!.id,
    lines: [
      { quantity: '2', net_cents: 10001, tax_cents: 1300, gross_cents: 11301 },
      { quantity: '1', net_cents: 2000, tax_cents: 100, gross_cents: 2100 },
    ],
  });
  const stock = await callApi<{ productCode: string; balance: string }[]>(
    isolated.request,
    'm.inventory.stock',
    { warehouseId },
    { token, method: 'GET' },
  );
  expect(stock.find((s) => s.productCode === 'INV-A')?.balance).toBe('18');
  expect(stock.find((s) => s.productCode === 'INV-B')?.balance).toBe('19');
  await expect(
    callApi(
      isolated.request,
      'm.inventory.removeDocument',
      { id: invoice!.inventoryDocumentId, revision: document.revision, confirmed: true },
      { token },
    ),
  ).rejects.toThrow(/发票|来源/);
});

test('w_fp_pz_ckd 真实库存联测：确认新增产品及负库存，取消预览零写入', async ({
  page,
  isolated,
}) => {
  const { token } = await setup(page, isolated, true);
  await selectInvoice(page, isolated);
  await page.getByRole('checkbox', { name: '第1行新增产品', exact: true }).check();
  await page.getByLabel('第1行产品编码', { exact: true }).fill('INV-NEW');
  await choose(page, '第1行新产品存货科目', '9801');
  await choose(page, '第1行新产品收入科目', '9802');
  await page.getByRole('button', { name: '预览出库单', exact: true }).click();
  await expect(page.getByText('拟新增产品', { exact: true })).toBeVisible();
  await expect(page.getByText('库存不足', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认转出库', exact: true })).toBeDisabled();
  expect(
    await callApi(isolated.request, 'm.inventory.products', {}, { token, method: 'GET' }),
  ).toEqual([]);
  await page.getByRole('button', { name: '取消出库预览', exact: true }).click();
  expect(
    await callApi(isolated.request, 'm.inventory.products', {}, { token, method: 'GET' }),
  ).toEqual([]);
  await page.getByRole('button', { name: '预览出库单', exact: true }).click();
  await page.getByRole('checkbox', { name: '已核对并同意新增以上产品', exact: true }).check();
  await page
    .getByRole('checkbox', { name: '已核对以上短缺，确认本次允许负库存出库', exact: true })
    .check();
  await confirm(page);
  const products = await callApi<
    { code: string; name: string; specification: string; unit: string }[]
  >(isolated.request, 'm.inventory.products', {}, { token, method: 'GET' });
  expect(products).toMatchObject([
    { code: 'INV-NEW', name: '合成新产品', specification: 'SPEC-NEW', unit: '件' },
  ]);
});

test('w_fp_pz_ckd 真实库存联测：原单替换确认、审核后拒绝旧预览，原来源保持完整', async ({
  page,
  isolated,
}) => {
  const { token, warehouseId, accounts, invoiceId } = await setup(page, isolated);
  const options: IssueOptions = {
    invoiceId,
    invoiceRevision: 2,
    requestKey: randomUUID(),
    warehouseId,
    date: '2026-02-28',
    number: 'FIRST-ISSUE',
    settlementAccountId: accounts.settlement,
    costAccountId: accounts.cost,
    regenerate: false,
    products: [
      { lineNo: 1, productCode: 'INV-A', create: false },
      { lineNo: 2, productCode: 'INV-B', create: false },
    ],
  };
  const preview = await callApi<IssuePreview>(isolated.request, 'm.invoice.previewIssue', options, {
    token,
  });
  await callApi(
    isolated.request,
    'm.invoice.saveIssue',
    {
      options,
      plan: preview.plan,
      fingerprint: preview.fingerprint,
      newProductsConfirmed: false,
      negativeStockConfirmed: false,
      replacementConfirmed: false,
    },
    { token },
  );
  await selectInvoice(page, isolated);
  await page.getByLabel('出库单号', { exact: true }).fill('REPLACED-ISSUE');
  await page.getByRole('button', { name: '预览出库单', exact: true }).click();
  await expect(page.getByText('替换原出库单', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认转出库', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '已核对并确认替换原出库单', exact: true }).check();
  await confirm(page);
  const before = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  const next = {
    ...options,
    invoiceRevision: 4,
    requestKey: randomUUID(),
    regenerate: true,
    number: 'LOCKED-REBUILD',
  };
  const stale = await callApi<IssuePreview>(isolated.request, 'm.invoice.previewIssue', next, {
    token,
  });
  const document = await callApi<{ revision: number }>(
    isolated.request,
    'm.inventory.document',
    { id: before[0]!.inventoryDocumentId },
    { token, method: 'GET' },
  );
  await callApi(
    isolated.request,
    'm.inventory.audit',
    { id: before[0]!.inventoryDocumentId, revision: document.revision, to: true },
    { token },
  );
  await expect(
    callApi(
      isolated.request,
      'm.invoice.saveIssue',
      {
        options: next,
        plan: stale.plan,
        fingerprint: stale.fingerprint,
        newProductsConfirmed: false,
        negativeStockConfirmed: false,
        replacementConfirmed: true,
      },
      { token },
    ),
  ).rejects.toThrow(/审核|版本|变化|锁定/);
  expect(await callApi(isolated.request, 'm.invoice.list', {}, { token, method: 'GET' })).toEqual(
    before,
  );
  const audited = await callApi<{ revision: number }>(
    isolated.request,
    'm.inventory.document',
    { id: before[0]!.inventoryDocumentId },
    { token, method: 'GET' },
  );
  await callApi(
    isolated.request,
    'm.inventory.audit',
    { id: before[0]!.inventoryDocumentId, revision: audited.revision, to: false },
    { token },
  );
  const unlocked = await callApi<{ revision: number }>(
    isolated.request,
    'm.inventory.document',
    { id: before[0]!.inventoryDocumentId },
    { token, method: 'GET' },
  );
  const resumedOptions = { ...next, requestKey: randomUUID(), number: 'AFTER-UNAUDIT' };
  const resumed = await callApi<IssuePreview>(
    isolated.request,
    'm.invoice.previewIssue',
    resumedOptions,
    { token },
  );
  expect(resumed.input.originalDocument).toEqual({
    id: before[0]!.inventoryDocumentId,
    revision: unlocked.revision,
  });
  await callApi(
    isolated.request,
    'm.invoice.saveIssue',
    {
      options: resumedOptions,
      plan: resumed.plan,
      fingerprint: resumed.fingerprint,
      newProductsConfirmed: false,
      negativeStockConfirmed: false,
      replacementConfirmed: true,
    },
    { token },
  );
  const [after] = await callApi<Invoice[]>(
    isolated.request,
    'm.invoice.list',
    {},
    { token, method: 'GET' },
  );
  expect(after).toMatchObject({ state: 'issued', revision: 5, issueNumber: 'AFTER-UNAUDIT' });
});
