import { createHash } from 'node:crypto';
import type { CoreServices } from '@caiwu/core/server';
import { periodEndDate } from '@caiwu/core';
import {
  type Configuration,
  type Sources,
  type StatementRequest,
  RequestSchema,
  lineIdentity,
} from './model';

/** 只调用核心只读服务；由公共生成事务传入同一个 svc，不另开事务或读模块私表。 */
export async function readNonprofitSources(
  svc: CoreServices,
  raw: StatementRequest,
): Promise<Sources> {
  const r = RequestSchema.parse(raw),
    year = Math.floor(r.to / 100),
    start = year * 100 + 1;
  const book = await svc.book.info();
  if (
    book.regime !== 'nonprofit' ||
    !/^nonprofit-2026(?:$|-)/.test(book.templateId) ||
    r.to < 202601
  )
    throw new Error('本账套未采用2026年民间非营利组织会计制度，请先核对账套制度及施行日期');
  // 年初资料须来自年度起点；年中启用不能将启用月期初伪装成年初。
  if (book.startPeriod > start)
    throw new Error('缺少完整年度年初和启用前逐笔来源，请先补充有凭据的年初与累计资料');
  for (let p = start; p <= r.to; p++) await svc.periods.require(p);
  const [accounts, categories, balances, entries, unposted, partners, people] = await Promise.all([
    svc.accounts.list(),
    svc.accounts.categories(),
    svc.ledger.balances({
      periodFrom: start,
      periodTo: r.to,
      rollup: false,
      includeZero: true,
      groupBy: ['partner', 'person'],
    }),
    svc.ledger.entries({ periodFrom: start, periodTo: r.to, limit: 200000 }),
    svc.vouchers.list({
      periodFrom: start,
      periodTo: r.to,
      statuses: ['draft', 'pending', 'audited'],
      limit: 1,
    }),
    svc.dimensions.items('partner'),
    svc.dimensions.items('person'),
  ]);
  if (entries.length >= 200000)
    throw new Error('实际分录达到读取上限，不能保证逐笔确认完整；请先缩小账套规模');
  const vouchers = new Map(
    (
      await Promise.all(
        [...new Set(entries.map((e) => e.voucherId))].map((id) => svc.vouchers.get(id)),
      )
    )
      .filter((v) => v !== null)
      .map((v) => [v.id, v]),
  );
  return {
    book,
    accounts,
    categories,
    balances,
    entries: entries.map((e) => {
      const v = vouchers.get(e.voucherId);
      if (!v) throw new Error('凭证来源已变化，请刷新后重新确认');
      return { ...e, revision: v.revision, closingKind: v.closingKind };
    }),
    from: start,
    to: r.to,
    openingDate: `${year}-01-01`,
    closingDate: periodEndDate(r.to),
    unpostedCount: unposted.total,
    dimensionNames: Object.fromEntries(
      [...partners, ...people].map((d) => [`${d.typeId}:${d.id}`, d.name]),
    ),
  };
}
export function sourceFingerprint(s: Sources, c: Configuration) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        book: s.book,
        accounts: s.accounts,
        balances: s.balances,
        entries: s.entries.map((e) => ({
          ...lineIdentity(e),
          date: e.date,
          dimensions: e.dimensions,
          closingKind: e.closingKind,
        })),
        configuration: c,
        from: s.from,
        to: s.to,
        unpostedCount: s.unpostedCount,
      }),
    )
    .digest('hex');
}
