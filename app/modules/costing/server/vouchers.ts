import { sumCents, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import { VoucherPreviewSchema } from '../shared';
import { isUnverifiedHistory, officialCost, readInventory } from './inventory-read';
import { e6, fail, integer, quantity, unitCost } from './math';
import { voucherGenerationUnavailable } from './service';

export async function previewVoucher(svc: CoreServices, raw: z.input<typeof VoucherPreviewSchema>) {
  svc.permissions.require('costing.voucher');
  const input = VoucherPreviewSchema.parse(raw);
  return svc.tx(async (t) => {
    const periods = await t.periods.list();
    const through = Math.max(...periods.map((p) => p.period));
    const snapshot = await readInventory(t, through);
    const doc = snapshot.documents.find((d) => d.id === input.documentId);
    if (!doc) fail('DOCUMENT', '当前账套中没有这张出入库单据', '请刷新单据列表');
    await t.periods.assertOpen(doc.period, '预览出入库凭证');
    if (input.purpose === 'receipt' && doc.kind !== 'receipt')
      fail('PURPOSE', '只有入库单可以生成入库凭证');
    if (input.purpose !== 'receipt' && doc.kind !== 'issue')
      fail('PURPOSE', '只有出库单可以生成收入或成本凭证');
    if (input.purpose === 'revenue' && doc.category !== '销售')
      fail(
        'PURPOSE',
        '只有销售类别出库单才有销售收入凭证',
        '领用出库请在本月成本核算后生成成本凭证',
      );
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
              quantity: quantity(integer(quantityE6)),
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
      fingerprint: snapshot.fingerprint,
      canGenerate: false as const,
    };
  });
}

export async function generateVoucher(
  svc: CoreServices,
  input: z.input<typeof VoucherPreviewSchema>,
) {
  svc.permissions.require('costing.voucher');
  await previewVoucher(svc, input);
  return voucherGenerationUnavailable();
}
