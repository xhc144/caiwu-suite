import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createCoreServices } from '@caiwu/core/server';
import type { Voucher } from '@caiwu/core';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { serverModules } from '../.generated/server-modules';

// Independent acceptance through the registered routers and real SQLite.
// No production helper, provider replacement, or mocked successful write is used.
type Doc = { id: number; revision: number; number: string };
type Preview = { fingerprint: string; expectedRevision: number };
type ImportPreview = { errors: unknown[]; shortages: unknown[]; confirmation: string };
type BatchPreview = {
  fingerprint: string;
  rows: {
    action: string;
    numbering: { impacts: { key: string; oldNumber: number; number: number }[] };
  }[];
};
const apps: TestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture() {
  const app = await createTestApp({
    modules: serverModules.filter((m) =>
      ['inventory', 'costing', 'invoice'].includes(m.manifest.id),
    ),
    product: 'chengben',
  });
  apps.push(app);
  const invoke = <T>(moduleId: string, name: string, input?: unknown, token?: string) => {
    const module = serverModules.find((m) => m.manifest.id === moduleId)!;
    const api = app.call(module, token) as unknown as Record<
      string,
      (v: unknown) => Promise<unknown>
    >;
    return api[name]!(input) as Promise<T>;
  };
  const inv = <T>(name: string, input?: unknown, token?: string) =>
    invoke<T>('inventory', name, input, token);
  const cost = <T>(name: string, input?: unknown) => invoke<T>('costing', name, input);
  const invoice = <T>(name: string, input?: unknown) => invoke<T>('invoice', name, input);
  const ids = {
    cash: (await app.svc.accounts.require('1001')).id,
    stock: (await app.svc.accounts.require('1405')).id,
    sales: (await app.svc.accounts.require('6001')).id,
    cost: (await app.svc.accounts.require('6401')).id,
    inputTax: (await app.svc.accounts.require('22210101')).id,
    outputTax: (await app.svc.accounts.require('22210102')).id,
  };
  const voucherTypeId = (await app.svc.reference.voucherTypes())[0]!.id;
  const warehouseId = await inv<number>('saveWarehouse', {
    code: 'INDEPENDENT',
    name: '独立验收仓',
  });
  await inv('saveProduct', {
    code: 'CHECK-P',
    name: '独立验收产品',
    inventoryAccountId: ids.stock,
    salesAccountId: ids.sales,
  });
  const document = (
    kind: 'receipt' | 'issue',
    number: string,
    quantity: string,
    price = '2.5',
  ) => ({
    requestKey: randomUUID(),
    kind,
    number,
    warehouseId,
    date: '2026-01-12',
    category: kind === 'receipt' ? '采购' : '领用',
    accountId: ids.cash,
    costAccountId: ids.cost,
    lines: [{ productCode: 'CHECK-P', quantity, unitPrice: price }],
  });
  const contract = await inv<{ id: number }>('saveContract', {
    number: 'INDEPENDENT-HT10',
    warehouseId,
    supplierId: (await app.svc.dimensions.getByCode('partner', 'S001'))!.id,
    date: '2026-01-05',
    lines: [{ productCode: 'CHECK-P', quantity: '10', unitPrice: '2.5' }],
  });
  const receive = async (number: string) =>
    inv<Doc>('saveDocument', {
      ...(await inv<object>('contractDraft', { id: contract.id })),
      number,
      accountId: ids.cash,
    });
  const history = async (withSecond = true) => {
    const first = await receive('R1');
    const reversal = await inv<Doc>('reverseDocument', {
      id: first.id,
      revision: first.revision,
      requestKey: randomUUID(),
      number: 'I1',
      date: '2026-01-10',
      accountId: ids.cost,
      confirmed: true,
    });
    const second = withSecond ? await receive('R2') : null;
    return { first, reversal, second };
  };
  const stock = async () =>
    (await inv<{ balance: string }[]>('stock', { warehouseId }))[0]?.balance;
  const fulfillment = async () =>
    (
      await inv<{ rows: { received: string; remaining: string }[] }>('contractFulfillment', {
        id: contract.id,
      })
    ).rows[0];
  const generate = async (documentId: number, purpose: string) => {
    const target = { documentId, purpose };
    const plan = await cost<Preview>('previewVoucher', target);
    return cost<Voucher>('generateVoucher', { ...target, ...plan, voucherTypeId, confirmed: true });
  };
  const snapshot = async () => {
    const tables = await sql<{
      name: string;
    }>`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`.execute(app.svc.db);
    const rows = [];
    for (const { name } of tables.rows) {
      const result = await sql
        .raw(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
        .execute(app.svc.db);
      rows.push([name, result.rows]);
    }
    return rows;
  };
  return {
    app,
    inv,
    cost,
    invoice,
    ids,
    voucherTypeId,
    warehouseId,
    document,
    contract,
    receive,
    history,
    stock,
    fulfillment,
    generate,
    snapshot,
  };
}

describe('独立合成验收：合同反冲与跨账套事务', () => {
  it('合同10：R1→I1→R2后删除I1拒绝，整库所有表和操作日志保持不变', async () => {
    const t = await fixture();
    const { reversal } = await t.history();
    expect(await t.fulfillment()).toMatchObject({ received: '10', remaining: '0' });
    const before = await t.snapshot();
    await expect(t.inv('removeDocument', { ...reversal, confirmed: true })).rejects.toThrow(/合同/);
    expect(await t.snapshot()).toEqual(before);
    expect(await t.stock()).toBe('10');
  });

  it('合法三单按[R2,I1,R1]真实导出再跨账套导入，关系和文件完整往返', async () => {
    const source = await fixture();
    const target = await fixture();
    const { first, reversal, second } = await source.history();
    const file = JSON.parse(
      JSON.stringify(
        await source.inv('exportDocuments', { ids: [second!.id, reversal.id, first.id] }),
      ),
    );
    const input = { file, requestKey: randomUUID() };
    const before = await target.snapshot();
    const p = await target.inv<ImportPreview>('importDocumentsPreview', input);
    expect(p.errors).toEqual([]);
    expect(p.shortages).toEqual([]);
    expect(await target.snapshot()).toEqual(before);
    const result = await target.inv<{ savedIds: number[] }>('importDocuments', {
      ...input,
      confirmation: p.confirmation,
    });
    expect(result.savedIds).toHaveLength(3);
    expect(await target.inv('exportDocuments', { ids: result.savedIds })).toEqual(file);
    expect(await target.stock()).toBe('10');
    expect(await target.fulfillment()).toMatchObject({ received: '10', remaining: '0' });
  });

  it('目标合同满额，净零[I1,R1]历史仍能导入且实际库存和履约维持10', async () => {
    const source = await fixture();
    const target = await fixture();
    const { first, reversal } = await source.history(false);
    await target.receive('TARGET-FULL');
    const file = await source.inv('exportDocuments', { ids: [reversal.id, first.id] });
    const input = { file, requestKey: randomUUID() };
    const p = await target.inv<ImportPreview>('importDocumentsPreview', input);
    expect(p.errors).toEqual([]);
    expect(p.shortages).toEqual([]);
    const result = await target.inv<{ savedIds: number[] }>('importDocuments', {
      ...input,
      confirmation: p.confirmation,
    });
    expect(result.savedIds).toHaveLength(2);
    expect(await target.inv('exportDocuments', { ids: result.savedIds })).toEqual(file);
    expect(await target.stock()).toBe('10');
    expect(await target.fulfillment()).toMatchObject({ received: '10', remaining: '0' });
  });

  it('四单[R1,R2,O,I1]不制造短缺，缺少负库存权限的操作员仍能合法整批导入', async () => {
    const source = await fixture();
    const target = await fixture();
    const { first, reversal, second } = await source.history();
    const issue = await source.inv<Doc>('saveDocument', source.document('issue', 'O', '10'));
    const file = await source.inv('exportDocuments', {
      ids: [first.id, second!.id, issue.id, reversal.id],
    });
    const token = await target.app.addUser('limited-import', {
      permissions: ['inventory.view', 'inventory.edit', 'inventory.import'],
    });
    const input = { file, requestKey: randomUUID() };
    const p = await target.inv<ImportPreview>('importDocumentsPreview', input, token);
    expect(p.errors).toEqual([]);
    expect(p.shortages).toEqual([]);
    const result = await target.inv<{ savedIds: number[] }>(
      'importDocuments',
      { ...input, confirmation: p.confirmation },
      token,
    );
    expect(result.savedIds).toHaveLength(4);
    expect(await target.inv('exportDocuments', { ids: result.savedIds })).toEqual(file);
    expect(await target.stock()).toBe('0');
    expect(await target.fulfillment()).toMatchObject({ received: '10', remaining: '0' });
  });

  it('四单实际出库11造成短缺1：无权限和无明确确认均拒绝，拒绝整库不变', async () => {
    const source = await fixture();
    const target = await fixture();
    const { first, reversal, second } = await source.history();
    const raw = source.document('issue', 'O-SHORTAGE', '11');
    const negative = await source.inv<{ confirmation: string }>('previewDocument', raw);
    const issue = await source.inv<Doc>('saveDocument', {
      ...raw,
      negativeConfirmation: negative.confirmation,
    });
    const file = await source.inv('exportDocuments', {
      ids: [first.id, second!.id, issue.id, reversal.id],
    });
    const token = await target.app.addUser('limited-shortage', {
      permissions: ['inventory.view', 'inventory.edit', 'inventory.import'],
    });
    const input = { file, requestKey: randomUUID() };
    const limited = await target.inv<ImportPreview>('importDocumentsPreview', input, token);
    expect(limited.errors).toEqual([]);
    expect(limited.shortages).toContainEqual(expect.objectContaining({ difference: '1' }));
    const before = await target.snapshot();
    await expect(
      target.inv('importDocuments', { ...input, confirmation: limited.confirmation }, token),
    ).rejects.toThrow(/权限/);
    const admin = await target.inv<ImportPreview>('importDocumentsPreview', input);
    await expect(
      target.inv('importDocuments', { ...input, confirmation: admin.confirmation }),
    ).rejects.toThrow(/明确确认/);
    expect(await target.snapshot()).toEqual(before);
    const allowed = { ...input, allowNegative: true };
    const p = await target.inv<ImportPreview>('importDocumentsPreview', allowed);
    await target.inv('importDocuments', { ...allowed, confirmation: p.confirmation });
    expect(await target.stock()).toBe('-1');
  });
});

describe('独立合成验收：成本批量重生成', () => {
  it.each([2, 3])(
    '%i张凭证重排预览包含本批新凭证；取消整库不变，确认全部成功且一单一凭证',
    async (count) => {
      const t = await fixture();
      await t.app.svc.voucherPolicy.set({
        numbering: 'automatic',
        renumberAfterDelete: true,
        allowModifyOthers: true,
      });
      const documents: Doc[] = [];
      for (let i = 0; i < count; i++) {
        const d = await t.inv<Doc>(
          'saveDocument',
          t.document('receipt', `BATCH-${i}`, '1', String(i + 1)),
        );
        documents.push(d);
        await t.generate(d.id, 'receipt');
      }
      const input = {
        from: '2026-01-01',
        to: '2026-01-31',
        purpose: 'receipt',
        voucherTypeId: t.voucherTypeId,
        regenerate: true,
      };
      const before = await t.snapshot();
      const p = await t.cost<BatchPreview>('previewVoucherBatch', input);
      expect(p.rows.map((r) => r.action)).toEqual(
        Array.from({ length: count }, () => 'regenerate'),
      );
      for (let i = 1; i < count; i++)
        expect(p.rows[i]!.numbering.impacts).toContainEqual(
          expect.objectContaining({
            key: `new:receipt:${documents[0]!.id}`,
            oldNumber: count + 1 - i,
            number: count - i,
          }),
        );
      await expect(
        t.cost('executeVoucherBatch', { ...input, fingerprint: p.fingerprint, confirmed: false }),
      ).rejects.toThrow(/确认/);
      expect(await t.snapshot()).toEqual(before);
      const result = await t.cost('executeVoucherBatch', {
        ...input,
        fingerprint: p.fingerprint,
        confirmed: true,
      });
      expect(result).toMatchObject({ succeeded: count, failed: 0, skipped: 0 });
      const vouchers = await t.app.svc.vouchers.list();
      expect(vouchers.total).toBe(count);
      expect(vouchers.items.map((v) => v.number).sort()).toEqual(
        Array.from({ length: count }, (_, i) => i + 1),
      );
      for (const d of documents)
        expect(vouchers.items.filter((v) => v.source?.id === String(d.id))).toHaveLength(1);
    },
  );

  it('外部真实删除再同ID、同内容、同时间重建手工凭证，旧成本批次确认必须拒绝且整库不变', async () => {
    const t = await fixture();
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const document = await t.inv<Doc>('saveDocument', t.document('receipt', 'ABA-COST', '1'));
    await t.generate(document.id, 'receipt');
    const external = createCoreServices({
      ...t.app.svc.ctx,
      now: () => new Date('2026-10-28T16:40:00.000Z'),
    });
    const manual = {
      date: '2026-01-15',
      voucherTypeId: t.voucherTypeId,
      lines: [
        { accountId: t.ids.cash, summary: '独立同内容重建', debit: 7300 },
        { accountId: t.ids.sales, summary: '独立同内容重建', credit: 7300 },
      ],
    };
    const original = await external.vouchers.create(manual);
    const input = {
      from: '2026-01-01',
      to: '2026-01-31',
      purpose: 'receipt',
      voucherTypeId: t.voucherTypeId,
      regenerate: true,
    };
    const p = await t.cost<BatchPreview>('previewVoucherBatch', input);
    await external.vouchers.deleteBatch(await external.vouchers.previewDelete([original.id]), true);
    const rebuilt = await external.vouchers.create(manual);
    expect(rebuilt).toEqual(original);
    const before = await t.snapshot();
    await expect(
      t.cost('executeVoucherBatch', { ...input, fingerprint: p.fingerprint, confirmed: true }),
    ).rejects.toThrow(/已变化/);
    expect(await t.snapshot()).toEqual(before);
    const fresh = await t.cost<BatchPreview>('previewVoucherBatch', input);
    expect(
      await t.cost('executeVoucherBatch', {
        ...input,
        fingerprint: fresh.fingerprint,
        confirmed: true,
      }),
    ).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 });
    expect((await t.app.svc.vouchers.list()).total).toBe(2);
  });
});

