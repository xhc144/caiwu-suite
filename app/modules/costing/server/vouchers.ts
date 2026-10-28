import { periodEndDate, sumCents, type VoucherLineInput, type VoucherStatus } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  DeleteVoucherSchema,
  GenerateVoucherSchema,
  RegenerateVoucherSchema,
  VoucherPreviewSchema,
  VoucherTargetSchema,
} from '../shared';
import {
  digest,
  inventoryReader,
  isUnverifiedHistory,
  officialCost,
  readInventory,
  verifiedBatches,
} from './inventory-read';
import { fail, integer, quantity, safe, unitCost } from './math';

/** 库存来源和正式盘点调整的只读投影；写入只走库存事务能力。 */
type VoucherReadTables = {
  inventory_voucher_source: {
    document_id: number;
    purpose: 'receipt' | 'revenue' | 'cost';
    voucher_id: number;
    owner_module: string;
  };
  inventory_count: {
    id: number;
    warehouse_id: number;
    period: number;
    revision: number;
    calculation_status: string;
    calculation_batch: string | null;
  };
  inventory_costing_adjustment: {
    batch_id: string;
    warehouse_id: number;
    product_id: number;
    count_id: number | null;
    quantity_e6: number;
    amount_cents: number;
    zero_cents: number;
  };
  costing_count_voucher: {
    count_id: number;
    batch_id: string;
    voucher_id: number;
    revision: number;
  };
};
type Target = z.input<typeof VoucherTargetSchema>;
type PreviewInput = z.input<typeof VoucherPreviewSchema>;
type Link = {
  purpose: 'receipt' | 'revenue' | 'cost' | 'count';
  voucherId: number;
  displayNo: string;
  status: VoucherStatus;
  revision: number;
};

async function linksFor(svc: CoreServices, target: Target): Promise<Link[]> {
  const db = svc.db.withTables<VoucherReadTables>();
  const sources =
    target.purpose === 'count'
      ? (
          await db
            .selectFrom('costing_count_voucher')
            .select('voucher_id')
            .where('count_id', '=', target.countId!)
            .execute()
        ).map((r) => ({ ...r, purpose: 'count' as const }))
      : await db
          .selectFrom('inventory_voucher_source')
          .select(['purpose', 'voucher_id'])
          .where('document_id', '=', target.documentId!)
          .orderBy('purpose')
          .execute();
  const links: Link[] = [];
  for (const source of sources) {
    const voucher = await svc.vouchers.get(source.voucher_id);
    if (!voucher)
      fail('VOUCHER_MISSING', '来源关联的凭证不存在', '请核对出入库单据和凭证记录后再操作');
    if (
      target.purpose === 'count' &&
      (voucher.source?.module !== svc.moduleId ||
        voucher.source.type !== 'count' ||
        voucher.source.id !== String(target.countId))
    )
      fail('VOUCHER_SOURCE', '盘点凭证的来源关联不一致', '请核对盘点表和凭证记录后再操作');
    links.push({
      purpose: source.purpose,
      voucherId: voucher.id,
      displayNo: voucher.displayNo,
      status: voucher.status,
      revision: voucher.revision,
    });
  }
  return links;
}

async function source(svc: CoreServices, input: Target) {
  const db = await inventoryReader(svc);
  if (input.purpose === 'count') {
    const count = await svc.db
      .withTables<VoucherReadTables>()
      .selectFrom('inventory_count')
      .selectAll()
      .where('id', '=', input.countId!)
      .executeTakeFirst();
    if (!count) fail('COUNT', '当前账套中没有这张盘点表', '请刷新盘点表列表');
    return {
      kind: 'count' as const,
      id: count.id,
      revision: count.revision,
      period: count.period,
      date: periodEndDate(count.period),
      number: `盘点 ${count.period}`,
      count,
      doc: null,
    };
  }
  const doc = await db
    .selectFrom('inventory_document')
    .selectAll()
    .where('id', '=', input.documentId!)
    .executeTakeFirst();
  if (!doc) fail('DOCUMENT', '当前账套中没有这张出入库单据', '请刷新单据列表');
  return {
    kind: doc.kind,
    id: doc.id,
    revision: doc.revision,
    period: doc.period,
    date: doc.date,
    number: doc.number,
    count: null,
    doc,
  };
}

