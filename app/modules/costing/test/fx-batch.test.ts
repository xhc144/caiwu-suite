import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { executeVoucherBatch, previewVoucherBatch } from '../server/batch';
import { saveSourceCurrency, sourceCurrency } from '../server/vouchers';
import { readInventory, type InventoryReadTables } from '../server/inventory-read';
import { caller, setup } from './fixtures';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.app.close();
});
const svc = () => t.app.svcFor('costing');
async function typeId() {
  return (await t.app.svc.reference.voucherTypes())[0]!.id;
}
async function generate(
  documentId: number,
  purpose: 'receipt' | 'revenue' | 'cost',
  taxAccountId?: number,
) {
  const target = { documentId, purpose, taxAccountId };
  const preview = await t.api.previewVoucher(target);
  return t.api.generateVoucher({
    ...target,
    fingerprint: preview.fingerprint,
    expectedRevision: preview.expectedRevision,
    voucherTypeId: await typeId(),
    confirmed: true,
  });
}
async function foreignReceipt(
  lines?: { productCode: string; quantity: string; unitPrice: string }[],
  taxRate = '13',
) {
  const stock = await t.app.svc.accounts.create(
    { code: '1406', name: '外币库存', categoryId: 'asset', currency: 'USD', quantityUnit: '件' },
    [4, 2, 2],
  );
  const sales = await t.app.svc.accounts.create(
    { code: '6002', name: '外币收入', categoryId: 'pnl', direction: 'credit', currency: 'USD' },
    [4, 2, 2],
  );
  const tax = await t.app.svc.accounts.create(
    { code: '22210103', name: '外币进项', currency: 'USD' },
    [4, 2, 2],
  );
  const bank = await t.app.svc.accounts.require('100202');
  await t.inventory.saveProduct({
    code: 'F1',
    name: '外币产品',
    inventoryAccountId: stock.id,
    salesAccountId: sales.id,
  });
  const document = await t.inventory.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId: t.warehouseId,
    number: randomUUID(),
    date: '2026-01-10',
    category: '采购',
    accountId: bank.id,
    costAccountId: t.ids.cost,
    taxRate,
    lines: lines ?? [{ productCode: 'F1', quantity: '2', unitPrice: '3.55' }],
  });
  return { document, stock, sales, tax, bank };
}
async function saveForeign(
  documentId: number,
  values: {
    netFcCents?: number;
    taxFcCents?: number;
    grossFcCents?: number;
    exchangeRate?: string;
  } = {},
) {
  const source = await sourceCurrency(svc(), { documentId });
  return saveSourceCurrency(svc(), {
    documentId,
    expectedRevision: source.sourceRevision,
    revision: source.data?.revision ?? 0,
    currency: 'USD',
    exchangeRate: values.exchangeRate ?? '7.1',
    netFcCents: values.netFcCents ?? 100,
    taxFcCents: values.taxFcCents ?? 13,
    grossFcCents: values.grossFcCents ?? 113,
  });
}

