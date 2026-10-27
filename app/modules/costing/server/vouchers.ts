import { createHash } from 'node:crypto';
import { sumCents, type InventorySnapshot, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import { CancelCostVoucherSchema, GenerateVoucherSchema, VoucherPreviewSchema } from '../shared';
import { isUnverifiedHistory, officialCost, readInventory } from './inventory-read';
import { e6, fail, integer, quantity, unitCost } from './math';
import { voucherGenerationUnavailable } from './service';

function requireOwner(svc: CoreServices) {
  svc.permissions.require('costing.voucher');
  if (svc.moduleId !== 'costing') fail('VOUCHER_OWNER', '成本凭证只能由成本模块生成或撤销');
}

async function allInventory(svc: CoreServices) {
  const through = Math.max(...(await svc.periods.list()).map((p) => p.period));
  return readInventory(svc, through);
}

function document(snapshot: InventorySnapshot, id: number) {
  const doc = snapshot.documents.find((d) => d.id === id);
  if (!doc) fail('DOCUMENT', '当前账套中没有这张出入库单据', '请刷新单据列表');
  return doc;
}

export async function costVoucherState(svc: CoreServices, documentId: number) {
  requireOwner(svc);
  return svc.tx(async (t) => {
    const snapshot = await allInventory(t);
    const doc = document(snapshot, documentId);
    const link = snapshot.voucherSources.find(
      (s) => s.document_id === doc.id && s.purpose === 'cost',
    );
    const v = link ? await t.vouchers.get(link.voucher_id) : null;
    return {
      bookId: snapshot.bookId,
      documentId: doc.id,
      documentRevision: doc.revision,
      ownerModule: link?.owner_module ?? null,
      voucher: v
        ? {
            id: v.id,
            revision: v.revision,
            status: v.status,
            voided: v.voided,
            displayNo: v.displayNo,
            debitTotal: v.debitTotal,
          }
        : null,
      linked: !!link,
    };
  });
}

export async function previewVoucher(svc: CoreServices, raw: z.input<typeof VoucherPreviewSchema>) {
  requireOwner(svc);
  const input = VoucherPreviewSchema.parse(raw);
  return svc.tx(async (t) => buildPreview(t, input, await allInventory(t)));
}

async function buildPreview(
  t: CoreServices,
  input: z.infer<typeof VoucherPreviewSchema>,
  snapshot: InventorySnapshot,
) {
  const doc = document(snapshot, input.documentId);
  await t.periods.assertOpen(doc.period, '预览出入库凭证');
  if (input.purpose === 'receipt' && doc.kind !== 'receipt')
    fail('PURPOSE', '只有入库单可以生成入库凭证');
  if (input.purpose !== 'receipt' && doc.kind !== 'issue')
    fail('PURPOSE', '只有出库单可以生成收入或成本凭证');
  if (input.purpose === 'revenue' && doc.category !== '销售')
    fail('PURPOSE', '只有销售类别出库单才有销售收入凭证', '领用出库请在本月成本核算后生成成本凭证');
  const sourceLines = snapshot.movements.filter((l) => l.documentId === doc.id);
  if (!sourceLines.length) fail('EMPTY', '单据没有明细，不能生成凭证');
  const lines: VoucherLineInput[] = [];
  const summary = `${input.purpose === 'receipt' ? '入库' : input.purpose === 'revenue' ? '销售收入' : '出库成本'} ${doc.number}`;
  const append = async (
    id: number | null | undefined,
    amount: number,
    side: 'debit' | 'credit',
    label: string,
    quantityE6?: number,
  ) => {
    integer(amount);
    if (amount === 0) return;
    if (amount < 0) fail('AMOUNT', `${label}金额不能为负`);
    if (!id) fail('ACCOUNT', `${label}科目没有录入`, '请补全单据、产品档案或凭证税额科目');
    const account = await t.accounts.get(id);
    if (!account || !account.isLeaf || account.disabled)
      fail('ACCOUNT', `${label}科目不存在、已停用或非明细科目`);
    if (account.currency)
      fail(
        'ACCOUNT_CURRENCY',
        `${label}科目启用了外币，来源单据没有外币金额`,
        '请选择本位币科目；外币凭证尚未接入',
      );
    const dimensions: NonNullable<VoucherLineInput['dimensions']> = {};
    for (const config of account.dimensions) {
      if (config.required && !config.defaultItemId)
        fail(
          'DIMENSION',
          `${label}科目需要辅助核算项，来源单据未提供`,
          '请先为科目设置默认辅助项；逐单辅助项映射尚未接入',
        );
      if (config.defaultItemId) {
        const item = await t.dimensions.get(config.defaultItemId);
        if (!item || item.disabled || !item.isLeaf || item.typeId !== config.type)
          fail('DIMENSION', `${label}科目的默认辅助项不可用`);
        dimensions[config.type] = item.id;
      }
    }
    if (account.quantityUnit && quantityE6 == null)
      fail('QUANTITY_ACCOUNT', `${label}科目需要数量，当前分录没有可用数量`);
    lines.push({
      summary,
      accountId: account.id,
      dimensions,
      [side]: amount,
      ...(account.quantityUnit && quantityE6 != null
        ? {
            quantity: quantity(integer(quantityE6) * (side === 'credit' ? -1n : 1n)),
            unitPrice: unitCost(integer(amount), integer(quantityE6)),
          }
        : {}),
    });
  };
  if (input.purpose === 'receipt') {
    for (const l of sourceLines) {
      const p = snapshot.products.find((p) => p.id === l.productId)!;
      await append(p.inventoryAccountId, l.netCents, 'debit', '产品存货', e6(l.quantity));
    }
    await append(
      input.taxAccountId,
      sumCents(sourceLines.map((l) => l.taxCents)),
      'debit',
      '进项税',
    );
    await append(doc.accountId, sumCents(sourceLines.map((l) => l.grossCents)), 'credit', '付款');
  } else if (input.purpose === 'revenue') {
    await append(doc.accountId, sumCents(sourceLines.map((l) => l.grossCents)), 'debit', '收款');
    for (const l of sourceLines) {
      const p = snapshot.products.find((p) => p.id === l.productId)!;
      await append(
        p.salesAccountId ?? input.revenueAccountId,
        l.netCents,
        'credit',
        '销售收入',
        e6(l.quantity),
      );
    }
    await append(
      input.taxAccountId,
      sumCents(sourceLines.map((l) => l.taxCents)),
      'credit',
      '销项税',
    );
  } else {
    for (const l of sourceLines) {
      const cost = officialCost(snapshot, doc, l);
      if (cost == null && isUnverifiedHistory(snapshot, doc))
        fail(
          'HISTORY_UNVERIFIED',
          '历史成本未知，不能预览成本凭证',
          '请核对控制锚点至启用月的有效批次链及来源头行状态',
        );
      if (cost == null)
        fail(
          'NOT_CALCULATED',
          '本月尚未完成正式成本核算，不能生成成本凭证',
          '先完成库存成本核算；保存试算不能替代正式核算',
        );
      const p = snapshot.products.find((p) => p.id === l.productId)!;
      await append(doc.costAccountId, cost, 'debit', '出库成本', e6(l.quantity));
      await append(p.inventoryAccountId, cost, 'credit', '产品存货', e6(l.quantity));
    }
  }
  if (lines.length < 2) fail('EMPTY', '没有足够的非零金额分录，不能生成凭证');
  const debitCents = sumCents(lines.map((l) => l.debit));
  const creditCents = sumCents(lines.map((l) => l.credit));
  if (debitCents !== creditCents) fail('UNBALANCED', '凭证借贷不平，请核对来源金额和科目映射');
  return {
    status: 'preview' as const,
    documentId: doc.id,
    purpose: input.purpose,
    date: doc.date,
    lines,
    debitCents,
    creditCents,
    documentRevision: doc.revision,
    fingerprint: createHash('sha256')
      .update(JSON.stringify([snapshot.fingerprint, input, lines]))
      .digest('hex'),
    canGenerate:
      input.purpose === 'cost' &&
      doc.voucherId === null &&
      !snapshot.voucherSources.some((s) => s.document_id === doc.id && s.purpose === 'cost'),
  };
}

export async function generateVoucher(
  svc: CoreServices,
  raw: z.input<typeof GenerateVoucherSchema>,
) {
  requireOwner(svc);
  const input = GenerateVoucherSchema.parse(raw);
  if (input.purpose !== 'cost') {
    await previewVoucher(svc, input);
    return voucherGenerationUnavailable();
  }
  if (!input.confirmed)
    fail('CONFIRM', '生成实际成本凭证需要明确确认', '请核对预览分录和凭证类型后确认生成');
  return svc.tx((t) =>
    t.inventory.with(async (inv) => {
      const snapshot = await allInventory(t);
      const doc = document(snapshot, input.documentId);
      const existing = await t.vouchers.list({
        sourceModule: 'costing',
        sourceType: 'cost',
        sourceId: String(doc.id),
        includeVoided: true,
        limit: 1,
      });
      if (
        doc.voucherId !== null ||
        existing.total ||
        snapshot.voucherSources.some((s) => s.document_id === doc.id && s.purpose === 'cost')
      )
        fail(
          'VOUCHER_DUPLICATE',
          '该出库单已有成本凭证或旧版凭证关联，不能重复生成',
          '请查看已有凭证；未审核成本凭证可明确撤销后重新预览',
        );
      const preview = await buildPreview(t, VoucherPreviewSchema.parse(input), snapshot);
      if (preview.fingerprint !== input.fingerprint)
        fail(
          'VOUCHER_STALE',
          '来源、科目映射或操作员已变化，不能使用旧预览生成凭证',
          '请重新预览并核对分录后确认',
        );
      const voucher = await t.vouchers.create({
        date: preview.date,
        voucherTypeId: input.voucherTypeId,
        lines: preview.lines,
        source: { type: 'cost', id: String(doc.id) },
      });
      await inv.lockVoucherSource({
        bookId: snapshot.bookId,
        documentId: doc.id,
        purpose: 'cost',
        expectedRevision: doc.revision,
        voucherId: voucher.id,
      });
      await t.log.write({
        action: 'costing.voucher.generate',
        summary: `出库单 ${doc.number} 生成成本凭证 ${voucher.displayNo}`,
        targetId: doc.id,
      });
      return voucher;
    }),
  );
}

export async function cancelCostVoucher(
  svc: CoreServices,
  raw: z.input<typeof CancelCostVoucherSchema>,
) {
  requireOwner(svc);
  const input = CancelCostVoucherSchema.parse(raw);
  if (!input.confirmed)
    fail('CONFIRM', '撤销成本凭证需要明确确认', '请确认删除未审核凭证并释放成本用途关联');
  return svc.tx((t) =>
    t.inventory.with(async (inv) => {
      const snapshot = await allInventory(t);
      if (input.bookId !== snapshot.bookId) fail('VOUCHER_BOOK', '请求账套与当前账套不一致');
      const doc = document(snapshot, input.documentId);
      const voucher = await t.vouchers.get(input.voucherId);
      if (!voucher || voucher.revision !== input.voucherRevision)
        fail('VOUCHER_STALE', '成本凭证不存在或版本已变化，不能撤销', '请刷新来源凭证后重新核对');
      const result = await inv.releaseVoucherSource({
        bookId: input.bookId,
        documentId: doc.id,
        purpose: 'cost',
        expectedRevision: input.documentRevision,
        voucherId: input.voucherId,
      });
      await t.log.write({
        action: 'costing.voucher.cancel',
        summary: `撤销出库单 ${doc.number} 的成本凭证 ${voucher.displayNo}`,
        targetId: doc.id,
      });
      return result;
    }),
  );
}
