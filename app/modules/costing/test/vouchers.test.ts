import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { seedVouchers } from '@caiwu/testkit';
import { generateVoucher, regenerateVoucher } from '../server/vouchers';
import { readInventory, type InventoryReadTables } from '../server/inventory-read';
import type { GenerateVoucherSchema, VoucherPreviewSchema } from '../shared';
import type { z } from 'zod';
import { caller, setup } from './fixtures';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.app.close();
});
type Target = z.input<typeof VoucherPreviewSchema>;
async function generation(target: Target): Promise<z.input<typeof GenerateVoucherSchema>> {
  const preview = await t.api.previewVoucher(target);
  return {
    ...target,
    fingerprint: preview.fingerprint,
    expectedRevision: preview.expectedRevision,
    voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
    confirmed: true,
  };
}
async function formal(period = 202601) {
  const preview = await t.api.preview({ period });
  return t.api.commit({
    period,
    fingerprint: preview.fingerprint,
    requestKey: randomUUID(),
    confirmed: true,
  });
}
async function seed() {
  await t.opening();
  const receipt = await t.document('receipt', '10', '3', { taxRate: '13' });
  const issue = await t.document('issue', '5', '10', { taxRate: '13' });
  return { receipt, issue };
}

// 发票 provider 由独立任务交付；这里用实际库存表中的来源字段构造合成前置，
// 不把旧版库存输入类型强制转换成尚未接回的发票输入，后续均调用真实成本接口。
async function markInvoiceSource(documentId: number) {
  await t.app.svc.tx(async (tx) => {
    const db = tx.db.withTables<InventoryReadTables>();
    await db
      .updateTable('inventory_document')
      .set({
        source_type: 'invoice',
        source_id: 7001,
        revision: sql`revision+1`,
      })
      .where('id', '=', documentId)
      .execute();
    await db
      .updateTable('inventory_control')
      .set({ stock_revision: sql`stock_revision+1` })
      .where('id', '=', 1)
      .execute();
  });
}

