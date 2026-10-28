import { createHash } from 'node:crypto';
import { sumCents } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import { FilterSchema, type DocumentInput, type Filter } from '../shared';
import {
  AuditTransferSchema,
  RemoveTransferSchema,
  TransferSchema,
  type TransferIdentity,
  type TransferInput,
} from '../transfer';
import type { InventoryTables } from './migrations';
import { fail, inventoryService } from './service';

export type TransferTables = InventoryTables;

type Transfer = z.infer<typeof TransferSchema>;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function documents(v: Transfer): { issue: DocumentInput; receipt: DocumentInput } {
  // 调拨采用用户明确填写的调拨单价；两端使用同一数量、单价和零税率。
  // 此单价是调拨单金额，正式出库成本仍由月末核算处理。
  const common = {
    date: v.date,
    operator: v.operator,
    summary: v.summary || `调拨 ${v.number}`,
    accountId: v.clearingAccountId,
    costAccountId: v.clearingAccountId,
    taxRate: '0',
    lines: v.lines.map((l) => ({ ...l, priceIncludesTax: false })),
  };
  return {
    issue: {
      ...common,
      requestKey: `${v.requestKey}:out`,
      kind: 'issue',
      warehouseId: v.sourceWarehouseId,
      number: `调出-${v.number}`,
      category: '其他出库',
      negativeConfirmation: v.negativeConfirmation,
    },
    receipt: {
      ...common,
      requestKey: `${v.requestKey}:in`,
      kind: 'receipt',
      warehouseId: v.targetWarehouseId,
      number: `调入-${v.number}`,
      category: '其他入库',
    },
  };
}

