import { Decimal } from 'decimal.js';
import { dimensionColumn, prevPeriod, type BalanceQuery, type BalanceRow } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { sql } from '@caiwu/db';
import { formulaError, formulaRequestKey, type FormulaAccountRequest } from './formula';

const FormulaDecimal = Decimal.clone({ precision: 80 });
type FormulaScope = { period: number; scope: 'operating' | 'ledger'; includeUnposted: boolean };

/** 原版 w_bb_help 明示的 S/W/F 参数，全部按当前账套的编码解析，不能跨账套猜 ID。 */
export async function validateFormulaAccounts(
  svc: CoreServices,
  requests: Iterable<FormulaAccountRequest>,
): Promise<void> {
  const accounts = await svc.accounts.list();
  const currencies = await svc.reference.currencies();
  const book = await svc.book.info();
  for (const request of requests) {
    const selected = accounts.filter(
      (a) => a.code === request.code || a.code.startsWith(request.code),
    );
    if (!selected.some((a) => a.code === request.code)) formulaError(`科目 ${request.code} 不存在`);
    const leaves = selected.filter((a) => a.isLeaf);
    if (request.valueKind === 'quantity') {
      const units = new Set(leaves.map((a) => a.quantityUnit));
      if (units.has(null) || units.size !== 1)
        formulaError(`科目 ${request.code} 的下级数量单位不同或未设置数量核算，不能合计数量`);
    }
    if (request.valueKind === 'foreign') {
      if (!request.currency || !currencies.some((c) => c.code === request.currency))
        formulaError(`币种 ${request.currency ?? ''} 不存在`);
      if (request.currency === book.baseCurrency)
        formulaError('外币函数须选择外币；本位币请直接使用金额函数');
      if (!leaves.some((a) => a.currency === request.currency))
        formulaError(`科目 ${request.code} 未设置 ${request.currency} 外币核算`);
    }
    if (request.dimension) {
      const { type, code } = request.dimension;
      const items = await svc.dimensions.items(type);
      const item = items.find((i) => i.code === code);
      if (!item) formulaError(`辅助编码 ${code} 不存在`);
      if (!item.isLeaf) formulaError(`辅助编码 ${code} 不是末级，请选择实际核算对象`);
      if (!leaves.some((a) => a.dimensions.some((d) => d.type === type)))
        formulaError(`科目 ${request.code} 未启用该类辅助核算`);
    }
  }
}

