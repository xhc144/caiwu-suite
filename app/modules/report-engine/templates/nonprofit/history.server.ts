import { createHash } from 'node:crypto';
import { periodEndDate } from '@caiwu/core';
import {
  balanceKey,
  exactSum,
  PreStartHistorySchema,
  type ActualLine,
  type Sources,
} from './model';

/** 启用前底稿只补本域报告来源，不写凭证或期初。完整导入必须逐明细承接到核心实际启用期初。 */
export function mergePreStartHistory(live: Sources, raw: unknown, to: number): Sources {
  const h = PreStartHistorySchema.parse(raw),
    start = live.book.startPeriod,
    january = Math.floor(start / 100) * 100 + 1;
  if (h.from !== january || h.to !== start - 1 || Math.floor(to / 100) !== Math.floor(start / 100))
    throw new Error('启用前来源必须从本年度一月连续覆盖至启用前月');
  const periods = new Set(h.periods);
  if (periods.size !== h.periods.length || periods.size !== start - january)
    throw new Error('启用前各月来源须逐月完整核对，未发生月份也须有核对依据');
  for (let p = january; p < start; p++)
    if (!periods.has(p)) throw new Error(`启用前${p}期间来源缺失`);
  const account = new Map(live.accounts.map((a) => [a.code, a]));
  const key = (r: { account: string; partner?: number; person?: number }) =>
    `${r.account}:${r.partner ?? ''}:${r.person ?? ''}`;
  const requireSource = (r: { account: string; partner?: number; person?: number }) => {
    if (!account.get(r.account)?.isLeaf)
      throw new Error(`启用前科目${r.account}不存在或不再是末级，请核对原账对应关系`);
    for (const type of ['partner', 'person'] as const)
      if (
        r[type] !== undefined &&
        !live.dimensionItems?.some((d) => d.type === type && d.id === r[type])
      )
        throw new Error('启用前往来对象未对应本账套真实档案，请重新核对');
  };
  const opening = new Map<string, number>();
  for (const row of h.opening) {
    requireSource(row);
    if (opening.has(key(row))) throw new Error('启用前年初同一科目及往来明细重复');
    opening.set(key(row), row.balance);
  }
  if (exactSum([...opening.values()]) !== 0) throw new Error('启用前年度年初借贷不平');
  const voucherKey = (row: (typeof h.entries)[number]) =>
    JSON.stringify([row.date.slice(0, 7), row.voucher]);
  const vouchers = new Map<string, typeof h.entries>();
  const lineKeys = new Set<string>();
  for (const row of h.entries) {
    requireSource(row);
    const p = Number(row.date.slice(0, 7).replace('-', ''));
    const date = new Date(`${row.date}T00:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== row.date ||
      !periods.has(p)
    )
      throw new Error('启用前分录日期无效或不在完整原期间内');
    if (row.debit !== 0 && row.credit !== 0)
      throw new Error('启用前每行只填实际借方或贷方，红字保留原侧负金额');
    const tag = JSON.stringify([row.date.slice(0, 7), row.voucher, row.line]);
    if (lineKeys.has(tag)) throw new Error('启用前同一原凭证行重复');
    lineKeys.add(tag);
    const rows = vouchers.get(voucherKey(row)) ?? [];
    rows.push(row);
    vouchers.set(voucherKey(row), rows);
  }
  const revisions = new Map<string, number>();
  for (const [voucher, rows] of vouchers) {
    if (
      rows.some(
        (r) =>
          r.date !== rows[0]!.date ||
          r.revision !== rows[0]!.revision ||
          r.closingKind !== rows[0]!.closingKind,
      ) ||
      exactSum(rows.flatMap((r) => [r.debit, -r.credit])) !== 0
    )
      throw new Error(`启用前凭证${voucher}日期、版本、结转性质不一致或借贷不平`);
    revisions.set(
      voucher,
      Number.parseInt(
        createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 13),
        16,
      ) || 1,
    );
  }
  const actual = new Map(live.balances.map((b) => [balanceKey(b), b]));
  if (actual.size !== live.balances.length)
    throw new Error('实际启用期初科目及往来明细重复，不能合并来源');
  const keys = new Set([...opening.keys(), ...h.entries.map(key), ...actual.keys()]);
  for (const k of keys) {
    const carried = exactSum([
      opening.get(k) ?? 0,
      ...h.entries.filter((r) => key(r) === k).flatMap((r) => [r.debit, -r.credit]),
    ]);
    if (carried !== (actual.get(k)?.opening ?? 0)) {
      const [code, partner, person] = k.split(':');
      const label =
        `${code} ${account.get(code!)?.name ?? ''} ${live.dimensionNames[`partner:${partner}`] ?? ''} ${live.dimensionNames[`person:${person}`] ?? ''}`.trim();
      throw new Error(
        `启用前来源未承接到实际启用期初：${label}，差额${(exactSum([carried, -(actual.get(k)?.opening ?? 0)]) / 100).toFixed(2)}元`,
      );
    }
  }
  const voucherIds = new Map([...vouchers.keys()].map((v, i) => [v, i - vouchers.size]));
  const historical: ActualLine[] = h.entries
    .map((e, i): ActualLine => ({
      voucherId: voucherIds.get(voucherKey(e))!,
      lineId: i - h.entries.length,
      revision: revisions.get(voucherKey(e))!,
      originalRevision: e.revision,
      historicalSource: e.sourceReference,
      period: Number(e.date.slice(0, 7).replace('-', '')),
      date: e.date,
      voucherTypeCode: '启用前',
      number: null,
      displayNo: e.voucher,
      status: 'posted',
      lineNo: e.line,
      summary: e.sourceReference,
      accountId: account.get(e.account)!.id,
      accountCode: e.account,
      dimensions: {
        ...(e.partner ? { partner: e.partner } : {}),
        ...(e.person ? { person: e.person } : {}),
      },
      currency: null,
      exchangeRate: null,
      fcAmount: null,
      quantity: null,
      unitPrice: null,
      debit: e.debit,
      credit: e.credit,
      refNo: e.sourceReference,
      sourceModule: null,
      closingKind: e.closingKind,
    }))
    .filter((e) => e.period <= to);
  if (historical.length + live.entries.length >= 200000)
    throw new Error('启用前及本账合计分录达到读取上限，不能保证完整来源');
  return {
    ...live,
    from: january,
    to,
    openingDate: `${Math.floor(start / 100)}-01-01`,
    closingDate: periodEndDate(to),
    historyMissing: false,
    entries: [...historical, ...live.entries.filter((e) => e.period <= to)],
    unpostedCount: to < start ? 0 : live.unpostedCount,
    balances: [...keys].map((k) => {
      const old = actual.get(k),
        [code, partner, person] = k.split(':'),
        a = account.get(code!)!;
      const rows = historical.filter((e) => balanceKey(e) === k);
      const debit = exactSum([to < start ? 0 : (old?.debit ?? 0), ...rows.map((e) => e.debit)]),
        credit = exactSum([to < start ? 0 : (old?.credit ?? 0), ...rows.map((e) => e.credit)]),
        initial = opening.get(k) ?? 0;
      return {
        accountId: a.id,
        accountCode: a.code,
        accountName: a.name,
        level: a.level,
        isLeaf: true,
        direction: a.direction,
        dimensions: {
          ...(partner ? { partner: Number(partner) } : {}),
          ...(person ? { person: Number(person) } : {}),
        },
        opening: initial,
        debit,
        credit,
        closing: to < start ? exactSum([initial, debit, -credit]) : (old?.closing ?? 0),
        ytdDebit: debit,
        ytdCredit: credit,
      };
    }),
  };
}
