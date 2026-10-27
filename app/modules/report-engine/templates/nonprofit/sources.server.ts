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
import { mergePreStartHistory } from './history.server';

/** 只调用核心只读服务；由公共生成事务传入同一个 svc，不另开事务或读模块私表。 */
export async function readNonprofitSources(
  svc: CoreServices,
  raw: StatementRequest,
  configuration?: Pick<Configuration, 'preStartHistory'>,
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
  if (Math.floor(book.startPeriod / 100) > year)
    throw new Error('报告年度早于账套启用年度，缺少可核对的年度来源');
  const liveStart = Math.max(start, book.startPeriod),
    liveTo = Math.max(liveStart, r.to);
  for (let p = liveStart; p <= liveTo; p++) await svc.periods.require(p);
  const [accounts, categories, balances, entries, unposted, partners, people] = await Promise.all([
    svc.accounts.list(),
    svc.accounts.categories(),
    svc.ledger.balances({
      periodFrom: liveStart,
      periodTo: liveTo,
      rollup: false,
      includeZero: true,
      groupBy: ['partner', 'person'],
    }),
    svc.ledger.entries({ periodFrom: liveStart, periodTo: liveTo, limit: 200000 }),
    svc.vouchers.list({
      periodFrom: liveStart,
      periodTo: liveTo,
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
  const sources: Sources = {
    book,
    accounts,
    categories,
    balances,
    entries: entries.map((e) => {
      const v = vouchers.get(e.voucherId);
      if (!v) throw new Error('凭证来源已变化，请刷新后重新确认');
      return { ...e, revision: v.revision, closingKind: v.closingKind };
    }),
    from: liveStart,
    to: liveTo,
    openingDate: `${year}-${String(liveStart % 100).padStart(2, '0')}-01`,
    closingDate: periodEndDate(liveTo),
    unpostedCount: unposted.total,
    dimensionNames: Object.fromEntries(
      [...partners, ...people].map((d) => [`${d.typeId}:${d.id}`, d.name]),
    ),
    dimensionItems: [
      ...partners.map((d) => ({ type: 'partner' as const, id: d.id, code: d.code, name: d.name })),
      ...people.map((d) => ({ type: 'person' as const, id: d.id, code: d.code, name: d.name })),
    ],
  };
  if (book.startPeriod > start) {
    if (configuration?.preStartHistory)
      return mergePreStartHistory(sources, configuration.preStartHistory, r.to);
    if (configuration)
      throw new Error('缺少完整年度年初和启用前逐笔来源，请在来源配置中导入并核对承接');
    return { ...sources, historyMissing: true };
  }
  return sources;
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
