import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sumCents } from '@caiwu/core';
import { seedVouchers } from '@caiwu/testkit';
import { allocateCents } from '../server/allocation';
import type { CostingTables } from '../server/migrations';
import { caller, setup } from './fixtures';
import { previewProduction, saveProduction } from '../server/production';
import { saveProfitConfig } from '../server/profit-allocation';
import { commitCalculation } from '../server/formal';
import { costingService } from '../server/service';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.app.close();
});

async function accounts() {
  const values = [];
  for (const [code, name] of [
    ['500101', '直接材料'],
    ['500102', '直接人工'],
    ['500103', '制造费用'],
  ] as const)
    values.push(
      await t.app.svc.accounts.create(
        { code, name, categoryId: 'cost', dimensions: [] },
        t.app.book.codeScheme,
      ),
    );
  return {
    materialAccountId: values[0]!.id,
    laborAccountId: values[1]!.id,
    overheadAccountId: values[2]!.id,
  };
}
async function seedProduction(amounts = [101, 102, 103]) {
  const ids = await accounts();
  await seedVouchers(t.app.svc, [
    {
      date: '2026-01-05',
      lines: [
        ...['500101', '500102', '500103'].flatMap((account, i) =>
          amounts[i] ? [{ account, debit: amounts[i] }] : [],
        ),
        { account: '1001', credit: sumCents(amounts) },
      ],
    },
  ]);
  return ids;
}
async function productionInput(ids: Awaited<ReturnType<typeof accounts>>, quantity = '1') {
  const context = await t.api.productionContext();
  return {
    date: '2026-01-20',
    warehouseId: t.warehouseId,
    ...ids,
    rows: [{ productId: context.products[0]!.id, quantity }],
  };
}
async function saveInput(input: Awaited<ReturnType<typeof productionInput>>) {
  const preview = await t.api.previewProduction(input);
  return {
    ...input,
    fingerprint: preview.fingerprint,
    requestKey: randomUUID(),
    voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
    confirmed: true,
  };
}
async function profitSettings() {
  const tax = await t.app.svc.accounts.create(
    { code: '6403', name: '税金及附加', categoryId: 'pnl' },
    t.app.book.codeScheme,
  );
  return {
    period: 202601,
    expenseAccountId: (await t.app.svc.accounts.require('6601')).id,
    surchargeAccountId: tax.id,
    profitAccountId: (await t.app.svc.accounts.require('4103')).id,
    revision: 0,
  };
}

