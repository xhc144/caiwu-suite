import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitCalculation, cancelCalculation } from '../server/formal';
import type { CostingTables } from '../server/migrations';
import { caller, setup } from './fixtures';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.app.close();
});

async function seed() {
  await t.opening();
  const receipt = await t.document('receipt', '10', '3');
  const issue = await t.document('issue', '5', '10');
  return { receipt, issue };
}

async function calculationInput(period = 202601, requestKey = randomUUID()) {
  const preview = await t.api.preview({ period });
  return { period, requestKey, fingerprint: preview.fingerprint, confirmed: true };
}

async function cancellationInput() {
  const preview = await t.api.previewCancelCalculation();
  return {
    batchId: preview.batchId,
    revision: preview.revision,
    fingerprint: preview.fingerprint,
    confirmed: true,
    ...(preview.voucherDeletion
      ? { voucherDeletion: { plan: preview.voucherDeletion, confirmed: true } }
      : {}),
  };
}

async function generate(documentId: number, purpose: 'receipt' | 'revenue' | 'cost') {
  const target = { documentId, purpose };
  const preview = await t.api.previewVoucher(target);
  return t.api.generateVoucher({
    ...target,
    fingerprint: preview.fingerprint,
    expectedRevision: preview.expectedRevision,
    voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
    confirmed: true,
  });
}

const snapshot = (period = 202601) => t.app.svcFor('costing').inventory.snapshot(period);

