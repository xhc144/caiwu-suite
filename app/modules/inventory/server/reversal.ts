import { createHash } from 'node:crypto';
import type { CoreServices } from '@caiwu/core/server';
import { ReversalSchema, type ReversalInput } from '../reversal';
import type { DocumentInput } from '../shared';
import type { InventoryTables } from './migrations';
import { fail, inventoryService } from './service';

export function inventoryReversal(svc: CoreServices) {
  const prepare = async (raw: ReversalInput) => {
    const v = ReversalSchema.parse(raw);
    const s = inventoryService(svc);
    const source = await s.getDocument(v.id);
    if (source.revision !== v.revision) fail('REVISION', '原单据已被修改，请重新打开反冲窗口');
    await s.protectedDocument(source.id);
    if (v.date < source.date) fail('REVERSAL_DATE', '反冲日期不能早于原单据日期');
    if (source.kind === 'issue' && (!v.unitPrices || v.unitPrices.length !== source.lines.length))
      fail(
        'REVERSAL_PRICE',
        '出库反冲需要逐行确认入库单价',
        '请按实际退回货物的计价依据填写单价，不能用销售价代替库存成本',
      );
    if (source.kind === 'receipt' && v.unitPrices)
      fail('REVERSAL_PRICE', '入库反冲使用原单不含税单价，不接受另填价格');
    const input: DocumentInput = {
      kind: source.kind === 'receipt' ? 'issue' : 'receipt',
      warehouseId: source.warehouse_id,
      requestKey: `reverse:${v.requestKey}`,
      number: v.number,
      date: v.date,
      category: source.kind === 'receipt' ? '其他出库' : '其他入库',
      accountId: source.kind === 'issue' ? v.accountId : null,
      costAccountId: source.kind === 'receipt' ? v.accountId : null,
      taxRate: source.kind === 'receipt' ? source.tax_rate : '0',
      invoiceKind: source.kind === 'receipt' ? source.invoice_kind : 'none',
      operator: svc.user.name,
      summary: `反冲${source.kind === 'receipt' ? '入' : '出'}库单 ${source.number}`.slice(0, 200),
      sourceType: 'document',
      sourceId: source.id,
      negativeConfirmation: v.negativeConfirmation,
      lines: source.lines.map((line, i) => ({
        productCode: line.productCode,
        quantity: line.quantity,
        unitPrice: source.kind === 'issue' ? v.unitPrices![i]! : line.unitPrice,
        priceIncludesTax: source.kind === 'receipt' && line.priceIncludesTax,
        note: line.note,
      })),
    };
    // 入库反冲保留原输入单价和税价口径，避免反算单价截断。
    // 反冲出库正式成本仍由本期成本核算确定；退回入库由用户明确确认计价。
    return { v, source, input };
  };
  return {
    async preview(raw: ReversalInput) {
      svc.permissions.require('inventory.edit');
      return svc.tx(async (t) => {
        const p = await inventoryReversal(t).prepare(raw);
        return {
          ...(await inventoryService(t).previewDocument(p.input)),
          kind: p.input.kind,
          sourceNumber: p.source.number,
        };
      });
    },
    async save(raw: ReversalInput) {
      svc.permissions.require('inventory.edit');
      const v = ReversalSchema.parse(raw);
      const { confirmed: _c, negativeConfirmation: _n, ...content } = v;
      const payloadHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
      if (!v.confirmed) fail('CONFIRM', '请核对反冲方向、数量和金额后确认保存');
      return svc.tx(async (t) => {
        const db = t.db.withTables<InventoryTables>();
        const done = await db
          .selectFrom('inventory_reversal')
          .selectAll()
          .where('request_key', '=', v.requestKey)
          .executeTakeFirst();
        if (done) {
          if (done.payload_hash !== payloadHash || done.created_by !== t.user.id)
            fail('REVERSAL_REQUEST', '同一反冲请求编号被用于不同内容或操作员');
          return inventoryService(t).getDocument(done.reversal_document_id);
        }
        const p = await inventoryReversal(t).prepare(v);
        return t.inventory.with(async (inventory) => {
          const saved = await inventory.saveDocument(p.input);
          await db
            .insertInto('inventory_reversal')
            .values({
              original_document_id: v.id,
              reversal_document_id: saved.id,
              request_key: v.requestKey,
              payload_hash: payloadHash,
              created_by: t.user.id,
              created_at: t.ctx.now().toISOString(),
            })
            .execute();
          await db
            .updateTable('inventory_document')
            .set({ revision: p.source.revision + 1 })
            .where('id', '=', v.id)
            .execute();
          await t.log.write({
            action: 'inventory.document.reverse',
            summary: `反冲单据 ${p.source.number} → ${v.number}`,
            targetId: saved.id,
            detail: { sourceId: v.id, reversalId: saved.id, kind: p.input.kind },
          });
          return inventoryService(t).getDocument(saved.id);
        });
      });
    },
    prepare,
  };
}