describe('独立合成验收：原发票至唯一收入、成本及撤销重排', () => {
  it('原票审核后出库和整数分制证；收入只能由发票生成；撤销先确认重排并保留出库、成本', async () => {
    const t = await fixture();
    const customer = (await t.app.svc.dimensions.getByCode('partner', 'C001'))!.id;
    const receivable = (await t.app.svc.accounts.require('1122')).id;
    await t.invoice('saveSettings', {
      direction: 'output',
      expectedRevision: 0,
      taxpayerBasis: 'other',
      inputTaxTreatment: 'separate',
      settlementMode: 'unified',
      business: { accountId: t.ids.sales, dimensions: {} },
      tax: { accountId: t.ids.outputTax, dimensions: {} },
      settlement: { accountId: receivable, dimensions: { partner: customer } },
      nonDeductible: { accountId: t.ids.cost, dimensions: {} },
    });
    await t.inv('saveOpening', {
      warehouseId: t.warehouseId,
      revision: 0,
      rows: [{ productCode: 'CHECK-P', quantity: '10', unitPrice: '3' }],
    });
    const id = await t.invoice<number>('save', {
      data: {
        direction: 'output',
        number: 'INDEPENDENT-INVOICE',
        date: '2026-01-05',
        sellerName: '独立测试销方',
        sellerTaxId: 'INDEPENDENT-SELLER',
        buyerName: '独立测试客户',
        kind: '独立测试票',
        amount: 10001,
        tax: 1300,
        total: 11301,
        lines: [
          {
            name: '独立验收产品',
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
      },
    });
    await t.invoice('audit', { selection: [{ id, revision: 1 }], to: 'audited' });
    const options = {
      invoiceId: id,
      invoiceRevision: 2,
      requestKey: randomUUID(),
      warehouseId: t.warehouseId,
      date: '2026-01-05',
      number: 'INDEPENDENT-OUT',
      settlementAccountId: receivable,
      costAccountId: t.ids.cost,
      regenerate: false,
      products: [{ lineNo: 1, productCode: 'CHECK-P', create: false }],
    };
    const issuePlan = await t.invoice<{
      fingerprint: string;
      plan: unknown;
      input: { lines: object[] };
    }>('previewIssue', options);
    expect(issuePlan.input.lines).toEqual([
      expect.objectContaining({
        quantity: '2',
        netCents: 10001,
        taxCents: 1300,
        totalCents: 11301,
      }),
    ]);
    const issue = await t.invoice<Doc>('saveIssue', {
      options,
      fingerprint: issuePlan.fingerprint,
      plan: issuePlan.plan,
      newProductsConfirmed: false,
      negativeStockConfirmed: false,
      replacementConfirmed: false,
    });
    expect(await t.stock()).toBe('8');
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    const current = async () =>
      (
        await t.invoice<
          {
            id: number;
            revision: number;
            state: string;
            groupId: number | null;
            voucherId: number | null;
            inventoryDocumentId: number;
          }[]
        >('list', { id })
      )[0]!;
    expect(await current()).toMatchObject({
      state: 'issued',
      inventoryDocumentId: issue.id,
      voucherId: null,
    });
    const generated = async (regenerate = false) => {
      const input = {
        selection: [{ id, revision: (await current()).revision }],
        date: '2026-01-05',
        voucherTypeId: t.voucherTypeId,
        mode: 'individual',
        regenerate,
      };
      const p = await t.invoice<{ fingerprint: string; deletionPlan: unknown }>(
        'previewVoucher',
        input,
      );
      return t.invoice<{ id: number; voucher_id: number }[]>('generate', {
        ...input,
        fingerprint: p.fingerprint,
        deletionPlan: p.deletionPlan ?? undefined,
        requestId: randomUUID(),
        regenerateConfirmed: regenerate,
      });
    };
    await expect(
      t.cost('previewVoucher', { documentId: issue.id, purpose: 'revenue' }),
    ).rejects.toThrow(/发票/);
    const [income] = await generated();
    const revenue = await t.app.svc.vouchers.get(income!.voucher_id);
    expect(revenue!.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [receivable, 11301, 0],
      [t.ids.sales, 0, 10001],
      [t.ids.outputTax, 0, 1300],
    ]);
    await expect(generated()).rejects.toThrow(/未制证/);
    const calculation = await t.cost<{ fingerprint: string }>('preview', { period: 202601 });
    await t.cost('commit', {
      period: 202601,
      fingerprint: calculation.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    const cost = await t.generate(issue.id, 'cost');
    expect(cost.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [t.ids.cost, 600, 0],
      [t.ids.stock, 0, 600],
    ]);
    expect((await t.app.svc.vouchers.list()).total).toBe(2);
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const beforeConflict = await t.snapshot();
    await expect(
      t.invoice('previewRevoke', { id: income!.id, expectedRevision: revenue!.revision }),
    ).rejects.toThrow(/生成/);
    expect(await t.snapshot()).toEqual(beforeConflict);
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const [rebuilt] = await generated(true);
    expect(rebuilt!.voucher_id).not.toBe(revenue!.id);
    expect(await t.app.svc.vouchers.get(cost.id)).toEqual(cost);
    // The previous regeneration intentionally retained a gap. A later full-period
    // renumber would also move the costing voucher and correctly refuse. Fill that
    // gap through the real manual-number policy before testing permitted impacts.
    await t.app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    await t.app.svc.vouchers.create({
      date: '2026-01-18',
      voucherTypeId: t.voucherTypeId,
      number: revenue!.number!,
      lines: [
        { accountId: t.ids.cash, summary: '手工补齐此前保留的空号', debit: 2500 },
        { accountId: t.ids.sales, summary: '手工补齐此前保留的空号', credit: 2500 },
      ],
    });
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const manual = await t.app.svc.vouchers.create({
      date: '2026-01-20',
      voucherTypeId: t.voucherTypeId,
      lines: [
        { accountId: t.ids.cash, summary: '撤销重排的后续手工凭证', debit: 4500 },
        { accountId: t.ids.sales, summary: '撤销重排的后续手工凭证', credit: 4500 },
      ],
    });
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const rebuiltVoucher = await t.app.svc.vouchers.get(rebuilt!.voucher_id);
    const revoke = await t.invoice<
      { fingerprint: string; deletionPlan: { impacts: unknown[] } } & Record<string, unknown>
    >('previewRevoke', { id: rebuilt!.id, expectedRevision: rebuiltVoucher!.revision });
    expect(revoke.deletionPlan).toBeTruthy();
    const beforeCancel = await t.snapshot();
    await expect(t.invoice('revoke', { ...revoke, confirmed: false })).rejects.toThrow(/确认/);
    expect(await t.snapshot()).toEqual(beforeCancel);
    await t.invoice('revoke', { ...revoke, confirmed: true });
    expect(await t.app.svc.vouchers.get(rebuiltVoucher!.id)).toBeNull();
    expect(await t.app.svc.vouchers.get(cost.id)).toEqual(cost);
    expect(await t.app.svc.vouchers.get(manual.id)).toMatchObject({ number: manual.number! - 1 });
    expect(await current()).toMatchObject({
      state: 'issued',
      groupId: null,
      inventoryDocumentId: issue.id,
    });
    expect(await t.stock()).toBe('8');
    expect((await t.app.svc.vouchers.list()).total).toBe(3);
  });
});
