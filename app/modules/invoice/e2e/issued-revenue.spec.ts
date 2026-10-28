import { randomUUID } from 'node:crypto';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Voucher } from '@caiwu/core';
import type { Invoice, IssueOptions, PlanInput } from '../shared';
import type { invoiceService } from '../server/service';
import type { invoiceIssueService } from '../server/issue-service';
import { mapping, single } from '../test/fixtures';
import { test, expect } from './isolated';

type RevenuePlan = Awaited<ReturnType<ReturnType<typeof invoiceService>['previewVoucher']>>;
type DeletePlan = NonNullable<RevenuePlan['deletionPlan']>;
type RevokePlan = Awaited<ReturnType<ReturnType<typeof invoiceService>['previewRevoke']>>;
type IssuePlan = Awaited<ReturnType<ReturnType<typeof invoiceIssueService>['preview']>>;
type Group = { id: number; voucher_id: number | null };
type CostPlan = { fingerprint: string; expectedRevision: number; debitCents: number };

test('w_fp_pz/w_fp_pz_ckd：真实出库→唯一收入→独立成本→撤销重建，保留来源与库存', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const get = <T>(name: string, input?: unknown) =>
    callApi<T>(isolated.request, name, input, { token, method: 'GET' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(isolated.request, name, input, { token });
  const { cfg, stockAccountId, costAccountId } = await isolated.inBook(bookId, async (svc) => ({
    cfg: await mapping(svc, 'output'),
    stockAccountId: (await svc.accounts.require('1405')).id,
    costAccountId: (await svc.accounts.require('6401')).id,
  }));
  await post('m.invoice.saveSettings', cfg);
  const warehouseId = await post<number>('m.inventory.saveWarehouse', {
    code: 'CHAIN',
    name: '合成完整链仓库',
  });
  await post('m.inventory.saveProduct', {
    code: 'CHAIN-A',
    name: '合成链商品',
    unit: '件',
    inventoryAccountId: stockAccountId,
    salesAccountId: cfg.business.accountId,
  });
  await post('m.inventory.saveOpening', {
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'CHAIN-A', quantity: '10', unitPrice: '3' }],
  });
  const id = await post<number>('m.invoice.save', {
    data: single({
      direction: 'output',
      number: 'ISSUED-INCOME-CHAIN',
      date: '2026-01-05',
      confirmDate: null,
      amount: 10001,
      tax: 1300,
      total: 11301,
      lines: [
        {
          name: '合成链商品',
          unit: '件',
          quantity: '2',
          unitPrice: '50.005',
          taxRate: '0.13',
          taxMark: 'rate',
          amount: 10001,
          tax: 1300,
          total: 11301,
        },
      ],
    }),
  });
  await post('m.invoice.audit', { selection: [{ id, revision: 1 }], to: 'audited' });
  const issueOptions: IssueOptions = {
    invoiceId: id,
    invoiceRevision: 2,
    requestKey: randomUUID(),
    warehouseId,
    date: '2026-01-05',
    number: 'CHAIN-OUT',
    settlementAccountId: cfg.settlement.accountId,
    costAccountId,
    regenerate: false,
    products: [{ lineNo: 1, productCode: 'CHAIN-A', create: false }],
  };
  const issuePlan = await post<IssuePlan>('m.invoice.previewIssue', issueOptions);
  expect(issuePlan.input.lines[0]).toMatchObject({
    taxRate: '13',
    netCents: 10001,
    taxCents: 1300,
  });
  const issue = await post<{ id: number }>('m.invoice.saveIssue', {
    options: issueOptions,
    fingerprint: issuePlan.fingerprint,
    plan: issuePlan.plan,
    newProductsConfirmed: false,
    negativeStockConfirmed: false,
    replacementConfirmed: false,
  });
  const invoice = async () => (await get<Invoice[]>('m.invoice.list', { id }))[0]!;
  const stock = async () =>
    (await get<{ balance: string }[]>('m.inventory.stock', { warehouseId }))[0]!.balance;
  const vouchers = () => get<{ total: number; items: Voucher[] }>('core.vouchers.list', {});
  const revenueInput = async (regenerate = false): Promise<PlanInput> => ({
    selection: [{ id, revision: (await invoice()).revision }],
    date: '2026-01-05',
    voucherTypeId: 1,
    mode: 'individual',
    regenerate,
  });
  const generate = async (regenerate = false) => {
    const input = await revenueInput(regenerate);
    const plan = await get<RevenuePlan>('m.invoice.previewVoucher', input);
    return post<Group[]>('m.invoice.generate', {
      ...input,
      fingerprint: plan.fingerprint,
      requestId: randomUUID(),
      regenerateConfirmed: regenerate,
      deletionPlan: plan.deletionPlan ?? undefined,
    });
  };
  expect(await invoice()).toMatchObject({
    state: 'issued',
    inventoryDocumentId: issue.id,
    voucherId: null,
  });
  expect((await vouchers()).total).toBe(0);
  expect(await stock()).toBe('8');
  await expect(
    get('m.costing.previewVoucher', { documentId: issue.id, purpose: 'revenue' }),
  ).rejects.toThrow(/发票/);

  // 页面可选择已转出库票，并真正提交收入凭证。
  await page.goto(`${isolated.origin}/m/invoice/process?direction=output&period=202601`);
  const row = page.getByRole('row').filter({ hasText: 'ISSUED-INCOME-CHAIN' });
  await expect(row.getByRole('checkbox')).toBeEnabled();
  await row.getByRole('checkbox').check();
  await page.getByLabel('凭证日期', { exact: true }).fill('2026-01-05');
  await page.getByLabel('凭证字', { exact: true }).click();
  await page.getByLabel('凭证字', { exact: true }).press('ArrowDown');
  await page.getByLabel('凭证字', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '预览分录', exact: true }).click();
  await expect(page.getByText('凭证预览（尚未保存）', { exact: true })).toBeVisible();
  const generated = page.waitForResponse((r) => r.url().includes('m.invoice.generate'));
  await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  expect((await generated).ok()).toBe(true);
  await expect(row).toContainText('已转出库、已制证');
  expect((await vouchers()).total).toBe(1);
  const firstIncome = (await invoice()).voucherId!;
  const original = await get<Voucher>('core.vouchers.get', { id: firstIncome });
  expect(original.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
    [cfg.settlement.accountId, 11301, 0],
    [cfg.business.accountId, 0, 10001],
    [cfg.tax.accountId, 0, 1300],
  ]);
  await expect(generate()).rejects.toThrow(/已审核、未制证/);
  await expect(
    post('m.invoice.previewIssue', {
      ...issueOptions,
      invoiceRevision: (await invoice()).revision,
      regenerate: true,
    }),
  ).rejects.toThrow(/已经生成凭证/);

  const calculation = await get<{ fingerprint: string }>('m.costing.preview', { period: 202601 });
  await post('m.costing.commit', {
    period: 202601,
    fingerprint: calculation.fingerprint,
    requestKey: randomUUID(),
    confirmed: true,
  });
  const target = { documentId: issue.id, purpose: 'cost' };
  const costPlan = await get<CostPlan>('m.costing.previewVoucher', target);
  expect(costPlan.debitCents).toBe(600);
  await post('m.costing.generateVoucher', {
    ...target,
    ...costPlan,
    voucherTypeId: 1,
    confirmed: true,
  });
  expect((await vouchers()).total).toBe(2);
  const costVoucher = (await vouchers()).items.find((v) => v.id !== firstIncome)!;
  const costDetail = await get<Voucher>('core.vouchers.get', { id: costVoucher.id });
  expect(costDetail.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
    [costAccountId, 600, 0],
    [stockAccountId, 0, 600],
  ]);
  await expect(
    get('m.costing.previewVoucher', { documentId: issue.id, purpose: 'revenue' }),
  ).rejects.toThrow(/发票/);

  // 重排会改到成本来源凭证时仍须拒绝，invoice 不能越过其他模块来源锁。
  await post('core.voucherPolicy.set', {
    numbering: 'automatic',
    renumberAfterDelete: true,
    allowModifyOthers: false,
  });
  const beforeLockedRevoke = await vouchers();
  await expect(
    get('m.invoice.previewRevoke', {
      id: (await invoice()).groupId,
      expectedRevision: original.revision,
    }),
  ).rejects.toThrow(/由「.*」生成/);
  expect(await vouchers()).toEqual(beforeLockedRevoke);
  expect(await stock()).toBe('8');
  await post('core.voucherPolicy.set', {
    numbering: 'automatic',
    renumberAfterDelete: false,
    allowModifyOthers: false,
  });

  // 收入重建与撤销都不删库存、成本或解除发票审核。
  const rebuilt = (await generate(true))[0]!;
  expect(rebuilt.voucher_id).not.toBe(firstIncome);
  expect((await vouchers()).total).toBe(2);
  expect((await vouchers()).items.some((v) => v.id === costVoucher.id)).toBe(true);
  expect(await stock()).toBe('8');
  const rebuiltVoucher = await get<Voucher>('core.vouchers.get', { id: rebuilt.voucher_id });
  const revocation = await get<RevokePlan>('m.invoice.previewRevoke', {
    id: rebuilt.id,
    expectedRevision: rebuiltVoucher.revision,
  });
  await post('m.invoice.revoke', { ...revocation, confirmed: true });
  expect(await invoice()).toMatchObject({
    state: 'issued',
    groupId: null,
    inventoryDocumentId: issue.id,
  });
  expect((await vouchers()).items.map((v) => v.id)).toEqual([costVoucher.id]);
  await expect(
    post('m.invoice.audit', {
      selection: [{ id, revision: (await invoice()).revision }],
      to: 'draft',
    }),
  ).rejects.toThrow(/已后续处理/);
  await expect(
    post('m.invoice.previewIssue', {
      ...issueOptions,
      invoiceRevision: (await invoice()).revision,
      regenerate: true,
      requestKey: randomUUID(),
    }),
  ).rejects.toThrow(/核算|凭证|锁定/);

  const deletion = await get<{
    expectedRevision: number;
    plan: DeletePlan;
  }>('m.costing.previewVoucherDelete', target);
  await post('m.costing.deleteVoucher', {
    ...target,
    expectedRevision: deletion.expectedRevision,
    confirmed: true,
    voucherDeletion: { plan: deletion.plan, confirmed: true },
  });
  const cancellation = await get<{
    batchId: string;
    revision: number;
    fingerprint: string;
    voucherDeletion: DeletePlan | null;
  }>('m.costing.previewCancelCalculation');
  await post('m.costing.cancelCalculation', {
    ...cancellation,
    confirmed: true,
    voucherDeletion: cancellation.voucherDeletion
      ? { plan: cancellation.voucherDeletion, confirmed: true }
      : undefined,
  });
  const replaceOptions = {
    ...issueOptions,
    invoiceRevision: (await invoice()).revision,
    requestKey: randomUUID(),
    regenerate: true,
    number: 'CHAIN-REBUILT',
  };
  const replacement = await post<IssuePlan>('m.invoice.previewIssue', replaceOptions);
  await post('m.invoice.saveIssue', {
    options: replaceOptions,
    fingerprint: replacement.fingerprint,
    plan: replacement.plan,
    newProductsConfirmed: false,
    negativeStockConfirmed: false,
    replacementConfirmed: true,
  });
  await generate();
  expect((await vouchers()).total).toBe(1);
  expect(await stock()).toBe('8');
  expect(await invoice()).toMatchObject({ state: 'generated', issueNumber: 'CHAIN-REBUILT' });
  expect(await get<unknown[]>('m.inventory.documents', { kind: 'issue' })).toHaveLength(1);
});
