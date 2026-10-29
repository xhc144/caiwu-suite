import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { seedVouchers } from '@caiwu/testkit';
import { costingService } from '../server/service';
import { officialCost, readInventory } from '../server/inventory-read';
import { caller, setup } from './fixtures';
import type { z } from 'zod';
import type { VoucherPreviewSchema } from '../shared';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.app.close();
});
const january = { period: 202601 };
const validCommitFields = () => ({
  fingerprint: '0'.repeat(64),
  requestKey: randomUUID(),
  confirmed: true,
});
async function commitInput(period = 202601) {
  const preview = await t.api.preview({ period });
  return { period, fingerprint: preview.fingerprint, requestKey: randomUUID(), confirmed: true };
}
async function generateInput(target: z.input<typeof VoucherPreviewSchema>) {
  const preview = await t.api.previewVoucher(target);
  return {
    ...target,
    fingerprint: preview.fingerprint,
    expectedRevision: preview.expectedRevision,
    voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
    confirmed: true,
  };
}
async function seed() {
  await t.opening();
  const receipt = await t.document('receipt', '10', '3');
  const issue = await t.document('issue', '5', '10');
  return { receipt, issue };
}

describe('w_cb_hz / w_cb_fgz：真实账套试算与反操作', () => {
  it('按真实库存加权、跨月结转、盘点调整，并且不写库存', async () => {
    const { issue } = await seed();
    const before = await readInventory(t.app.svcFor('costing'), 202601);
    const r = await t.api.preview(january);
    expect(r.rows[0]).toMatchObject({
      openingCents: 1000,
      receivedCents: 3000,
      issuedCents: 1000,
      closingCents: 3000,
      closingQuantity: '15',
    });
    expect(r.lines).toEqual([
      {
        lineId: issue.lines[0]!.id,
        documentId: issue.id,
        costCents: 1000,
        unitCost: '2.000000000000',
      },
    ]);
    expect((await readInventory(t.app.svcFor('costing'), 202601)).fingerprint).toBe(
      before.fingerprint,
    );
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
    expect((await t.api.preview(january)).rows[0]).toMatchObject({
      countDifference: '-3',
      countCents: -600,
      closingCents: 2400,
    });
    await t.document('issue', '2', '20', { date: '2026-02-10' });
    expect((await t.api.preview({ period: 202602 })).rows[0]).toMatchObject({
      openingQuantity: '12',
      openingCents: 2400,
      issuedCents: 400,
      closingCents: 2000,
    });
  });
  it('保存/取消试算、重复保存、来源锁版本与确认保护；库存未被假核算', async () => {
    await seed();
    const preview = await t.api.preview(january);
    const before = await readInventory(t.app.svcFor('costing'), 202601);
    const saved = await t.api.saveWorksheet({ ...january, fingerprint: preview.fingerprint });
    expect((await t.api.worksheet(saved)).stale).toBe(false);
    await expect(
      t.api.saveWorksheet({ ...january, fingerprint: preview.fingerprint }),
    ).rejects.toThrow(/已有有效试算/);
    await expect(t.api.cancelWorksheet({ ...saved, confirmed: false })).rejects.toThrow(/确认/);
    await expect(
      t.api.cancelWorksheet({ ...saved, revision: 999, confirmed: true }),
    ).rejects.toThrow(/版本/);
    await t.api.cancelWorksheet({ ...saved, confirmed: true });
    expect((await t.api.worksheets())[0]).toMatchObject({ status: 'cancelled', revision: 2 });
    await expect(t.api.cancelWorksheet({ ...saved, revision: 2, confirmed: true })).rejects.toThrow(
      /已经取消/,
    );
    expect((await readInventory(t.app.svcFor('costing'), 202601)).fingerprint).toBe(
      before.fingerprint,
    );
    await t.document('receipt', '1', '2');
    expect((await t.api.worksheet(saved)).stale).toBe(true);
    await expect(
      t.api.saveWorksheet({ ...january, fingerprint: preview.fingerprint }),
    ).rejects.toThrow(/来源数据已变化/);
  });
  it('试算保存和日志同事务；后续异常全部回滚；并发保存仅一个成功', async () => {
    await seed();
    const r = await t.api.preview(january);
    const input = { ...january, fingerprint: r.fingerprint };
    const svc = t.app.svcFor('costing');
    const logsBefore = await t.app.svc.db.selectFrom('operation_log').selectAll().execute();
    await expect(
      svc.tx(async (tx) => {
        await costingService(tx).saveWorksheet(input);
        throw new Error('回滚试算');
      }),
    ).rejects.toThrow('回滚试算');
    expect(await t.api.worksheets()).toEqual([]);
    expect(await t.app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(
      logsBefore,
    );
    const both = await Promise.allSettled([t.api.saveWorksheet(input), t.api.saveWorksheet(input)]);
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await t.api.worksheets()).toHaveLength(1);
    const active = (await t.api.worksheets())[0]!;
    await expect(
      svc.tx(async (tx) => {
        await costingService(tx).cancelWorksheet({
          id: active.id,
          revision: active.revision,
          confirmed: true,
        });
        throw new Error('回滚取消');
      }),
    ).rejects.toThrow('回滚取消');
    expect((await t.api.worksheet({ id: active.id })).status).toBe('preview');
    await t.app.svc.periods.setStatus(202601, 'closed');
    await expect(
      t.api.cancelWorksheet({ id: active.id, revision: active.revision, confirmed: true }),
    ).rejects.toThrow(/已经结账/);
    expect((await t.api.worksheet({ id: active.id })).status).toBe('preview');
  });
  it('期间、初始开账、空数据、过期盘点与非法期间均拒绝', async () => {
    await expect(t.api.preview({ period: 202600 })).rejects.toThrow();
    await expect(t.api.preview({ period: 202512 })).rejects.toThrow(/启用/);
    await expect(t.api.cancelCalculation()).rejects.toThrow(/初始开账日期/);
    const empty = await t.api.preview(january);
    expect(empty.rows).toEqual([]);
    await expect(
      t.api.saveWorksheet({ ...january, fingerprint: empty.fingerprint }),
    ).rejects.toThrow(/没有可试算/);
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
      rows: [{ productCode: 'P1', actual: '15' }],
    });
    await t.document('receipt', '1', '3');
    await expect(t.api.preview(january)).rejects.toThrow(/盘点账面数量已变化/);
    await t.app.svc.periods.setStatus(202601, 'closed');
    await expect(t.api.commit({ ...january, ...validCommitFields() })).rejects.toThrow(/已经结账/);
  });
  it('正式核算写入库存；权限逐接口检查', async () => {
    await seed();
    const before = await readInventory(t.app.svcFor('costing'), 202601);
    await expect(t.api.commit(await commitInput())).resolves.toMatchObject({
      status: 'calculated',
      period: 202601,
    });
    expect((await readInventory(t.app.svcFor('costing'), 202601)).fingerprint).not.toBe(
      before.fingerprint,
    );
    const viewer = caller(t.app, await t.app.addUser('viewer', { permissions: ['costing.view'] }));
    const r = await viewer.preview(january);
    await expect(viewer.saveWorksheet({ ...january, fingerprint: r.fingerprint })).rejects.toThrow(
      /权限/,
    );
    await expect(viewer.cancelWorksheet({ id: 1, revision: 1, confirmed: true })).rejects.toThrow(
      /权限/,
    );
    await expect(viewer.commit({ ...january, ...validCommitFields() })).rejects.toThrow(/权限/);
    await expect(viewer.cancelCalculation()).rejects.toThrow(/权限/);
    await expect(viewer.previewVoucher({ documentId: 1, purpose: 'receipt' })).rejects.toThrow(
      /权限/,
    );
    await expect(viewer.voucherDocuments()).rejects.toThrow(/权限/);
    await expect(
      viewer.generateVoucher({
        documentId: 1,
        purpose: 'receipt',
        voucherTypeId: 1,
        expectedRevision: 1,
        fingerprint: '0'.repeat(64),
        confirmed: true,
      }),
    ).rejects.toThrow(/权限/);
    const none = caller(t.app, await t.app.addUser('none'));
    await expect(none.preview(january)).rejects.toThrow(/权限/);
    await expect(none.worksheets()).rejects.toThrow(/权限/);
    await expect(none.worksheet({ id: 1 })).rejects.toThrow(/权限/);
    await expect(none.profit({ from: '2026-01-01', to: '2026-01-31' })).rejects.toThrow(/权限/);
  });
});

