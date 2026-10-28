import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createCoreServices, type CoreServices } from '@caiwu/core/server';
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
  it.each([
    [false, 2],
    [false, 3],
    [true, 2],
    [true, 3],
  ] as const)('删除后重排=%s，%i 张真实入库凭证在同一批内全部重新生成', async (renumber, count) => {
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: renumber,
      allowModifyOthers: true,
    });
    const documents: Awaited<ReturnType<typeof t.document>>[] = [];
    for (let i = 0; i < count; i++) {
      const document = await t.document('receipt', '1', String(i + 1));
      documents.push(document);
      await generate(document.id, 'receipt');
    }
    const input = { ...(await filter()), regenerate: true };
    const preview = await previewVoucherBatch(svc(), input);
    expect(preview.rows.map((r) => r.action)).toEqual(documents.map(() => 'regenerate'));
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result, JSON.stringify(result.results)).toMatchObject({
      succeeded: count,
      failed: 0,
      skipped: 0,
    });
    expect((await t.app.svc.vouchers.list()).total).toBe(count);
    for (const document of documents) {
      expect(
        (await t.api.voucherDocuments()).find((d) => d.documentId === document.id)?.sources,
      ).toHaveLength(1);
    }
  });

  it('三张重生成预览含后续对本批新凭证的完整映射，未确认时不写入', async () => {
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const documents: Awaited<ReturnType<typeof t.document>>[] = [];
    const originals: Awaited<ReturnType<typeof generate>>[] = [];
    for (let i = 0; i < 3; i++) {
      const document = await t.document('receipt', '1', String(i + 1));
      documents.push(document);
      originals.push(await generate(document.id, 'receipt'));
    }
    const input = { ...(await filter()), regenerate: true };
    const before = await t.app.svc.vouchers.list();
    const inventoryBefore = (await readInventory(svc(), 202602)).fingerprint;
    const preview = await previewVoucherBatch(svc(), input);
    const mappings = preview.rows.map((row) =>
      row.numbering!.impacts.map(({ key, oldNumber, number }) => [key, oldNumber, number]),
    );
    expect(mappings).toEqual([
      [
        [`voucher:${originals[1]!.id}`, 2, 1],
        [`voucher:${originals[2]!.id}`, 3, 2],
      ],
      [
        [`voucher:${originals[2]!.id}`, 2, 1],
        [`new:receipt:${documents[0]!.id}`, 3, 2],
      ],
      [
        [`new:receipt:${documents[0]!.id}`, 2, 1],
        [`new:receipt:${documents[1]!.id}`, 3, 2],
      ],
    ]);
    expect(preview.rows.map((row) => row.numbering!.created.number)).toEqual([3, 3, 3]);
    await expect(
      executeVoucherBatch(svc(), { ...input, fingerprint: preview.fingerprint, confirmed: false }),
    ).rejects.toThrow(/确认/);
    expect(await t.app.svc.vouchers.list()).toEqual(before);
    expect((await readInventory(svc(), 202602)).fingerprint).toBe(inventoryBefore);
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result.succeeded).toBe(3);
    expect(result.results.map((row) => row.displayNo)).toEqual(originals.map((v) => v.displayNo));
    for (let i = 0; i < 3; i++) {
      const voucher = (await t.app.svc.vouchers.list()).items.find(
        (v) => v.source?.id === String(documents[i]!.id),
      );
      expect(voucher).toMatchObject({ number: i + 1, revision: 3 - i });
    }
  });

  it('混合首次生成与重生成跨月执行，后项映射包含前项新凭证且保留各月编号', async () => {
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const first = await t.document('receipt', '1', '1', { date: '2026-01-05' });
    const second = await t.document('receipt', '1', '2', { date: '2026-01-06' });
    const third = await t.document('receipt', '1', '3', { date: '2026-02-06' });
    await generate(second.id, 'receipt');
    await generate(third.id, 'receipt');
    const input = { ...(await filter()), regenerate: true };
    const preview = await previewVoucherBatch(svc(), input);
    expect(preview.rows.map((row) => row.action)).toEqual(['generate', 'regenerate', 'regenerate']);
    expect(preview.rows[1]!.numbering!.impacts).toEqual([
      expect.objectContaining({ key: `new:receipt:${first.id}`, oldNumber: 2, number: 1 }),
    ]);
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 3, failed: 0, skipped: 0 });
    const vouchers = (await t.app.svc.vouchers.list()).items;
    expect(vouchers.find((v) => v.source?.id === String(first.id))).toMatchObject({
      period: 202601,
      number: 1,
      revision: 2,
    });
    expect(vouchers.find((v) => v.source?.id === String(second.id))).toMatchObject({
      period: 202601,
      number: 2,
    });
    expect(vouchers.find((v) => v.source?.id === String(third.id))).toMatchObject({
      period: 202602,
      number: 1,
    });
    expect(vouchers).toHaveLength(3);
  });

  it('手工编号同时启用删除后重排时按已确认步骤保存，结果反映后续重排后的最终字号', async () => {
    for (let i = 0; i < 3; i++) {
      const document = await t.document('receipt', '1', String(i + 1));
      await generate(document.id, 'receipt');
    }
    await t.app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const input = { ...(await filter()), regenerate: true, startNumber: 10 };
    const preview = await previewVoucherBatch(svc(), input);
    expect(preview.rows.map((r) => r.numbering!.created.number)).toEqual([10, 11, 12]);
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 3, failed: 0, skipped: 0 });
    for (const row of result.results)
      expect(await t.app.svc.vouchers.get(row.voucherId!)).toMatchObject({
        displayNo: row.displayNo,
      });
    expect(
      (await t.app.svc.vouchers.list()).items.map((v) => v.number).sort((a, b) => a! - b!),
    ).toEqual([1, 2, 12]);
  });

  it.each([false, true])(
    '重排=%s 时预览后外部同号修改仍拒绝旧确认',
    async (renumberAfterDelete) => {
      await t.app.svc.voucherPolicy.set({
        numbering: 'automatic',
        renumberAfterDelete,
        allowModifyOthers: true,
      });
      const document = await t.document('receipt', '1', '1');
      const original = await generate(document.id, 'receipt');
      const input = { ...(await filter()), regenerate: true };
      const preview = await previewVoucherBatch(svc(), input);
      const changed = await svc().vouchers.update(
        original.id,
        { ...original, source: original.source ?? undefined, note: '预览后外部修改' },
        { expectedRevision: original.revision },
      );
      await expect(
        executeVoucherBatch(svc(), { ...input, fingerprint: preview.fingerprint, confirmed: true }),
      ).rejects.toThrow(/已变化/);
      expect(await t.app.svc.vouchers.get(original.id)).toEqual(changed);
      expect((await t.app.svc.vouchers.list()).total).toBe(1);
    },
  );

  it.each([
    ['预览后', '金额'],
    ['预览后', '摘要'],
    ['预览后', '同内容'],
    ['执行中', '金额'],
    ['执行中', '摘要'],
    ['执行中', '同内容'],
  ] as const)(
    '%s 删除最大 ID 后同 actor、同时间、同版本重建的 ABA（%s）不能沿用旧确认',
    async (phase, change) => {
      await t.app.svc.voucherPolicy.set({
        numbering: 'automatic',
        renumberAfterDelete: true,
        allowModifyOthers: true,
      });
      const document = await t.document('receipt', '1', '1');
      const target = await generate(document.id, 'receipt');
      const external = createCoreServices({
        ...t.app.svc.ctx,
        now: () => new Date('2026-10-28T15:00:00.000Z'),
      });
      const outsideInput = {
        date: '2026-01-12',
        voucherTypeId: await typeId(),
        lines: [
          { accountId: t.ids.cash, summary: '原手工凭证', debit: 200 },
          { accountId: t.ids.sales, summary: '原手工凭证', credit: 200 },
        ],
      };
      const outside = await external.vouchers.create(outsideInput);
      expect(target).toMatchObject({ id: 1, number: 1, revision: 1 });
      expect(outside).toMatchObject({ id: 2, number: 2, revision: 1, source: null });
      const input = { ...(await filter()), regenerate: true };
      const preview = await previewVoucherBatch(svc(), input);
      const replace = async () => {
        const deletion = await external.vouchers.previewDelete([outside.id]);
        await external.vouchers.deleteBatch(deletion, true);
        const replacement = await external.vouchers.create({
          ...outsideInput,
          lines: outsideInput.lines.map((line) => ({
            ...line,
            summary: change === '摘要' ? '已替换摘要' : line.summary,
            ...(change === '金额'
              ? {
                  ...(line.debit == null ? {} : { debit: 900 }),
                  ...(line.credit == null ? {} : { credit: 900 }),
                }
              : {}),
          })),
        });
        // 真实删除、真实新增；SQLite 复用凭证和分录最大 ID，创建时间也刻意完全相同。
        expect(replacement).toMatchObject({
          id: outside.id,
          number: outside.number,
          revision: outside.revision,
          source: null,
          createdBy: outside.createdBy,
          createdAt: outside.createdAt,
          updatedAt: outside.updatedAt,
        });
        expect(replacement.lines.map((line) => line.id)).toEqual(
          outside.lines.map((line) => line.id),
        );
        if (change === '同内容') expect(replacement).toEqual(outside);
        return replacement;
      };
      const confirmation = { ...input, fingerprint: preview.fingerprint, confirmed: true };
      if (phase === '预览后') {
        await replace();
        await expect(executeVoucherBatch(svc(), confirmation)).rejects.toThrow(/已变化/);
      } else {
        const base = svc();
        let transactions = 0;
        const concurrent: CoreServices = {
          ...base,
          async tx(fn) {
            if (++transactions === 2) await replace();
            return base.tx(fn);
          },
        };
        const result = await executeVoucherBatch(concurrent, confirmation);
        expect(result, JSON.stringify(result.results)).toMatchObject({
          succeeded: 0,
          failed: 1,
          skipped: 0,
        });
        expect(result.results[0]?.message).toMatch(/已变化/);
      }
      expect(await t.app.svc.vouchers.get(target.id)).toEqual(target);
      expect(await t.app.svc.vouchers.get(outside.id)).toMatchObject({ number: 2, revision: 1 });
      expect((await t.app.svc.vouchers.list()).total).toBe(2);
      expect(
        (await t.api.voucherDocuments()).find((d) => d.documentId === document.id)?.sources,
      ).toHaveLength(1);
      const fresh = await previewVoucherBatch(svc(), input);
      expect(
        await executeVoucherBatch(svc(), {
          ...input,
          fingerprint: fresh.fingerprint,
          confirmed: true,
        }),
      ).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 });
      expect((await t.app.svc.vouchers.list()).total).toBe(2);
    },
  );

  it.each(['内容', '编号', '审核', '新增'] as const)(
    '执行中外部%s变化不会混入本批重排或自动扩大确认',
    async (change) => {
      await t.app.svc.voucherPolicy.set({
        numbering: 'automatic',
        renumberAfterDelete: true,
        allowModifyOthers: true,
      });
      const documents: Awaited<ReturnType<typeof t.document>>[] = [];
      for (let i = 0; i < 2; i++) {
        const document = await t.document('receipt', '1', String(i + 1));
        documents.push(document);
        await generate(document.id, 'receipt');
      }
      // 非本批来源的凭证也在完整删除影响集合内；即使分录金额和本单 links 不变也要拒绝。
      const outside = await t.app.svc.vouchers.create({
        date: '2026-01-12',
        voucherTypeId: await typeId(),
        lines: [
          { accountId: t.ids.cash, summary: '外部凭证', debit: 100 },
          { accountId: t.ids.sales, summary: '外部凭证', credit: 100 },
        ],
      });
      const input = { ...(await filter()), regenerate: true };
      const preview = await previewVoucherBatch(svc(), input);
      const base = svc();
      let transactions = 0;
      const concurrent: CoreServices = {
        ...base,
        async tx(fn) {
          if (++transactions === 3) {
            const current = (await t.app.svc.vouchers.get(outside.id))!;
            if (change === '内容')
              await t.app.svc.vouchers.update(
                current.id,
                { ...current, source: undefined, note: '外部修改', lines: current.lines },
                { expectedRevision: current.revision },
              );
            if (change === '编号') {
              const plan = await t.app.svc.vouchers.previewNumbers([
                { id: current.id, number: 10 },
              ]);
              await t.app.svc.vouchers.setNumbers(plan.updates, { plan, confirmed: true });
            }
            if (change === '审核')
              await t.app.svc.vouchers.changeStatus({ ids: [current.id], to: 'audited' });
            if (change === '新增')
              await t.app.svc.vouchers.create({
                ...current,
                number: undefined,
                source: undefined,
                lines: current.lines,
              });
          }
          return base.tx(fn);
        },
      };
      const result = await executeVoucherBatch(concurrent, {
        ...input,
        fingerprint: preview.fingerprint,
        confirmed: true,
      });
      expect(result).toMatchObject({ succeeded: 1, failed: 1, skipped: 0 });
      expect(result.results[1]).toMatchObject({
        status: 'failed',
        message: expect.stringContaining('已变化'),
      });
      const secondLink = (await t.api.voucherDocuments()).find(
        (d) => d.documentId === documents[1]!.id,
      )!.sources[0]!;
      expect(await t.app.svc.vouchers.get(secondLink.voucherId)).toMatchObject({
        source: { id: String(documents[1]!.id) },
        number: 1,
        revision: 2,
      });
      expect((await t.app.svc.vouchers.list()).total).toBe(change === '新增' ? 4 : 3);
    },
  );

  it('批量预览后外部改动未关联来源，即使金额不变也要求重新预览', async () => {
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const first = await t.document('receipt', '1', '1', { date: '2026-01-05' });
    const second = await t.document('receipt', '1', '2', { date: '2026-01-06' });
    await generate(first.id, 'receipt');
    const input = { ...(await filter()), regenerate: true };
    const preview = await previewVoucherBatch(svc(), input);
    const base = svc();
    let transactions = 0;
    const concurrent: CoreServices = {
      ...base,
      async tx(fn) {
        if (++transactions === 3)
          await base.tx((tx) =>
            tx.inventory.with((inventory) =>
              inventory.saveDocument({
                id: second.id,
                revision: second.revision,
                requestKey: randomUUID(),
                kind: 'receipt',
                warehouseId: t.warehouseId,
                number: '外部改过来源单号',
                date: '2026-01-06',
                category: '采购',
                accountId: t.ids.cash,
                costAccountId: t.ids.cost,
                taxRate: '0',
                lines: [{ productCode: 'P1', quantity: '1', unitPrice: '2' }],
              }),
            ),
          );
        return base.tx(fn);
      },
    };
    const result = await executeVoucherBatch(concurrent, {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 1, failed: 1, skipped: 0 });
    expect(result.results[1]?.message).toMatch(/来源或凭证已变化/);
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
    expect(
      (await t.api.voucherDocuments()).find((d) => d.documentId === second.id)?.sources,
    ).toEqual([]);
  });

  it('重生成中间项真实写入失败回滚重排，偏离预览的后项需重预览，重试后无重复制证', async () => {
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const documents: Awaited<ReturnType<typeof t.document>>[] = [];
    const originals: Awaited<ReturnType<typeof generate>>[] = [];
    for (let i = 0; i < 3; i++) {
      const document = await t.document('receipt', '1', String(i + 1), {
        date: `2026-01-0${i + 5}`,
      });
      documents.push(document);
      originals.push(await generate(document.id, 'receipt'));
    }
    await sql
      .raw(
        `CREATE TRIGGER costing_batch_regenerate_failure BEFORE INSERT ON inventory_voucher_source WHEN NEW.document_id=${documents[1]!.id} BEGIN SELECT RAISE(ABORT, '合成重生成失败'); END`,
      )
      .execute(t.app.svc.db);
    const input = { ...(await filter()), regenerate: true };
    const preview = await previewVoucherBatch(svc(), input);
    const result = await executeVoucherBatch(svc(), {
      ...input,
      fingerprint: preview.fingerprint,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 1, failed: 2, skipped: 0 });
    expect(result.results[1]?.message).toMatch(/合成重生成失败/);
    expect(result.results[2]?.message).toMatch(/逐步映射不一致/);
    expect(await t.app.svc.vouchers.get(originals[1]!.id)).toMatchObject({
      number: 1,
      revision: 2,
      debitTotal: 200,
    });
    expect(await t.app.svc.vouchers.get(originals[2]!.id)).toMatchObject({
      number: 2,
      revision: 2,
      debitTotal: 300,
    });
    await expect(
      executeVoucherBatch(svc(), { ...input, fingerprint: preview.fingerprint, confirmed: true }),
    ).rejects.toThrow(/已变化/);
    expect((await t.app.svc.vouchers.list()).total).toBe(3);
    await sql.raw('DROP TRIGGER costing_batch_regenerate_failure').execute(t.app.svc.db);
    const retryInput = { ...input, from: '2026-01-06' };
    const retry = await previewVoucherBatch(svc(), retryInput);
    expect(
      await executeVoucherBatch(svc(), {
        ...retryInput,
        fingerprint: retry.fingerprint,
        confirmed: true,
      }),
    ).toMatchObject({ succeeded: 2, failed: 0, skipped: 0 });
    const ordinary = { ...input, regenerate: false };
    const last = await previewVoucherBatch(svc(), ordinary);
    expect(
      await executeVoucherBatch(svc(), {
        ...ordinary,
        fingerprint: last.fingerprint,
        confirmed: true,
      }),
    ).toMatchObject({ succeeded: 0, failed: 0, skipped: 3 });
    expect((await t.app.svc.vouchers.list()).total).toBe(3);
    for (const document of documents)
      expect(
        (await t.api.voucherDocuments()).find((d) => d.documentId === document.id)?.sources,
      ).toHaveLength(1);
  });
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
