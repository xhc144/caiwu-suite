import { sumMoney as sumCents } from './amounts';
import { dimensionsKey, qtyToE6 } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { closingBuckets, digest, openingRows } from './buckets';
import { allVouchers, fail, tables } from './transfers';
import { pnlBalances } from './service';
import { requireOpening } from './preconditions';

export async function yearEnd(svc: CoreServices, input: { year: number; confirmed: boolean }) {
  if (!input.confirmed)
    fail(
      'CONFIRM',
      '请确认年结',
      '年结会生成下一年期间及派生期初；撤销年结需要先合法撤销后年度业务，并完成在线备份和文字确认',
    );
  return svc.tx(async (t) => {
    const source = input.year;
    const target = source + 1;
    const existing = await tables(t)
      .selectFrom('period_close_year')
      .selectAll()
      .where('source_year', '=', source)
      .executeTakeFirst();
    if (existing) {
      const current = await t.opening.list(target);
      const stored = JSON.parse(existing.snapshot) as ReturnType<typeof openingRows>;
      const normalize = (rows: ReturnType<typeof openingRows>) =>
        rows
          .map((r) => [
            `${r.accountId}|${dimensionsKey(r.dimensions)}|${r.currency ?? ''}`,
            r.balance,
            r.fcBalance,
            qtyToE6(r.quantity),
            r.ytdDebit,
            r.ytdCredit,
          ])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      if (digest(normalize(current)) !== digest(normalize(stored)))
        fail('SNAPSHOT_CHANGED', '后年度派生期初已经变化', '保留现有数据，先核对期初，不能覆盖');
      return { message: '该年度已经年结；未重复写入期初', year: target, rows: current.length };
    }
    await requireOpening(t, source);
    const periods = (await t.periods.list()).filter((p) => p.year === source);
    if (!periods.length || periods.some((p) => p.status !== 'closed'))
      fail('YEAR_NOT_CLOSED', '本年度仍有未结期间，不能年结', '按月份顺序完成结账', undefined, {
        periods: periods.filter((p) => p.status !== 'closed').map((p) => p.period),
      });
    if (
      (await allVouchers(t, target * 100 + 1, target * 100 + 12)).length ||
      (await t.opening.list(target)).length
    )
      fail(
        'TARGET_HAS_DATA',
        `${target} 年已有手工期初或业务，不能覆盖`,
        '先核对目标年度；本模块不会直接覆盖用户数据',
      );
    const end = source * 100 + 12;
    if (
      !(await t.ledger.trialBalance(periods[0]!.period, end)).balanced ||
      (await pnlBalances(t, end)).length
    )
      fail('YEAR_TRIAL', '年结试算或损益结转尚未完成', '平衡正式账并完成损益结转后再年结');
    const buckets = await closingBuckets(t, end, [], false);
    const accounts = await t.accounts.list();
    if ([...buckets.values()].some((b) => !accounts.some((a) => a.id === b.accountId && a.isLeaf)))
      fail('NONLEAF', '存在非末级余额，不能生成下一年期初', '先修正科目层级');
    const core = await t.ledger.balances({
      periodFrom: end,
      periodTo: end,
      rollup: false,
      includeZero: true,
    });
    for (const row of core) {
      const total = sumCents(
        [...buckets.values()].filter((b) => b.accountId === row.accountId).map((b) => b.amount),
      );
      if (total !== row.closing)
        fail('BUCKET_TOTAL', '逐桶余额与核心账簿不一致', '保留原数据，核对余额后再年结');
    }
    const rows = openingRows(buckets, target);
    await t.periods.ensureYear(target, { openingStored: true });
    await t.opening.replaceYear(target, rows);
    const next = await t.ledger.balances({
      periodFrom: target * 100 + 1,
      periodTo: target * 100 + 1,
      rollup: false,
      includeZero: true,
    });
    for (const row of core)
      if (next.find((n) => n.accountId === row.accountId)?.opening !== row.closing)
        fail('CONTINUITY', '年结后余额不连续，已回滚');
    if (next.some((n) => n.ytdDebit || n.ytdCredit))
      fail('YTD_RESET', '下一年度累计未归零，已回滚');
    await tables(t)
      .insertInto('period_close_year')
      .values({
        source_year: source,
        target_year: target,
        snapshot: JSON.stringify(rows),
        created_at: t.ctx.now().toISOString(),
      })
      .execute();
    await t.db
      .updateTable('fiscal_year')
      .set({ status: 'closed', closed_at: t.ctx.now().toISOString(), closed_by: t.user.id })
      .where('year', '=', source)
      .execute();
    await t.log.write({
      action: 'period-close.year-end',
      summary: `${source} 年年结，生成 ${target} 年 ${rows.length} 行期初`,
    });
    return { message: '年结完成，下一年度累计已重置', year: target, rows: rows.length };
  });
}

/** 年结的可操作检查与真实逐桶预览；不会建立年度或写期初。 */
export async function yearEndPreview(svc: CoreServices, year: number) {
  const info = await svc.book.info();
  const periods = (await svc.periods.list()).filter((p) => p.year === year);
  const opening = await svc.opening.list(year);
  const nextOpening = await svc.opening.list(year + 1);
  const business = await allVouchers(svc, (year + 1) * 100 + 1, (year + 1) * 100 + 12);
  const first = periods[0]?.period ?? year * 100 + 1;
  const end = year * 100 + 12;
  await svc.periods.require(end);
  const trial = await svc.ledger.trialBalance(first, end);
  const pnl = await pnlBalances(svc, end);
  const buckets = await closingBuckets(svc, end, [], false);
  const accounts = await svc.accounts.list();
  const expected = 13 - (Math.trunc(info.startPeriod / 100) === year ? info.startPeriod % 100 : 1);
  const checks = [
    {
      id: 'periods',
      title: '全年期间已结',
      pass: periods.length === expected && periods.every((p) => p.status === 'closed'),
      detail:
        periods
          .filter((p) => p.status !== 'closed')
          .map((p) => String(p.period))
          .join('、') || `${periods.length}/${expected} 个期间已结`,
      to: `/m/period-close?period=${periods.find((p) => p.status !== 'closed')?.period ?? end}`,
    },
    {
      id: 'trial',
      title: '期初与正式账试算',
      pass:
        opening.length > 0 &&
        sumCents(opening.map((r) => r.balance)) === 0 &&
        sumCents(opening.flatMap((r) => [r.ytdDebit, -r.ytdCredit])) === 0 &&
        trial.balanced,
      detail: `期初 ${opening.length} 行；正式账${trial.balanced ? '平衡' : '不平衡'}`,
      to: `/m/opening?year=${year}`,
    },
    {
      id: 'pnl',
      title: '损益结转完成',
      pass: !pnl.length,
      detail: pnl.length ? pnl.map((r) => r.code).join('、') : '各损益桶余额为零',
      to: `/m/period-close?period=${end}`,
    },
    {
      id: 'target',
      title: '下一年度无手工期初或业务',
      pass: !nextOpening.length && !business.length,
      detail: `${year + 1} 年期初 ${nextOpening.length} 行、凭证 ${business.length} 张`,
      to: `/m/opening?year=${year + 1}`,
    },
  ];
  return {
    year,
    targetYear: year + 1,
    checks,
    allPassed: checks.every((c) => c.pass),
    rows: openingRows(buckets, year + 1).map((r, index) => ({
      ...r,
      key: index,
      accountCode: accounts.find((a) => a.id === r.accountId)?.code ?? String(r.accountId),
    })),
  };
}