describe('w_cb_pz / w_ck_rk1 / w_ck_ck1：正式来源凭证', () => {
  it('发票来源排除收入候选并拒绝收入预览、生成与重生成，正式成本凭证仍可入账', async () => {
    const { issue } = await seed();
    const target = {
      documentId: issue.id,
      purpose: 'revenue' as const,
      taxAccountId: t.ids.outputTax,
    };
    const oldPreview = await generation(target);
    const [invoiceRevenue] = await seedVouchers(t.app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '1001', debit: 5650 },
          { account: '6001', credit: 5000 },
          { account: '22210102', credit: 650 },
        ],
      },
    ]);
    await markInvoiceSource(issue.id);

    const snapshot = await readInventory(t.app.svcFor('costing'), 202601);
    expect(snapshot.documents.find((d) => d.id === issue.id)).toMatchObject({
      source_type: 'invoice',
      source_id: 7001,
    });
    expect(snapshot.sharedSnapshot.documents.find((d) => d.id === issue.id)).toMatchObject({
      sourceType: 'invoice',
      sourceId: 7001,
    });
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'issue' && d.id === issue.id),
    ).toMatchObject({ sourceType: 'invoice', revenueEligible: false });
    await expect(t.api.previewVoucher(target)).rejects.toMatchObject({
      cause: { data: { code: 'COSTING_INVOICE_REVENUE_OWNED' } },
    });
    await expect(t.api.generateVoucher(oldPreview)).rejects.toThrow(/销售发票.*不能重复制证/);
    await expect(t.api.regenerateVoucher(oldPreview)).rejects.toThrow(/销售发票.*不能重复制证/);
    expect((await t.app.svc.vouchers.list()).total).toBe(1);

    await formal();
    const cost = await t.api.generateVoucher(
      await generation({ documentId: issue.id, purpose: 'cost' }),
    );
    expect(cost).toMatchObject({
      status: 'pending',
      debitTotal: 1000,
      creditTotal: 1000,
      source: { module: 'costing', type: 'cost', id: String(issue.id) },
    });
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'issue' && d.id === issue.id)!
        .sources,
    ).toEqual([expect.objectContaining({ purpose: 'cost', voucherId: cost.id })]);
    expect((await t.app.svc.vouchers.list()).total).toBe(2);
    expect(await t.app.svc.vouchers.get(invoiceRevenue!.id)).toMatchObject({
      id: invoiceRevenue!.id,
      debitTotal: 5650,
      creditTotal: 5650,
    });
  });

  it('来源改为发票后拒绝重生成，保留已有收入凭证及关联，普通销售仍允许收入制证', async () => {
    const { issue } = await seed();
    const target = {
      documentId: issue.id,
      purpose: 'revenue' as const,
      taxAccountId: t.ids.outputTax,
    };
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'issue' && d.id === issue.id),
    ).toMatchObject({ sourceType: null, revenueEligible: true });
    const original = await t.api.generateVoucher(await generation(target));
    const regeneration = await generation(target);
    const deletion = await t.api.previewVoucherDelete(target);
    await markInvoiceSource(issue.id);
    await expect(
      t.api.regenerateVoucher({
        ...regeneration,
        voucherDeletion: { plan: deletion.plan, confirmed: true },
      }),
    ).rejects.toThrow(/销售发票.*不能重复制证/);
    expect(await t.app.svc.vouchers.get(original.id)).toMatchObject({
      id: original.id,
      status: 'pending',
      debitTotal: original.debitTotal,
    });
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'issue' && d.id === issue.id)!
        .sources,
    ).toEqual([expect.objectContaining({ purpose: 'revenue', voucherId: original.id })]);
  });

  it('入库、收入、成本真实入账；同一销售单保留两种用途和来源链接', async () => {
    const { receipt, issue } = await seed();
    const receiptVoucher = await t.api.generateVoucher(
      await generation({
        documentId: receipt.id,
        purpose: 'receipt',
        taxAccountId: t.ids.inputTax,
      }),
    );
    const revenueVoucher = await t.api.generateVoucher(
      await generation({ documentId: issue.id, purpose: 'revenue', taxAccountId: t.ids.outputTax }),
    );
    expect(receiptVoucher).toMatchObject({
      status: 'pending',
      debitTotal: 3390,
      creditTotal: 3390,
      source: { module: 'costing', type: 'receipt', id: String(receipt.id) },
    });
    expect(revenueVoucher).toMatchObject({ debitTotal: 5650, creditTotal: 5650 });
    await formal();
    const costVoucher = await t.api.generateVoucher(
      await generation({ documentId: issue.id, purpose: 'cost' }),
    );
    expect(costVoucher).toMatchObject({
      status: 'pending',
      debitTotal: 1000,
      creditTotal: 1000,
      source: { module: 'costing', type: 'cost', id: String(issue.id) },
    });
    const listed = (await t.api.voucherDocuments()).find(
      (d) => d.kind === 'issue' && d.id === issue.id,
    )!;
    expect(listed.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: 'revenue', voucherId: revenueVoucher.id }),
        expect.objectContaining({ purpose: 'cost', voucherId: costVoucher.id }),
      ]),
    );
    expect((await t.app.svc.vouchers.list()).total).toBe(3);
    const profit = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(profit.totals).toMatchObject({
      revenueCents: 5000,
      costCents: 1000,
      grossProfitCents: 4000,
    });
  });

  it('重复生成、旧预览、未确认及缺少权限拒绝，不多占编号', async () => {
    const { receipt } = await seed();
    const input = await generation({
      documentId: receipt.id,
      purpose: 'receipt',
      taxAccountId: t.ids.inputTax,
    });
    await expect(t.api.generateVoucher({ ...input, confirmed: false })).rejects.toThrow(/确认/);
    const first = await t.api.generateVoucher(input);
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/变化|已有|已生成/);
    const refreshed = await generation({
      documentId: receipt.id,
      purpose: 'receipt',
      taxAccountId: t.ids.inputTax,
    });
    await expect(t.api.generateVoucher(refreshed)).rejects.toThrow(/已生成/);
    const viewOnly = caller(
      t.app,
      await t.app.addUser('readonly', { permissions: ['costing.view'] }),
    );
    await expect(viewOnly.generateVoucher(refreshed)).rejects.toThrow(/权限/);
    await expect(
      viewOnly.previewVoucherDelete({ documentId: receipt.id, purpose: 'receipt' }),
    ).rejects.toThrow(/权限/);
    expect((await t.app.svc.vouchers.list()).items.map((r) => r.number)).toEqual([first.number]);
  });

  it('删除先预览编号影响，删除与来源释放同事务，重新生成取得有效凭证', async () => {
    const { receipt } = await seed();
    const target = {
      documentId: receipt.id,
      purpose: 'receipt' as const,
      taxAccountId: t.ids.inputTax,
    };
    const first = await t.api.generateVoucher(await generation(target));
    const deletion = await t.api.previewVoucherDelete(target);
    await expect(
      t.api.deleteVoucher({
        ...target,
        expectedRevision: deletion.expectedRevision,
        confirmed: true,
      }),
    ).rejects.toThrow(/编号影响/);
    await expect(
      t.api.deleteVoucher({
        ...target,
        expectedRevision: deletion.expectedRevision,
        confirmed: false,
        voucherDeletion: { plan: deletion.plan, confirmed: true },
      }),
    ).rejects.toThrow(/确认/);
    await t.api.deleteVoucher({
      ...target,
      expectedRevision: deletion.expectedRevision,
      confirmed: true,
      voucherDeletion: { plan: deletion.plan, confirmed: true },
    });
    expect(await t.app.svc.vouchers.get(first.id)).toBeNull();
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'receipt' && d.id === receipt.id)!
        .sources,
    ).toEqual([]);
    const second = await t.api.generateVoucher(await generation(target));
    expect(second).toMatchObject({ status: 'pending', debitTotal: first.debitTotal });
  });

  it('重生成失败回滚已有凭证与来源；成功后保留同单另一用途', async () => {
    const { issue } = await seed();
    const target = {
      documentId: issue.id,
      purpose: 'revenue' as const,
      taxAccountId: t.ids.outputTax,
    };
    const first = await t.api.generateVoucher(await generation(target));
    await formal();
    const cost = await t.api.generateVoucher(
      await generation({ documentId: issue.id, purpose: 'cost' }),
    );
    const input = await generation(target);
    const deletion = await t.api.previewVoucherDelete(target);
    const before = await readInventory(t.app.svcFor('costing'), 202601);
    await expect(
      t.api.regenerateVoucher({
        ...input,
        voucherTypeId: 99999,
        voucherDeletion: { plan: deletion.plan, confirmed: true },
      }),
    ).rejects.toThrow();
    expect(await t.app.svc.vouchers.get(first.id)).toMatchObject({
      id: first.id,
      status: 'pending',
    });
    expect((await readInventory(t.app.svcFor('costing'), 202601)).fingerprint).toBe(
      before.fingerprint,
    );
    const next = await t.api.regenerateVoucher({
      ...input,
      voucherDeletion: { plan: deletion.plan, confirmed: true },
    });
    expect(next).toMatchObject({
      debitTotal: first.debitTotal,
      source: { type: 'revenue', id: String(issue.id) },
    });
    expect(await t.app.svc.vouchers.get(cost.id)).toMatchObject({
      id: cost.id,
      source: { type: 'cost' },
    });
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'issue' && d.id === issue.id)!
        .sources,
    ).toHaveLength(2);
  });

  it('审核与过账锁定删除和重生成；关账后不能写入', async () => {
    const { receipt } = await seed();
    const target = {
      documentId: receipt.id,
      purpose: 'receipt' as const,
      taxAccountId: t.ids.inputTax,
    };
    const first = await t.api.generateVoucher(await generation(target));
    const input = await generation(target);
    const deletion = await t.api.previewVoucherDelete(target);
    await t.app.svc.vouchers.changeStatus({ ids: [first.id], to: 'audited' });
    await expect(t.api.previewVoucherDelete(target)).rejects.toThrow(/审核|过账/);
    await expect(
      t.api.deleteVoucher({
        ...target,
        expectedRevision: deletion.expectedRevision,
        confirmed: true,
        voucherDeletion: { plan: deletion.plan, confirmed: true },
      }),
    ).rejects.toThrow(/审核|过账/);
    await expect(
      t.api.regenerateVoucher({
        ...input,
        voucherDeletion: { plan: deletion.plan, confirmed: true },
      }),
    ).rejects.toThrow(/变化|审核/);
    await t.app.svc.vouchers.changeStatus({ ids: [first.id], to: 'posted' });
    await expect(t.api.previewVoucherDelete(target)).rejects.toThrow(/审核|过账/);
    await t.app.svc.periods.setStatus(202601, 'closed');
    await expect(t.api.generateVoucher(await generation(target))).rejects.toThrow(/结账|已生成/);
    expect(await t.app.svc.vouchers.get(first.id)).toMatchObject({ status: 'posted' });
  });

  it('重排策略展示全部编号变化；过期计划拒绝并完整保留来源', async () => {
    const { receipt } = await seed();
    const second = await t.document('receipt', '1', '4');
    const target = {
      documentId: receipt.id,
      purpose: 'receipt' as const,
      taxAccountId: t.ids.inputTax,
    };
    const firstVoucher = await t.api.generateVoucher(await generation(target));
    const secondVoucher = await t.api.generateVoucher(
      await generation({ documentId: second.id, purpose: 'receipt' }),
    );
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const deletion = await t.api.previewVoucherDelete(target);
    expect(deletion.plan.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: secondVoucher.id, oldNumber: 2, number: 1 }),
      ]),
    );
    await expect(
      t.api.deleteVoucher({
        ...target,
        expectedRevision: deletion.expectedRevision,
        confirmed: true,
        voucherDeletion: {
          plan: { ...deletion.plan, fingerprint: '0'.repeat(64) },
          confirmed: true,
        },
      }),
    ).rejects.toThrow(/变化/);
    expect(await t.app.svc.vouchers.get(firstVoucher.id)).toMatchObject({ id: firstVoucher.id });
    await t.api.deleteVoucher({
      ...target,
      expectedRevision: deletion.expectedRevision,
      confirmed: true,
      voucherDeletion: { plan: deletion.plan, confirmed: true },
    });
    expect(await t.app.svc.vouchers.get(secondVoucher.id)).toMatchObject({ number: 1 });
  });

  it('凭证预览绑定科目映射；不能换科目后复用旧确认', async () => {
    const { receipt } = await seed();
    const input = await generation({
      documentId: receipt.id,
      purpose: 'receipt',
      taxAccountId: t.ids.inputTax,
    });
    await expect(
      t.api.generateVoucher({ ...input, taxAccountId: t.ids.outputTax }),
    ).rejects.toThrow(/旧预览/);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    await t.api.generateVoucher(input);
  });

  it('手工编号必填且防重复；失败不留凭证或来源关联', async () => {
    const { receipt } = await seed();
    await t.app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const input = await generation({
      documentId: receipt.id,
      purpose: 'receipt',
      taxAccountId: t.ids.inputTax,
    });
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/编号/);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    const voucher = await t.api.generateVoucher({ ...input, number: 9 });
    expect(voucher.number).toBe(9);
    const second = await t.document('receipt', '1', '2');
    const secondInput = await generation({ documentId: second.id, purpose: 'receipt' });
    await expect(t.api.generateVoucher({ ...secondInput, number: 9 })).rejects.toThrow(/编号|重复/);
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'receipt' && d.id === second.id)!
        .sources,
    ).toEqual([]);
  });

  it('禁止修改他人凭证的账套不能代删或代重生成', async () => {
    const { receipt } = await seed();
    const target = {
      documentId: receipt.id,
      purpose: 'receipt' as const,
      taxAccountId: t.ids.inputTax,
    };
    const voucher = await t.api.generateVoucher(await generation(target));
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: false,
      allowModifyOthers: false,
    });
    const clerk = caller(
      t.app,
      await t.app.addUser('otherclerk', { permissions: ['costing.view', 'costing.voucher'] }),
    );
    await expect(clerk.previewVoucherDelete(target)).rejects.toThrow(/其他操作员|原制单人/);
    expect(await t.app.svc.vouchers.get(voucher.id)).toMatchObject({
      id: voucher.id,
      status: 'pending',
    });
  });

  it('同一来源并发生成只成功一次，不重复记账', async () => {
    const { receipt } = await seed();
    const input = await generation({
      documentId: receipt.id,
      purpose: 'receipt',
      taxAccountId: t.ids.inputTax,
    });
    const results = await Promise.allSettled([
      t.api.generateVoucher(input),
      t.api.generateVoucher(input),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'receipt' && d.id === receipt.id)!
        .sources,
    ).toHaveLength(1);
  });

  it('零成本单保留真实数量预览并保存单条数量凭证，不伪造平衡行', async () => {
    await t.opening('3', '0.003333');
    const first = await t.document('issue', '1', '10');
    await t.document('issue', '1', '10');
    await t.document('issue', '1', '10');
    await formal();
    const target = { documentId: first.id, purpose: 'cost' as const };
    const preview = await t.api.previewVoucher(target);
    expect(preview).toMatchObject({
      canGenerate: true,
      debitCents: 0,
      creditCents: 0,
      generationBlocker: null,
    });
    expect(preview.lines).toEqual([
      expect.objectContaining({
        accountId: t.ids.stock,
        credit: 0,
        quantity: '1',
        entrySide: 'credit',
      }),
    ]);
    const voucher = await t.api.generateVoucher(await generation(target));
    expect(voucher.lines).toHaveLength(1);
    expect(voucher.lines[0]).toMatchObject({ credit: 0, quantity: '1', entrySide: 'credit' });
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
  });

  it('生成凭证后的外层失败同时回滚凭证、来源和日志', async () => {
    const { receipt } = await seed();
    const input = await generation({
      documentId: receipt.id,
      purpose: 'receipt',
      taxAccountId: t.ids.inputTax,
    });
    const svc = t.app.svcFor('costing');
    const before = await readInventory(svc, 202601);
    const logs = await t.app.svc.db.selectFrom('operation_log').selectAll().execute();
    await expect(
      svc.tx(async (tx) => {
        await generateVoucher(tx, input);
        throw new Error('模拟保存失败');
      }),
    ).rejects.toThrow('模拟保存失败');
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    expect((await readInventory(svc, 202601)).fingerprint).toBe(before.fingerprint);
    expect(await t.app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(logs);
  });
});

