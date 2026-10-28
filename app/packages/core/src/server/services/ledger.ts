import { sql, withTransaction } from '@caiwu/db';
import { BusinessError } from '../../errors';
import {
  DIMENSION_TYPES,
  dimensionColumn,
  dimensionsKey,
  type DimensionTypeId,
  type DimensionValues,
} from '../../dimensions';
import { qtyFromE6 } from '../../decimal';
import {
  formatPeriod,
  makePeriod,
  periodYear,
  periodMonth,
  prevPeriod,
  type Period,
} from '../../period';
import {
  BalanceQuerySchema,
  DEFAULT_COUNTED_STATUSES,
  EntryFilterSchema,
  EntryPageSchema,
  CashflowPageSchema,
  UNPOSTED_COUNTED_STATUSES,
  type BalanceQuery,
  type BalanceRow,
  type EntryFilter,
  type EntryRow,
  type EntryPageQuery,
  type EntryPage,
  type CashflowSummary,
  type CashflowTotals,
  type CashflowPageQuery,
  type CashflowPage,
  type CashflowGroupPage,
  type CashflowDiagnosticPage,
} from '../../ledger';
import { formatVoucherNo } from '../../voucher';
import type { Account } from '../../account';
import type { ServiceContext } from '../context';
import { accountService } from './accounts';
import { bookService } from './basic';

function isExchangeCashEntry(row: EntryRow, account: Account | undefined, baseCurrency: string) {
  return (
    row.sourceModule === 'period-close' &&
    row.sourceType === 'exchange' &&
    row.closingKind === 'exchange' &&
    row.sourceId === String(row.period) &&
    (account?.isCash || account?.isBank) &&
    row.currency != null &&
    row.currency !== baseCurrency &&
    row.currency === account.currency &&
    row.fcAmount === 0
  );
}

/** 与 isExchangeCashEntry 同口径；完整凭证内部转移诊断也须排除汇率折算行。 */
const exchangeCashSql = (baseCurrency: string) => sql<boolean>`
  coalesce(v.source_module, '') = 'period-close'
  AND coalesce(v.source_type, '') = 'exchange'
  AND coalesce(v.closing_kind, '') = 'exchange'
  AND coalesce(v.source_id, '') = cast(l.period AS text)
  AND (a.is_cash = 1 OR a.is_bank = 1)
  AND coalesce(l.currency_code, '') NOT IN ('', ${baseCurrency})
  AND coalesce(a.currency_code, '') = coalesce(l.currency_code, '')
  AND l.fc_amount IS 0
`;

interface Accum {
  accountId: number;
  dims: DimensionValues;
  balanceDebit: bigint;
  balanceCredit: bigint;
  fcBalanceDelta: bigint;
  qtyBalanceDelta: bigint;
  opening: bigint;
  debit: bigint;
  credit: bigint;
  ytdDebit: bigint;
  ytdCredit: bigint;
  fcYtdDebit: bigint;
  fcYtdCredit: bigint;
  qtyYtdDebit: bigint;
  qtyYtdCredit: bigint;
  fcOpening: bigint;
  fcDebit: bigint;
  fcCredit: bigint;
  qtyOpening: bigint;
  qtyDebit: bigint;
  qtyCredit: bigint;
}

function emptyAccum(accountId: number, dims: DimensionValues): Accum {
  return {
    accountId,
    dims,
    balanceDebit: 0n,
    balanceCredit: 0n,
    fcBalanceDelta: 0n,
    qtyBalanceDelta: 0n,
    opening: 0n,
    debit: 0n,
    credit: 0n,
    ytdDebit: 0n,
    ytdCredit: 0n,
    fcYtdDebit: 0n,
    fcYtdCredit: 0n,
    qtyYtdDebit: 0n,
    qtyYtdCredit: 0n,
    fcOpening: 0n,
    fcDebit: 0n,
    fcCredit: 0n,
    qtyOpening: 0n,
    qtyDebit: 0n,
    qtyCredit: 0n,
  };
}

const n = (v: unknown) => BigInt((v ?? '0') as string | number);

function aggregateRangeError(label = '账簿累计金额或数量'): BusinessError {
  return new BusinessError({
    code: 'LEDGER_AGGREGATE_OUT_OF_RANGE',
    message: `${label}超出安全整数范围，无法返回精确结果`,
    hint: '请缩小查询范围或按科目、辅助项分别查询',
  });
}

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw aggregateRangeError(label);
  return result;
}

async function aggregateRows<T>(query: { execute(): Promise<T[]> }): Promise<T[]> {
  try {
    return await query.execute();
  } catch (error) {
    // SQLite 的 SUM 本身也可能超过 64 位；拒绝返回，不能改用浮点 TOTAL。
    if (error instanceof Error && error.message === 'integer overflow') throw aggregateRangeError();
    throw error;
  }
}

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