describe('w_cb_pz：来源原币与零成本数量凭证', () => {
  it('预录原币后正式核算和取消只更新成本元数据，入库与销售收入仍可真实制证', async () => {
    const { document, tax, bank } = await foreignReceipt();
    const sale = await t.inventory.saveDocument({
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId: t.warehouseId,
      number: 'FX-SALE',
      date: '2026-01-20',
      category: '销售',
      accountId: bank.id,
      costAccountId: t.ids.cost,
      taxRate: '13',
      lines: [{ productCode: 'F1', quantity: '1', unitPrice: '7.1' }],
    });
    await saveForeign(document.id);
    await saveForeign(sale.id);
    const calculation = await t.api.preview({ period: 202601 });
    await t.api.commit({
      period: 202601,
      fingerprint: calculation.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(false);
    expect((await sourceCurrency(svc(), { documentId: sale.id })).stale).toBe(false);
    const receiptVoucher = await generate(document.id, 'receipt', tax.id);
    const revenueVoucher = await generate(sale.id, 'revenue', tax.id);
    expect(receiptVoucher.lines.find((line) => line.accountId === bank.id)).toMatchObject({
      fcAmount: 113,
      credit: 802,
    });
    expect(revenueVoucher.lines.find((line) => line.accountId === bank.id)).toMatchObject({
      fcAmount: 113,
      debit: 802,
    });
    const { voucherDeletion: _deletion, ...cancellation } = await t.api.previewCancelCalculation();
    await t.api.cancelCalculation({ ...cancellation, confirmed: true });
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(false);
    expect((await sourceCurrency(svc(), { documentId: sale.id })).stale).toBe(false);
    expect(
      (
        await t.api.previewVoucher({
          documentId: document.id,
          purpose: 'receipt',
          taxAccountId: tax.id,
        })
      ).generationBlocker,
    ).toBeNull();
    expect(
      (
        await t.api.previewVoucher({
          documentId: sale.id,
          purpose: 'revenue',
          taxAccountId: tax.id,
        })
      ).generationBlocker,
    ).toBeNull();
  });

  it('真正修改来源数量后的失效原币不会被随后正式核算或取消洗白', async () => {
    const { document, bank } = await foreignReceipt();
    await saveForeign(document.id);
    await svc().tx((tx) =>
      tx.inventory.with((inventory) =>
        inventory.saveDocument({
          id: document.id,
          revision: document.revision,
          requestKey: randomUUID(),
          kind: 'receipt',
          warehouseId: t.warehouseId,
          number: 'FX-CHANGED',
          date: '2026-01-11',
          category: '采购',
          accountId: bank.id,
          costAccountId: t.ids.cost,
          taxRate: '13',
          lines: [{ productCode: 'F1', quantity: '1', unitPrice: '7.1' }],
        }),
      ),
    );
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(true);
    const calculation = await t.api.preview({ period: 202601 });
    await t.api.commit({
      period: 202601,
      fingerprint: calculation.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(true);
    await expect(
      t.api.previewVoucher({ documentId: document.id, purpose: 'receipt' }),
    ).rejects.toThrow(/重新核对/);
    const { voucherDeletion: _deletion, ...cancellation } = await t.api.previewCancelCalculation();
    await t.api.cancelCalculation({ ...cancellation, confirmed: true });
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(true);
  });

  it('原币资料在真实关闭和重新打开账套后恢复，可继续预览制证', async () => {
    const { document, tax } = await foreignReceipt();
    await saveForeign(document.id);
    await t.app.runtime.bookStore.close(t.app.book.id);
    expect(await t.api.sourceCurrency({ documentId: document.id })).toMatchObject({
      stale: false,
      data: { net_fc_cents: 100, tax_fc_cents: 13, gross_fc_cents: 113, exchange_rate: '7.1' },
    });
    const preview = await t.api.previewVoucher({
      documentId: document.id,
      purpose: 'receipt',
      taxAccountId: tax.id,
    });
    expect(preview.lines.find((line) => line.currency === 'USD')?.fcAmount).toBe(100);
  });

  it('删除未制证来源时级联清理原币资料，重建单据不会继承旧单原币', async () => {
    const { document } = await foreignReceipt();
    await saveForeign(document.id);
    await t.app.svcFor('inventory').tx((tx) =>
      tx.inventory.with((inventory) =>
        inventory.removeDocument({
          id: document.id,
          revision: document.revision,
          confirmed: true,
        }),
      ),
    );
    const rows = await sql<{
      total: number;
    }>`SELECT count(*) AS total FROM costing_source_currency WHERE document_id=${document.id}`.execute(
      t.app.svc.db,
    );
    expect(rows.rows[0]?.total).toBe(0);
    const replacement = await t.document('receipt', '1', '7.1');
    expect((await sourceCurrency(svc(), { documentId: replacement.id })).data).toBeNull();
  });

  it('保存真实来源原币，入库凭证保留净额、税额、价税合计及汇率，删除重生仍一致', async () => {
    const { document, stock, tax, bank } = await foreignReceipt();
    const target = { documentId: document.id, purpose: 'receipt' as const, taxAccountId: tax.id };
    await expect(t.api.previewVoucher(target)).rejects.toThrow(/没有对应原币金额/);
    await saveForeign(document.id);
    expect(await sourceCurrency(svc(), { documentId: document.id })).toMatchObject({
      stale: false,
      data: {
        currency: 'USD',
        exchange_rate: '7.1',
        net_fc_cents: 100,
        tax_fc_cents: 13,
        gross_fc_cents: 113,
        revision: 1,
      },
    });
    const voucher = await generate(document.id, 'receipt', tax.id);
    expect(voucher).toMatchObject({ debitTotal: 802, creditTotal: 802 });
    expect(voucher.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: stock.id,
          debit: 710,
          fcAmount: 100,
          currency: 'USD',
          exchangeRate: '7.1',
          quantity: '2',
        }),
        expect.objectContaining({ accountId: tax.id, debit: 92, fcAmount: 13 }),
        expect.objectContaining({ accountId: bank.id, credit: 802, fcAmount: 113 }),
      ]),
    );
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(false);
    await expect(saveForeign(document.id)).rejects.toThrow(/已有凭证/);
    const preview = await t.api.previewVoucher(target);
    const deletion = await t.api.previewVoucherDelete(target);
    const next = await t.api.regenerateVoucher({
      ...target,
      fingerprint: preview.fingerprint,
      expectedRevision: preview.expectedRevision,
      voucherTypeId: await typeId(),
      confirmed: true,
      voucherDeletion: { plan: deletion.plan, confirmed: true },
    });
    expect(next.lines.map((l) => l.fcAmount)).toEqual(voucher.lines.map((l) => l.fcAmount));
    // SQLite 可以复用已删除的最大主键；验证持久化后仅剩本次凭证及唯一来源关联。
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
    expect(await t.app.svc.vouchers.get(next.id)).toEqual(next);
    expect(
      (await t.api.voucherDocuments()).find((d) => d.documentId === document.id)?.sources,
    ).toEqual([expect.objectContaining({ voucherId: next.id, purpose: 'receipt' })]);
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(false);
  });

  it('两行原币分配整分尾差守恒，本币折算最多一分差异', async () => {
    const { document } = await foreignReceipt(
      [
        { productCode: 'F1', quantity: '1', unitPrice: '0.02' },
        { productCode: 'F1', quantity: '1', unitPrice: '0.02' },
      ],
      '0',
    );
    await saveForeign(document.id, {
      netFcCents: 3,
      taxFcCents: 0,
      grossFcCents: 3,
      exchangeRate: '1.5',
    });
    const voucher = await generate(document.id, 'receipt');
    expect(voucher.lines.map((l) => l.fcAmount)).toEqual([2, 1, 3]);
    expect(voucher).toMatchObject({ debitTotal: 4, creditTotal: 4 });
  });

  it('拒绝不平原币、错误折算、失效版本及本位币代码，失败不覆盖已保存资料', async () => {
    const { document } = await foreignReceipt();
    const base = {
      documentId: document.id,
      expectedRevision: document.revision,
      revision: 0,
      currency: 'USD',
      exchangeRate: '7.1',
      netFcCents: 100,
      taxFcCents: 13,
      grossFcCents: 113,
    };
    await expect(saveSourceCurrency(svc(), { ...base, grossFcCents: 114 })).rejects.toThrow(
      /加税额必须等于/,
    );
    await expect(saveSourceCurrency(svc(), { ...base, exchangeRate: '9' })).rejects.toThrow(/折算/);
    await expect(saveSourceCurrency(svc(), { ...base, currency: 'CNY' })).rejects.toThrow(
      /外币币种/,
    );
    await expect(saveSourceCurrency(svc(), { ...base, expectedRevision: 99 })).rejects.toThrow(
      /已经变化/,
    );
    await expect(saveSourceCurrency(svc(), { ...base, exchangeRate: '0' })).rejects.toThrow(
      /汇率必须/,
    );
    expect((await sourceCurrency(svc(), { documentId: document.id })).data).toBeNull();
    await saveSourceCurrency(svc(), base);
    await expect(saveSourceCurrency(svc(), base)).rejects.toThrow(/已被修改/);
    expect((await sourceCurrency(svc(), { documentId: document.id })).data?.revision).toBe(1);
    await t.app.svc.db
      .withTables<InventoryReadTables>()
      .updateTable('inventory_document')
      .set({ revision: sql`revision+1` })
      .where('id', '=', document.id)
      .execute();
    expect((await sourceCurrency(svc(), { documentId: document.id })).stale).toBe(true);
    await expect(
      t.api.previewVoucher({ documentId: document.id, purpose: 'receipt' }),
    ).rejects.toThrow(/重新核对/);
  });

  it('零成本单行数量凭证真实入账，审核过账后保留数量贷方方向', async () => {
    await t.opening('3', '0.003333');
    const first = await t.document('issue', '1', '10');
    await t.document('issue', '1', '10');
    await t.document('issue', '1', '10');
    const calculation = await t.api.preview({ period: 202601 });
    await t.api.commit({
      period: 202601,
      fingerprint: calculation.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    const preview = await t.api.previewVoucher({ documentId: first.id, purpose: 'cost' });
    expect(preview).toMatchObject({
      canGenerate: true,
      generationBlocker: null,
      debitCents: 0,
      creditCents: 0,
    });
    expect(preview.lines).toHaveLength(1);
    const voucher = await generate(first.id, 'cost');
    expect(voucher.lines).toEqual([
      expect.objectContaining({
        accountId: t.ids.stock,
        credit: 0,
        quantity: '1',
        entrySide: 'credit',
      }),
    ]);
    await t.app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await t.app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    const balances = await t.app.svc.ledger.quantityBalances({
      periodFrom: 202601,
      periodTo: 202601,
      accountCodes: ['1405'],
      quantityUnit: '件',
      rollup: false,
      includeZero: true,
    });
    expect(balances[0]?.qtyClosing).toBe('-1');
  });
});

describe('w_cb_pz：日期范围逐单制证与完整结果', () => {
  async function filter(purpose: 'receipt' | 'revenue' | 'cost' = 'receipt') {
    return { from: '2026-01-01', to: '2026-02-28', purpose, voucherTypeId: await typeId() };
  }
  it('逐条列出失败、已生成跳过与审核跳过，只有成功项使用手工起始编号', async () => {
    await t.document('receipt', '1', '1', { date: '2026-01-05', taxRate: '13' });
    const good = await t.document('receipt', '1', '1', { date: '2026-01-10' });
    const existing = await t.document('receipt', '1', '1', { date: '2026-01-15' });
    const audited = await t.document('receipt', '1', '1', { date: '2026-01-20' });
    await generate(existing.id, 'receipt');
    const locked = await generate(audited.id, 'receipt');
    await t.app.svc.vouchers.changeStatus({ ids: [locked.id], to: 'audited' });
    await t.app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const input = { ...(await filter()), startNumber: 10 };
    const preview = await previewVoucherBatch(svc(), input);
    expect(preview.rows.map((r) => r.action)).toEqual(['failed', 'generate', 'skip', 'skip']);
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 1, failed: 1, skipped: 2 });
    const created = result.results.find((r) => r.status === 'generated')!;
    expect(await t.app.svc.vouchers.get(created.voucherId!)).toMatchObject({
      number: 10,
      source: { id: String(good.id) },
    });
    expect(await t.app.svc.vouchers.get(locked.id)).toMatchObject({ status: 'audited' });
    await expect(
      executeVoucherBatch(svc(), { ...input, fingerprint: preview.fingerprint, confirmed: true }),
    ).rejects.toThrow(/已变化/);
    expect((await t.app.svc.vouchers.list()).total).toBe(3);
  });

  it('真实来源写入失败回滚本张凭证和编号，继续下一张并复用未占用手工号', async () => {
    const broken = await t.document('receipt', '1', '1', { date: '2026-01-05' });
    const good = await t.document('receipt', '1', '2', { date: '2026-01-06' });
    await t.app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    await sql
      .raw(
        `CREATE TRIGGER costing_synthetic_source_failure BEFORE INSERT ON inventory_voucher_source WHEN NEW.document_id=${broken.id} BEGIN SELECT RAISE(ABORT, '合成来源写入失败'); END`,
      )
      .execute(t.app.svc.db);
    const input = { ...(await filter()), startNumber: 30 };
    const preview = await previewVoucherBatch(svc(), input);
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 1, failed: 1, skipped: 0 });
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('合成来源写入失败'),
    });
    expect((await t.app.svc.vouchers.list()).items).toEqual([
      expect.objectContaining({
        number: 30,
        source: { module: 'costing', type: 'receipt', id: String(good.id) },
      }),
    ]);
    expect(
      (await t.api.voucherDocuments()).find((d) => d.documentId === broken.id)?.sources,
    ).toEqual([]);
    await sql.raw('DROP TRIGGER costing_synthetic_source_failure').execute(t.app.svc.db);
    const retry = await previewVoucherBatch(svc(), { ...input, startNumber: 31 });
    const retried = await executeVoucherBatch(svc(), {
      ...input,
      startNumber: 31,
      fingerprint: retry.fingerprint,
      confirmed: true,
    });
    expect(retried).toMatchObject({ succeeded: 1, failed: 0, skipped: 1 });
  });

  it('批量显式跳过发票收入，普通销售收入可入账，跨月保留来源月份', async () => {
    await t.opening();
    const invoice = await t.document('issue', '1', '1', { date: '2026-01-05' });
    await t.app.svc.db
      .withTables<InventoryReadTables>()
      .updateTable('inventory_document')
      .set({ source_type: 'invoice', source_id: 7001, revision: sql`revision+1` })
      .where('id', '=', invoice.id)
      .execute();
    await t.document('issue', '1', '2', { date: '2026-01-06' });
    await t.document('issue', '1', '3', { date: '2026-02-06' });
    const input = await filter('revenue');
    const preview = await previewVoucherBatch(svc(), input);
    expect(preview.rows[0]).toMatchObject({
      action: 'skip',
      message: expect.stringContaining('销售发票'),
    });
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 2, failed: 0, skipped: 1 });
    const vouchers = await t.app.svc.vouchers.list();
    expect(vouchers.items.map((v) => v.period).sort()).toEqual([202601, 202602]);
    expect(
      (await t.api.voucherDocuments()).find((d) => d.documentId === invoice.id)?.sources,
    ).toEqual([]);
  });

  it('旧批量预览与未确认请求拒绝；重新生成失败完整保留原凭证及关联', async () => {
    const document = await t.document('receipt', '1', '1');
    const input = await filter();
    const before = await previewVoucherBatch(svc(), input);
    const other = await setup();
    try {
      await other.inventory.saveDocument({
        requestKey: randomUUID(),
        kind: 'receipt',
        warehouseId: other.warehouseId,
        number: document.number,
        date: '2026-01-10',
        category: '采购',
        accountId: other.ids.cash,
        costAccountId: other.ids.cost,
        taxRate: '0',
        lines: [{ productCode: 'P1', quantity: '1', unitPrice: '1' }],
      });
      await expect(
        other.api.executeVoucherBatch({
          ...input,
          fingerprint: before.fingerprint,
          confirmed: true,
        }),
      ).rejects.toThrow(/已变化/);
      expect((await other.app.svc.vouchers.list()).total).toBe(0);
    } finally {
      await other.app.close();
    }
    const second = caller(t.app, await t.app.addUser('batch-other', { isAdmin: true }));
    await expect(
      second.executeVoucherBatch({ ...input, fingerprint: before.fingerprint, confirmed: true }),
    ).rejects.toThrow(/已变化/);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    await expect(
      executeVoucherBatch(svc(), { ...input, fingerprint: before.fingerprint, confirmed: false }),
    ).rejects.toThrow(/确认/);
    await t.document('receipt', '1', '2');
    await expect(
      executeVoucherBatch(svc(), { ...input, fingerprint: before.fingerprint, confirmed: true }),
    ).rejects.toThrow(/已变化/);
    const original = await generate(document.id, 'receipt');
    const regeneration = { ...input, regenerate: true, voucherTypeId: 999999 };
    const plan = await previewVoucherBatch(svc(), regeneration);
    const fingerprint = (await readInventory(svc(), 202602)).fingerprint;
    const result = await executeVoucherBatch(svc(), {
      ...regeneration,
      fingerprint: plan.fingerprint,
      confirmed: true,
    });
    expect(result.failed).toBe(2);
    expect(await t.app.svc.vouchers.get(original.id)).toMatchObject({
      id: original.id,
      debitTotal: 100,
      status: 'pending',
    });
    expect((await readInventory(svc(), 202602)).fingerprint).toBe(fingerprint);
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
  });
});