describe('w_cb_hz / w_cb_fgz：正式月末加权核算与逐月撤销', () => {
  it('启用后连续空月仍可正式核算并封锁，首次三月业务承接空余额且可逐月撤销', async () => {
    const emptyPreview = await t.api.preview({ period: 202601 });
    expect(emptyPreview.rows).toEqual([]);
    await expect(
      t.api.saveWorksheet({ period: 202601, fingerprint: emptyPreview.fingerprint }),
    ).rejects.toThrow(/没有可试算/);
    const january = await t.api.commit(await calculationInput());
    expect(january.result.rows).toEqual([]);
    expect((await snapshot()).control).toMatchObject({
      costPeriod: 202601,
      costBatch: january.batchId,
      openingLocked: true,
    });
    await expect(t.document('receipt', '1', '2')).rejects.toThrow(/核算|锁定/);
    const february = await t.api.commit(await calculationInput(202602));
    expect(february.result.rows).toEqual([]);
    const februarySnapshot = await snapshot(202602);
    expect(februarySnapshot.periodOpeningReady).toBe(true);
    expect(februarySnapshot.periodOpening).toEqual([]);
    expect(februarySnapshot.batches.find((b) => b.id === february.batchId)).toMatchObject({
      previous_batch_id: january.batchId,
    });

    const receipt = await t.document('receipt', '10', '3', { date: '2026-03-05' });
    const issue = await t.document('issue', '2', '10', { date: '2026-03-15' });
    const march = await t.api.commit(await calculationInput(202603));
    expect(march.result.rows[0]).toMatchObject({
      openingQuantity: '0',
      openingCents: 0,
      receivedQuantity: '10',
      receivedCents: 3000,
      issuedCents: 600,
      closingQuantity: '8',
      closingCents: 2400,
    });
    const marchSnapshot = await snapshot(202603);
    expect(marchSnapshot.batches.find((b) => b.id === march.batchId)).toMatchObject({
      previous_batch_id: february.batchId,
    });
    expect(marchSnapshot.movements.find((m) => m.documentId === issue.id)).toMatchObject({
      outboundCostCents: 600,
      calculationStatus: 'calculated',
    });
    expect((await t.api.profit({ from: '2026-03-01', to: '2026-03-31' })).totals).toMatchObject({
      revenueCents: 2000,
      costCents: 600,
      grossProfitCents: 1400,
      pendingLines: 0,
    });

    for (const previous of [202602, 202601, null]) {
      await t.api.cancelCalculation(await cancellationInput());
      expect((await snapshot(202603)).control.costPeriod).toBe(previous);
    }
    const cancelled = await snapshot(202603);
    expect(cancelled.batches.filter((b) => b.status === 'cancelled')).toHaveLength(3);
    expect(cancelled.documents.map((d) => d.id)).toEqual([receipt.id, issue.id]);
    expect(cancelled.movements.every((m) => m.calculationStatus === 'uncalculated')).toBe(true);
    expect(
      cancelled.movements.find((m) => m.documentId === issue.id)!.outboundCostCents,
    ).toBeNull();
    expect((await t.api.context()).nextCalculationPeriod).toBe(202601);
    await expect(t.api.previewCancelCalculation()).rejects.toThrow(/初始开账日期/);
  });

  it('正式写入出库成本、期初和盘点状态，并锁定整月来源；试算金额与收入利润可核对', async () => {
    const { issue } = await seed();
    const generatedCount = await t.inventory.generateCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: 0,
      confirmed: false,
    });
    await t.inventory.saveCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: generatedCount.revision,
      rows: [{ productCode: 'P1', actual: '12' }],
    });
    const input = await calculationInput();
    const result = await t.api.commit(input);
    expect(result).toMatchObject({ status: 'calculated', period: 202601, revision: 1 });
    expect(result.result.rows[0]).toMatchObject({
      openingCents: 1000,
      receivedCents: 3000,
      issuedCents: 1000,
      countCents: -600,
      closingQuantity: '12',
      closingCents: 2400,
    });
    const after = await snapshot();
    expect(after.control).toMatchObject({
      costPeriod: 202601,
      costBatch: result.batchId,
      costCutoffDate: '2026-01-31',
      openingLocked: true,
    });
    expect(after.movements.find((l) => l.documentId === issue.id)).toMatchObject({
      outboundCostCents: 1000,
      calculationStatus: 'calculated',
      calculationBatch: result.batchId,
      calculationPeriod: 202601,
    });
    expect(after.opening.every((r) => r.calculationBatch === result.batchId)).toBe(true);
    expect(after.counts[0]).toMatchObject({
      calculationStatus: 'calculated',
      calculationBatch: result.batchId,
    });
    expect(after.counts[0]!.lines[0]!.bookCents).toBe(3000);
    await expect(t.document('receipt', '1', '2')).rejects.toThrow(/核算|锁定/);
    await expect(t.opening()).rejects.toThrow(/锁定|核算/);
    await expect(
      t.inventory.saveCount({
        warehouseId: t.warehouseId,
        period: 202601,
        revision: after.counts[0]!.revision,
        rows: [{ productCode: 'P1', actual: '15' }],
      }),
    ).rejects.toThrow(/核算|锁定/);
    const report = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(report.rows[0]).toMatchObject({
      revenueCents: 5000,
      costCents: 1000,
      grossProfitCents: 4000,
      costStatus: '已核算',
    });
    expect(report.totals.pendingLines).toBe(0);
  });

  it('连续两月使用上一正式结存；历史月份仍可核验，且只能先撤销最后月份', async () => {
    await seed();
    const january = await t.api.commit(await calculationInput());
    const januaryCancellation = await cancellationInput();
    await t.document('receipt', '5', '4', { date: '2026-02-03' });
    await t.document('issue', '4', '9', { date: '2026-02-12' });
    const februaryPreview = await t.api.preview({ period: 202602 });
    expect(februaryPreview.rows[0]).toMatchObject({
      openingQuantity: '15',
      openingCents: 3000,
      receivedCents: 2000,
      issuedCents: 1000,
      closingQuantity: '16',
      closingCents: 4000,
    });
    const february = await t.api.commit(await calculationInput(202602));
    expect((await snapshot(202602)).batches.find((b) => b.id === february.batchId)).toMatchObject({
      previous_batch_id: january.batchId,
    });
    const januaryReport = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(januaryReport.totals).toMatchObject({ costCents: 1000, grossProfitCents: 4000 });
    await expect(t.api.cancelCalculation(januaryCancellation)).rejects.toThrow(/最后|变化/);
    expect((await t.api.previewCancelCalculation()).batchId).toBe(february.batchId);
    await t.api.cancelCalculation(await cancellationInput());
    expect((await snapshot()).control.costBatch).toBe(january.batchId);
    expect(
      (await snapshot(202602)).movements.filter((l) => l.calculationPeriod === 202602),
    ).toEqual([]);
    await t.api.cancelCalculation(await cancellationInput());
    expect((await snapshot()).control).toMatchObject({
      costBatch: null,
      costPeriod: null,
      costCutoffDate: null,
      openingLocked: false,
    });
    await expect(t.api.previewCancelCalculation()).rejects.toThrow(/初始开账日期/);
    await t.document('receipt', '1', '2');
    expect((await t.api.context()).nextCalculationPeriod).toBe(202601);
  });

  it('初始保护、明确确认、旧来源指纹、跳月和重复月份均拒绝，不改库存和日志', async () => {
    await expect(t.api.cancelCalculation()).rejects.toThrow(/初始开账日期/);
    await seed();
    const input = await calculationInput();
    const before = await snapshot();
    await expect(t.api.commit({ ...input, confirmed: false })).rejects.toThrow(/确认/);
    expect((await snapshot()).fingerprint).toBe(before.fingerprint);
    await expect(t.api.commit(await calculationInput(202602))).rejects.toThrow(/按月|跳月/);
    await t.document('receipt', '1', '2');
    await expect(t.api.commit(input)).rejects.toThrow(/变化|旧试算/);
    expect((await snapshot()).control.costPeriod).toBeNull();
    const committed = await t.api.commit(await calculationInput());
    const cancellation = await cancellationInput();
    await expect(t.api.cancelCalculation()).rejects.toThrow(/预览|确认/);
    await expect(t.api.cancelCalculation({ ...cancellation, confirmed: false })).rejects.toThrow(
      /确认/,
    );
    await expect(
      t.api.cancelCalculation({ ...cancellation, revision: cancellation.revision + 1 }),
    ).rejects.toThrow(/版本|变化/);
    await expect(
      t.api.cancelCalculation({ ...cancellation, fingerprint: '0'.repeat(64) }),
    ).rejects.toThrow(/版本|变化/);
    await expect(t.api.commit(await calculationInput())).rejects.toThrow(/按月|重复/);
    expect((await snapshot()).control.costBatch).toBe(committed.batchId);
  });

  it('相同核算请求并发重试只形成一个正式批次，已取消请求号不得复活', async () => {
    await seed();
    const input = await calculationInput();
    const both = await Promise.all([t.api.commit(input), t.api.commit(input)]);
    expect(both[0]!.batchId).toBe(both[1]!.batchId);
    expect((await snapshot()).batches.filter((b) => b.status === 'calculated')).toHaveLength(1);
    expect(await t.api.commit(input)).toMatchObject({ batchId: both[0]!.batchId });
    await expect(t.api.commit({ ...input, adjustZeroQuantity: true })).rejects.toThrow(/请求|内容/);
    await t.api.cancelCalculation(await cancellationInput());
    await expect(t.api.commit(input)).rejects.toThrow(/请求|状态/);
    const next = await t.api.commit(await calculationInput());
    expect(next.batchId).not.toBe(both[0]!.batchId);
  });

  it('核算与撤销后的外层异常完整回滚正式批次、成本字段、锁、模块记录及日志', async () => {
    await seed();
    const svc = t.app.svcFor('costing');
    const input = await calculationInput();
    const before = await snapshot();
    const logs = await t.app.svc.db.selectFrom('operation_log').selectAll().execute();
    await expect(
      svc.tx(async (tx) => {
        await commitCalculation(tx, input);
        throw new Error('模拟核算保存失败');
      }),
    ).rejects.toThrow('模拟核算保存失败');
    expect((await snapshot()).fingerprint).toBe(before.fingerprint);
    expect(
      await svc.db
        .withTables<CostingTables>()
        .selectFrom('costing_calculation')
        .selectAll()
        .execute(),
    ).toEqual([]);
    expect(await t.app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(logs);
    const committed = await t.api.commit(input);
    const cancellation = await cancellationInput();
    const calculated = await snapshot();
    const calculatedLogs = await t.app.svc.db.selectFrom('operation_log').selectAll().execute();
    await expect(
      svc.tx(async (tx) => {
        await cancelCalculation(tx, cancellation);
        throw new Error('模拟撤销保存失败');
      }),
    ).rejects.toThrow('模拟撤销保存失败');
    expect((await snapshot()).fingerprint).toBe(calculated.fingerprint);
    expect(await t.app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(
      calculatedLogs,
    );
    expect((await snapshot()).control.costBatch).toBe(committed.batchId);
    await expect(t.document('receipt', '1', '2')).rejects.toThrow(/锁定|核算/);
  });

  it('权限与服务端已结账限制适用于正式提交和最后批次撤销', async () => {
    await seed();
    const viewer = caller(
      t.app,
      await t.app.addUser('cost-viewer', { permissions: ['costing.view'] }),
    );
    const input = await calculationInput();
    await expect(viewer.commit(input)).rejects.toThrow(/权限/);
    await expect(viewer.previewCancelCalculation()).rejects.toThrow(/权限/);
    await expect(viewer.cancelCalculation()).rejects.toThrow(/权限/);
    await t.app.svc.periods.setStatus(202601, 'closed');
    await expect(t.api.commit(input)).rejects.toThrow(/结账/);
    expect((await snapshot()).control.costPeriod).toBeNull();
    await t.app.svc.periods.setStatus(202601, 'open');
    const committed = await t.api.commit(input);
    const cancellation = await cancellationInput();
    await t.app.svc.periods.setStatus(202601, 'closed');
    await expect(t.api.previewCancelCalculation()).rejects.toThrow(/结账/);
    await expect(t.api.cancelCalculation(cancellation)).rejects.toThrow(/结账/);
    expect((await snapshot()).control.costBatch).toBe(committed.batchId);
  });

  it('w_cb_hz：整分尾差随累计出库分配，零成本行也完整提交且全部出完无残值', async () => {
    await t.opening('3', '0.003333');
    const issues = [];
    for (let i = 0; i < 3; i++) issues.push(await t.document('issue', '1', '10'));
    const committed = await t.api.commit(await calculationInput());
    expect(committed.result.lines.map((l) => l.costCents)).toEqual([0, 1, 0]);
    expect(committed.result.rows[0]).toMatchObject({
      openingCents: 1,
      issuedCents: 1,
      closingQuantity: '0',
      closingCents: 0,
    });
    const actual = await snapshot();
    expect(
      issues.map(
        (issue) => actual.movements.find((m) => m.documentId === issue.id)!.outboundCostCents,
      ),
    ).toEqual([0, 1, 0]);
    expect((await t.api.profit({ from: '2026-01-01', to: '2026-01-31' })).totals).toMatchObject({
      revenueCents: 3000,
      costCents: 1,
      grossProfitCents: 2999,
      pendingLines: 0,
    });
  });

  it('w_cb_hz：盘点与出库各自四舍五入形成零数量残差时，必须选择调整且正式提交守恒', async () => {
    await t.opening('2', '0.005');
    await t.document('issue', '1', '10');
    const count = await t.inventory.generateCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: 0,
      confirmed: false,
    });
    await t.inventory.saveCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: count.revision,
      rows: [{ productCode: 'P1', actual: '0' }],
    });
    await expect(t.api.preview({ period: 202601 })).rejects.toThrow(/数量为零|没有数量/);
    const preview = await t.api.preview({ period: 202601, adjustZeroQuantity: true });
    expect(preview.rows[0]).toMatchObject({
      openingCents: 1,
      issuedCents: 1,
      countCents: -1,
      zeroQuantityAdjustmentCents: 1,
      closingQuantity: '0',
      closingCents: 0,
    });
    const result = await t.api.commit({
      period: 202601,
      adjustZeroQuantity: true,
      fingerprint: preview.fingerprint,
      requestKey: randomUUID(),
      confirmed: true,
    });
    expect(result.result.rows).toEqual(preview.rows);
    const next = await snapshot(202602);
    expect(next.periodOpening[0]).toMatchObject({
      quantity: '0',
      amountCents: 0,
      sourceBatchId: result.batchId,
    });
  });
});

