import { sql, withTransaction } from '@caiwu/db';
import { BusinessError } from '../../errors';
import {
  formatPeriod,
  makePeriod,
  periodEndDate,
  periodStartDate,
  periodYear,
  type Period,
} from '../../period';
import { parseCodeScheme } from '../../code-scheme';
import type { BookInfo, PeriodInfo } from '../../book';
import type { PeriodWriteCheck, DependencyBlock } from '../inventory-provider';
import type { ProductId } from '../../products';
import { nowIso, type ServiceContext } from '../context';

// ---------------------------------------------------------------- 账套信息

export function bookService(ctx: ServiceContext) {
  return {
    async info(): Promise<BookInfo> {
      const row = await ctx.db
        .selectFrom('book_info')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();
      if (!row) throw new Error('账套信息缺失（book_info 为空），账套文件可能已损坏');
      return {
        id: row.book_id,
        name: row.name,
        orgName: row.org_name,
        templateId: row.template_id,
        templateName: row.template_name,
        regime: row.regime,
        product: row.product as ProductId,
        startPeriod: row.start_period,
        codeScheme: parseCodeScheme(row.code_scheme),
        baseCurrency: row.base_currency,
        createdAt: row.created_at,
      };
    },
  };
}

// ---------------------------------------------------------------- 期间

function toPeriodInfo(r: {
  period: number;
  year: number;
  month: number;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
}): PeriodInfo {
  return {
    period: r.period,
    year: r.year,
    month: r.month,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
  };
}