describe('w_cb_pz.wf_wgrk / zx_cbfpb 生产成本归集与完工入库', () => {
  it('拒绝其它模块身份，产品与数量科目单位不同也不允许入库', async () => {
    const ids = await seedProduction();
    const input = await productionInput(ids);
    const request = await saveInput(input);
    const wrong = t.app.svcFor('inventory');
    await expect(previewProduction(wrong, input)).rejects.toThrow(/从成本核算/);
    await expect(saveProduction(wrong, request)).rejects.toThrow(/从成本核算/);
    await expect(saveProfitConfig(wrong, await profitSettings())).rejects.toThrow(/从成本核算/);
    const calculation = await t.api.preview({ period: 202601 });
    await expect(
      commitCalculation(wrong, {
        period: 202601,
        fingerprint: calculation.fingerprint,
        requestKey: randomUUID(),
        confirmed: true,
      }),
    ).rejects.toThrow(/从成本核算/);
    expect(() => costingService(wrong)).toThrow(/从成本核算/);
    await t.inventory.saveProduct({
      code: 'KG',
      name: '千克产品',
      unit: '千克',
      inventoryAccountId: t.ids.stock,
      salesAccountId: t.ids.sales,
    });
    const product = (await t.api.productionContext()).products.find((p) => p.code === 'KG')!;
    await expect(
      t.api.previewProduction({ ...input, rows: [{ productId: product.id, quantity: '1' }] }),
    ).rejects.toThrow(/单位.*不同/);
    expect((await t.api.productionContext()).saved).toHaveLength(0);
    expect((await t.app.svcFor('costing').inventory.snapshot(202601)).documents).toHaveLength(0);
  });
  it('真实保护恢复承接完工成本、库存凭证、归集配置、原币和非法输入草稿', async () => {
    const ids = await seedProduction([100, 200, 300]);
    const record = await t.api.saveProduction(await saveInput(await productionInput(ids, '3')));
    const config = await profitSettings();
    await t.api.saveProfitConfig(config);
    const receipt = await t.document('receipt', '1', '7.1');
    const fx = {
      documentId: receipt.id,
      expectedRevision: receipt.revision,
      revision: 0,
      currency: 'USD',
      exchangeRate: '7.1',
      netFcCents: 100,
      taxFcCents: 0,
      grossFcCents: 100,
    };
    await t.api.saveSourceCurrency(fx);
    const draft = {
      date: '2026-01-31',
      warehouseId: t.warehouseId,
      ...ids,
      rows: [
        {
          productId: (await t.api.productionContext()).products[0]!.id,
          quantity: '1..2',
          factor: '0.',
        },
      ],
      requestKey: randomUUID(),
    };
    await t.api.saveProductionDraft(draft);
    const bytes = t.app.runtime.bookStore.open(t.app.book.id).raw.serialize();
    const deletion = await t.api.previewCancelProduction({ id: record.id });
    await t.api.cancelProduction({
      ...deletion,
      confirmed: true,
      voucherDeletion: { plan: deletion.plan, confirmed: true },
    });
    await t.api.saveProfitConfig({ ...config, revision: 1 });
    await t.api.saveSourceCurrency({
      ...fx,
      revision: 1,
      exchangeRate: '14.2',
      netFcCents: 50,
      grossFcCents: 50,
    });
    await t.api.saveProductionDraft({ ...draft, rows: [{ ...draft.rows[0]!, quantity: '9..9' }] });
    const token = await t.app.login();
    const ticket = await t.app.runtime.bookStore.prepareReplacement({
      bookId: t.app.book.id,
      bytes,
      length: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      expectedRevision: t.app.runtime.bookStore.revision(t.app.book.id),
      expiresAt: Date.now() + 60000,
    });
    await t.app.runtime.lifecycle.maintainBook({
      token,
      bookId: t.app.book.id,
      permission: 'costing.calculate',
      confirmation: { bookId: t.app.book.id, bookName: t.app.book.name, password: 'admin' },
      authorize: async () => {},
      plan: { kind: 'replace', replacementId: ticket.replacementId },
    });
    expect(t.app.runtime.sessions.get(token)).toBeNull();
    const api = caller(t.app, await t.app.login());
    expect((await api.productionContext()).saved[0]).toMatchObject({
      id: record.id,
      status: 'saved',
      document_id: record.document_id,
      voucher_id: record.voucher_id,
    });
    expect((await api.profitConfig({ period: 202601 }))?.revision).toBe(1);
    expect((await api.sourceCurrency({ documentId: receipt.id })).data).toMatchObject({
      net_fc_cents: 100,
      gross_fc_cents: 100,
      exchange_rate: '7.1',
      revision: 1,
    });
    expect(await api.productionDraft()).toEqual(draft);
    const restored = t.app.runtime.bookStore.open(t.app.book.id).raw;
    expect(
      restored
        .prepare('SELECT net_cents FROM inventory_line WHERE document_id=?')
        .get(record.document_id),
    ).toMatchObject({ net_cents: 600 });
    expect(
      restored
        .prepare('SELECT debit FROM voucher_line WHERE voucher_id=? AND debit>0')
        .get(record.voucher_id),
    ).toMatchObject({ debit: 600 });
  });
  it('三类费用分别守恒，整分尾差分配后库存、凭证和已存分摊一致，取消还原', async () => {
    const ids = await seedProduction();
    await t.inventory.saveProduct({
      code: 'P2',
      name: '产品二',
      inventoryAccountId: t.ids.stock,
      salesAccountId: t.ids.sales,
    });
    await t.inventory.saveProduct({
      code: 'P3',
      name: '产品三',
      inventoryAccountId: t.ids.stock,
      salesAccountId: t.ids.sales,
    });
    const context = await t.api.productionContext();
    const input = {
      date: '2026-01-20',
      warehouseId: t.warehouseId,
      ...ids,
      rows: context.products.map((p) => ({ productId: p.id, quantity: '1', factor: '1' })),
    };
    const preview = await t.api.previewProduction(input);
    expect(preview.rows.map((r) => r.materialCents)).toEqual([34, 33, 34]);
    expect(preview.rows.map((r) => r.laborCents)).toEqual([34, 34, 34]);
    expect(preview.rows.map((r) => r.overheadCents)).toEqual([34, 35, 34]);
    expect(preview.totalCents).toBe(306);
    const request = await saveInput(input);
    const record = await t.api.saveProduction(request);
    expect(await t.api.saveProduction(request)).toEqual(record);
    const saved = await t.app.svcFor('costing').inventory.snapshot(202601);
    expect(
      saved.movements.filter((r) => r.documentId === record.document_id).map((r) => r.netCents),
    ).toEqual([102, 102, 102]);
    expect(
      (await t.app.svc.vouchers.get(record.voucher_id!))?.lines
        .filter((l) => l.credit > 0)
        .map((l) => l.credit),
    ).toEqual([101, 102, 103]);
    await expect(
      t.api.previewVoucher({ documentId: record.document_id!, purpose: 'receipt' }),
    ).rejects.toThrow(/生产|完工/);
    const deletion = await t.api.previewCancelProduction({ id: record.id });
    await t.api.cancelProduction({
      ...deletion,
      confirmed: true,
      voucherDeletion: { plan: deletion.plan, confirmed: true },
    });
    expect((await t.app.svcFor('costing').inventory.snapshot(202601)).documents).toHaveLength(0);
    expect(await t.app.svc.vouchers.get(record.voucher_id!)).toBeNull();
    expect(
      (
        await t.app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['5001'],
          rollup: false,
          includeUnposted: true,
        })
      ).map((r) => r.closing),
    ).toEqual([101, 102, 103]);
  });
  it('产品默认系数生效，接近零系数恢复为1；重复产品、零数量及非明细成本科目拒绝', async () => {
    const ids = await seedProduction([1, 1, 1]);
    await t.inventory.saveProduct({
      code: 'P2',
      name: '双系数产品',
      inventoryAccountId: t.ids.stock,
      salesAccountId: t.ids.sales,
      allocationFactor: '2',
    });
    const context = await t.api.productionContext();
    const defaults = await t.api.previewProduction({
      date: '2026-01-20',
      warehouseId: t.warehouseId,
      ...ids,
      rows: context.products.map((p) => ({ productId: p.id, quantity: '1' })),
    });
    expect(defaults.rows.map((r) => r.factor)).toEqual(['1', '2']);
    expect(defaults.rows.map((r) => r.totalCents)).toEqual([0, 3]);
    const input = await productionInput(ids);
    const zero = await t.api.previewProduction({
      ...input,
      rows: [{ ...input.rows[0]!, factor: '0' }],
    });
    expect(zero.rows[0]!.factor).toBe('1');
    await expect(
      t.api.previewProduction({ ...input, rows: [input.rows[0]!, input.rows[0]!] }),
    ).rejects.toThrow(/只能录入一行/);
    await expect(
      t.api.previewProduction({ ...input, rows: [{ ...input.rows[0]!, quantity: '0' }] }),
    ).rejects.toThrow(/数量必须大于零/);
    await expect(
      t.api.previewProduction({
        ...input,
        materialAccountId: (await t.app.svc.accounts.require('5001')).id,
      }),
    ).rejects.toThrow(/明细科目/);
  });
  it('失效预览、并发重复、未知权限及未确认不写入；长请求编号仍可重试', async () => {
    const ids = await seedProduction();
    const input = await productionInput(ids);
    const request = await saveInput(input);
    await expect(t.api.saveProduction({ ...request, confirmed: false })).rejects.toThrow(/确认/);
    const clerk = caller(t.app, await t.app.addUser('no-cost', { permissions: ['costing.view'] }));
    await expect(clerk.saveProduction(request)).rejects.toThrow();
    const long = { ...request, requestKey: 'x'.repeat(100) };
    const results = await Promise.allSettled([
      t.api.saveProduction(long),
      t.api.saveProduction(long),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await t.api.productionContext()).saved).toHaveLength(1);
    await expect(t.api.saveProduction({ ...request, requestKey: randomUUID() })).rejects.toThrow(
      /没有可分配余额|已变化/,
    );
  });
  it('入库后凭证编号冲突全部回滚，来源费用余额保留', async () => {
    const ids = await seedProduction();
    await t.app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const input = await saveInput(await productionInput(ids));
    await expect(t.api.saveProduction({ ...input, number: 1 })).rejects.toThrow(/编号|重复/);
    expect((await t.api.productionContext()).saved).toHaveLength(0);
    expect((await t.app.svcFor('costing').inventory.snapshot(202601)).documents).toHaveLength(0);
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
  });
  it('无法准确表示的单价拒绝，不让高数量入库漂移一分钱', async () => {
    const ids = await seedProduction([1, 0, 0]);
    const input = await productionInput(ids, '1000000');
    await expect(t.api.previewProduction(input)).rejects.toThrow(/无法.*准确入库/);
    expect((await t.api.productionContext()).saved).toHaveLength(0);
  });
  it('真实文件关闭重开后分摊明细、凭证关联、数量及草稿原文可恢复', async () => {
    const ids = await seedProduction([100, 200, 300]);
    const request = await saveInput(await productionInput(ids, '3'));
    const record = await t.api.saveProduction(request);
    const draft = {
      date: '2026-01-31',
      warehouseId: t.warehouseId,
      ...ids,
      rows: [{ productId: request.rows[0]!.productId, quantity: '1..2', factor: '0.' }],
      requestKey: randomUUID(),
    };
    await t.api.saveProductionDraft(draft);
    await t.app.runtime.bookStore.closeAll();
    const api = caller(t.app, await t.app.login());
    const context = await api.productionContext();
    expect(context.saved[0]).toMatchObject({
      id: record.id,
      document_id: record.document_id,
      voucher_id: record.voucher_id,
      status: 'saved',
    });
    expect(JSON.parse(context.saved[0]!.result_json)).toMatchObject({
      totalCents: 600,
      rows: [{ quantity: '3', totalCents: 600 }],
    });
    expect(await api.productionDraft()).toEqual(draft);
    expect(
      (await api.voucherDocuments()).find((d) => d.documentId === record.document_id)?.sources[0]
        ?.voucherId,
    ).toBe(record.voucher_id);
  });
  it('已审核完工凭证及正式库存核算锁住取消，未破坏已存记录', async () => {
    const ids = await seedProduction();
    const record = await t.api.saveProduction(await saveInput(await productionInput(ids)));
    await t.app.svc.vouchers.changeStatus({ ids: [record.voucher_id!], to: 'audited' });
    await expect(t.api.previewCancelProduction({ id: record.id })).rejects.toThrow(/审核|过账/);
    expect((await t.api.productionContext()).saved[0]?.status).toBe('saved');
    await t.app.svc.vouchers.changeStatus({ ids: [record.voucher_id!], to: 'pending' });
    const preview = await t.api.preview({ period: 202601 });
    await t.api.commit({
      period: 202601,
      fingerprint: preview.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    await expect(t.api.previewCancelProduction({ id: record.id })).rejects.toThrow(/核算/);
  });
});