describe('w_cb_fgz / w_cb_pz：关联凭证保护与取消联动', () => {
  it('取消核算先预览并确认成本凭证删除；只删成本用途，保留收入和入库凭证', async () => {
    const { receipt, issue } = await seed();
    const receiptVoucher = await generate(receipt.id, 'receipt');
    const revenueVoucher = await generate(issue.id, 'revenue');
    await t.api.commit(await calculationInput());
    const costVoucher = await generate(issue.id, 'cost');
    const preview = await t.api.previewCancelCalculation();
    expect(preview.voucherDeletion?.ids).toEqual([costVoucher.id]);
    await expect(
      t.api.cancelCalculation({
        batchId: preview.batchId,
        revision: preview.revision,
        fingerprint: preview.fingerprint,
        confirmed: true,
      }),
    ).rejects.toThrow(/确认|编号影响/);
    const before = await snapshot();
    await expect(
      t.api.cancelCalculation({
        ...(await cancellationInput()),
        voucherDeletion: {
          plan: { ...preview.voucherDeletion!, fingerprint: '0'.repeat(64) },
          confirmed: true,
        },
      }),
    ).rejects.toThrow(/变化/);
    expect((await snapshot()).fingerprint).toBe(before.fingerprint);
    await t.api.cancelCalculation(await cancellationInput());
    expect(await t.app.svc.vouchers.get(costVoucher.id)).toBeNull();
    expect(await t.app.svc.vouchers.get(receiptVoucher.id)).toMatchObject({
      id: receiptVoucher.id,
      status: 'pending',
    });
    expect(await t.app.svc.vouchers.get(revenueVoucher.id)).toMatchObject({
      id: revenueVoucher.id,
      status: 'pending',
    });
    const sale = (await t.api.voucherDocuments()).find(
      (d) => d.kind === 'issue' && d.id === issue.id,
    )!;
    expect(sale.sources).toEqual([
      expect.objectContaining({ purpose: 'revenue', voucherId: revenueVoucher.id }),
    ]);
    expect((await snapshot()).movements.find((m) => m.documentId === issue.id)).toMatchObject({
      outboundCostCents: null,
      calculationStatus: 'uncalculated',
      calculationBatch: null,
    });
    expect(
      (await t.api.profit({ from: '2026-01-01', to: '2026-01-31' })).totals.costCents,
    ).toBeNull();
  });

  it.each(['revenue', 'cost'] as const)(
    '已审核或过账的%s关联凭证阻止取消，旧取消预览不能绕过',
    async (purpose) => {
      const { issue } = await seed();
      const revenue = await generate(issue.id, 'revenue');
      await t.api.commit(await calculationInput());
      const cost = await generate(issue.id, 'cost');
      const input = await cancellationInput();
      const voucher = purpose === 'revenue' ? revenue : cost;
      await t.app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      await expect(t.api.previewCancelCalculation()).rejects.toThrow(/审核|过账/);
      await expect(t.api.cancelCalculation(input)).rejects.toThrow(/审核|过账/);
      await t.app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
      await expect(t.api.cancelCalculation(input)).rejects.toThrow(/审核|过账/);
      expect((await snapshot()).control.costPeriod).toBe(202601);
      expect((await t.app.svc.vouchers.list()).total).toBe(2);
    },
  );

  it('启用删除后重排时展示保留凭证的编号变化，并在确认后原子重排', async () => {
    const { issue } = await seed();
    await t.api.commit(await calculationInput());
    const cost = await generate(issue.id, 'cost');
    const revenue = await generate(issue.id, 'revenue');
    expect([cost.number, revenue.number]).toEqual([1, 2]);
    await t.app.svc.voucherPolicy.set({
      numbering: 'automatic',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    const preview = await t.api.previewCancelCalculation();
    expect(preview.voucherDeletion?.impacts).toEqual([
      expect.objectContaining({ id: revenue.id, oldNumber: 2, number: 1 }),
    ]);
    await t.api.cancelCalculation(await cancellationInput());
    expect(await t.app.svc.vouchers.get(cost.id)).toBeNull();
    expect(await t.app.svc.vouchers.get(revenue.id)).toMatchObject({
      number: 1,
      status: 'pending',
    });
    expect((await snapshot()).control.costPeriod).toBeNull();
  });

  it('外层撤销失败同时恢复成本凭证及双凭证关联，再次按同一预览可成功', async () => {
    const { issue } = await seed();
    const revenue = await generate(issue.id, 'revenue');
    await t.api.commit(await calculationInput());
    const cost = await generate(issue.id, 'cost');
    const input = await cancellationInput();
    const before = await snapshot();
    await expect(
      t.app.svcFor('costing').tx(async (tx) => {
        await cancelCalculation(tx, input);
        throw new Error('模拟取消核算失败');
      }),
    ).rejects.toThrow('模拟取消核算失败');
    expect((await snapshot()).fingerprint).toBe(before.fingerprint);
    expect(await t.app.svc.vouchers.get(cost.id)).toMatchObject({ id: cost.id });
    const links = (await t.api.voucherDocuments()).find(
      (d) => d.kind === 'issue' && d.id === issue.id,
    )!.sources;
    expect(links.map((l) => l.voucherId).sort((a, b) => a - b)).toEqual(
      [revenue.id, cost.id].sort((a, b) => a - b),
    );
    await t.api.cancelCalculation(input);
    expect(await t.app.svc.vouchers.get(cost.id)).toBeNull();
  });

  it('w_cb_pdk_1：已有盘点凭证时先删除，再取消最后月份，实盘数据与原状态均保留', async () => {
    await seed();
    const count = await t.inventory.generateCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: 0,
      confirmed: false,
    });
    await t.inventory.saveCount({
      warehouseId: t.warehouseId,
      period: 202601,
      revision: count.revision,
      rows: [{ productCode: 'P1', actual: '12' }],
    });
    await t.api.commit(await calculationInput());
    const source = (await t.api.voucherDocuments()).find((d) => d.kind === 'count')!;
    const target = {
      countId: source.id,
      purpose: 'count' as const,
      adjustmentAccountId: t.ids.cost,
    };
    const preview = await t.api.previewVoucher(target);
    const voucher = await t.api.generateVoucher({
      ...target,
      fingerprint: preview.fingerprint,
      expectedRevision: preview.expectedRevision,
      voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
      confirmed: true,
    });
    await expect(t.api.previewCancelCalculation()).rejects.toThrow(/先删除盘点凭证/);
    const before = await snapshot();
    await expect(t.api.cancelCalculation()).rejects.toThrow(/先删除盘点凭证/);
    expect((await snapshot()).fingerprint).toBe(before.fingerprint);
    const deletion = await t.api.previewVoucherDelete(target);
    await t.api.deleteVoucher({
      ...target,
      expectedRevision: deletion.expectedRevision,
      confirmed: true,
      voucherDeletion: { plan: deletion.plan, confirmed: true },
    });
    expect(await t.app.svc.vouchers.get(voucher.id)).toBeNull();
    await t.api.cancelCalculation(await cancellationInput());
    const after = await snapshot();
    expect(after.control.costPeriod).toBeNull();
    expect(after.counts[0]).toMatchObject({
      calculationStatus: 'uncalculated',
      calculationBatch: null,
    });
    expect(after.counts[0]!.lines[0]).toMatchObject({
      actualQuantity: '12',
      bookQuantity: '15',
      bookCents: null,
    });
    expect((await t.api.preview({ period: 202601 })).rows[0]).toMatchObject({
      countDifference: '-3',
      countCents: -600,
      closingCents: 2400,
    });
  });
});
