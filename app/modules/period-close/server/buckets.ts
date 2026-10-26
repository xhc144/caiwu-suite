import { sumMoney as sumCents } from './amounts';
import { createHash } from 'node:crypto';
import {
  BusinessError,
  assertCents,
  dimensionsKey,
  qtyFromE6,
  qtyToE6,
  periodYear,
  type DimensionValues,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';

export type Bucket = {
  accountId: number;
  dimensions: DimensionValues;
  currency: string | null;
  amount: number;
  fc: number;
  qty: number;
};
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const bucketKey = (b: Pick<Bucket, 'accountId' | 'dimensions' | 'currency'>) =>
  `${b.accountId}|${dimensionsKey(b.dimensions)}|${b.currency ?? ''}`;
export function addBucket(map: Map<string, Bucket>, b: Bucket) {
  if (![b.amount, b.fc, b.qty].every(Number.isSafeInteger))
    throw new BusinessError({
      code: 'PERIOD_CLOSE_UNSAFE_MONEY',
      message: `科目 ID ${b.accountId} 的金额或数量超出安全整数范围`,
      hint: '核对该科目期初和凭证，再重试',
      actions: [{ label: '去处理', to: '/m/period-close' }],
    });
  const key = bucketKey(b);
  const old = map.get(key);
  if (old) {
    old.amount = sumCents([old.amount, b.amount]);
    old.fc = sumCents([old.fc, b.fc]);
    old.qty = assertCents(old.qty + b.qty, '数量');
  } else map.set(key, { ...b, dimensions: { ...b.dimensions } });
}
/** 只读真实核心行，保留币种及辅助桶；不使用有上限的分录查询，不汇总父级。 */
export async function closingBuckets(
  svc: CoreServices,
  period: number,
  exclude: number[] = [],
  cashflow = true,
) {
  const years = await svc.periods.years();
  const year = years.find((y) => y.year === periodYear(period));
  if (!year) throw new Error('会计年度不存在');
  const map = new Map<string, Bucket>();
  for (const r of await svc.opening.list(year.year))
    addBucket(map, {
      accountId: r.accountId,
      dimensions: r.dimensions,
      currency: r.currency,
      amount: r.balance,
      fc: r.fcBalance,
      qty: qtyToE6(r.quantity),
    });
  let q = svc.db
    .selectFrom('voucher_line as l')
    .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
    .selectAll('l')
    .where('v.status', '=', 'posted')
    .where('v.voided', '=', 0)
    .where('l.period', '>=', year.opening_period)
    .where('l.period', '<=', period);
  if (exclude.length) q = q.where('v.id', 'not in', exclude);
  for (const r of await q.execute()) {
    const sign = r.debit !== 0 ? 1 : -1;
    addBucket(map, {
      accountId: r.account_id,
      dimensions: {
        project: r.dim_project,
        partner: r.dim_partner,
        department: r.dim_department,
        person: r.dim_person,
        ...(cashflow ? { cashflow: r.dim_cashflow } : {}),
      },
      currency: r.currency_code,
      amount: sumCents([r.debit, -r.credit]),
      fc: assertCents(sign * (r.fc_amount ?? 0)),
      qty: assertCents(sign * (r.quantity_e6 ?? 0), '数量'),
    });
  }
  return map;
}
export function applyLines(map: Map<string, Bucket>, lines: VoucherLineInput[]) {
  for (const l of lines) {
    const debit = l.debit ?? 0;
    const credit = l.credit ?? 0;
    const sign = debit !== 0 ? 1 : -1;
    addBucket(map, {
      accountId: l.accountId!,
      dimensions: l.dimensions ?? {},
      currency: l.currency ?? null,
      amount: sumCents([debit, -credit]),
      fc: assertCents(sign * (l.fcAmount ?? 0)),
      qty: assertCents(sign * qtyToE6(l.quantity ?? '0'), '数量'),
    });
  }
}
export function canonicalBuckets(map: Map<string, Bucket>) {
  return [...map.values()]
    .filter((b) => b.amount || b.fc || b.qty)
    .sort((a, b) => bucketKey(a).localeCompare(bucketKey(b)))
    .map((b) => [bucketKey(b), b.amount, b.fc, b.qty]);
}
export function openingRows(map: Map<string, Bucket>, year: number) {
  return [...map.values()].map((b) => ({
    year,
    accountId: b.accountId,
    dimensions: b.dimensions,
    currency: b.currency,
    balance: b.amount,
    fcBalance: b.fc,
    quantity: qtyFromE6(b.qty),
    ytdDebit: 0,
    ytdCredit: 0,
  }));
}