function flowColumns(baseCurrency: string) {
  const ordinary = sql<boolean>`not (${exchangeCashSql(baseCurrency)})`;
  const conditions = {
    cash: sql<boolean>`1`,
    inflow: sql<boolean>`${ordinary} and l.cashflow_direction = 'inflow'`,
    outflow: sql<boolean>`${ordinary} and l.cashflow_direction = 'outflow'`,
    internal: sql<boolean>`${ordinary} and l.cashflow_direction = 'internal'`,
    exchange: exchangeCashSql(baseCurrency),
    unallocated: sql<boolean>`${ordinary} and (l.cashflow_direction is null or l.dim_cashflow is null)`,
  };
  return [
    sql<string>`cast(count(*) as text)`.as('rowCount'),
    sql<string>`cast(coalesce(sum(case when ${conditions.unallocated} then 1 else 0 end), 0) as text)`.as(
      'unallocatedCount',
    ),
    ...Object.entries(conditions).flatMap(([key, condition]) => [
      sql<string>`cast(coalesce(sum(case when ${condition} then l.debit else 0 end), 0) as text)`.as(
        `${key}Debit`,
      ),
      sql<string>`cast(coalesce(sum(case when ${condition} then l.credit else 0 end), 0) as text)`.as(
        `${key}Credit`,
      ),
    ]),
  ];
}

