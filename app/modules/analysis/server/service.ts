import { Decimal } from 'decimal.js';
import {
  BusinessError,
  periodOfDate,
  periodYear,
  type DimensionValues,
  type EntryRow,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  AgingFilterSchema,
  BucketBoundsSchema,
  DEFAULT_BOUNDS,
  TrendFilterSchema,
  type AgingFilter,
  type AgingLot,
  type AgingReport,
  type AgingRow,
  type TrendFilter,
  type TrendReport,
  type TrendRow,
} from '../shared';
import type { AnalysisTables } from './migrations';
import { allocateFifo, bucketLabels, cents, sum } from './fifo';

function fail(code: string, message: string, hint: string): never {
  throw new BusinessError({
    code: `ANALYSIS_${code}`,
    message,
    hint,
    actions: [
      { label: '科目分析', to: '/m/analysis' },
      { label: '账龄分析', to: '/m/analysis/aging' },
    ],
  });
}
async function selection(svc: CoreServices, code: string) {
  const selected = (await svc.accounts.list()).filter(
    (a) => a.code === code || a.code.startsWith(code),
  );
  if (!selected.some((a) => a.code === code))
    fail('ACCOUNT_NOT_FOUND', `科目 ${code} 不存在`, '请重新选择当前账套的科目');
  return selected.filter((a) => a.isLeaf);
}
async function baseOf(svc: CoreServices, period: number) {
  const book = await svc.book.info();
  if (period < book.startPeriod)
    fail(
      'BEFORE_START',
      '查询期间早于账套启用期间',
      `请从 ${book.startPeriod} 起查询；启用前的余额只能按期初资料分析`,
    );
  const base = await svc.db
    .selectFrom('fiscal_year')
    .selectAll()
    .where('year', '<=', periodYear(period))
    .where('opening_stored', '=', 1)
    .orderBy('year', 'desc')
    .executeTakeFirst();
  if (!base || period < base.opening_period)
    fail('OPENING_MISSING', '没有可用的期初起算年度', '请先检查账套期初资料');
  return { base, book };
}
export function assertCompleteEntries(count: number): void {
  if (count >= 200_000)
    fail(
      'ENTRY_LIMIT',
      '分录达到 200000 行，无法保证分析完整',
      '请缩小科目或期间范围后重试；本次没有输出截断结果',
    );
}
/** 核心接口取实际分录；元数据一次投影，避免逐凭证读取及 N+1。 */
async function entriesWithMetadata(
  svc: CoreServices,
  from: number,
  to: number,
  accountIds: number[],
  includeUnposted: boolean,
) {
  const entries = await svc.ledger.entries({
    periodFrom: from,
    periodTo: to,
    accountIds,
    includeUnposted,
    limit: 200_000,
  });
  assertCompleteEntries(entries.length);
  const metadata = await svc.db
    .selectFrom('voucher_line as l')
    .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
    .select(['l.id', 'l.biz_date', 'v.closing_kind'])
    .where('l.period', '>=', from)
    .where('l.period', '<=', to)
    .where('l.account_id', 'in', accountIds)
    .where('v.status', 'in', includeUnposted ? ['pending', 'audited', 'posted'] : ['posted'])
    .where('v.voided', '=', 0)
    .execute();
  const byId = new Map(metadata.map((r) => [r.id, r]));
  return entries.map((e) => {
    const meta = byId.get(e.lineId);
    if (!meta) fail('SNAPSHOT_MISMATCH', '分录元数据缺失', '请刷新重试并检查凭证资料');
    return { ...e, bizDate: meta.biz_date ?? e.date, closingKind: meta.closing_kind };
  });
}