describe('w_cb_pdk / w_cb_pdk_1 / w_cb_pz：盘盈盘亏凭证', () => {
  async function count(actual: string) {
    await seed();
    const generated = await t.inventory.generateCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: 0,
      confirmed: false,
    });
    await t.inventory.saveCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: generated.revision,
      rows: [{ productCode: 'P1', actual }],
    });
    const result = (await t.api.voucherDocuments()).find((d) => d.kind === 'count')!;
    return { countId: result.id, purpose: 'count' as const, adjustmentAccountId: t.ids.cost };
  }

  it.each([
    { actual: '12', stockSide: 'credit', adjustmentSide: 'debit', cents: 600 },
    { actual: '18', stockSide: 'debit', adjustmentSide: 'credit', cents: 600 },
  ])(
    '盘点实际数量$actual按正式成本生成平衡分录',
    async ({ actual, stockSide, adjustmentSide, cents }) => {
      const target = await count(actual);
      await expect(t.api.previewVoucher(target)).rejects.toThrow(/正式成本核算/);
      await formal();
      const preview = await t.api.previewVoucher(target);
      expect(preview.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: t.ids.stock, [stockSide]: cents, quantity: '3' }),
          expect.objectContaining({ accountId: t.ids.cost, [adjustmentSide]: cents }),
        ]),
      );
      const voucher = await t.api.generateVoucher(await generation(target));
      expect(voucher).toMatchObject({
        debitTotal: cents,
        creditTotal: cents,
        source: { type: 'count', id: String(target.countId) },
      });
      await expect(
        t.inventory.saveCount({
          warehouseId: t.warehouseId,
          period: 202601,
          revision: preview.expectedRevision,
          rows: [{ productCode: 'P1', actual: '10' }],
        }),
      ).rejects.toThrow(/核算|锁/);
      const deletion = await t.api.previewVoucherDelete(target);
      await t.api.deleteVoucher({
        ...target,
        expectedRevision: deletion.expectedRevision,
        confirmed: true,
        voucherDeletion: { plan: deletion.plan, confirmed: true },
      });
      expect(await t.app.svc.vouchers.get(voucher.id)).toBeNull();
    },
  );

  it('无盘盈盘亏不生成空凭证', async () => {
    const target = await count('15');
    await formal();
    expect(await t.api.previewVoucher(target)).toMatchObject({
      canGenerate: false,
      lines: [],
      generationBlocker: expect.stringMatching(/无需生成金额凭证/),
    });
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
  });

  it('盘点凭证重生成的外层异常恢复旧凭证和关联', async () => {
    const target = await count('12');
    await formal();
    const first = await t.api.generateVoucher(await generation(target));
    const input = await generation(target);
    const deletion = await t.api.previewVoucherDelete(target);
    await expect(
      t.app.svcFor('costing').tx(async (tx) => {
        await regenerateVoucher(tx, {
          ...input,
          voucherDeletion: { plan: deletion.plan, confirmed: true },
        });
        throw new Error('模拟重生成失败');
      }),
    ).rejects.toThrow('模拟重生成失败');
    expect(await t.app.svc.vouchers.get(first.id)).toMatchObject({ id: first.id });
    expect(
      (await t.api.voucherDocuments()).find((d) => d.kind === 'count' && d.id === target.countId)!
        .sources,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ voucherId: first.id })]));
    await t.app.svc.vouchers.changeStatus({ ids: [first.id], to: 'audited' });
    await expect(t.api.previewVoucherDelete(target)).rejects.toThrow(/审核|过账/);
  });
});
