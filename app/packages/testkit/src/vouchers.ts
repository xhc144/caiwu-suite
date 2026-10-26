import type { CoreServices } from '@caiwu/core/server';
import type { DimensionTypeId, Voucher, VoucherStatus } from '@caiwu/core';

export interface LineSpec {
  /** 科目编码 */
  account: string;
  debit?: number;
  credit?: number;
  summary?: string;
  /** 辅助核算，用维度项编码，例如 { partner: 'C001' } */
  dims?: Partial<Record<DimensionTypeId, string>>;
  currency?: string;
  rate?: string;
  fcAmount?: number;
  quantity?: string;
  unitPrice?: string;
}

export interface VoucherSpec {
  date: string;
  summary?: string;
  lines: LineSpec[];
  /** 最终状态，默认 pending（待审核） */
  status?: VoucherStatus;
  /** 凭证字，默认取第一个凭证类型 */
  type?: string;
  attachments?: number;
}

/** 把编码形式的分录描述转成 createVoucher 的入参。 */
export async function voucherInputFromSpec(svc: CoreServices, spec: VoucherSpec) {
  const types = await svc.reference.voucherTypes();
  const type = spec.type ? types.find((t) => t.code === spec.type) : types[0];
  if (!type) throw new Error(`没有凭证类型 ${spec.type ?? ''}`);
  const lines = [];
  for (const l of spec.lines) {
    const account = await svc.accounts.require(l.account);
    const dimensions: Partial<Record<DimensionTypeId, number>> = {};
    for (const [t, code] of Object.entries(l.dims ?? {}) as [DimensionTypeId, string][]) {
      const item = await svc.dimensions.getByCode(t, code);
      if (!item) throw new Error(`没有维度项 ${t}:${code}`);
      dimensions[t] = item.id;
    }
    lines.push({
      summary: l.summary ?? spec.summary ?? '测试凭证',
      accountId: account.id,
      dimensions,
      currency: l.currency ?? null,
      exchangeRate: l.rate ?? null,
      fcAmount: l.fcAmount ?? null,
      quantity: l.quantity ?? null,
      unitPrice: l.unitPrice ?? null,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
    });
  }
  return {
    voucherTypeId: type.id,
    date: spec.date,
    attachments: spec.attachments ?? 0,
    lines,
    draft: spec.status === 'draft',
  };
}

/**
 * 批量造凭证，并推进到指定状态（pending / audited / posted）。
 * 状态推进直接调用 core 的状态变更入口，不经过审核、过账模块的业务检查——用来给别的模块造前置数据。
 */
export async function seedVouchers(svc: CoreServices, specs: VoucherSpec[]): Promise<Voucher[]> {
  const out: Voucher[] = [];
  for (const spec of specs) {
    const v = await svc.vouchers.create(await voucherInputFromSpec(svc, spec));
    const target = spec.status ?? 'pending';
    if (target === 'audited' || target === 'posted')
      await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    if (target === 'posted') await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    out.push((await svc.vouchers.get(v.id))!);
  }
  return out;
}