export function analysisService(svc: CoreServices) {
  return {
    async config() {
      const db = svc.db.withTables<AnalysisTables>();
      const row = await db
        .selectFrom('analysis_aging_config')
        .selectAll()
        .where('user_id', '=', svc.user.id)
        .executeTakeFirst();
      return {
        bounds: row ? BucketBoundsSchema.parse(JSON.parse(row.bounds_json)) : DEFAULT_BOUNDS,
        revision: row?.revision ?? 0,
      };
    },
    async saveConfig(raw: { bounds: number[]; expectedRevision: number }) {
      const bounds = BucketBoundsSchema.parse(raw.bounds);
      return svc.tx(async (tsvc) => {
        const db = tsvc.db.withTables<AnalysisTables>();
        const current = await analysisService(tsvc).config();
        if (JSON.stringify(current.bounds) === JSON.stringify(bounds)) return current;
        if (current.revision !== raw.expectedRevision)
          fail('CONFLICT', '账龄区间已被另一窗口修改', '刷新配置后重新编辑，避免覆盖他人的更新');
        const value = {
          user_id: tsvc.user.id,
          bounds_json: JSON.stringify(bounds),
          revision: current.revision + 1,
        };
        if (current.revision === 0)
          await db.insertInto('analysis_aging_config').values(value).execute();
        else
          await db
            .updateTable('analysis_aging_config')
            .set(value)
            .where('user_id', '=', tsvc.user.id)
            .execute();
        await tsvc.log.write({ action: 'analysis.config.save', summary: '保存个人账龄区间' });
        return { bounds, revision: value.revision };
      });
    },
    async shortcuts() {
      return svc.db
        .withTables<AnalysisTables>()
        .selectFrom('analysis_shortcut')
        .selectAll()
        .execute();
    },
    async saveShortcut(input: { kind: string; accountCode: string; expectedRevision: number }) {
      return svc.tx(async (tsvc) => {
        await selection(tsvc, input.accountCode);
        const db = tsvc.db.withTables<AnalysisTables>();
        const current = await db
          .selectFrom('analysis_shortcut')
          .selectAll()
          .where('kind', '=', input.kind)
          .executeTakeFirst();
        if (current?.account_code === input.accountCode) return current;
        if ((current?.revision ?? 0) !== input.expectedRevision)
          fail('CONFLICT', '入口科目已被修改', '刷新后重新选择入口科目');
        const row = {
          kind: input.kind,
          account_code: input.accountCode,
          revision: (current?.revision ?? 0) + 1,
        };
        if (current)
          await db
            .updateTable('analysis_shortcut')
            .set(row)
            .where('kind', '=', input.kind)
            .execute();
        else await db.insertInto('analysis_shortcut').values(row).execute();
        await tsvc.log.write({
          action: 'analysis.shortcut.save',
          summary: `设置分析入口 ${input.kind}：${input.accountCode}`,
        });
        return row;
      });
    },
    async aging(raw: AgingFilter): Promise<AgingReport> {
      const f = AgingFilterSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const accounts = await selection(tsvc, f.accountCode);
        const byId = new Map(accounts.map((a) => [a.id, a]));
        const cutoffPeriod = periodOfDate(f.cutoff);
        const { base, book } = await baseOf(tsvc, cutoffPeriod);
        const entries = await entriesWithMetadata(
          tsvc,
          base.opening_period,
          cutoffPeriod,
          accounts.map((a) => a.id),
          f.includeUnposted,
        );
        const openings = await tsvc.opening.list(base.year);
        const extra = f.groupBy === 'none' || f.groupBy === 'partner' ? null : f.groupBy;
        const allocationDims = extra ? (['partner', extra] as const) : (['partner'] as const);
        const reportDims = f.groupBy === 'none' ? [] : allocationDims;
        const names = new Map<number, string>();
        for (const d of allocationDims)
          for (const item of await tsvc.dimensions.items(d))
            names.set(item.id, `${item.code} ${item.name}`);
        const dimsKey = (dims: DimensionValues, fields: readonly (keyof DimensionValues)[]) =>
          JSON.stringify(fields.map((d) => dims[d] ?? null));
        const groupName = (
          dims: DimensionValues,
          fields: readonly (keyof DimensionValues)[] = reportDims,
        ) =>
          fields.length === 0
            ? '科目汇总'
            : fields
                .map((d) =>
                  dims[d] == null
                    ? `未指定${d === 'partner' ? '客供' : d === 'project' ? '项目' : d === 'department' ? '部门' : '个人'}`
                    : (names.get(dims[d]!) ?? `辅助项 ${dims[d]}`),
                )
                .join(' · ');
        const groups = new Map<
          string,
          {
            accountId: number;
            dimensions: DimensionValues;
            currency: string | null;
            lots: AgingLot[];
          }
        >();
        const get = (accountId: number, dimensions: DimensionValues, currency: string | null) => {
          const normalizedCurrency = currency === book.baseCurrency ? null : currency;
          const key = `${accountId}|${dimsKey(dimensions, allocationDims)}|${normalizedCurrency ?? 'BASE'}`;
          let group = groups.get(key);
          if (!group)
            groups.set(
              key,
              (group = { accountId, dimensions, currency: normalizedCurrency, lots: [] }),
            );
          return group;
        };
        const sign = f.direction === 'receivable' ? 1 : -1;
        for (const o of openings) {
          if (!byId.has(o.accountId)) continue;
          get(o.accountId, o.dimensions, o.currency).lots.push({
            lineId: null,
            voucherId: null,
            voucherNo: '期初未分龄',
            date: null,
            bizDate: null,
            amount: cents(o.balance * sign),
            remaining: 0,
          });
        }
        for (const e of entries) {
          if (e.date > f.cutoff) continue;
          get(e.accountId, e.dimensions, e.currency).lots.push({
            lineId: e.lineId,
            voucherId: e.voucherId,
            voucherNo: e.displayNo,
            date: e.date,
            bizDate: e.bizDate,
            amount: cents(cents(e.debit - e.credit) * sign),
            remaining: 0,
          });
        }
        const merged = new Map<string, AgingRow>();
        for (const g of groups.values()) {
          const a = byId.get(g.accountId)!;
          const fifo = allocateFifo(g.lots, f.cutoff, f.bounds);
          const key = `${a.code}|${dimsKey(g.dimensions, reportDims)}|${g.currency ?? 'BASE'}`;
          const dimensions = Object.fromEntries(
            reportDims.map((d) => [d, g.dimensions[d] ?? null]),
          );
          const row: AgingRow = {
            key,
            accountCode: a.code,
            accountName: a.fullName,
            groupId: f.groupBy === 'none' ? null : (g.dimensions.partner ?? null),
            groupName: groupName(g.dimensions),
            dimensions,
            currency: g.currency ?? book.baseCurrency,
            ...fifo,
            lots: fifo.lots.map((l) => ({
              ...l,
              groupName: groupName(g.dimensions, allocationDims),
            })),
            buckets: fifo.buckets.map((n) => cents(n * sign)),
            unaged: cents(fifo.unaged * sign),
            future: cents(fifo.future * sign),
            reverse: cents(fifo.reverse * sign),
            closing: cents(fifo.closing * sign),
            allocated: cents(fifo.allocated * sign),
          };
          const previous = merged.get(key);
          if (!previous) merged.set(key, row);
          else {
            previous.buckets = previous.buckets.map((n, i) => cents(n + row.buckets[i]!));
            for (const k of ['unaged', 'future', 'reverse', 'closing', 'allocated'] as const)
              previous[k] = cents(previous[k] + row[k]);
            previous.lots.push(...row.lots);
          }
        }
        const rows = [...merged.values()].sort(
          (a, b) =>
            a.accountCode.localeCompare(b.accountCode) ||
            a.groupName.localeCompare(b.groupName) ||
            a.currency.localeCompare(b.currency),
        );
        // 独立核对：核心月末余额，扣除凭证日期晚于 cutoff 的未来分录，得到同截止日余额。
        const balances = await tsvc.ledger.balances({
          periodFrom: cutoffPeriod,
          periodTo: cutoffPeriod,
          accountCodes: [f.accountCode],
          groupBy: [...reportDims],
          includeUnposted: f.includeUnposted,
          rollup: false,
        });
        const controls = new Map<string, AgingReport['controls'][number]>();
        const control = (code: string, dimensions: DimensionValues) => {
          const key = `${code}|${dimsKey(dimensions, reportDims)}`;
          let row = controls.get(key);
          if (!row)
            controls.set(
              key,
              (row = {
                key,
                accountCode: code,
                groupName: groupName(dimensions),
                allocated: 0,
                ledger: 0,
                difference: 0,
              }),
            );
          return row;
        };
        for (const b of balances) {
          const c = control(b.accountCode, b.dimensions);
          c.ledger = cents(c.ledger + b.closing);
        }
        for (const e of entries.filter((e) => e.date > f.cutoff)) {
          const c = control(e.accountCode, e.dimensions);
          c.ledger = sum([c.ledger, -e.debit, e.credit]);
        }
        for (const r of rows) {
          const c = control(r.accountCode, r.dimensions);
          c.allocated = cents(c.allocated + r.allocated);
        }
        for (const c of controls.values()) c.difference = cents(c.allocated - c.ledger);
        if ([...controls.values()].some((c) => c.difference !== 0))
          fail(
            'RECONCILIATION',
            '账龄合计与同截止日总账不一致，未生成报告',
            '请检查期初与凭证资料后重试',
          );
        const visible = f.hideZero ? rows.filter((r) => r.closing !== 0) : rows;
        return {
          filter: f,
          generatedAt: tsvc.ctx.now().toISOString(),
          basePeriod: base.opening_period,
          baseCurrency: book.baseCurrency,
          bucketLabels: bucketLabels(f.bounds),
          rows: visible,
          controls: [...controls.values()],
          totals: {
            buckets: f.bounds
              .map((_, i) => sum(visible.map((r) => r.buckets[i]!)))
              .concat(sum(visible.map((r) => r.buckets[f.bounds.length]!))),
            unaged: sum(visible.map((r) => r.unaged)),
            future: sum(visible.map((r) => r.future)),
            reverse: sum(visible.map((r) => r.reverse)),
            closing: sum(visible.map((r) => r.closing)),
            ledger: sum([...controls.values()].map((c) => c.ledger)),
            difference: 0,
          },
        };
      });
    },
    async trend(raw: TrendFilter): Promise<TrendReport> {
      const f = TrendFilterSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const accounts = await selection(tsvc, f.accountCode);
        const year = periodYear(f.period);
        const endMonth = f.mode === 'annual' ? 12 : f.period % 100;
        const end = year * 100 + endMonth;
        const { base, book } = await baseOf(tsvc, end);
        const entries = await entriesWithMetadata(
          tsvc,
          base.opening_period,
          end,
          accounts.map((a) => a.id),
          f.includeUnposted,
        );
        const pnl = entries.filter((e) => e.closingKind === 'pnl');
        const first = Math.max(year * 100 + 1, book.startPeriod);
        const rows: TrendRow[] = accounts.map((a) => ({
          accountCode: a.code,
          accountName: a.fullName,
          direction: a.direction,
          months: Array<number | null>(12).fill(null),
          current: 0,
          ytd: 0,
          average: 0,
          ratio: null,
          ledgerCurrent: 0,
          pnlAdjustment: 0,
        }));
        for (let p = first; p <= end; p++) {
          const balance = await tsvc.ledger.balances({
            periodFrom: p,
            periodTo: p,
            accountCodes: [f.accountCode],
            includeUnposted: f.includeUnposted,
            rollup: false,
            includeZero: true,
          });
          const byCode = new Map(balance.map((b) => [b.accountCode, b]));
          for (const row of rows) {
            const b = byCode.get(row.accountCode);
            if (!b) continue;
            const relevant = pnl.filter((e) => e.accountCode === row.accountCode);
            const adjustments = f.scope === 'ledger' ? [] : relevant;
            const selectedValue = (list: EntryRow[]) =>
              f.metric === 'debit'
                ? sum(list.map((e) => e.debit))
                : f.metric === 'credit'
                  ? sum(list.map((e) => e.credit))
                  : sum(list.map((e) => cents(e.debit - e.credit)));
            const adjust = selectedValue(
              adjustments.filter((e) => (f.metric === 'balance' ? e.period <= p : e.period === p)),
            );
            const ledgerValue = f.metric === 'balance' ? b.closing : b[f.metric];
            row.months[(p % 100) - 1] = cents(ledgerValue - adjust);
            if (p === end) {
              row.current = row.months[(p % 100) - 1]!;
              row.ledgerCurrent = cents(ledgerValue);
              row.pnlAdjustment = adjust;
              row.ytd =
                f.metric === 'balance'
                  ? row.current
                  : cents(
                      (f.metric === 'debit' ? b.ytdDebit : b.ytdCredit) -
                        selectedValue(
                          adjustments.filter((e) => e.period >= year * 100 + 1 && e.period <= p),
                        ),
                    );
            }
          }
        }
        const activeMonths = endMonth - (first % 100) + 1;
        for (const row of rows) {
          const numerator =
            f.metric === 'balance'
              ? sum(row.months.filter((n): n is number => n !== null))
              : row.ytd;
          row.average = cents(
            new Decimal(numerator)
              .div(f.metric === 'balance' ? activeMonths : endMonth)
              .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
              .toNumber(),
          );
        }
        for (let i = 0; i < 12; i++) sum(rows.map((r) => r.months[i] ?? 0));
        const denominator = sum(rows.map((r) => (f.mode === 'annual' ? r.ytd : r.current)));
        for (const row of rows)
          row.ratio =
            denominator === 0
              ? null
              : new Decimal(f.mode === 'annual' ? row.ytd : row.current)
                  .div(denominator)
                  .mul(100)
                  .toFixed(2);
        return {
          filter: f,
          generatedAt: tsvc.ctx.now().toISOString(),
          startPeriod: book.startPeriod,
          activeMonths,
          denominator,
          rows,
        };
      });
    },
  };
}