describe('w_cb_pz / w_ck_ck1 / w_ck_rk1：实际单据凭证接口', () => {
  it('来源凭证锁与已审核反操作不删除、不覆盖已有凭证', async () => {
    const { receipt } = await seed();
    const r = await t.api.preview(january);
    const worksheet = await t.api.saveWorksheet({ ...january, fingerprint: r.fingerprint });
    const voucher = await t.app.svcFor('costing').vouchers.create({
      date: '2026-01-10',
      voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
      source: { type: 'worksheet', id: String(worksheet.id) },
      lines: [
        { summary: '历史成本来源凭证', accountId: t.ids.cash, debit: 1 },
        { summary: '历史成本来源凭证', accountId: t.ids.sales, credit: 1 },
      ],
    });
    await sql`UPDATE inventory_document SET voucher_id=${voucher.id} WHERE id=${receipt.id}`.execute(
      t.app.svc.db,
    );
    await t.app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    const before = await readInventory(t.app.svcFor('costing'), 202601);
    await expect(t.app.svc.vouchers.delete(voucher.id)).rejects.toThrow(/成本核算/);
    await expect(t.app.svcFor('costing').vouchers.delete(voucher.id)).rejects.toThrow(/审核/);
    await expect(
      t.api.generateVoucher(await generateInput({ documentId: receipt.id, purpose: 'receipt' })),
    ).rejects.toThrow(/已有|审核|关联|旧版/);
    expect((await readInventory(t.app.svcFor('costing'), 202601)).fingerprint).toBe(
      before.fingerprint,
    );
    expect(await t.app.svc.vouchers.get(voucher.id)).toMatchObject({
      status: 'audited',
      source: { module: 'costing', type: 'worksheet', id: String(worksheet.id) },
    });
  });
  it('入库和收入价税分录平衡，数量科目带数量；预览不占号、生成实际凭证', async () => {
    await t.opening();
    const receipt = await t.document('receipt', '10', '3', { taxRate: '13' });
    const r = await t.api.previewVoucher({
      documentId: receipt.id,
      purpose: 'receipt',
      taxAccountId: t.ids.inputTax,
    });
    expect([r.debitCents, r.creditCents]).toEqual([3390, 3390]);
    expect(r.lines[0]).toMatchObject({
      accountId: t.ids.stock,
      debit: 3000,
      quantity: '10',
      unitPrice: '3.000000000000',
    });
    expect(r.lines[1]).toMatchObject({ accountId: t.ids.inputTax, debit: 390 });
    expect(r.lines[2]).toMatchObject({ accountId: t.ids.cash, credit: 3390 });
    const issue = await t.document('issue', '2', '10', { taxRate: '13' });
    const sale = await t.api.previewVoucher({
      documentId: issue.id,
      purpose: 'revenue',
      taxAccountId: t.ids.outputTax,
    });
    expect([sale.debitCents, sale.creditCents]).toEqual([2260, 2260]);
    expect(sale.lines.map((l) => [l.accountId, l.debit ?? 0, l.credit ?? 0])).toEqual([
      [t.ids.cash, 2260, 0],
      [t.ids.sales, 0, 2000],
      [t.ids.outputTax, 0, 260],
    ]);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    await expect(
      t.api.generateVoucher(
        await generateInput({
          documentId: receipt.id,
          purpose: 'receipt',
          taxAccountId: t.ids.inputTax,
        }),
      ),
    ).resolves.toMatchObject({ status: 'pending', number: 1 });
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
    const seeded = await seedVouchers(t.app.svc, [
      {
        date: '2026-01-01',
        lines: [
          { account: '1001', debit: 1 },
          { account: '6001', credit: 1 },
        ],
      },
    ]);
    expect(seeded[0]!.number).toBe(2);
  });
  it('领用不生成销售收入、成本必须正式核算；缺税额/非末级科目拒绝', async () => {
    await t.opening();
    const issue = await t.document('issue', '1', '5', { category: '领用' });
    await expect(
      t.api.previewVoucher({ documentId: issue.id, purpose: 'revenue' }),
    ).rejects.toThrow(/只有销售类别/);
    await expect(t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' })).rejects.toThrow(
      /正式成本核算/,
    );
    const receipt = await t.document('receipt', '1', '5', { taxRate: '13' });
    await expect(
      t.api.previewVoucher({ documentId: receipt.id, purpose: 'receipt' }),
    ).rejects.toThrow(/进项税科目没有录入/);
    await expect(
      t.api.previewVoucher({
        documentId: receipt.id,
        purpose: 'receipt',
        taxAccountId: (await t.app.svc.accounts.require('2221')).id,
      }),
    ).rejects.toThrow(/非明细/);
    await expect(
      t.api.previewVoucher({ documentId: receipt.id, purpose: 'revenue' }),
    ).rejects.toThrow(/只有出库单/);
    await expect(t.api.previewVoucher({ documentId: 99999, purpose: 'receipt' })).rejects.toThrow(
      /没有这张/,
    );
  });
});

