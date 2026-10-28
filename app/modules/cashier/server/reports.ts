import { BusinessError, periodYear } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { CashSummarySchema, type CashSummaryInput } from '../reports-shared';
import { safeSum, signedAmount } from '../shared';
import type { CashierTables } from './migrations';
import { cashierPeriods } from './periods';

function fail(message: string, hint: string): never {
  throw new BusinessError({
    code: 'CASHIER_REPORT_RANGE',
    message,
    hint,
    actions: [{ label: '出纳账户与期初', to: '/m/cashier/accounts' }],
  });
}

const baseKeys = ['opening', 'receipt', 'payment', 'closing', 'ytdReceipt', 'ytdPayment'] as const;
const foreignKeys = [
  'foreignOpening',
  'foreignReceipt',
  'foreignPayment',
  'foreignClosing',
  'foreignYtdReceipt',
  'foreignYtdPayment',
] as const;

export const reportsService = (svc: CoreServices) => ({
  async summary(raw: CashSummaryInput) {
    const input = CashSummarySchema.parse(raw);
    return svc.tx(async (t) => {
      const state = await cashierPeriods(t);
      if (input.from < state.enabled)
        fail('汇总起始月份早于出纳启用月份', '请从出纳启用月份开始查询');
      if (periodYear(input.to) > periodYear(state.current))
        fail('该年度的出纳期初尚未建立', '请先逐月结账至上一年十二月');
      await t.periods.require(input.from);
      await t.periods.require(input.to);
      const db = t.db.withTables<CashierTables>();
      const accounts = await db
        .selectFrom('cashier_account as a')
        .innerJoin('account as c', 'c.id', 'a.core_account_id')
        .select(['a.id', 'a.name', 'a.currency', 'c.code', 'c.full_name'])
        .orderBy('c.code')
        .orderBy('a.id')
        .execute();
      const openings = await db
        .selectFrom('cashier_opening')
        .selectAll()
        .where('period', '=', state.enabled)
        .execute();
      const documents = await db
        .selectFrom('cashier_document')
        .selectAll()
        .where('deleted', '=', 0)
        .where('period', '<=', input.to)
        .execute();
      const closed = new Set(state.history.filter((p) => p.closed).map((p) => p.period));
      const included = documents.filter((d) => input.includeUnclosed || closed.has(d.period));
      const effectiveTo = input.includeUnclosed
        ? input.to
        : state.lastClosed == null || state.lastClosed < input.from
          ? null
          : Math.min(input.to, state.lastClosed);
      const excludedPeriods: number[] = [];
      for (let p = input.from; p <= input.to; p++)
        if (!input.includeUnclosed && !closed.has(p)) excludedPeriods.push(p);
      const book = await t.book.info();
      const yearStart = periodYear(input.to) * 100 + 1;
      const rows = accounts.map((a) => {
        const initial = openings.find((o) => o.account_id === a.id);
        if (!initial) fail(`账户 ${a.name} 缺少出纳启用期初`, '请检查账户期初来源后再查询');
        const own = included.filter((d) => d.account_id === a.id);
        const prior = own.filter((d) => d.period < input.from);
        const current = own.filter((d) => d.period >= input.from);
        const ytd = own.filter((d) => d.period >= yearStart);
        const foreign = a.currency !== book.baseCurrency;
        if (
          foreign &&
          (initial.foreign_balance == null || own.some((d) => d.foreign_amount == null))
        )
          fail(`账户 ${a.name} 缺少原币期初或单据金额`, '请核对外币账户，不能把本位币金额当作原币');
        const opening = safeSum([initial.balance, ...prior.map(signedAmount)]);
        const receipt = safeSum(
          current.filter((d) => d.direction === 'receipt').map((d) => d.amount),
        );
        const payment = safeSum(
          current.filter((d) => d.direction === 'payment').map((d) => d.amount),
        );
        const foreignOpening = foreign
          ? safeSum([
              initial.foreign_balance!,
              ...prior.map((d) =>
                d.direction === 'receipt' ? d.foreign_amount! : -d.foreign_amount!,
              ),
            ])
          : null;
        const foreignReceipt = foreign
          ? safeSum(current.filter((d) => d.direction === 'receipt').map((d) => d.foreign_amount!))
          : null;
        const foreignPayment = foreign
          ? safeSum(current.filter((d) => d.direction === 'payment').map((d) => d.foreign_amount!))
          : null;
        return {
          accountId: a.id,
          name: a.name,
          code: a.code,
          coreName: a.full_name,
          currency: a.currency,
          opening,
          receipt,
          payment,
          closing: safeSum([opening, receipt, -payment]),
          ytdReceipt: safeSum(ytd.filter((d) => d.direction === 'receipt').map((d) => d.amount)),
          ytdPayment: safeSum(ytd.filter((d) => d.direction === 'payment').map((d) => d.amount)),
          foreignOpening,
          foreignReceipt,
          foreignPayment,
          foreignClosing: foreign
            ? safeSum([foreignOpening!, foreignReceipt!, -foreignPayment!])
            : null,
          foreignYtdReceipt: foreign
            ? safeSum(ytd.filter((d) => d.direction === 'receipt').map((d) => d.foreign_amount!))
            : null,
          foreignYtdPayment: foreign
            ? safeSum(ytd.filter((d) => d.direction === 'payment').map((d) => d.foreign_amount!))
            : null,
        };
      });
      const currencies = [...new Set(rows.map((r) => r.currency))].sort();
      const currencyTotals = currencies.map((currency) => {
        const own = rows.filter((r) => r.currency === currency);
        return {
          currency,
          ...(Object.fromEntries(
            baseKeys.map((key) => [key, safeSum(own.map((r) => r[key]))]),
          ) as Record<(typeof baseKeys)[number], number>),
          ...(Object.fromEntries(
            foreignKeys.map((key) => [
              key,
              currency === book.baseCurrency ? null : safeSum(own.map((r) => r[key]!)),
            ]),
          ) as Record<(typeof foreignKeys)[number], number | null>),
        };
      });
      const baseTotal = Object.fromEntries(
        baseKeys.map((key) => [key, safeSum(rows.map((r) => r[key]))]),
      ) as Record<(typeof baseKeys)[number], number>;
      return {
        ...input,
        effectiveTo,
        excludedPeriods,
        baseCurrency: book.baseCurrency,
        rows,
        currencyTotals,
        baseTotal,
      };
    });
  },
});