export function periodService(ctx: ServiceContext) {
  const self = {
    async list(): Promise<PeriodInfo[]> {
      const rows = await ctx.db.selectFrom('period').selectAll().orderBy('period').execute();
      return rows.map(toPeriodInfo);
    },

    async get(period: Period): Promise<PeriodInfo | null> {
      const r = await ctx.db
        .selectFrom('period')
        .selectAll()
        .where('period', '=', period)
        .executeTakeFirst();
      return r ? toPeriodInfo(r) : null;
    },

    /** 期间必须存在，否则抛出业务错误。 */
    async require(period: Period): Promise<PeriodInfo> {
      const p = await self.get(period);
      if (!p) {
        const first = await ctx.db
          .selectFrom('period')
          .select('period')
          .orderBy('period')
          .executeTakeFirst();
        if (first && period < first.period) {
          throw new BusinessError({
            code: 'PERIOD_BEFORE_START',
            message: `${formatPeriod(period)}早于账套启用期间${formatPeriod(first.period)}`,
            hint: '启用期间之前的数据请作为期初余额录入',
          });
        }
        throw new BusinessError({
          code: 'PERIOD_NOT_FOUND',
          message: `${formatPeriod(period)}还没有建立`,
          hint: '新年度的期间在年结后自动建立',
          actions: [{ label: '去期末处理', to: '/m/period-close' }],
        });
      }
      return p;
    },

    /** 期间必须存在且未结账。action 用于提示，例如 "保存凭证"。 */
    async assertOpen(period: Period, action = '修改数据'): Promise<PeriodInfo> {
      return self.assertWritable({ period, action, mode: 'business' });
    },

    async dependencies(input: PeriodWriteCheck): Promise<DependencyBlock[]> {
      const blocks: DependencyBlock[] = [];
      for (const provider of ctx.providers?.periodDependencies ?? [])
        blocks.push(...(await provider(ctx, input)));
      return blocks.filter((block) => block.count > 0);
    },

    async assertWritable(input: PeriodWriteCheck): Promise<PeriodInfo> {
      const mode = input.mode ?? 'business';
      const action = input.action ?? '修改数据';
      const book = await bookService(ctx).info();
      for (const period of new Set([input.period, input.oldPeriod ?? input.period])) {
        if (period < book.startPeriod)
          throw new BusinessError({
            code: 'PERIOD_BEFORE_START',
            message: `${formatPeriod(period)}早于启用期间${formatPeriod(book.startPeriod)}，不能${action}`,
          });
        const p = await self.require(period);
        const year = await ctx.db
          .selectFrom('fiscal_year')
          .selectAll()
          .where('year', '=', periodYear(period))
          .executeTakeFirst();
        if (!year)
          throw new BusinessError({
            code: 'YEAR_NOT_FOUND',
            message: `${periodYear(period)}年度未建立`,
          });
        if (mode !== 'year-reopen' && year.status === 'closed')
          throw new BusinessError({
            code: 'YEAR_CLOSED',
            message: `${year.year}年度已经年结，不能${action}`,
            actions: [{ label: '去期末处理', to: '/m/period-close' }],
          });
        if ((mode === 'business' || mode === 'opening') && p.status === 'closed')
          throw new BusinessError({
            code: 'PERIOD_CLOSED',
            message: `${formatPeriod(period)}已经结账，不能${action}`,
            hint: '先对该月反结账，再重新操作',
            actions: [{ label: '去期末处理', to: '/m/period-close' }],
          });
        if (mode === 'opening') {
          const lock = await ctx.db
            .selectFrom('book_setting')
            .select('value')
            .where('scope', '=', 'opening')
            .where('key', '=', `lock.${year.year}`)
            .executeTakeFirst();
          if (lock && JSON.parse(lock.value) === true)
            throw new BusinessError({
              code: 'OPENING_LOCKED',
              message: `${year.year}年期初已锁定，不能${action}`,
              actions: [{ label: '去期初录入', to: '/m/opening' }],
            });
        }
        const blocks = await self.dependencies({ ...input, period, mode });
        if (blocks.length)
          throw new BusinessError({
            code: 'PERIOD_DEPENDENCIES',
            message: `${formatPeriod(period)}不能${action}：${blocks.map((b) => `${b.category}${b.count}项`).join('、')}`,
            details: { blocks },
            actions: blocks.flatMap((b) =>
              b.to ? [{ label: `处理${b.category}`, to: b.to }] : [],
            ),
          });
      }
      return self.require(input.period);
    },

    /** 会计年度：首年 opening_period 为启用期间。 */
    async years() {
      return ctx.db.selectFrom('fiscal_year').selectAll().orderBy('year').execute();
    },

    /**
     * 建立会计年度及其期间（已存在则跳过）。fromMonth 用于首年从启用月开始。
     * openingStored = true 表示该年期初余额以 opening_balance 为准（首年、年结后）。
     */
    async ensureYear(year: number, opts: { fromMonth?: number; openingStored?: boolean } = {}) {
      const fromMonth = opts.fromMonth ?? 1;
      const exists = await ctx.db
        .selectFrom('fiscal_year')
        .select('year')
        .where('year', '=', year)
        .executeTakeFirst();
      if (!exists) {
        await ctx.db
          .insertInto('fiscal_year')
          .values({
            year,
            opening_period: makePeriod(year, fromMonth),
            opening_stored: opts.openingStored ? 1 : 0,
            status: 'open',
            closed_at: null,
            closed_by: null,
          })
          .execute();
      } else if (opts.openingStored != null) {
        await ctx.db
          .updateTable('fiscal_year')
          .set({ opening_stored: opts.openingStored ? 1 : 0 })
          .where('year', '=', year)
          .execute();
      }
      for (let m = fromMonth; m <= 12; m++) {
        const p = makePeriod(year, m);
        await ctx.db
          .insertInto('period')
          .values({
            period: p,
            year,
            month: m,
            start_date: periodStartDate(p),
            end_date: periodEndDate(p),
            status: 'open',
            closed_at: null,
            closed_by: null,
          })
          .onConflict((oc) => oc.column('period').doNothing())
          .execute();
      }
    },

    /** 结账 / 反结账只改状态；检查规则由期末处理模块负责。 */
    async setStatus(period: Period, status: 'open' | 'closed'): Promise<void> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) =>
          periodService({ ...ctx, db }).setStatus(period, status),
        );
      await self.require(period);
      const blocks =
        status === 'closed'
          ? await self.dependencies({ period, mode: 'year-close', action: '结账' })
          : [];
      if (blocks.length)
        throw new BusinessError({
          code: 'PERIOD_DEPENDENCIES',
          message: `${formatPeriod(period)}尚有${blocks.map((b) => `${b.category}${b.count}项`).join('、')}，不能结账`,
          details: { blocks },
          actions: blocks.flatMap((b) => (b.to ? [{ label: `处理${b.category}`, to: b.to }] : [])),
        });
      await ctx.db
        .updateTable('period')
        .set({
          status,
          closed_at: status === 'closed' ? nowIso(ctx) : null,
          closed_by: status === 'closed' ? ctx.user.id : null,
        })
        .where('period', '=', period)
        .execute();
    },

    /** 当前工作期间：最早的未结账期间；全部结账则取最后一个。 */
    async current(): Promise<PeriodInfo | null> {
      const open = await ctx.db
        .selectFrom('period')
        .selectAll()
        .where('status', '=', 'open')
        .orderBy('period')
        .executeTakeFirst();
      if (open) return toPeriodInfo(open);
      const last = await ctx.db
        .selectFrom('period')
        .selectAll()
        .orderBy('period', 'desc')
        .executeTakeFirst();
      return last ? toPeriodInfo(last) : null;
    },

    yearOf: periodYear,
  };
  return self;
}

