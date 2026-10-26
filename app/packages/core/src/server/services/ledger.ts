import { sql } from '@caiwu/db';
import { BusinessError } from '../../errors';
import {
  DIMENSION_TYPES,
  dimensionColumn,
  dimensionsKey,
  type DimensionTypeId,
  type DimensionValues,
} from '../../dimensions';
import { qtyFromE6 } from '../../decimal';
import { formatPeriod, makePeriod, periodYear, prevPeriod, type Period } from '../../period';
import {
  BalanceQuerySchema,
  DEFAULT_COUNTED_STATUSES,
  EntryFilterSchema,
  UNPOSTED_COUNTED_STATUSES,
  type BalanceQuery,
  type BalanceRow,
  type EntryFilter,
  type EntryRow,
} from '../../ledger';
import { formatVoucherNo } from '../../voucher';
import type { Account } from '../../account';
import type { ServiceContext } from '../context';
import { accountService } from './accounts';

interface Accum {
  accountId: number;
  dims: DimensionValues;
  opening: number;
  debit: number;
  credit: number;
  ytdDebit: number;
  ytdCredit: number;
  fcOpening: number;
  fcDebit: number;
  fcCredit: number;
  qtyOpening: number;
  qtyDebit: number;
  qtyCredit: number;
}

function emptyAccum(accountId: number, dims: DimensionValues): Accum {
  return {
    accountId,
    dims,
    opening: 0,
    debit: 0,
    credit: 0,
    ytdDebit: 0,
    ytdCredit: 0,
    fcOpening: 0,
    fcDebit: 0,
    fcCredit: 0,
    qtyOpening: 0,
    qtyDebit: 0,
    qtyCredit: 0,
  };
}

const n = (v: unknown) => Number(v ?? 0);

/** 科目是否落在查询的科目范围内。 */
function accountMatches(
  a: Account,
  q: { codeFrom?: string; codeTo?: string; accountCodes?: string[] },
): boolean {
  if (q.codeFrom && a.code < q.codeFrom) return false;
  if (q.codeTo && a.code > q.codeTo && !a.code.startsWith(q.codeTo)) return false;
  if (q.accountCodes?.length && !q.accountCodes.some((c) => a.code.startsWith(c))) return false;
  return true;
}