/** 列出同一销售单的收入和成本凭证，另列正式核算后的盘点来源。 */
export async function listVoucherDocuments(svc: CoreServices) {
  svc.permissions.require('costing.voucher');
  return svc.tx(async (t) => {
    const db = await inventoryReader(t);
    const documents = await db
      .selectFrom('inventory_document')
      .select(['id', 'number', 'date', 'period', 'kind', 'category', 'revision', 'source_type'])
      .orderBy('date', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const counts = await t.db
      .withTables<VoucherReadTables>()
      .selectFrom('inventory_count')
      .selectAll()
      .orderBy('period', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const result = [];
    for (const doc of documents)
      result.push({
        ...doc,
        sourceType: doc.source_type,
        revenueEligible:
          doc.kind === 'issue' && doc.category === '销售' && doc.source_type !== 'invoice',
        documentId: doc.id,
        countId: undefined,
        sources: await linksFor(t, {
          documentId: doc.id,
          purpose: doc.kind === 'receipt' ? 'receipt' : 'revenue',
        }),
      });
    const warehouses = await db.selectFrom('inventory_warehouse').select(['id', 'name']).execute();
    for (const count of counts)
      result.push({
        id: count.id,
        documentId: undefined,
        countId: count.id,
        number:
          `盘点 ${count.period} ${warehouses.find((w) => w.id === count.warehouse_id)?.name ?? ''}`.trim(),
        date: periodEndDate(count.period),
        period: count.period,
        kind: 'count' as const,
        category: '盘点',
        sourceType: null,
        revenueEligible: false,
        revision: count.revision,
        sources: await linksFor(t, { countId: count.id, purpose: 'count' }),
      });
    return result;
  });
}

async function buildPreview(svc: CoreServices, input: PreviewInput) {
  const target = await source(svc, input);
  const snapshot = await readInventory(svc, target.period);
  const links = await linksFor(svc, input);
  const doc = target.doc;
  if (input.purpose === 'receipt' && doc?.kind !== 'receipt')
    fail('PURPOSE', '只有入库单可以生成入库凭证');
  if (input.purpose !== 'receipt' && input.purpose !== 'count' && doc?.kind !== 'issue')
    fail('PURPOSE', '只有出库单可以生成收入或成本凭证');
  if (input.purpose === 'revenue' && doc?.category !== '销售')
    fail('PURPOSE', '只有销售类别出库单才有销售收入凭证', '领用出库请在本月成本核算后生成成本凭证');
  if (input.purpose === 'revenue' && doc?.source_type === 'invoice')
    fail(
      'INVOICE_REVENUE_OWNED',
      '该出库单来自销售发票，收入凭证由发票功能生成，不能重复制证',
      '请到发票功能查看或生成收入凭证；本功能仍可生成该单成本凭证',
    );
  const lines: VoucherLineInput[] = [];
  const summary = `${input.purpose === 'receipt' ? '入库' : input.purpose === 'revenue' ? '销售收入' : input.purpose === 'count' ? '盘盈盘亏' : '出库成本'} ${target.number}`;
  const append = async (
    id: number | null | undefined,
    amount: number,
    side: 'debit' | 'credit',
    label: string,
    quantityE6?: number,
  ) => {
    integer(amount);
    if (amount < 0) fail('AMOUNT', `${label}金额不能为负`);
    if (amount === 0 && (quantityE6 == null || quantityE6 === 0)) return;
    if (!id) fail('ACCOUNT', `${label}科目没有录入`, '请补全单据、产品档案或凭证科目');
    const account = await svc.accounts.get(id);
    if (!account || !account.isLeaf || account.disabled)
      fail('ACCOUNT', `${label}科目不存在、已停用或非明细科目`);
    if (account.currency)
      fail('ACCOUNT_CURRENCY', `${label}科目启用了外币，来源单据没有外币金额`, '请选择本位币科目');
    const dimensions: NonNullable<VoucherLineInput['dimensions']> = {};
    for (const config of account.dimensions) {
      if (config.required && !config.defaultItemId)
        fail('DIMENSION', `${label}科目需要辅助核算项，来源单据未提供`, '请先为科目设置默认辅助项');
      if (config.defaultItemId) {
        const item = await svc.dimensions.get(config.defaultItemId);
        if (!item || item.disabled || !item.isLeaf || item.typeId !== config.type)
          fail('DIMENSION', `${label}科目的默认辅助项不可用`);
        dimensions[config.type] = item.id;
      }
    }
    if (account.quantityUnit && quantityE6 == null)
      fail('QUANTITY_ACCOUNT', `${label}科目需要数量，当前分录没有可用数量`);
    // 没有数量核算的科目不产生零金额空分录。
    if (amount === 0 && !account.quantityUnit) return;
    lines.push({
      summary,
      accountId: account.id,
      dimensions,
      [side]: amount,
      ...(account.quantityUnit && quantityE6 != null
        ? {
            quantity: quantity(integer(quantityE6)),
            unitPrice: unitCost(integer(amount), integer(quantityE6)),
            entrySide: side,
          }
        : {}),
    });
  };
  let batchId: string | null = null;
  let adjustments: VoucherReadTables['inventory_costing_adjustment'][] = [];
  if (input.purpose === 'count') {
    const count = target.count!;
    batchId = count.calculation_batch;
    if (
      count.calculation_status !== 'calculated' ||
      !batchId ||
      verifiedBatches(snapshot.sharedSnapshot).get(batchId) !== count.period
    )
      fail(
        'NOT_CALCULATED',
        '盘点表尚未完成正式成本核算，不能生成盘点凭证',
        '请先完成该月正式成本核算',
      );
    adjustments = await svc.db
      .withTables<VoucherReadTables>()
      .selectFrom('inventory_costing_adjustment')
      .selectAll()
      .where('batch_id', '=', batchId)
      .where('count_id', '=', count.id)
      .orderBy('product_id')
      .execute();
    for (const adjustment of adjustments) {
      const product = snapshot.products.find((p) => p.id === adjustment.product_id);
      if (!product) fail('SOURCE', '盘点产品档案不存在', '请核对产品档案');
      const amount = sumCents([adjustment.amount_cents, adjustment.zero_cents]);
      const gain = amount > 0 || (amount === 0 && adjustment.quantity_e6 > 0);
      const absAmount = safe(integer(amount) < 0n ? -integer(amount) : integer(amount));
      const absQuantity = safe(
        integer(adjustment.quantity_e6) < 0n
          ? -integer(adjustment.quantity_e6)
          : integer(adjustment.quantity_e6),
      );
      await append(
        product.inventory_account_id,
        absAmount,
        gain ? 'debit' : 'credit',
        '产品存货',
        absQuantity,
      );
      await append(
        input.adjustmentAccountId,
        absAmount,
        gain ? 'credit' : 'debit',
        '待处理财产损溢',
      );
    }
  } else {
    const sourceLines = snapshot.lines.filter((l) => l.document_id === doc!.id);
    if (!sourceLines.length) fail('EMPTY', '单据没有明细，不能生成凭证');
    if (input.purpose === 'receipt') {
      for (const l of sourceLines) {
        const p = snapshot.products.find((p) => p.id === l.product_id)!;
        await append(p.inventory_account_id, l.net_cents, 'debit', '产品存货', l.quantity_e6);
      }
      await append(
        input.taxAccountId,
        sumCents(sourceLines.map((l) => l.tax_cents)),
        'debit',
        '进项税',
      );
      await append(
        doc!.account_id,
        sumCents(sourceLines.map((l) => l.gross_cents)),
        'credit',
        '付款',
      );
    } else if (input.purpose === 'revenue') {
      await append(
        doc!.account_id,
        sumCents(sourceLines.map((l) => l.gross_cents)),
        'debit',
        '收款',
      );
      for (const l of sourceLines) {
        const p = snapshot.products.find((p) => p.id === l.product_id)!;
        await append(
          p.sales_account_id ?? input.revenueAccountId,
          l.net_cents,
          'credit',
          '销售收入',
          l.quantity_e6,
        );
      }
      await append(
        input.taxAccountId,
        sumCents(sourceLines.map((l) => l.tax_cents)),
        'credit',
        '销项税',
      );
    } else {
      for (const l of sourceLines) {
        const cost = officialCost(snapshot, doc!, l);
        if (cost == null && isUnverifiedHistory(snapshot, doc!))
          fail('HISTORY_UNVERIFIED', '历史成本未知，不能预览成本凭证', '请先核实历史核算记录');
        if (cost == null)
          fail(
            'NOT_CALCULATED',
            '本月尚未完成正式成本核算，不能生成成本凭证',
            '先完成库存成本核算；保存试算不能替代正式核算',
          );
        const p = snapshot.products.find((p) => p.id === l.product_id)!;
        await append(doc!.cost_account_id, cost, 'debit', '出库成本', l.quantity_e6);
        await append(p.inventory_account_id, cost, 'credit', '产品存货', l.quantity_e6);
      }
    }
  }
  const debitCents = sumCents(lines.map((l) => l.debit));
  const creditCents = sumCents(lines.map((l) => l.credit));
  if (debitCents !== creditCents) fail('UNBALANCED', '凭证借贷不平，请核对来源金额和科目映射');
  const generationBlocker =
    lines.length === 0
      ? '本单没有需要入账的金额或数量变动，无需生成金额凭证'
      : lines.length === 1 && debitCents === 0 && creditCents === 0
        ? '本单金额为零，仅有一条库存数量分录；库存数量已经记录，当前账务凭证要求至少两条有效分录，暂不能单独生成数量凭证'
        : null;
  return {
    status: 'preview' as const,
    documentId: input.documentId,
    countId: input.countId,
    purpose: input.purpose,
    date: target.date,
    lines,
    debitCents,
    creditCents,
    fingerprint: digest({
      inventory: snapshot.fingerprint,
      target: input.purpose === 'count' ? target.count : target.doc,
      adjustments,
      links,
      mappings: {
        taxAccountId: input.taxAccountId,
        revenueAccountId: input.revenueAccountId,
        adjustmentAccountId: input.adjustmentAccountId,
      },
      lines,
    }),
    expectedRevision: target.revision,
    links,
    canGenerate: !generationBlocker && !links.some((link) => link.purpose === input.purpose),
    generationBlocker,
    batchId,
  };
}

export async function previewVoucher(svc: CoreServices, raw: PreviewInput) {
  svc.permissions.require('costing.voucher');
  const input = VoucherPreviewSchema.parse(raw);
  return svc.tx((t) => buildPreview(t, input));
}

function requireConfirmation(confirmed: boolean) {
  if (!confirmed) fail('CONFIRM', '生成或删除凭证需要确认', '请先核对凭证分录和编号影响后再确认');
}

async function createFromPreview(
  svc: CoreServices,
  input: z.infer<typeof GenerateVoucherSchema>,
  preview: Awaited<ReturnType<typeof buildPreview>>,
) {
  if (preview.generationBlocker)
    fail(
      'QUANTITY_ONLY_VOUCHER',
      preview.generationBlocker,
      '可在库存台账查看数量；本次不会生成凭证或占用编号',
    );
  const target = await source(svc, input);
  await svc.periods.assertWritable({ period: target.period, action: '生成出入库凭证' });
  if (target.doc?.voucher_id != null)
    fail('VOUCHER_LEGACY', '来源单据已有旧版凭证关联，不能覆盖', '请先核对并处理已有凭证');
  const voucher = await svc.vouchers.create({
    voucherTypeId: input.voucherTypeId,
    number: input.number,
    date: preview.date,
    source: { type: input.purpose, id: String(target.id) },
    lines: preview.lines,
  });
  if (input.purpose === 'count') {
    await svc.db
      .withTables<VoucherReadTables>()
      .insertInto('costing_count_voucher')
      .values({
        count_id: target.id,
        batch_id: preview.batchId!,
        voucher_id: voucher.id,
        revision: 1,
      })
      .execute();
  } else {
    const purpose = input.purpose;
    await svc.inventory.with(async (inventory) => {
      await inventory.lockVoucherSource({
        bookId: (await svc.book.info()).id,
        documentId: target.id,
        purpose,
        expectedRevision: target.revision,
        voucherId: voucher.id,
      });
    });
  }
  await svc.log.write({
    action: 'costing.voucher.generate',
    summary: `生成${input.purpose === 'count' ? '盘点' : input.purpose === 'cost' ? '成本' : input.purpose === 'revenue' ? '收入' : '入库'}凭证 ${voucher.displayNo}`,
    targetType: 'voucher',
    targetId: voucher.id,
  });
  return voucher;
}

export async function generateVoucher(
  svc: CoreServices,
  raw: z.input<typeof GenerateVoucherSchema>,
) {
  svc.permissions.require('costing.voucher');
  const input = GenerateVoucherSchema.parse(raw);
  requireConfirmation(input.confirmed);
  return svc.tx(async (t) => {
    const preview = await buildPreview(t, input);
    if (
      preview.fingerprint !== input.fingerprint ||
      preview.expectedRevision !== input.expectedRevision
    )
      fail('STALE', '来源单据或关联凭证已变化，不能使用旧预览', '请重新预览凭证');
    if (preview.generationBlocker)
      fail(
        'QUANTITY_ONLY_VOUCHER',
        preview.generationBlocker,
        '可在库存台账查看数量；本次不会生成凭证或占用编号',
      );
    if (!preview.canGenerate)
      fail(
        'VOUCHER_DUPLICATE',
        '这张单据已生成该用途凭证',
        '请查看已有凭证，或预览编号影响后重新生成',
      );
    return createFromPreview(t, input, preview);
  });
}

export async function previewVoucherDelete(svc: CoreServices, raw: Target) {
  svc.permissions.require('costing.voucher');
  const input = VoucherTargetSchema.parse(raw);
  return svc.tx(async (t) => {
    const target = await source(t, input);
    await t.periods.assertWritable({ period: target.period, action: '删除出入库凭证' });
    const link = (await linksFor(t, input)).find((l) => l.purpose === input.purpose);
    if (!link) fail('VOUCHER_NOT_FOUND', '这张单据尚未生成该用途凭证', '请刷新单据和凭证列表');
    return {
      expectedRevision: target.revision,
      voucherId: link.voucherId,
      plan: await t.vouchers.previewDelete([link.voucherId]),
    };
  });
}

async function release(svc: CoreServices, input: z.infer<typeof DeleteVoucherSchema>) {
  const target = await source(svc, input);
  if (target.revision !== input.expectedRevision)
    fail('REVISION', '来源单据版本已变化，不能删除旧版本的关联凭证', '请刷新并重新预览编号影响');
  await svc.periods.assertWritable({ period: target.period, action: '删除出入库凭证' });
  const link = (await linksFor(svc, input)).find((l) => l.purpose === input.purpose);
  if (!link) fail('VOUCHER_NOT_FOUND', '这张单据尚未生成该用途凭证', '请刷新单据和凭证列表');
  const deletion = input.voucherDeletion;
  if (
    !deletion?.confirmed ||
    deletion.plan.ids.length !== 1 ||
    deletion.plan.ids[0] !== link.voucherId
  )
    fail('VOUCHER_DELETE_CONFIRM', '删除凭证前需要核对编号影响', '请重新预览编号影响后确认');
  const current = await svc.vouchers.previewDelete([link.voucherId], deletion.plan.expiresAt);
  if (current.fingerprint !== deletion.plan.fingerprint)
    fail('STALE', '凭证或编号已变化，不能使用旧删除预览', '请重新预览编号影响');
  if (input.purpose === 'count') {
    const row = await svc.db
      .withTables<VoucherReadTables>()
      .selectFrom('costing_count_voucher')
      .selectAll()
      .where('count_id', '=', target.id)
      .executeTakeFirstOrThrow();
    await svc.db
      .withTables<VoucherReadTables>()
      .deleteFrom('costing_count_voucher')
      .where('count_id', '=', target.id)
      .execute();
    await svc.vouchers.deleteBatch(deletion.plan, true);
    await svc.log.write({
      action: 'costing.voucher.delete',
      summary: `删除盘点凭证 ${link.displayNo}`,
      targetType: 'voucher',
      targetId: row.voucher_id,
    });
  } else {
    const purpose = input.purpose;
    await svc.inventory.with(async (inventory) => {
      await inventory.releaseVoucherSource({
        bookId: (await svc.book.info()).id,
        documentId: target.id,
        purpose,
        expectedRevision: target.revision,
        voucherId: link.voucherId,
        voucherDeletion: deletion,
      });
    });
  }
  return {
    voucherId: link.voucherId,
    documentId: input.documentId,
    countId: input.countId,
    purpose: input.purpose,
  };
}

export async function deleteVoucher(svc: CoreServices, raw: z.input<typeof DeleteVoucherSchema>) {
  svc.permissions.require('costing.voucher');
  const input = DeleteVoucherSchema.parse(raw);
  requireConfirmation(input.confirmed);
  return svc.tx((t) => release(t, input));
}

export async function regenerateVoucher(
  svc: CoreServices,
  raw: z.input<typeof RegenerateVoucherSchema>,
) {
  svc.permissions.require('costing.voucher');
  const input = RegenerateVoucherSchema.parse(raw);
  requireConfirmation(input.confirmed);
  return svc.tx(async (t) => {
    const preview = await buildPreview(t, input);
    if (
      preview.fingerprint !== input.fingerprint ||
      preview.expectedRevision !== input.expectedRevision
    )
      fail('STALE', '来源单据或关联凭证已变化，不能使用旧预览', '请重新预览凭证');
    if (preview.generationBlocker)
      fail(
        'QUANTITY_ONLY_VOUCHER',
        preview.generationBlocker,
        '本次保留已有凭证，请在库存台账查看数量',
      );
    await release(t, input);
    return createFromPreview(t, input, preview);
  });
}