describe('w_ck_xsmxz / w_cb_hzsj_cblr 费用税金及净利润', () => {
  it('完整月分配后再筛日期，销项税不重复扣减，未知费用保持空白', async () => {
    await t.opening();
    await t.document('issue', '1', '10', { date: '2026-01-10', taxRate: '13' });
    await t.document('issue', '1', '30', { date: '2026-01-20', taxRate: '13' });
    const preview = await t.api.preview({ period: 202601 });
    await t.api.commit({
      period: 202601,
      fingerprint: preview.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    expect(
      (await t.api.profit({ from: '2026-01-01', to: '2026-01-31' })).totals.netProfitCents,
    ).toBeNull();
    const config = await profitSettings();
    await t.api.saveProfitConfig(config);
    await seedVouchers(t.app.svc, [
      {
        date: '2026-01-12',
        lines: [
          { account: '6601', debit: 101 },
          { account: '6403', debit: 41 },
          { account: '1001', credit: 142 },
        ],
      },
    ]);
    const all = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(all.rows.map((r) => [r.salesExpenseCents, r.surchargeCents, r.netProfitCents])).toEqual([
      [25, 10, 865],
      [76, 31, 2793],
    ]);
    expect(all.totals).toMatchObject({
      salesExpenseCents: 101,
      surchargeCents: 41,
      netProfitCents: 3658,
      taxCents: 520,
    });
    expect((await t.api.profit({ from: '2026-01-01', to: '2026-01-15' })).totals).toMatchObject({
      salesExpenseCents: 25,
      surchargeCents: 10,
      netProfitCents: 865,
    });
  });
  it('结转全部应转损益，保留以前年度调整用途，取消删除后余额恢复且审核锁有效', async () => {
    const config = await profitSettings();
    await t.api.saveProfitConfig(config);
    const historical = await t.app.svc.accounts.create(
      {
        code: '6901',
        name: '以前年度损益调整',
        categoryId: 'pnl',
        closingRule: 'retained-earnings',
      },
      t.app.book.codeScheme,
    );
    await seedVouchers(t.app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '1001', debit: 10000 },
          { account: '6001', credit: 10000 },
        ],
      },
      {
        date: '2026-01-12',
        lines: [
          { account: '6401', debit: 3000 },
          { account: '6601', debit: 101 },
          { account: '6403', debit: 41 },
          { account: '6801', debit: 500 },
          { account: '6901', debit: 1000 },
          { account: '1001', credit: 4642 },
        ],
      },
    ]);
    const preview = await t.api.previewProfitTransfer({ period: 202601 });
    expect(preview.netProfitCents).toBe(6358);
    expect(preview.lines.some((l) => l.accountId === historical.id)).toBe(false);
    const voucher = await t.api.generateProfitTransfer({
      period: 202601,
      fingerprint: preview.fingerprint,
      voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
      confirmed: true,
    });
    expect(voucher.closingKind).toBe('pnl');
    expect(
      (
        await t.app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['6001', '6401', '6601', '6403', '6801'],
          rollup: false,
          includeUnposted: true,
        })
      ).map((r) => [r.accountCode, r.closing]),
    ).toEqual([
      ['6001', 0],
      ['6401', 0],
      ['6403', 0],
      ['6601', 0],
      ['6801', 0],
    ]);
    expect(
      (
        await t.app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['4103'],
          rollup: false,
          includeUnposted: true,
        })
      )[0]?.closing,
    ).toBe(-6358);
    await expect(t.api.previewProfitTransfer({ period: 202601 })).rejects.toThrow(/已有/);
    await t.app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await expect(t.api.previewDeleteProfitTransfer({ period: 202601 })).rejects.toThrow(/审核/);
    await t.app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'pending' });
    const plan = await t.api.previewDeleteProfitTransfer({ period: 202601 });
    await t.api.deleteProfitTransfer({
      period: 202601,
      confirmed: true,
      voucherDeletion: { plan, confirmed: true },
    });
    expect((await t.api.previewProfitTransfer({ period: 202601 })).netProfitCents).toBe(6358);
  });
  it('净亏损按借方转入利润，外币和数量损益结转后辅助余额也清零', async () => {
    const config = await profitSettings();
    await t.api.saveProfitConfig(config);
    const foreign = await t.app.svc.accounts.create(
      { code: '600101', name: '美元收入', categoryId: 'pnl', direction: 'credit', currency: 'USD' },
      t.app.book.codeScheme,
    );
    const qty = await t.app.svc.accounts.create(
      { code: '640101', name: '数量成本', categoryId: 'pnl', quantityUnit: '件' },
      t.app.book.codeScheme,
    );
    await seedVouchers(t.app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '1001', debit: 7100 },
          { account: '600101', credit: 7100, currency: 'USD', rate: '7.1', fcAmount: 1000 },
        ],
      },
      {
        date: '2026-01-11',
        lines: [
          { account: '640101', debit: 8000, quantity: '2' },
          { account: '1001', credit: 8000 },
        ],
      },
    ]);
    const preview = await t.api.previewProfitTransfer({ period: 202601 });
    expect(preview.netProfitCents).toBe(-900);
    expect(preview.lines.find((l) => l.accountId === foreign.id)).toMatchObject({
      debit: 7100,
      fcAmount: 1000,
      currency: 'USD',
    });
    expect(preview.lines.find((l) => l.accountId === qty.id)).toMatchObject({
      credit: 8000,
      quantity: '2',
    });
    await t.api.generateProfitTransfer({
      period: 202601,
      fingerprint: preview.fingerprint,
      voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
      confirmed: true,
    });
    expect(
      (
        await t.app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['600101'],
          currency: 'USD',
          rollup: false,
          includeUnposted: true,
        })
      ).map((r) => [r.closing, r.fcClosing]),
    ).toEqual([[0, 0]]);
    expect(
      (
        await t.app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['640101'],
          rollup: false,
          includeUnposted: true,
        })
      ).map((r) => [r.closing, r.qtyClosing]),
    ).toEqual([[0, '0']]);
  });
  it('旧预览、销项税误选、设置版本冲突及关闭期间均拒绝', async () => {
    const config = await profitSettings();
    await expect(
      t.api.saveProfitConfig({ ...config, surchargeAccountId: t.ids.outputTax }),
    ).rejects.toThrow(/不能使用销项税|损益类/);
    await t.api.saveProfitConfig(config);
    await expect(t.api.saveProfitConfig(config)).rejects.toThrow(/版本/);
    await seedVouchers(t.app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '1001', debit: 100 },
          { account: '6001', credit: 100 },
        ],
      },
    ]);
    const preview = await t.api.previewProfitTransfer({ period: 202601 });
    await seedVouchers(t.app.svc, [
      {
        date: '2026-01-11',
        lines: [
          { account: '1001', debit: 100 },
          { account: '6001', credit: 100 },
        ],
      },
    ]);
    await expect(
      t.api.generateProfitTransfer({
        period: 202601,
        fingerprint: preview.fingerprint,
        voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
        confirmed: true,
      }),
    ).rejects.toThrow(/已变化/);
    await t.app.svc.periods.setStatus(202601, 'closed');
    await expect(t.api.previewProfitTransfer({ period: 202601 })).rejects.toThrow(/结账|锁/);
    expect(
      (
        await t.app.svc.db
          .withTables<CostingTables>()
          .selectFrom('costing_profit_config')
          .selectAll()
          .execute()
      )[0]?.voucher_id,
    ).toBeNull();
  });
});

describe('w_cb_pz 分摊金额不变量', () => {
  it('随机分摊、负费用冲回和接近安全整数上限均守恒且不产生浮点金额', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 30 }),
        (total, weights) => {
          const amounts = allocateCents(total, weights.map(String));
          expect(amounts.every(Number.isSafeInteger)).toBe(true);
          expect(sumCents(amounts)).toBe(total);
        },
      ),
      { numRuns: 200 },
    );
    expect(
      sumCents(allocateCents(Number.MAX_SAFE_INTEGER, ['0.000001', '999999999.999999', '1'])),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      allocateCents(Number.MAX_SAFE_INTEGER, [
        '999999999999999999999999999999',
        '1000000000000000000000000000000',
      ]),
    ).toEqual([4503599627370495, 4503599627370496]);
    expect(() => allocateCents(1, ['0'])).toThrow(/没有有效分摊/);
  });
});
