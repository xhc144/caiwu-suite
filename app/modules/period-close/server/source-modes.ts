import { qtyToE6, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { SourceMode } from '../shared';
import { addBucket, type Bucket } from './buckets';
import { sumMoney } from './amounts';

export type SourceActivity = {
  debit: Map<string, Bucket>;
  credit: Map<string, Bucket>;
  net: Map<string, Bucket>;
};

/** 发生额按原借贷侧累计，红字冲减同侧；所有桶统一采用借正贷负。 */
function addActivity(activity: SourceActivity, bucket: Bucket, side: 'debit' | 'credit') {
  addBucket(activity[side], bucket);
  addBucket(activity.net, bucket);
}

export async function loadSourceActivity(
  svc: CoreServices,
  period: number,
  excludeVoucherIds: number[] = [],
): Promise<SourceActivity> {
  const activity: SourceActivity = { debit: new Map(), credit: new Map(), net: new Map() };
  let query = svc.db
    .selectFrom('voucher_line as l')
    .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
    .selectAll('l')
    .where('v.status', '=', 'posted')
    .where('v.voided', '=', 0)
    .where('l.period', '=', period);
  if (excludeVoucherIds.length) query = query.where('v.id', 'not in', excludeVoucherIds);
  for (const line of await query.execute()) {
    const side = line.entry_side ?? (line.debit !== 0 ? 'debit' : 'credit');
    const sign = side === 'debit' ? 1 : -1;
    addActivity(
      activity,
      {
        accountId: line.account_id,
        dimensions: {
          project: line.dim_project,
          partner: line.dim_partner,
          department: line.dim_department,
          person: line.dim_person,
        },
        currency: line.currency_code,
        amount: sumMoney([line.debit, -line.credit]),
        fc: sumMoney([sign * (line.fc_amount ?? 0)]),
        qty: sumMoney([sign * (line.quantity_e6 ?? 0)]),
      },
      side,
    );
  }
  return activity;
}

/** 同批前序结转虽尚未保存/过账，也应参与后序发生额的预览基数。 */
export function applySourceActivity(activity: SourceActivity, lines: VoucherLineInput[]) {
  for (const line of lines) {
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    const side = line.entrySide ?? (debit !== 0 ? 'debit' : 'credit');
    const sign = side === 'debit' ? 1 : -1;
    addActivity(
      activity,
      {
        accountId: line.accountId!,
        dimensions: { ...line.dimensions, cashflow: null },
        currency: line.currency ?? null,
        amount: sumMoney([debit, -credit]),
        fc: sumMoney([sign * (line.fcAmount ?? 0)]),
        qty: sumMoney([sign * qtyToE6(line.quantity ?? '0')]),
      },
      side,
    );
  }
}

/** 本币为零时，以原币、数量依次确定余额方向，避免静默遗漏辅助余额。 */
const bucketDirection = (bucket: Bucket) => Math.sign(bucket.amount || bucket.fc || bucket.qty);

export function selectSourceBuckets(
  balances: Map<string, Bucket>,
  activity: SourceActivity,
  modes: Map<number, SourceMode>,
) {
  const selected = new Map<string, Bucket>();
  for (const [accountId, mode] of modes) {
    const candidates =
      mode === 'periodDebit'
        ? activity.debit
        : mode === 'periodCredit'
          ? activity.credit
          : mode === 'periodNet'
            ? activity.net
            : balances;
    for (const bucket of candidates.values()) {
      if (bucket.accountId !== accountId) continue;
      if (mode === 'debitBalance' && bucketDirection(bucket) <= 0) continue;
      if (mode === 'creditBalance' && bucketDirection(bucket) >= 0) continue;
      addBucket(selected, bucket);
    }
  }
  return selected;
}