describe('w_cb_hzsj_cblr / w_ck_xsmxz：销售利润与历史成本', () => {
  it('仅销售不含税收入；未核算成本/利润留空，已保存试算也不冒充正式成本', async () => {
    await seed();
    await t.document('issue', '1', '7', { category: '领用' });
    const r = await t.api.preview(january);
    await t.api.saveWorksheet({ ...january, fingerprint: r.fingerprint });
    const report = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      revenueCents: 5000,
      costCents: null,
      grossProfitCents: null,
      costStatus: '待成本核算',
    });
    expect(report.totals).toMatchObject({
      revenueCents: 5000,
      costCents: null,
      grossProfitCents: null,
      pendingLines: 1,
    });
    await expect(t.api.profit({ from: '2026-02-01', to: '2026-01-01' })).rejects.toThrow(
      /截止日期/,
    );
    await expect(
      t.api.profit({ from: '2026-01-01', to: '2026-01-31', productFrom: 'ZZZ' }),
    ).rejects.toThrow(/没有销售/);
  });
  it('仓库和账套隔离；另一仓同产品使用自己的成本池', async () => {
    await seed();
    const secondWarehouse = await t.inventory.saveWarehouse({ code: '02', name: '二仓' });
    await t.document('receipt', '5', '9', { warehouseId: secondWarehouse });
    const r = await t.api.preview(january);
    expect(r.rows.map((row) => [row.warehouseId, row.closingCents])).toEqual([
      [t.warehouseId, 3000],
      [secondWarehouse, 4500],
    ]);
    const other = await setup();
    try {
      expect((await other.api.preview(january)).rows).toEqual([]);
      await expect(other.api.worksheet({ id: 1 })).rejects.toThrow(/不存在/);
    } finally {
      await other.app.close();
    }
  });
  it('正式核算成本必须头/行批次和截止一致，部分缺失不显示合计毛利', async () => {
    const { issue } = await seed();
    await t.api.commit(await commitInput());
    let report = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(report.totals).toMatchObject({
      revenueCents: 5000,
      costCents: 1000,
      grossProfitCents: 4000,
      pendingLines: 0,
    });
    const cost = await t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' });
    expect([cost.debitCents, cost.creditCents]).toEqual([1000, 1000]);
    await sql`UPDATE inventory_line SET calculation_batch='mismatch' WHERE document_id=${issue.id}`.execute(
      t.app.svc.db,
    );
    report = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
    expect(report.totals.costCents).toBeNull();
    await expect(t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' })).rejects.toThrow(
      /正式成本核算/,
    );
  });
  it.each([
    {
      name: '同月全局 current-B 与头行 obsolete-A 不一致',
      controlBatch: 'current-B',
      documentBatch: 'obsolete-A',
      controlCutoff: '2026-01-31',
      documentCutoff: '2026-01-31',
    },
    {
      name: '头截止缺失',
      controlBatch: 'current-B',
      documentBatch: 'current-B',
      controlCutoff: '2026-01-31',
      documentCutoff: null,
    },
    {
      name: '头截止只到月中',
      controlBatch: 'current-B',
      documentBatch: 'current-B',
      controlCutoff: '2026-01-31',
      documentCutoff: '2026-01-15',
    },
    {
      name: '全局截止只到 1/15，即使覆盖 1/10 单据也不是完整核算',
      controlBatch: 'current-B',
      documentBatch: 'current-B',
      controlCutoff: '2026-01-15',
      documentCutoff: '2026-01-31',
    },
    {
      name: '全局截止晚于本月末也不构成同月证据',
      controlBatch: 'current-B',
      documentBatch: 'current-B',
      controlCutoff: '2026-02-28',
      documentCutoff: '2026-01-31',
    },
    {
      name: '原独审组合：旧头行批次且头截止为空',
      controlBatch: 'current-B',
      documentBatch: 'obsolete-A',
      controlCutoff: '2026-01-31',
      documentCutoff: null,
    },
  ])(
    'w_cb_hzsj_cblr / w_cb_pz：$name，正式成本未知且不占凭证号',
    async ({ controlBatch, documentBatch, controlCutoff, documentCutoff }) => {
      const { issue } = await seed();
      // 合成不一致证据作为回归前置，不代表发现原账事故，也不是正式核算 writer。
      await sql`UPDATE inventory_control SET cost_period=202601, cost_cutoff_date=${controlCutoff}, cost_batch=${controlBatch}`.execute(
        t.app.svc.db,
      );
      await sql`UPDATE inventory_document SET calculation_status='calculated', calculation_batch=${documentBatch}, calculation_period=202601, calculation_cutoff_date=${documentCutoff} WHERE id=${issue.id}`.execute(
        t.app.svc.db,
      );
      await sql`UPDATE inventory_line SET outbound_cost_cents=1000, calculation_status='calculated', calculation_batch=${documentBatch}, calculation_period=202601 WHERE document_id=${issue.id}`.execute(
        t.app.svc.db,
      );
      const snapshot = await readInventory(t.app.svcFor('costing'), 202601);
      const doc = snapshot.documents.find((d) => d.id === issue.id)!;
      const line = snapshot.lines.find((l) => l.document_id === issue.id)!;
      expect(officialCost(snapshot, doc, line)).toBeNull();
      const report = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
      expect(report.rows[0]).toMatchObject({ costCents: null, grossProfitCents: null });
      expect(report.totals).toMatchObject({
        costCents: null,
        grossProfitCents: null,
        pendingLines: 1,
      });
      await expect(
        t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' }),
      ).rejects.toMatchObject({ cause: { data: { code: 'COSTING_NOT_CALCULATED' } } });
      expect((await t.app.svc.vouchers.list()).total).toBe(0);
      expect((await readInventory(t.app.svcFor('costing'), 202601)).fingerprint).toBe(
        snapshot.fingerprint,
      );
    },
  );
  it.each(['current-B', 'history-A'])(
    'w_cb_hzsj_cblr / w_cb_pz：跨月全局批次 %s 不能证明历史月份，显式返回历史成本未知',
    async (latestBatch) => {
      const { issue } = await seed();
      await sql`UPDATE inventory_control SET cost_period=202602, cost_cutoff_date='2026-02-28', cost_batch=${latestBatch}`.execute(
        t.app.svc.db,
      );
      await sql`UPDATE inventory_document SET calculation_status='calculated', calculation_batch='history-A', calculation_period=202601, calculation_cutoff_date='2026-01-31' WHERE id=${issue.id}`.execute(
        t.app.svc.db,
      );
      await sql`UPDATE inventory_line SET outbound_cost_cents=1000, calculation_status='calculated', calculation_batch='history-A', calculation_period=202601 WHERE document_id=${issue.id}`.execute(
        t.app.svc.db,
      );
      const snapshot = await readInventory(t.app.svcFor('costing'), 202601);
      expect(
        officialCost(
          snapshot,
          snapshot.documents.find((d) => d.id === issue.id)!,
          snapshot.lines.find((l) => l.document_id === issue.id)!,
        ),
      ).toBeNull();
      const report = await t.api.profit({ from: '2026-01-01', to: '2026-01-31' });
      expect(report.rows[0]).toMatchObject({
        costCents: null,
        grossProfitCents: null,
        costStatus: '历史成本未知',
      });
      expect(report.totals).toMatchObject({
        costCents: null,
        grossProfitCents: null,
        unknownHistoryLines: 1,
      });
      await expect(
        t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' }),
      ).rejects.toMatchObject({
        cause: {
          data: { code: 'COSTING_HISTORY_UNVERIFIED', message: '历史成本未知，不能预览成本凭证' },
        },
      });
      expect((await t.app.svc.vouchers.list()).total).toBe(0);
      expect((await readInventory(t.app.svcFor('costing'), 202601)).fingerprint).toBe(
        snapshot.fingerprint,
      );
    },
  );
});