// ---------------------------------------------------------------- 账套参数

/** 账套级参数，按模块隔离（scope = 当前模块 id，核心为 "core"）。值是任意可 JSON 序列化的数据。 */
export function settingsService(ctx: ServiceContext) {
  const scope = ctx.moduleId ?? 'core';
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const row = await ctx.db
        .selectFrom('book_setting')
        .select('value')
        .where('scope', '=', scope)
        .where('key', '=', key)
        .executeTakeFirst();
      return row ? (JSON.parse(row.value) as T) : fallback;
    },
    async set(key: string, value: unknown): Promise<void> {
      await ctx.db
        .insertInto('book_setting')
        .values({ scope, key, value: JSON.stringify(value), updated_at: nowIso(ctx) })
        .onConflict((oc) =>
          oc
            .columns(['scope', 'key'])
            .doUpdateSet({ value: JSON.stringify(value), updated_at: nowIso(ctx) }),
        )
        .execute();
    },
  };
}

// ---------------------------------------------------------------- 操作日志

export interface LogEntryInput {
  action: string;
  summary: string;
  targetType?: string;
  targetId?: string | number;
  detail?: unknown;
}

export function logService(ctx: ServiceContext) {
  return {
    async write(entry: LogEntryInput): Promise<void> {
      await ctx.db
        .insertInto('operation_log')
        .values({
          at: nowIso(ctx),
          user_id: ctx.user.id,
          user_name: ctx.user.name,
          module: ctx.moduleId ?? 'core',
          action: entry.action,
          target_type: entry.targetType ?? null,
          target_id: entry.targetId == null ? null : String(entry.targetId),
          summary: entry.summary,
          detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
        })
        .execute();
    },

    async list(opts: { limit?: number; targetType?: string; targetId?: string | number } = {}) {
      let q = ctx.db
        .selectFrom('operation_log')
        .selectAll()
        .orderBy('id', 'desc')
        .limit(opts.limit ?? 200);
      if (opts.targetType) q = q.where('target_type', '=', opts.targetType);
      if (opts.targetId != null) q = q.where('target_id', '=', String(opts.targetId));
      return q.execute();
    },
  };
}

// ---------------------------------------------------------------- 权限

export function permissionService(ctx: ServiceContext) {
  const has = (permission: string) => ctx.user.isAdmin || ctx.user.permissions.has(permission);
  return {
    has,
    require(permission: string) {
      if (has(permission)) return;
      const name = ctx.modules.permissionName(permission) ?? permission;
      throw new BusinessError({
        code: 'FORBIDDEN',
        message: `你没有「${name}」权限`,
        hint: '请让系统管理员在用户管理中授权',
        details: { permission },
      });
    },
  };
}

// ---------------------------------------------------------------- 币种、凭证类型、结算方式、摘要

export function referenceService(ctx: ServiceContext) {
  return {
    async currencies() {
      const rows = await ctx.db
        .selectFrom('currency')
        .selectAll()
        .orderBy('sort')
        .orderBy('code')
        .execute();
      return rows.map((r) => ({
        code: r.code,
        name: r.name,
        symbol: r.symbol,
        isBase: r.is_base === 1,
        disabled: r.disabled === 1,
      }));
    },

    /** 某币种在某期间适用的汇率：该期间或之前最近一次设定的汇率；没有返回 null。 */
    async exchangeRate(currency: string, period: Period): Promise<string | null> {
      const r = await ctx.db
        .selectFrom('exchange_rate')
        .select('rate')
        .where('currency_code', '=', currency)
        .where('period', '<=', period)
        .orderBy('period', 'desc')
        .executeTakeFirst();
      return r?.rate ?? null;
    },

    async voucherTypes() {
      const rows = await ctx.db
        .selectFrom('voucher_type')
        .selectAll()
        .orderBy('sort')
        .orderBy('id')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        rule: r.rule ? (JSON.parse(r.rule) as unknown) : null,
        disabled: r.disabled === 1,
      }));
    },

    async settlementMethods() {
      const rows = await ctx.db
        .selectFrom('settlement_method')
        .selectAll()
        .orderBy('sort')
        .orderBy('code')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        disabled: r.disabled === 1,
      }));
    },

    async summaries() {
      const rows = await ctx.db
        .selectFrom('summary_phrase')
        .selectAll()
        .orderBy('sort')
        .orderBy(sql`use_count`, 'desc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        text: r.text,
        pinyin: r.pinyin,
        useCount: r.use_count,
      }));
    },
  };
}