export function ledgerService(ctx: ServiceContext) {
  const accounts = accountService(ctx);

  /**
   * 余额的起算点：期间 p 所在年度往前找最近一个"期初以 opening_balance 为准"的年度。
   * 返回该年度和它的期初期间。
   */
  const baseOf = async (p: Period) => {
    const year = await ctx.db
      .selectFrom('fiscal_year')
      .selectAll()
      .where('year', '<=', periodYear(p))
      .where('opening_stored', '=', 1)
      .orderBy('year', 'desc')
      .executeTakeFirst();
    if (!year || p < year.opening_period) {
      const first = await ctx.db
        .selectFrom('fiscal_year')
        .selectAll()
        .orderBy('year')
        .executeTakeFirst();
      throw new BusinessError({
        code: 'PERIOD_BEFORE_START',
        message: `${formatPeriod(p)}早于账套启用期间${first ? formatPeriod(first.opening_period) : ''}`,
      });
    }
    return year;
  };

  const self = {
    /**
     * 分录明细：按日期、凭证类型、编号、行号排序。默认只含已过账凭证，作废凭证不含。
     * 明细账、日记账、往来对账都基于它。
     */
    async entries(raw: EntryFilter): Promise<EntryRow[]> {
      const f = EntryFilterSchema.parse(raw);
      const statuses = f.includeUnposted ? UNPOSTED_COUNTED_STATUSES : DEFAULT_COUNTED_STATUSES;
      let q = ctx.db
        .selectFrom('voucher_line as l')
        .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
        .innerJoin('voucher_type as t', 't.id', 'v.voucher_type_id')
        .innerJoin('account as a', 'a.id', 'l.account_id')
        .selectAll('l')
        .select([
          'v.date',
          'v.number',
          'v.status',
          'v.source_module',
          't.code as type_code',
          'a.code as account_code',
        ])
        .where('l.period', '>=', f.periodFrom)
        .where('l.period', '<=', f.periodTo)
        .where('v.status', 'in', [...statuses])
        .where('v.voided', '=', 0);
      if (f.accountCode) {
        q = f.includeChildren
          ? q.where('a.code', 'like', `${f.accountCode}%`)
          : q.where('a.code', '=', f.accountCode);
      }
      if (f.accountIds?.length) q = q.where('l.account_id', 'in', f.accountIds);
      if (f.currency) q = q.where('l.currency_code', '=', f.currency);
      for (const dt of DIMENSION_TYPES) {
        const v = f.dimensions[dt.id];
        if (v != null) q = q.where(sql.ref(`l.${dt.column}`), '=', v);
      }
      const rows = await q
        .orderBy('v.date')
        .orderBy('t.sort')
        .orderBy('t.id')
        .orderBy('v.number')
        .orderBy('l.line_no')
        .limit(f.limit)
        .execute();
      return rows.map((r) => ({
        voucherId: r.voucher_id,
        lineId: r.id,
        period: r.period,
        date: r.date,
        voucherTypeCode: r.type_code,
        number: r.number,
        displayNo: formatVoucherNo(r.type_code, r.number),
        status: r.status,
        lineNo: r.line_no,
        summary: r.summary,
        accountId: r.account_id,
        accountCode: r.account_code,
        dimensions: {
          project: r.dim_project,
          partner: r.dim_partner,
          department: r.dim_department,
          person: r.dim_person,
          cashflow: r.dim_cashflow,
        },
        currency: r.currency_code,
        exchangeRate: r.exchange_rate,
        fcAmount: r.fc_amount,
        quantity: r.quantity_e6 == null ? null : qtyFromE6(r.quantity_e6),
        unitPrice: r.unit_price,
        debit: r.debit,
        credit: r.credit,
        refNo: r.ref_no,
        sourceModule: r.source_module,
      }));
    },

    /**
     * 科目余额：期初、本期借贷、期末、本年累计，可按辅助核算维度展开，可只看某一币种。
     * 余额"借正贷负"。rollup=true 时同时返回上级科目的汇总行。
     *
     * 期初 = 最近一个"期初已确定"年度的 opening_balance + 该年期初期间到 periodFrom 前一期的发生额。
     * 所以年结前也能跨年查询（上年期末自动结转为下年期初）。
     */
    async balances(raw: BalanceQuery): Promise<BalanceRow[]> {
      const q = BalanceQuerySchema.parse(raw);
      if (q.periodFrom > q.periodTo) {
        throw new BusinessError({
          code: 'PERIOD_RANGE_INVALID',
          message: '开始期间不能晚于结束期间',
        });
      }
      const statuses = q.includeUnposted ? UNPOSTED_COUNTED_STATUSES : DEFAULT_COUNTED_STATUSES;
      const base = await baseOf(q.periodFrom);
      const targetYear = periodYear(q.periodTo);
      const groupDims = DIMENSION_TYPES.filter((d) => q.groupBy.includes(d.id));
      const groupCols = groupDims.map((d) => d.column);

      const acc = new Map<string, Accum>();
      const keyOf = (accountId: number, dims: DimensionValues) =>
        `${accountId}|${dimensionsKey(dims)}`;
      const get = (accountId: number, dims: DimensionValues) => {
        const k = keyOf(accountId, dims);
        let a = acc.get(k);
        if (!a) acc.set(k, (a = emptyAccum(accountId, dims)));
        return a;
      };
      const dimsOf = (r: Record<string, unknown>): DimensionValues => {
        const d: DimensionValues = {};
        for (const g of groupDims) d[g.id] = (r[g.column] as number | null) ?? null;
        return d;
      };

      // 1. 起算年度的期初余额
      {
        let oq = ctx.db
          .selectFrom('opening_balance as o')
          .select('o.account_id')
          .select([
            sql<number>`sum(o.balance)`.as('balance'),
            sql<number>`sum(o.fc_balance)`.as('fc_balance'),
            sql<number>`sum(o.quantity_e6)`.as('qty'),
            sql<number>`sum(o.ytd_debit)`.as('ytd_debit'),
            sql<number>`sum(o.ytd_credit)`.as('ytd_credit'),
          ])
          .where('o.year', '=', base.year)
          .groupBy('o.account_id');
        for (const col of groupCols) {
          if (col === 'dim_cashflow') {
            oq = oq.select(sql<null>`null`.as('dim_cashflow'));
          } else {
            oq = oq.select(sql.ref(`o.${col}`).as(col)).groupBy(sql.ref(`o.${col}`));
          }
        }
        if (q.currency) oq = oq.where('o.currency_code', '=', q.currency);
        for (const dt of DIMENSION_TYPES) {
          const v = q.dimensions[dt.id];
          if (v == null) continue;
          if (dt.id === 'cashflow') oq = oq.where(sql<boolean>`1 = 0`);
          else oq = oq.where(sql.ref(`o.${dt.column}`), '=', v);
        }
        for (const r of (await oq.execute()) as Record<string, unknown>[]) {
          const a = get(r.account_id as number, dimsOf(r));
          a.opening += n(r.balance);
          a.fcOpening += n(r.fc_balance);
          a.qtyOpening += n(r.qty);
          if (base.year === targetYear) {
            a.ytdDebit += n(r.ytd_debit);
            a.ytdCredit += n(r.ytd_credit);
          }
        }
      }

      // 2. 分录发生额按区间汇总
      const sumLines = async (from: Period, to: Period) => {
        if (from > to) return [];
        let lq = ctx.db
          .selectFrom('voucher_line as l')
          .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
          .select('l.account_id')
          .select([
            sql<number>`sum(l.debit)`.as('debit'),
            sql<number>`sum(l.credit)`.as('credit'),
            sql<number>`sum(case when l.debit <> 0 then coalesce(l.fc_amount, 0) else 0 end)`.as(
              'fc_debit',
            ),
            sql<number>`sum(case when l.credit <> 0 then coalesce(l.fc_amount, 0) else 0 end)`.as(
              'fc_credit',
            ),
            sql<number>`sum(case when l.debit <> 0 then coalesce(l.quantity_e6, 0) else 0 end)`.as(
              'qty_debit',
            ),
            sql<number>`sum(case when l.credit <> 0 then coalesce(l.quantity_e6, 0) else 0 end)`.as(
              'qty_credit',
            ),
          ])
          .where('l.period', '>=', from)
          .where('l.period', '<=', to)
          .where('v.status', 'in', [...statuses])
          .where('v.voided', '=', 0)
          .groupBy('l.account_id');
        for (const col of groupCols)
          lq = lq.select(sql.ref(`l.${col}`).as(col)).groupBy(sql.ref(`l.${col}`));
        if (q.currency) lq = lq.where('l.currency_code', '=', q.currency);
        for (const dt of DIMENSION_TYPES) {
          const v = q.dimensions[dt.id];
          if (v != null) lq = lq.where(sql.ref(`l.${dt.column}`), '=', v);
        }
        return (await lq.execute()) as Record<string, unknown>[];
      };

      // 起算期间到 periodFrom 前一期：并入期初
      for (const r of await sumLines(base.opening_period, prevPeriod(q.periodFrom))) {
        const a = get(r.account_id as number, dimsOf(r));
        a.opening += n(r.debit) - n(r.credit);
        a.fcOpening += n(r.fc_debit) - n(r.fc_credit);
        a.qtyOpening += n(r.qty_debit) - n(r.qty_credit);
      }
      // 本期发生
      for (const r of await sumLines(q.periodFrom, q.periodTo)) {
        const a = get(r.account_id as number, dimsOf(r));
        a.debit += n(r.debit);
        a.credit += n(r.credit);
        a.fcDebit += n(r.fc_debit);
        a.fcCredit += n(r.fc_credit);
        a.qtyDebit += n(r.qty_debit);
        a.qtyCredit += n(r.qty_credit);
      }
      // 本年累计：targetYear 年初（或启用期间）到 periodTo
      const ytdFrom = base.year === targetYear ? base.opening_period : makePeriod(targetYear, 1);
      for (const r of await sumLines(ytdFrom, q.periodTo)) {
        const a = get(r.account_id as number, dimsOf(r));
        a.ytdDebit += n(r.debit);
        a.ytdCredit += n(r.credit);
      }

      // 3. 汇总到上级科目
      const all = await accounts.list();
      const byId = new Map(all.map((a) => [a.id, a]));
      const totals = new Map<string, Accum>();
      const addInto = (target: Accum, src: Accum) => {
        target.opening += src.opening;
        target.debit += src.debit;
        target.credit += src.credit;
        target.ytdDebit += src.ytdDebit;
        target.ytdCredit += src.ytdCredit;
        target.fcOpening += src.fcOpening;
        target.fcDebit += src.fcDebit;
        target.fcCredit += src.fcCredit;
        target.qtyOpening += src.qtyOpening;
        target.qtyDebit += src.qtyDebit;
        target.qtyCredit += src.qtyCredit;
      };
      for (const a of acc.values()) {
        let account = byId.get(a.accountId);
        while (account) {
          const k = keyOf(account.id, a.dims);
          let t = totals.get(k);
          if (!t) totals.set(k, (t = emptyAccum(account.id, a.dims)));
          addInto(t, a);
          if (!q.rollup || account.parentId == null) break;
          account = byId.get(account.parentId);
        }
      }
      if (q.includeZero && groupDims.length === 0) {
        for (const a of all) {
          const k = keyOf(a.id, {});
          if (!totals.has(k) && (q.rollup || a.isLeaf)) totals.set(k, emptyAccum(a.id, {}));
        }
      }

      // 4. 输出
      const rows: BalanceRow[] = [];
      for (const t of totals.values()) {
        const account = byId.get(t.accountId);
        if (!account || !accountMatches(account, q)) continue;
        const closing = t.opening + t.debit - t.credit;
        const isZero =
          t.opening === 0 &&
          t.debit === 0 &&
          t.credit === 0 &&
          t.ytdDebit === 0 &&
          t.ytdCredit === 0;
        if (isZero && !q.includeZero) continue;
        rows.push({
          accountId: account.id,
          accountCode: account.code,
          accountName: account.fullName,
          level: account.level,
          isLeaf: account.isLeaf,
          direction: account.direction,
          dimensions: t.dims,
          opening: t.opening,
          debit: t.debit,
          credit: t.credit,
          closing,
          ytdDebit: t.ytdDebit,
          ytdCredit: t.ytdCredit,
          fcOpening: q.currency ? t.fcOpening : 0,
          fcDebit: q.currency ? t.fcDebit : 0,
          fcCredit: q.currency ? t.fcCredit : 0,
          fcClosing: q.currency ? t.fcOpening + t.fcDebit - t.fcCredit : 0,
          qtyOpening: qtyFromE6(t.qtyOpening),
          qtyDebit: qtyFromE6(t.qtyDebit),
          qtyCredit: qtyFromE6(t.qtyCredit),
          qtyClosing: qtyFromE6(t.qtyOpening + t.qtyDebit - t.qtyCredit),
        });
      }
      rows.sort((a, b) =>
        a.accountCode === b.accountCode
          ? dimensionsKey(a.dimensions).localeCompare(dimensionsKey(b.dimensions))
          : a.accountCode.localeCompare(b.accountCode),
      );
      return rows;
    },

    /** 试算平衡：一级科目期初、本期、期末借贷合计是否相等。 */
    async trialBalance(
      periodFrom: Period,
      periodTo: Period,
      opts: { includeUnposted?: boolean } = {},
    ) {
      const rows = (
        await self.balances({
          periodFrom,
          periodTo,
          includeUnposted: opts.includeUnposted ?? false,
        })
      ).filter((r) => r.level === 1);
      const sum = (f: (r: BalanceRow) => number) => rows.reduce((s, r) => s + f(r), 0);
      const result = {
        openingDebit: sum((r) => Math.max(r.opening, 0)),
        openingCredit: sum((r) => Math.max(-r.opening, 0)),
        debit: sum((r) => r.debit),
        credit: sum((r) => r.credit),
        closingDebit: sum((r) => Math.max(r.closing, 0)),
        closingCredit: sum((r) => Math.max(-r.closing, 0)),
      };
      return {
        ...result,
        balanced:
          result.openingDebit === result.openingCredit &&
          result.debit === result.credit &&
          result.closingDebit === result.closingCredit,
      };
    },

    dimensionColumn: (type: DimensionTypeId) => dimensionColumn(type),
  };
  return self;
}