function flowTotals(row: Record<string, unknown>): CashflowTotals {
  const net = (key: string) =>
    safeNumber(n(row[`${key}Debit`]) - n(row[`${key}Credit`]), '现金流量金额');
  return {
    rowCount: safeNumber(n(row.rowCount), '现金流量分录数'),
    cashNet: net('cash'),
    inflow: net('inflow'),
    outflow: -net('outflow') || 0,
    internalNet: net('internal'),
    exchangeEffect: net('exchange'),
    unallocatedNet: net('unallocated'),
    unallocatedCount: safeNumber(n(row.unallocatedCount), '未分配现金流量分录数'),
  };
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

  const assertEntryRange = async (
    f: ReturnType<typeof EntryFilterSchema.parse>,
    complete: boolean,
    label = '现金流量',
  ) => {
    if (f.periodFrom > f.periodTo)
      throw new BusinessError({
        code: 'PERIOD_RANGE_INVALID',
        message: '开始期间不能晚于结束期间',
      });
    if (complete) {
      const book = await bookService(ctx).info();
      if (f.periodFrom < book.startPeriod)
        throw new BusinessError({
          code: 'PERIOD_BEFORE_START',
          message: `${formatPeriod(f.periodFrom)}早于启用期间${formatPeriod(book.startPeriod)}，无法返回完整${label}`,
        });
      const present = new Set(
        (
          await ctx.db
            .selectFrom('period')
            .select('period')
            .where('period', '>=', f.periodFrom)
            .where('period', '<=', f.periodTo)
            .execute()
        ).map((row) => row.period),
      );
      const missing: number[] = [];
      for (let year = periodYear(f.periodFrom); year <= periodYear(f.periodTo); year++)
        for (
          let month = year === periodYear(f.periodFrom) ? periodMonth(f.periodFrom) : 1;
          month <= (year === periodYear(f.periodTo) ? periodMonth(f.periodTo) : 12);
          month++
        ) {
          const period = makePeriod(year, month);
          if (!present.has(period)) missing.push(period);
        }
      if (missing.length)
        throw new BusinessError({
          code: 'LEDGER_PERIOD_MISSING',
          message: `${label}查询缺少${missing.slice(0, 24).map(formatPeriod).join('、')}等${missing.length}个期间，不能按零计算`,
          details: { missingPeriods: missing },
          actions: [{ label: '去期末处理', to: '/m/period-close' }],
        });
    }
  };

  /** 共用过滤器：所有明细、完整合计与分组都先过滤，再截页。 */
  const entryQuery = async (f: ReturnType<typeof EntryFilterSchema.parse>) => {
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
        'v.source_type',
        'v.source_id',
        'v.closing_kind',
        't.code as type_code',
        'a.code as account_code',
      ])
      .where('l.period', '>=', f.periodFrom)
      .where('l.period', '<=', f.periodTo)
      .where('v.status', 'in', [...statuses])
      .where('v.voided', '=', 0);
    if (f.excludeClosing) q = q.where('v.closing_kind', 'is', null);
    else if (f.excludeClosingKinds.length)
      q = q.where((eb) =>
        eb.or([
          eb('v.closing_kind', 'is', null),
          eb('v.closing_kind', 'not in', f.excludeClosingKinds),
        ]),
      );
    if (f.accountCode) {
      q = f.includeChildren
        ? q.where('a.code', 'like', `${f.accountCode}%`)
        : q.where('a.code', '=', f.accountCode);
    }
    if (f.accountIds) q = q.where('l.account_id', 'in', f.accountIds);
    if (f.quantityUnit) q = q.where('a.quantity_unit', '=', f.quantityUnit);
    if (f.currency) {
      const baseCurrency = (await bookService(ctx).info()).baseCurrency;
      q = q.where((eb) =>
        f.currency === baseCurrency
          ? eb.or([eb('l.currency_code', '=', f.currency!), eb('l.currency_code', 'is', null)])
          : eb('l.currency_code', '=', f.currency!),
      );
    }
    for (const dt of DIMENSION_TYPES) {
      const v = f.dimensions[dt.id];
      if (v === null) q = q.where(sql.ref(`l.${dt.column}`), 'is', null);
      else if (v !== undefined) q = q.where(sql.ref(`l.${dt.column}`), '=', v);
    }
    return q;
  };
  const mapEntries = (
    rows: Awaited<ReturnType<Awaited<ReturnType<typeof entryQuery>>['execute']>>,
  ): EntryRow[] => {
    return rows.map((r) => ({
      voucherId: r.voucher_id,
      lineId: r.id,
      cashflowDirection: r.cashflow_direction,
      entrySide: r.entry_side,
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
      sourceType: r.source_type,
      sourceId: r.source_id,
      closingKind: r.closing_kind,
    }));
  };

  const cashQuery = async (f: ReturnType<typeof EntryFilterSchema.parse>) =>
    (await entryQuery(f)).where((eb) =>
      eb.or([eb('a.is_cash', '=', 1), eb('a.is_bank', '=', 1), eb('a.cashflow_required', '=', 1)]),
    );
  const orderedEntries = (q: Awaited<ReturnType<typeof entryQuery>>) =>
    q
      .orderBy('v.date')
      .orderBy('t.sort')
      .orderBy('t.id')
      .orderBy('v.number')
      .orderBy('l.line_no')
      .orderBy('l.id');

  const unbalancedQuery = async (
    f: ReturnType<typeof EntryFilterSchema.parse>,
    baseCurrency: string,
  ) => {
    const candidates = (await cashQuery(f))
      .clearSelect()
      .select('l.voucher_id')
      .where('l.cashflow_direction', '=', 'internal')
      .where(sql<boolean>`not (${exchangeCashSql(baseCurrency)})`)
      .distinct();
    // 外侧过滤仅决定候选凭证，逐凭证诊断必须读取其完整现金内部转移行。
    return ctx.db
      .selectFrom('voucher_line as l')
      .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
      .innerJoin('account as a', 'a.id', 'l.account_id')
      .select('l.voucher_id')
      .where('l.voucher_id', 'in', candidates)
      .where((eb) =>
        eb.or([
          eb('a.is_cash', '=', 1),
          eb('a.is_bank', '=', 1),
          eb('a.cashflow_required', '=', 1),
        ]),
      )
      .where('l.cashflow_direction', '=', 'internal')
      .where(sql<boolean>`not (${exchangeCashSql(baseCurrency)})`)
      .groupBy('l.voucher_id')
      .having(sql`sum(l.debit) - sum(l.credit)`, '!=', 0);
  };
  const diagnosticCount = async (q: Awaited<ReturnType<typeof unbalancedQuery>>) => {
    const [row] = await aggregateRows(
      ctx.db.selectFrom(q.as('diagnostic')).select(sql<string>`cast(count(*) as text)`.as('count')),
    );
    return safeNumber(n(row?.count), '内部转移异常凭证数');
  };

  const self = {
    /**
     * 分录明细：按日期、凭证类型、编号、行号排序。默认只含已过账凭证，作废凭证不含。
     * 明细账、日记账、往来对账都基于它。
     */
    async entries(raw: EntryFilter, requireComplete = false): Promise<EntryRow[]> {
      const f = EntryFilterSchema.parse(raw);
      await assertEntryRange(f, requireComplete);
      const q = await entryQuery(f);
      const rows = await orderedEntries(q)
        .limit(f.limit + (requireComplete ? 1 : 0))
        .execute();
      if (requireComplete && rows.length > f.limit)
        throw new BusinessError({
          code: 'LEDGER_QUERY_TOO_LARGE',
          message: `现金流量查询超过 ${f.limit} 条分录，不能截断汇总`,
          hint: '请缩短期间范围或按辅助对象分别查询',
        });
      return mapEntries(rows);
    },

    /**
     * 完整匹配数和有限明细页在同一快照读取，过滤先于计数与截页，旧 limit 不参与截页。
     * 与现金流分页相同，实际期间缺失时明确拒绝。跨页导出须在 svc.tx 内循环调用。
     */
    async entriesPage(raw: EntryPageQuery): Promise<EntryPage> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => ledgerService({ ...ctx, db }).entriesPage(raw));
      const f = EntryPageSchema.parse(raw);
      await assertEntryRange(f, true, '明细账');
      const query = await entryQuery(f);
      const [count] = await aggregateRows(
        query.clearSelect().select(sql<string>`cast(count(*) as text)`.as('count')),
      );
      const rowCount = safeNumber(n(count?.count), '明细账分录数');
      const rows = mapEntries(
        await orderedEntries(query).offset(f.offset).limit(f.pageSize).execute(),
      );
      return {
        rows,
        rowCount,
        offset: f.offset,
        pageSize: f.pageSize,
        hasMore: f.offset + rows.length < rowCount,
      };
    },

    /**
     * 科目余额：期初、本期借贷、期末、本年累计，可按辅助核算维度展开，可只看某一币种。
     * 余额"借正贷负"。rollup=true 时同时返回上级科目的汇总行。
     *
     * 期初 = 最近一个"期初已确定"年度的 opening_balance + 该年期初期间到 periodFrom 前一期的发生额。
     * 所用期间均已建立时，年结前也能跨年承接历史余额；未建期间不按零推算。
     */
    async balances(raw: BalanceQuery): Promise<BalanceRow[]> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => ledgerService({ ...ctx, db }).balances(raw));
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
      const book = await bookService(ctx).info();
      // 每行同时包含余额和 YTD：从实际期初锚点至查询末期、以及本年累计范围都要完整。
      // 首启用年从 startPeriod 起算；已存期初锚点之前未参与计算的期间不强制补建。
      const requiredYtdFrom = Math.max(book.startPeriod, makePeriod(targetYear, 1));
      const requiredFrom = Math.min(base.opening_period, requiredYtdFrom);
      const coveredPeriods = await ctx.db
        .selectFrom('period')
        .select('period')
        .where('period', '>=', requiredFrom)
        .where('period', '<=', q.periodTo)
        .execute();
      const ytdComplete =
        coveredPeriods.filter((p) => p.period >= requiredYtdFrom).length ===
        periodMonth(q.periodTo) - periodMonth(requiredYtdFrom) + 1;
      const coveredMonths =
        (targetYear - periodYear(requiredFrom)) * 12 +
        periodMonth(q.periodTo) -
        periodMonth(requiredFrom) +
        1;
      if (!ytdComplete || coveredPeriods.length !== coveredMonths) {
        const covered = new Set(coveredPeriods.map((row) => row.period));
        const missing: number[] = [];
        for (let year = periodYear(requiredFrom); year <= targetYear; year++)
          for (
            let month = year === periodYear(requiredFrom) ? periodMonth(requiredFrom) : 1;
            month <= (year === targetYear ? periodMonth(q.periodTo) : 12);
            month++
          ) {
            const period = makePeriod(year, month);
            if (!covered.has(period)) missing.push(period);
          }
        throw new BusinessError({
          code: ytdComplete ? 'LEDGER_BALANCE_PERIOD_MISSING' : 'LEDGER_YTD_PERIOD_MISSING',
          message: `${ytdComplete ? '余额承接' : '本年累计'}缺少期间：${missing.slice(0, 24).map(formatPeriod).join('、')}${missing.length > 24 ? `等${missing.length}个期间` : ''}，不能按零发生额计算`,
          details: { missingPeriods: missing },
          hint: '请补齐实际覆盖范围内的期间后重新查询；首启用年从启用期间累计，余额从已存期初锚点承接',
          actions: [{ label: '去期末处理', to: '/m/period-close' }],
        });
      }
      const baseCurrency = q.currency ? book.baseCurrency : null;
      const all = await accounts.list();
      const byId = new Map(all.map((a) => [a.id, a]));
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

      // SUM 先转文本，再用 bigint 抵销、汇总，输出时才检查 Number 安全范围。
      // 1. 起算年度的期初余额
      {
        let oq = ctx.db
          .selectFrom('opening_balance as o')
          .select('o.account_id')
          .select([
            sql<string>`cast(sum(o.balance) as text)`.as('balance'),
            sql<string>`cast(sum(o.fc_balance) as text)`.as('fc_balance'),
            sql<string>`cast(sum(o.quantity_e6) as text)`.as('qty'),
            sql<string>`cast(sum(o.ytd_debit) as text)`.as('ytd_debit'),
            sql<string>`cast(sum(o.ytd_credit) as text)`.as('ytd_credit'),
            // SUM 之前记录任一原始非零累计；正负抵销不代表来源已知。
            sql<string>`cast(max(case when o.ytd_debit <> 0 or o.ytd_credit <> 0 then 1 else 0 end) as text)`.as(
              'has_unknown_ytd',
            ),
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
        if (q.currency)
          oq = oq.where((eb) =>
            q.currency === baseCurrency
              ? eb.or([eb('o.currency_code', '=', q.currency!), eb('o.currency_code', 'is', null)])
              : eb('o.currency_code', '=', q.currency!),
          );
        for (const dt of DIMENSION_TYPES) {
          const v = q.dimensions[dt.id];
          if (v === undefined) continue;
          if (dt.id === 'cashflow') {
            if (v !== null) oq = oq.where(sql<boolean>`1 = 0`);
          } else if (v === null) oq = oq.where(sql.ref(`o.${dt.column}`), 'is', null);
          else oq = oq.where(sql.ref(`o.${dt.column}`), '=', v);
        }
        for (const r of (await aggregateRows(oq)) as Record<string, unknown>[]) {
          const a = get(r.account_id as number, dimsOf(r));
          if (q.quantityUnit && byId.get(a.accountId)?.quantityUnit !== q.quantityUnit) {
            acc.delete(keyOf(a.accountId, a.dims));
            continue;
          }
          a.opening += n(r.balance);
          a.fcOpening += n(r.fc_balance);
          a.qtyOpening += n(r.qty);
          if (base.year === targetYear) {
            const account = byId.get(a.accountId);
            if (
              (q.excludeClosing || q.excludeClosingKinds.length > 0) &&
              n(r.has_unknown_ytd) !== 0n &&
              account &&
              accountMatches(account, q)
            )
              throw new BusinessError({
                code: 'LEDGER_CLOSING_SCOPE_UNKNOWN',
                message: '启用前累计发生额没有结转来源，无法可靠排除结转',
                hint: '请使用有完整凭证明细的年度，或选择包含结转的账面口径',
              });
            a.ytdDebit += n(r.ytd_debit);
            a.ytdCredit += n(r.ytd_credit);
          }
        }
      }

      // 2. 分录发生额按区间汇总
      // 仅复用本次快照中实际相同的聚合；未配置结转排除时发生额与账面变动同口径。
      let lastRangeAggregate: { key: string; rows: Record<string, unknown>[] } | undefined;
      const sumLines = async (from: Period, to: Period, filterClosing = false) => {
        if (from > to) return [];
        const effectiveClosing =
          filterClosing && (q.excludeClosing || q.excludeClosingKinds.length > 0);
        const key = `${from}:${to}:${effectiveClosing}`;
        if (lastRangeAggregate?.key === key) return lastRangeAggregate.rows;
        lastRangeAggregate = undefined;
        let lq = ctx.db
          .selectFrom('voucher_line as l')
          .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
          .select('l.account_id')
          .select([
            sql<string>`cast(sum(l.debit) as text)`.as('debit'),
            sql<string>`cast(sum(l.credit) as text)`.as('credit'),
            sql<string>`cast(sum(case when l.entry_side = 'debit' OR (l.entry_side IS NULL AND l.debit <> 0) then coalesce(l.fc_amount, 0) else 0 end) as text)`.as(
              'fc_debit',
            ),
            sql<string>`cast(sum(case when l.entry_side = 'credit' OR (l.entry_side IS NULL AND l.credit <> 0) then coalesce(l.fc_amount, 0) else 0 end) as text)`.as(
              'fc_credit',
            ),
            sql<string>`cast(sum(case when l.entry_side = 'debit' OR (l.entry_side IS NULL AND l.debit <> 0) then coalesce(l.quantity_e6, 0) else 0 end) as text)`.as(
              'qty_debit',
            ),
            sql<string>`cast(sum(case when l.entry_side = 'credit' OR (l.entry_side IS NULL AND l.credit <> 0) then coalesce(l.quantity_e6, 0) else 0 end) as text)`.as(
              'qty_credit',
            ),
          ])
          .where('l.period', '>=', from)
          .where('l.period', '<=', to)
          .where('v.status', 'in', [...statuses])
          .where('v.voided', '=', 0)
          .groupBy('l.account_id');
        if (q.quantityUnit)
          lq = lq.where(
            'l.account_id',
            'in',
            all.filter((a) => a.quantityUnit === q.quantityUnit).map((a) => a.id),
          );
        if (effectiveClosing) {
          if (q.excludeClosing) lq = lq.where('v.closing_kind', 'is', null);
          else if (q.excludeClosingKinds.length)
            lq = lq.where((eb) =>
              eb.or([
                eb('v.closing_kind', 'is', null),
                eb('v.closing_kind', 'not in', q.excludeClosingKinds),
              ]),
            );
        }
        for (const col of groupCols)
          lq = lq.select(sql.ref(`l.${col}`).as(col)).groupBy(sql.ref(`l.${col}`));
        if (q.currency)
          lq = lq.where((eb) =>
            q.currency === baseCurrency
              ? eb.or([eb('l.currency_code', '=', q.currency!), eb('l.currency_code', 'is', null)])
              : eb('l.currency_code', '=', q.currency!),
          );
        for (const dt of DIMENSION_TYPES) {
          const v = q.dimensions[dt.id];
          if (v === null) lq = lq.where(sql.ref(`l.${dt.column}`), 'is', null);
          else if (v !== undefined) lq = lq.where(sql.ref(`l.${dt.column}`), '=', v);
        }
        const rows = (await aggregateRows(lq)) as Record<string, unknown>[];
        lastRangeAggregate = { key, rows };
        return rows;
      };

      // 起算期间到 periodFrom 前一期：并入期初
      for (const r of await sumLines(base.opening_period, prevPeriod(q.periodFrom))) {
        const a = get(r.account_id as number, dimsOf(r));
        a.opening += n(r.debit) - n(r.credit);
        a.fcOpening += n(r.fc_debit) - n(r.fc_credit);
        a.qtyOpening += n(r.qty_debit) - n(r.qty_credit);
      }
      // Balance movement always includes closing vouchers, independently of turnover filters.
      for (const r of await sumLines(q.periodFrom, q.periodTo)) {
        const a = get(r.account_id as number, dimsOf(r));
        a.balanceDebit += n(r.debit);
        a.balanceCredit += n(r.credit);
        a.fcBalanceDelta += n(r.fc_debit) - n(r.fc_credit);
        a.qtyBalanceDelta += n(r.qty_debit) - n(r.qty_credit);
      }
      // 本期发生
      for (const r of await sumLines(q.periodFrom, q.periodTo, true)) {
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
      for (const r of await sumLines(ytdFrom, q.periodTo, true)) {
        const a = get(r.account_id as number, dimsOf(r));
        a.ytdDebit += n(r.debit);
        a.ytdCredit += n(r.credit);
        a.fcYtdDebit += n(r.fc_debit);
        a.fcYtdCredit += n(r.fc_credit);
        a.qtyYtdDebit += n(r.qty_debit);
        a.qtyYtdCredit += n(r.qty_credit);
      }

      // 3. 汇总到上级科目
      const totals = new Map<string, Accum>();
      const quantityUnits = new Map<string, Set<string>>();
      const addInto = (target: Accum, src: Accum) => {
        target.balanceDebit += src.balanceDebit;
        target.balanceCredit += src.balanceCredit;
        target.fcBalanceDelta += src.fcBalanceDelta;
        target.qtyBalanceDelta += src.qtyBalanceDelta;
        target.opening += src.opening;
        target.debit += src.debit;
        target.credit += src.credit;
        target.ytdDebit += src.ytdDebit;
        target.ytdCredit += src.ytdCredit;
        target.fcYtdDebit += src.fcYtdDebit;
        target.fcYtdCredit += src.fcYtdCredit;
        target.qtyYtdDebit += src.qtyYtdDebit;
        target.qtyYtdCredit += src.qtyYtdCredit;
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
          const unit = byId.get(a.accountId)?.quantityUnit;
          if (
            unit &&
            (a.qtyOpening !== 0n ||
              a.qtyDebit !== 0n ||
              a.qtyCredit !== 0n ||
              a.qtyYtdDebit !== 0n ||
              a.qtyYtdCredit !== 0n ||
              a.qtyBalanceDelta !== 0n)
          ) {
            let units = quantityUnits.get(k);
            if (!units) quantityUnits.set(k, (units = new Set()));
            units.add(unit);
          }
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
        const units = quantityUnits.get(keyOf(t.accountId, t.dims));
        if (units && units.size > 1)
          throw new BusinessError({
            code: 'LEDGER_QUANTITY_UNIT_REQUIRED',
            message: `科目 ${account.code} ${account.fullName} 包含${[...units].join('、')}，不能混加数量`,
            hint: '请按数量单位分别查询 quantityBalances，或选择末级科目',
            details: { accountId: account.id, units: [...units] },
          });
        const closing = t.opening + t.balanceDebit - t.balanceCredit;
        const isZero =
          t.opening === 0n &&
          closing === 0n &&
          t.debit === 0n &&
          t.credit === 0n &&
          t.ytdDebit === 0n &&
          t.ytdCredit === 0n &&
          (!q.currency ||
            (t.fcOpening === 0n &&
              t.fcDebit === 0n &&
              t.fcCredit === 0n &&
              t.fcOpening + t.fcBalanceDelta === 0n &&
              t.fcYtdDebit === 0n &&
              t.fcYtdCredit === 0n)) &&
          t.qtyOpening === 0n &&
          t.qtyDebit === 0n &&
          t.qtyCredit === 0n &&
          t.qtyOpening + t.qtyBalanceDelta === 0n &&
          t.qtyYtdDebit === 0n &&
          t.qtyYtdCredit === 0n;
        if (isZero && !q.includeZero) continue;
        rows.push({
          quantityUnit: units?.values().next().value ?? account.quantityUnit,
          accountId: account.id,
          accountCode: account.code,
          accountName: account.fullName,
          level: account.level,
          isLeaf: account.isLeaf,
          direction: account.direction,
          dimensions: t.dims,
          opening: safeNumber(t.opening, '期初金额'),
          debit: safeNumber(t.debit, '借方发生额'),
          credit: safeNumber(t.credit, '贷方发生额'),
          closing: safeNumber(closing, '期末金额'),
          ytdDebit: safeNumber(t.ytdDebit, '本年累计借方'),
          ytdCredit: safeNumber(t.ytdCredit, '本年累计贷方'),
          fcYtdDebit:
            book.startPeriod % 100 !== 1 && targetYear === periodYear(book.startPeriod)
              ? null
              : q.currency && q.currency !== book.baseCurrency
                ? safeNumber(t.fcYtdDebit, '外币累计借方')
                : null,
          fcYtdCredit:
            book.startPeriod % 100 !== 1 && targetYear === periodYear(book.startPeriod)
              ? null
              : q.currency && q.currency !== book.baseCurrency
                ? safeNumber(t.fcYtdCredit, '外币累计贷方')
                : null,
          qtyYtdDebit:
            book.startPeriod % 100 !== 1 && targetYear === periodYear(book.startPeriod)
              ? null
              : qtyFromE6(safeNumber(t.qtyYtdDebit, '累计借方数量')),
          qtyYtdCredit:
            book.startPeriod % 100 !== 1 && targetYear === periodYear(book.startPeriod)
              ? null
              : qtyFromE6(safeNumber(t.qtyYtdCredit, '累计贷方数量')),
          dimensionYtdMissing:
            book.startPeriod % 100 !== 1 && targetYear === periodYear(book.startPeriod)
              ? '启用前外币/数量累计尚无独立来源，不能按零计算'
              : null,
          fcOpening: q.currency ? safeNumber(t.fcOpening, '外币期初') : 0,
          fcDebit: q.currency ? safeNumber(t.fcDebit, '外币借方') : 0,
          fcCredit: q.currency ? safeNumber(t.fcCredit, '外币贷方') : 0,
          fcClosing: q.currency ? safeNumber(t.fcOpening + t.fcBalanceDelta, '外币期末') : 0,
          qtyOpening: qtyFromE6(safeNumber(t.qtyOpening, '累计数量')),
          qtyDebit: qtyFromE6(safeNumber(t.qtyDebit, '累计数量')),
          qtyCredit: qtyFromE6(safeNumber(t.qtyCredit, '累计数量')),
          qtyClosing: qtyFromE6(safeNumber(t.qtyOpening + t.qtyBalanceDelta, '期末数量')),
        });
      }
      rows.sort((a, b) =>
        a.accountCode === b.accountCode
          ? dimensionsKey(a.dimensions).localeCompare(dimensionsKey(b.dimensions))
          : a.accountCode.localeCompare(b.accountCode),
      );
      return rows;
    },

    /** Both periods are read in the same SQLite snapshot; missing periods remain errors. */
    async compare(input: {
      current: BalanceQuery;
      comparison: BalanceQuery;
    }): Promise<{ current: BalanceRow[]; comparison: BalanceRow[] }> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => ledgerService({ ...ctx, db }).compare(input));
      return {
        current: await self.balances(input.current),
        comparison: await self.balances(input.comparison),
      };
    },
    /** Debit/credit balances are split at the leaf and auxiliary-object level before any account rollup. */
    async balanceSides(raw: BalanceQuery) {
      const rows = await self.balances({
        ...raw,
        rollup: false,
        groupBy: ['project', 'partner', 'department', 'person'],
      });
      return rows.map((row) => ({
        ...row,
        openingDebit: Math.max(row.opening, 0),
        openingCredit: Math.max(-row.opening, 0),
        closingDebit: Math.max(row.closing, 0),
        closingCredit: Math.max(-row.closing, 0),
      }));
    },
    async quantityBalances(raw: BalanceQuery & { quantityUnit: string }) {
      if (!raw.quantityUnit?.trim())
        throw new BusinessError({
          code: 'LEDGER_QUANTITY_UNIT_REQUIRED',
          message: '数量余额必须选择数量单位，不能跨单位混加',
        });
      return self.balances(raw);
    },
    /**
     * 同一快照中的完整合计和有限明细页。旧 limit 不影响完整合计；只有 pageSize 限制物化行数。
     * 多页导出要在 svc.tx 的回调内连续调用，以共享一次快照。
     */
    async cashflowPage(raw: CashflowPageQuery): Promise<CashflowPage> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => ledgerService({ ...ctx, db }).cashflowPage(raw));
      const f = CashflowPageSchema.parse(raw);
      await assertEntryRange(f, true);
      const { baseCurrency } = await bookService(ctx).info();
      const query = await cashQuery(f);
      const [aggregate] = await aggregateRows(
        query.clearSelect().select(flowColumns(baseCurrency)),
      );
      const totals = flowTotals(aggregate!);
      const rows = mapEntries(
        await orderedEntries(query).offset(f.offset).limit(f.pageSize).execute(),
      );
      return {
        rows,
        totals,
        internalUnbalancedVoucherCount: await diagnosticCount(
          await unbalancedQuery(f, baseCurrency),
        ),
        rowCount: totals.rowCount,
        offset: f.offset,
        pageSize: f.pageSize,
        hasMore: f.offset + rows.length < totals.rowCount,
      };
    },
    /** 现金流项目汇总也分页；未指定项目为 null，排在所有具名项目之前。 */
    async cashflowGroups(raw: CashflowPageQuery): Promise<CashflowGroupPage> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => ledgerService({ ...ctx, db }).cashflowGroups(raw));
      const f = CashflowPageSchema.parse(raw);
      await assertEntryRange(f, true);
      const { baseCurrency } = await bookService(ctx).info();
      const query = (await cashQuery(f)).clearSelect();
      const grouped = query.select('l.dim_cashflow').groupBy('l.dim_cashflow');
      const [count] = await aggregateRows(
        ctx.db
          .selectFrom(grouped.as('groups'))
          .select(sql<string>`cast(count(*) as text)`.as('count')),
      );
      const groupCount = safeNumber(n(count?.count), '现金流量项目组数');
      const rows = await aggregateRows(
        grouped
          .select(flowColumns(baseCurrency))
          .orderBy('l.dim_cashflow')
          .offset(f.offset)
          .limit(f.pageSize),
      );
      const groups = rows.map((row) => ({ cashflowId: row.dim_cashflow, ...flowTotals(row) }));
      return {
        groups,
        groupCount,
        offset: f.offset,
        pageSize: f.pageSize,
        hasMore: f.offset + groups.length < groupCount,
      };
    },
    /** 异常凭证列表独立分页，不因诊断列表过大而物化全部凭证。 */
    async cashflowDiagnostics(raw: CashflowPageQuery): Promise<CashflowDiagnosticPage> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) =>
          ledgerService({ ...ctx, db }).cashflowDiagnostics(raw),
        );
      const f = CashflowPageSchema.parse(raw);
      await assertEntryRange(f, true);
      const { baseCurrency } = await bookService(ctx).info();
      const query = await unbalancedQuery(f, baseCurrency);
      const voucherCount = await diagnosticCount(query);
      const rows = await aggregateRows(
        query.orderBy('l.voucher_id').offset(f.offset).limit(f.pageSize),
      );
      const voucherIds = rows.map((row) => row.voucher_id);
      return {
        voucherIds,
        voucherCount,
        offset: f.offset,
        pageSize: f.pageSize,
        hasMore: f.offset + voucherIds.length < voucherCount,
      };
    },
    /** Historical NULL direction stays unallocated even when the current project has direction metadata. */
    async cashflow(raw: EntryFilter): Promise<CashflowSummary> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => ledgerService({ ...ctx, db }).cashflow(raw));
      const entries = await self.entries({ ...raw, limit: 200_000 }, true);
      const { baseCurrency } = await bookService(ctx).info();
      const accounts = new Map((await accountService(ctx).list()).map((a) => [a.id, a]));
      const rows = entries.filter((row) => {
        const account = accounts.get(row.accountId);
        return account?.isCash || account?.isBank || account?.cashflowRequired;
      });
      const exchangeRows = new Set(
        rows
          .filter((row) => isExchangeCashEntry(row, accounts.get(row.accountId), baseCurrency))
          .map((row) => row.lineId),
      );
      const ordinary = (row: EntryRow) => !exchangeRows.has(row.lineId);
      const candidates = [
        ...new Set(
          rows
            .filter((row) => ordinary(row) && row.cashflowDirection === 'internal')
            .map((row) => row.voucherId),
        ),
      ];
      const unbalanced = new Set<number>();
      // Totals follow the requested subset. A voucher-level diagnostic must inspect
      // all its cash lines in the same snapshot, including the filtered-out side.
      for (let offset = 0; offset < candidates.length; offset += 500) {
        const complete = await ctx.db
          .selectFrom('voucher_line as l')
          .innerJoin('account as a', 'a.id', 'l.account_id')
          .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
          .select('l.voucher_id')
          .select(sql<string>`cast(sum(l.debit) - sum(l.credit) as text)`.as('net'))
          .where('l.voucher_id', 'in', candidates.slice(offset, offset + 500))
          .where((eb) =>
            eb.or([
              eb('a.is_cash', '=', 1),
              eb('a.is_bank', '=', 1),
              eb('a.cashflow_required', '=', 1),
            ]),
          )
          .where('l.cashflow_direction', '=', 'internal')
          .where(sql<boolean>`not (${exchangeCashSql(baseCurrency)})`)
          .groupBy('l.voucher_id')
          .execute();
        for (const voucher of complete)
          if (BigInt(voucher.net) !== 0n) unbalanced.add(voucher.voucher_id);
      }
      const total = (filter: (row: EntryRow) => boolean) =>
        safeNumber(
          rows
            .filter(filter)
            .reduce((sum, row) => sum + BigInt(row.debit) - BigInt(row.credit), 0n),
          '现金流量金额',
        );
      const unallocated = rows.filter(
        (row) =>
          ordinary(row) && (row.cashflowDirection == null || row.dimensions.cashflow == null),
      );
      return {
        rows,
        cashNet: total(() => true),
        inflow: total((row) => ordinary(row) && row.cashflowDirection === 'inflow'),
        outflow: 0 - total((row) => ordinary(row) && row.cashflowDirection === 'outflow'),
        internalNet: total((row) => ordinary(row) && row.cashflowDirection === 'internal'),
        exchangeEffect: total((row) => exchangeRows.has(row.lineId)),
        unallocatedNet: total((row) => unallocated.includes(row)),
        unallocatedCount: unallocated.length,
        internalUnbalancedVouchers: candidates.filter((id) => unbalanced.has(id)),
      };
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
      const sum = (f: (r: BalanceRow) => number) =>
        safeNumber(
          rows.reduce((s, r) => s + BigInt(f(r)), 0n),
          '试算合计',
        );
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
