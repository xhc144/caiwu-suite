import type { Account, BalanceRow, EntryRow } from '@caiwu/core';
import type { OpeningBalance } from '@caiwu/core/server';
import {
  rowKey,
  sum,
  problem,
  pnlRoles,
  entrySignature,
  type Role,
  type Configuration,
} from './configuration';
export function historicalOpeningBalances(accounts: Account[], rows: OpeningBalance[]) {
  const byId = new Map(accounts.map((a) => [a.id, a])),
    grouped = new Map<string, BalanceRow>();
  for (const row of rows) {
    const account = byId.get(row.accountId);
    if (!account || !account.isLeaf)
      problem('OPENING_ACCOUNT', '启用期初存在失效或非末级科目，请先修正期初', 'openingEvidence');
    const key = rowKey({ accountCode: account.code, dimensions: row.dimensions });
    let out = grouped.get(key);
    if (!out) {
      out = {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.fullName,
        level: account.level,
        isLeaf: true,
        direction: account.direction,
        dimensions: row.dimensions,
        opening: 0,
        closing: 0,
        debit: 0,
        credit: 0,
        ytdDebit: 0,
        ytdCredit: 0,
        fcOpening: 0,
        fcClosing: 0,
        fcDebit: 0,
        fcCredit: 0,
        qtyOpening: '0',
        qtyClosing: '0',
        qtyDebit: '0',
        qtyCredit: '0',
      };
      grouped.set(key, out);
    }
    out.opening = sum([out.opening, row.balance, -row.ytdDebit, row.ytdCredit]);
    out.closing = out.opening;
    out.ytdDebit = sum([out.ytdDebit, row.ytdDebit]);
    out.ytdCredit = sum([out.ytdCredit, row.ytdCredit]);
  }
  return [...grouped.values()].map((r) => ({ ...r, historical: true }));
}
/** 年中启用只按真实期初明细及其累计还原，保留往来对象；损益结转和现金项目另行确认。 */
export function openingHistory(
  accounts: Account[],
  rows: OpeningBalance[],
  config: Configuration,
  startPeriod: number,
  roles: Map<string, Role>,
) {
  const year = Math.floor(startPeriod / 100),
    evidence = config.openingEvidence.filter(
      (e) => e.year === year && e.startPeriod === startPeriod,
    );
  if (evidence.length !== 1)
    problem(
      'OPENING_EVIDENCE',
      `${year}年中启用：请确认完整期初明细、启用前损益结转与现金项目来源`,
      'openingEvidence',
    );
  const facts = evidence[0]!,
    grouped = new Map(historicalOpeningBalances(accounts, rows).map((r) => [rowKey(r), r]));
  const previous = startPeriod - 1,
    date = new Date(Date.UTC(year, previous % 100, 0)).toISOString().slice(0, 10),
    entries: EntryRow[] = [];
  let identity = -1;
  const makeEntry = (r: BalanceRow, value: number, when: string): EntryRow => ({
    voucherId: identity,
    lineId: identity--,
    period: Number(when.slice(0, 7).replace('-', '')),
    date: when,
    voucherTypeCode: '启用前资料',
    number: null,
    displayNo: '启用前资料',
    status: 'posted',
    lineNo: 1,
    summary: facts.reason,
    accountId: r.accountId,
    accountCode: r.accountCode,
    dimensions: r.dimensions,
    currency: null,
    exchangeRate: null,
    fcAmount: null,
    quantity: null,
    unitPrice: null,
    debit: value > 0 ? value : 0,
    credit: value < 0 ? -value : 0,
    refNo: null,
    sourceModule: null,
  });
  const cashParts = new Map<number, number>();
  for (const [key, row] of grouped) {
    const role = roles.get(row.accountCode);
    if (!role && (row.opening || row.ytdDebit || row.ytdCredit))
      problem('OPENING_MAPPING', `${row.accountCode} 的启用前余额或累计尚未指定业务角色`, key);
    if (role && pnlRoles.includes(role) && (row.ytdDebit || row.ytdCredit)) {
      const declarations = facts.pnlClosing.filter((f) => f.key === key),
        closing = declarations[0];
      if (declarations.length !== 1 || !closing)
        problem('OPENING_PNL', `${row.accountCode} 启用前损益结转借贷额尚未确认`, key);
      if (closing.debit > row.ytdDebit || closing.credit > row.ytdCredit)
        problem('OPENING_PNL_SUM', `${row.accountCode} 启用前损益结转额超过真实累计`, key);
      const net = sum([row.ytdDebit, -row.ytdCredit, -closing.debit, closing.credit]);
      if (net) entries.push(makeEntry(row, net, date));
    }
    if (role === 'money') {
      const history = facts.cashHistory.filter((h) => h.key === key);
      if (
        sum(history.map((h) => h.inflow)) !== row.ytdDebit ||
        sum(history.map((h) => h.outflow)) !== row.ytdCredit
      )
        problem(
          'OPENING_CASH_SUM',
          `${row.accountCode} 启用前现金项目流入、流出分别与真实期初累计不相等`,
          key,
        );
      for (const h of history) {
        const period = Number(h.date.slice(0, 7).replace('-', ''));
        if (
          period < year * 100 + 1 ||
          period >= startPeriod ||
          Number.isNaN(Date.parse(h.date)) ||
          new Date(h.date).toISOString().slice(0, 10) !== h.date
        )
          problem('OPENING_DATE', '启用前现金分类日期须在本年年初至启用前一日之间', key);
        for (const value of [h.inflow, -h.outflow])
          if (value) {
            const e = makeEntry(row, value, h.date);
            e.voucherId = -100000000 - Number(h.date.replaceAll('-', ''));
            e.summary = h.reason;
            entries.push(e);
            cashParts.set(e.lineId, h.line);
          }
      }
    }
  }
  for (const h of facts.cashHistory)
    if (!grouped.has(h.key))
      problem('OPENING_CASH_SOURCE', '启用前现金分类引用了不存在的期初明细', h.key);
  for (const h of facts.pnlClosing)
    if (!grouped.has(h.key) || !pnlRoles.includes(roles.get(grouped.get(h.key)!.accountCode)!))
      problem('OPENING_PNL_SOURCE', '启用前损益确认引用了无效科目明细', h.key);
  const allocations: Configuration['cashAllocations'] = {};
  for (const e of entries)
    if (cashParts.has(e.lineId))
      allocations[String(e.lineId)] = {
        signature: entrySignature(e, entries),
        reason: e.summary,
        parts: [{ line: cashParts.get(e.lineId)!, amount: sum([e.debit, -e.credit]) }],
      };
  const balances = [...grouped.values()].map((r) => ({ ...r, historical: true }));
  return { balances, entries, allocations };
}