/** 调用方应在同一 svc.tx 内验证、读数及计算。数量保持 Decimal；金额从整数分转元。 */
export async function resolveFormulaAccounts(
  svc: CoreServices,
  requests: Iterable<FormulaAccountRequest>,
  scope: FormulaScope,
): Promise<Map<string, Decimal>> {
  const unique = new Map(Array.from(requests, (r) => [formulaRequestKey(r), r]));
  await validateFormulaAccounts(svc, unique.values());
  const values = new Map<string, Decimal>();
  const book = await svc.book.info();
  if (scope.period < book.startPeriod) formulaError('公式取数期间早于账套启用期间，历史数据未知');
  const yearFrom = Math.max(Math.trunc(scope.period / 100) * 100 + 1, book.startPeriod);
  const accounts = await svc.accounts.list();
  const cache = new Map<string, BalanceRow[]>();
  for (const [key, request] of unique) {
    const dimensions: NonNullable<BalanceQuery['dimensions']> = {};
    if (request.dimension) {
      const item = (await svc.dimensions.items(request.dimension.type)).find(
        (i) => i.code === request.dimension!.code,
      )!;
      dimensions[request.dimension.type] = item.id;
    }
    const query: Omit<BalanceQuery, 'periodFrom' | 'periodTo'> = {
      accountCodes: [request.code],
      dimensions,
      currency: request.currency,
      quantityUnit:
        request.valueKind === 'quantity'
          ? (accounts.find((a) => a.isLeaf && a.code.startsWith(request.code))?.quantityUnit ??
            undefined)
          : undefined,
      includeZero: true,
      includeUnposted: scope.includeUnposted,
      rollup: false,
      // 启用前本币累计保留实际期初值，不能以“排除结转”重写未知历史。
      // 只在下面扣除启用后、确有 pnl 标志的本年真实分录。
    };
    const balances = async (from: number, to: number): Promise<BalanceRow[]> => {
      const cacheKey = JSON.stringify({ ...query, periodFrom: from, periodTo: to });
      let rows = cache.get(cacheKey);
      if (!rows) {
        rows = await svc.ledger.balances({ ...query, periodFrom: from, periodTo: to });
        cache.set(cacheKey, rows);
      }
      return rows;
    };
    const sum = (rows: BalanceRow[], field: keyof BalanceRow): Decimal =>
      rows.reduce((total, row) => {
        const raw = row[field];
        if (raw == null)
          formulaError('启用前的外币或数量累计缺少来源，无法计算；请改用本期发生或调整分析期间');
        return total.plus(String(raw));
      }, new FormulaDecimal(0));
    const prefix =
      request.valueKind === 'quantity' ? 'qty' : request.valueKind === 'foreign' ? 'fc' : '';
    const field = (name: 'opening' | 'debit' | 'credit' | 'closing' | 'ytdDebit' | 'ytdCredit') =>
      (prefix ? `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}` : name) as keyof BalanceRow;
    let value: Decimal;
    if (request.fn === '年初') {
      value = sum(await balances(yearFrom, yearFrom), field('opening'));
    } else if (request.fn === '期初' || request.fn === '余额') {
      value = sum(
        await balances(scope.period, scope.period),
        field(request.fn === '期初' ? 'opening' : 'closing'),
      );
    } else {
      const fieldName = {
        借方: 'debit',
        贷方: 'credit',
        累计借方: 'ytdDebit',
        累计贷方: 'ytdCredit',
      }[request.fn] as 'debit' | 'credit' | 'ytdDebit' | 'ytdCredit';
      value = sum(await balances(scope.period, scope.period), field(fieldName));
    }
    if (scope.scope === 'operating' && request.fn !== '年初') {
      const to =
        request.fn === '期初'
          ? scope.period === yearFrom
            ? yearFrom - 1
            : prevPeriod(scope.period)
          : scope.period;
      if (to >= yearFrom) {
        let q = svc.db
          .selectFrom('voucher_line as l')
          .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
          .select([
            'l.period',
            'l.debit',
            'l.credit',
            'l.fc_amount',
            'l.quantity_e6',
            'l.entry_side',
          ])
          .where(
            'l.account_id',
            'in',
            accounts.filter((a) => a.isLeaf && a.code.startsWith(request.code)).map((a) => a.id),
          )
          .where(
            'l.period',
            '>=',
            request.fn === '借方' || request.fn === '贷方' ? scope.period : yearFrom,
          )
          .where('l.period', '<=', to)
          .where('v.closing_kind', '=', 'pnl')
          .where(
            'v.status',
            'in',
            scope.includeUnposted ? ['pending', 'audited', 'posted'] : ['posted'],
          )
          .where('v.voided', '=', 0);
        if (request.currency) q = q.where('l.currency_code', '=', request.currency);
        if (request.dimension)
          q = q.where(
            sql.ref(`l.${dimensionColumn(request.dimension.type)}`),
            '=',
            dimensions[request.dimension.type]!,
          );
        const adjustments = await q.execute();
        const side =
          request.fn === '借方' || request.fn === '累计借方'
            ? 'debit'
            : request.fn === '贷方' || request.fn === '累计贷方'
              ? 'credit'
              : 'net';
        for (const row of adjustments) {
          if (request.valueKind === 'money') {
            value = value.minus(
              side === 'net' ? new FormulaDecimal(row.debit).minus(row.credit) : row[side],
            );
          } else {
            const entrySide =
              row.entry_side ?? (row.debit !== 0 ? 'debit' : row.credit !== 0 ? 'credit' : null);
            const amount =
              request.valueKind === 'quantity'
                ? new FormulaDecimal(row.quantity_e6 ?? 0).div(1_000_000)
                : new FormulaDecimal(row.fc_amount ?? 0);
            if (!entrySide && !amount.isZero())
              formulaError('零本币分录缺少借贷方向，无法计算数量或外币');
            if (side === 'net')
              value = value.minus(entrySide === 'credit' ? amount.negated() : amount);
            else if (entrySide === side) value = value.minus(amount);
          }
        }
      }
    }
    values.set(key, request.valueKind === 'quantity' ? value : value.div(100));
  }
  return values;
}