export function inventoryTransfer(svc: CoreServices) {
  const db = svc.db.withTables<TransferTables>();
  const row = async (id: number) => {
    const r = await db
      .selectFrom('inventory_transfer')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) fail('TRANSFER_NOT_FOUND', '这张调拨单已不存在', '请刷新调拨列表');
    return r;
  };
  const checkIdentity = async (v: TransferIdentity) => {
    const r = await row(v.id);
    const s = inventoryService(svc);
    const issue = await s.getDocument(r.issue_document_id);
    const receipt = await s.getDocument(r.receipt_document_id);
    if (
      r.revision !== v.revision ||
      issue.revision !== v.issueRevision ||
      receipt.revision !== v.receiptRevision
    )
      fail('REVISION', '调拨单或其出入库单已被修改', '请刷新调拨列表后重试');
    return { r, issue, receipt };
  };
  const self = {
    async get(id: number) {
      svc.permissions.require('inventory.view');
      const r = await row(id);
      const s = inventoryService(svc);
      const issue = await s.getDocument(r.issue_document_id);
      const receipt = await s.getDocument(r.receipt_document_id);
      return { ...r, issue, receipt };
    },
    async list(filter: Filter = {}) {
      svc.permissions.require('inventory.view');
      const f = FilterSchema.parse(filter);
      let q = db
        .selectFrom('inventory_transfer as t')
        .innerJoin('inventory_document as i', 'i.id', 't.issue_document_id')
        .innerJoin('inventory_document as r', 'r.id', 't.receipt_document_id')
        .innerJoin('inventory_warehouse as sw', 'sw.id', 'i.warehouse_id')
        .innerJoin('inventory_warehouse as tw', 'tw.id', 'r.warehouse_id')
        .selectAll('t')
        .select([
          'i.date',
          'i.summary',
          'i.warehouse_id as sourceWarehouseId',
          'r.warehouse_id as targetWarehouseId',
          'sw.name as sourceWarehouseName',
          'tw.name as targetWarehouseName',
          'i.revision as issueRevision',
          'r.revision as receiptRevision',
          'i.number as issueNumber',
          'r.number as receiptNumber',
          'i.audited_by as issueAuditedBy',
          'r.audited_by as receiptAuditedBy',
          'i.calculation_status as issueCalculationStatus',
          'r.calculation_status as receiptCalculationStatus',
        ])
        .orderBy('i.date', 'desc')
        .orderBy('t.id', 'desc');
      if (f.id) q = q.where('t.id', '=', f.id);
      if (f.warehouseId)
        q = q.where((eb) =>
          eb.or([
            eb('i.warehouse_id', '=', f.warehouseId!),
            eb('r.warehouse_id', '=', f.warehouseId!),
          ]),
        );
      if (f.from) q = q.where('i.date', '>=', f.from);
      if (f.to) q = q.where('i.date', '<=', f.to);
      if (f.keyword)
        q = q.where((eb) =>
          eb.or([
            eb('t.number', 'like', `%${f.keyword}%`),
            eb('i.summary', 'like', `%${f.keyword}%`),
          ]),
        );
      if (f.unaudited)
        q = q.where((eb) =>
          eb.or([eb('i.audited_by', 'is', null), eb('r.audited_by', 'is', null)]),
        );
      return q.execute();
    },
    async preview(raw: TransferInput) {
      svc.permissions.require('inventory.edit');
      const v = TransferSchema.parse(raw);
      return svc.tx(async (t) => {
        const d = documents(v),
          s = inventoryService(t);
        const { negativeConfirmation: _n, ...payload } = v;
        const done = await t.db
          .withTables<TransferTables>()
          .selectFrom('inventory_transfer')
          .selectAll()
          .where('request_key', '=', v.requestKey)
          .executeTakeFirst();
        if (done) {
          if (done.payload_hash !== digest(payload) || done.created_by !== t.user.id)
            fail('TRANSFER_REQUEST', '同一次调拨请求编号被用于不同内容或操作员', '请重新发起调拨');
          const issue = await s.getDocument(done.issue_document_id);
          const receipt = await s.getDocument(done.receipt_document_id);
          return {
            shortages: [],
            confirmation: '',
            netCents: sumCents(issue.lines.map((l) => l.net_cents)),
            taxCents: sumCents(issue.lines.map((l) => l.tax_cents)),
            grossCents: sumCents(issue.lines.map((l) => l.gross_cents)),
            issueNumber: issue.number,
            receiptNumber: receipt.number,
          };
        }
        const dup = await t.db
          .withTables<TransferTables>()
          .selectFrom('inventory_transfer')
          .select('id')
          .where('number', '=', v.number)
          .executeTakeFirst();
        if (dup) fail('TRANSFER_NUMBER', `调拨单号 ${v.number} 重复`, '请填写新的调拨单号');
        await s.previewDocument(d.receipt);
        const preview = await s.previewDocument(d.issue);
        return { ...preview, issueNumber: d.issue.number, receiptNumber: d.receipt.number };
      });
    },
    async save(raw: TransferInput) {
      svc.permissions.require('inventory.edit');
      const v = TransferSchema.parse(raw);
      const { negativeConfirmation: _n, ...payload } = v;
      const payloadHash = digest(payload);
      return svc.tx(async (t) => {
        const tdb = t.db.withTables<TransferTables>();
        const done = await tdb
          .selectFrom('inventory_transfer')
          .selectAll()
          .where('request_key', '=', v.requestKey)
          .executeTakeFirst();
        if (done) {
          if (done.payload_hash !== payloadHash || done.created_by !== t.user.id)
            fail('TRANSFER_REQUEST', '同一次调拨请求编号被用于不同内容或操作员', '请重新发起调拨');
          return inventoryTransfer(t).get(done.id);
        }
        if (
          await tdb
            .selectFrom('inventory_transfer')
            .select('id')
            .where('number', '=', v.number)
            .executeTakeFirst()
        )
          fail('TRANSFER_NUMBER', `调拨单号 ${v.number} 重复`, '请填写新的调拨单号');
        const d = documents(v);
        // 先验证调入端，避免用户确认负库存后才发现另一端不合法。
        await inventoryService(t).previewDocument(d.receipt);
        return t.inventory.with(async (inventory) => {
          const issue = await inventory.saveDocument(d.issue);
          const receipt = await inventory.saveDocument(d.receipt);
          const saved = await tdb
            .insertInto('inventory_transfer')
            .values({
              number: v.number,
              request_key: v.requestKey,
              payload_hash: payloadHash,
              issue_document_id: issue.id,
              receipt_document_id: receipt.id,
              revision: 1,
              created_by: t.user.id,
              created_at: t.ctx.now().toISOString(),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await t.log.write({
            action: 'inventory.transfer.save',
            summary: `保存调拨单 ${v.number}`,
            targetId: saved.id,
            detail: {
              issueId: issue.id,
              receiptId: receipt.id,
              sourceWarehouseId: v.sourceWarehouseId,
              targetWarehouseId: v.targetWarehouseId,
            },
          });
          return inventoryTransfer(t).get(saved.id);
        });
      });
    },
    async audit(raw: z.input<typeof AuditTransferSchema>) {
      svc.permissions.require('inventory.audit');
      const v = AuditTransferSchema.parse(raw);
      return svc.tx(async (t) => {
        const { r, issue, receipt } = await inventoryTransfer(t).checkIdentity(v),
          s = inventoryService(t);
        await s.sourceUnlocked(issue, true);
        await s.sourceUnlocked(receipt, true);
        if ((issue.audited_by != null) === v.to && (receipt.audited_by != null) === v.to)
          fail(
            'TRANSFER_AUDIT',
            v.to ? '这张调拨单已经审核' : '这张调拨单尚未审核',
            '请刷新列表后核对状态',
          );
        for (const d of [issue, receipt])
          if ((d.audited_by != null) !== v.to)
            await s.audit({ id: d.id, revision: d.revision, to: v.to }, r.id);
        await t.db
          .withTables<TransferTables>()
          .updateTable('inventory_transfer')
          .set({ revision: r.revision + 1 })
          .where('id', '=', r.id)
          .execute();
        await t.log.write({
          action: v.to ? 'inventory.transfer.audit' : 'inventory.transfer.unaudit',
          summary: `${v.to ? '审核' : '取消审核'}调拨单 ${r.number}`,
          targetId: r.id,
        });
        return inventoryTransfer(t).get(r.id);
      });
    },
    async remove(raw: z.input<typeof RemoveTransferSchema>) {
      svc.permissions.require('inventory.edit');
      const v = RemoveTransferSchema.parse(raw);
      if (!v.confirmed)
        fail('CONFIRM', '删除调拨单及两端库存影响需要确认', '请先核对调出与调入仓库和单号');
      return svc.tx(async (t) => {
        const { r, issue, receipt } = await inventoryTransfer(t).checkIdentity(v),
          s = inventoryService(t);
        await s.sourceUnlocked(issue);
        await s.sourceUnlocked(receipt);
        await t.db
          .withTables<TransferTables>()
          .deleteFrom('inventory_transfer')
          .where('id', '=', r.id)
          .execute();
        await t.inventory.with(async (inventory) => {
          // 调入数量若已被使用，removeDocument 会阻止，外层事务恢复完整配对。
          await inventory.removeDocument({
            id: receipt.id,
            revision: receipt.revision,
            confirmed: true,
          });
          await inventory.removeDocument({
            id: issue.id,
            revision: issue.revision,
            confirmed: true,
          });
        });
        await t.log.write({
          action: 'inventory.transfer.delete',
          summary: `删除调拨单 ${r.number} 及成对出入库单`,
          targetId: r.id,
          detail: {
            issueId: issue.id,
            receiptId: receipt.id,
            amountCents: sumCents(receipt.lines.map((l) => l.net_cents)),
          },
        });
      });
    },
    checkIdentity,
  };
  return self;
}
