import { createHash } from 'node:crypto';
import { BusinessError, formatPeriod, nextPeriod, periodYear, type Period } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { safeSum, signedAmount } from '../shared';
import type { CashierTables } from './migrations';

const tables = (svc: CoreServices) => svc.db.withTables<CashierTables>();
function fail(code: string, message: string, hint = '刷新期间状态，核对后重新预览'): never {
  throw new BusinessError({
    code: `CASHIER_${code}`,
    message,
    hint,
    actions: [{ label: '出纳结账与反结账', to: '/m/cashier/periods' }],
  });
}
export async function cashierPeriods(svc: CoreServices) {
  const enabled = await svc.settings.get<Period | null>('enabledPeriod', null);
  if (enabled == null) fail('NOT_ENABLED', '尚未启用出纳', '请先保存出纳启用期间和账户期初');
  const history = await tables(svc)
    .selectFrom('cashier_period')
    .selectAll()
    .orderBy('period')
    .execute();
  let current = enabled;
  for (const row of history.filter((r) => r.closed)) {
    if (row.period !== current) fail('PERIOD_SEQUENCE', '出纳已结账月份不连续，请检查账套数据');
    if (current === 999912) fail('PERIOD_LIMIT', '已到可支持的最后一个出纳月份');
    current = nextPeriod(current);
  }
  const lastClosed = history.filter((r) => r.closed).at(-1)?.period ?? null;
  return { enabled, current, lastClosed, history };
}

async function preview(svc: CoreServices) {
  const state = await cashierPeriods(svc);
  const db = tables(svc);
  const accounts = await db.selectFrom('cashier_account').selectAll().orderBy('id').execute();
  const openings = await db
    .selectFrom('cashier_opening')
    .selectAll()
    .orderBy('period')
    .orderBy('account_id')
    .execute();
  const documents = await db
    .selectFrom('cashier_document')
    .selectAll()
    .where('deleted', '=', 0)
    .orderBy('id')
    .execute();
  const checks = await db.selectFrom('cashier_check').selectAll().orderBy('id').execute();
  const rows = accounts.map((a) => {
    const initial = openings.find((o) => o.account_id === a.id && o.period === state.enabled);
    if (!initial) fail('OPENING_MISSING', `账户 ${a.name} 缺少启用期初，请检查账套数据`);
    const own = documents.filter((d) => d.account_id === a.id);
    const opening = safeSum([
      initial.balance,
      ...own.filter((d) => d.period < state.current).map(signedAmount),
    ]);
    const current = own.filter((d) => d.period === state.current);
    const receipt = safeSum(current.filter((d) => d.direction === 'receipt').map((d) => d.amount));
    const payment = safeSum(current.filter((d) => d.direction === 'payment').map((d) => d.amount));
    return {
      accountId: a.id,
      name: a.name,
      currency: a.currency,
      opening,
      receipt,
      payment,
      closing: safeSum([opening, receipt, -payment]),
    };
  });
  const next = state.current === 999912 ? null : nextPeriod(state.current);
  const rollover = next != null && periodYear(next) !== periodYear(state.current);
  const reopenRemovesYear = state.lastClosed != null && state.lastClosed % 100 === 12;
  // 所有已发生单据（包括软删除历史）都保护后续年度，反结账不删除业务数据。
  const laterHistory = reopenRemovesYear
    ? await db
        .selectFrom('cashier_document')
        .select('id')
        .where('period', '>', state.lastClosed!)
        .executeTakeFirst()
    : undefined;
  const laterChecks =
    reopenRemovesYear &&
    checks.some((c) =>
      [c.received_date, c.issued_date, c.finished_date].some(
        (date) => date != null && Number(date.slice(0, 4)) > periodYear(state.lastClosed!),
      ),
    );
  const snapshot = createHash('sha256')
    .update(JSON.stringify({ state, accounts, openings, documents, checks, laterHistory }))
    .digest('hex');
  return {
    ...state,
    rows,
    next,
    rollover,
    reopenRemovesYear,
    reopenBlocked: !!laterHistory || laterChecks,
    snapshot,
  };
}

export const periodService = (svc: CoreServices) => ({
  preview: () => svc.tx((t) => preview(t)),
  async close(input: { period: number; snapshot: string }) {
    svc.permissions.require('cashier.period.close');
    return svc.tx(async (t) => {
      const p = await preview(t);
      if (input.period !== p.current) fail('PERIOD_ORDER', '只能结账当前最早未结账的出纳月份');
      if (input.snapshot !== p.snapshot) fail('STALE', '出纳单据、账户或期间已变化，请重新预览');
      if (!p.rows.length) fail('NO_ACCOUNTS', '没有出纳账户，不能结账', '请先建立账户及期初');
      if (p.next == null) fail('PERIOD_LIMIT', '已到可支持的最后一个出纳月份');
      const db = tables(t);
      const old = p.history.find((r) => r.period === p.current);
      await db
        .insertInto('cashier_period')
        .values({
          period: p.current,
          closed: 1,
          revision: (old?.revision ?? 0) + 1,
          closed_at: t.ctx.now().toISOString(),
          closed_by: t.user.id,
        })
        .onConflict((oc) =>
          oc.column('period').doUpdateSet({
            closed: 1,
            revision: (old?.revision ?? 0) + 1,
            closed_at: t.ctx.now().toISOString(),
            closed_by: t.user.id,
          }),
        )
        .execute();
      for (const row of p.rows) {
        await db
          .insertInto('cashier_month_balance')
          .values({
            period: p.current,
            account_id: row.accountId,
            opening: row.opening,
            receipt: row.receipt,
            payment: row.payment,
            closing: row.closing,
          })
          .execute();
        if (p.rollover) {
          const existing = await db
            .selectFrom('cashier_opening')
            .selectAll()
            .where('period', '=', p.next)
            .where('account_id', '=', row.accountId)
            .executeTakeFirst();
          if (existing)
            fail('YEAR_EXISTS', '下一年度出纳期初已存在，不能覆盖', '保留现场并核对已有年度来源');
          await db
            .insertInto('cashier_opening')
            .values({ account_id: row.accountId, period: p.next, balance: row.closing })
            .execute();
        }
      }
      await t.log.write({
        action: 'cashier.period.close',
        summary: `出纳结账 ${formatPeriod(p.current)}`,
        detail: { period: p.current, next: p.next, rollover: p.rollover, rows: p.rows },
      });
      return { period: p.current, next: p.next };
    });
  },
  async reopen(input: { period: number; snapshot: string }) {
    svc.permissions.require('cashier.period.reopen');
    return svc.tx(async (t) => {
      const p = await preview(t);
      if (p.lastClosed == null || input.period !== p.lastClosed)
        fail('PERIOD_ORDER', '只能逐月反结账最近一个已结账月份，不能早于启用期');
      if (input.snapshot !== p.snapshot) fail('STALE', '出纳单据、账户或期间已变化，请重新预览');
      if (p.reopenBlocked)
        fail(
          'YEAR_IN_USE',
          '后续年度已有出纳业务历史（含支票），不能删除其年初数',
          '先保留备份并核对后续年度；本功能不会删除任何单据',
        );
      const db = tables(t);
      if (p.reopenRemovesYear)
        await db.deleteFrom('cashier_opening').where('period', '=', p.current).execute();
      await db.deleteFrom('cashier_month_balance').where('period', '=', p.lastClosed).execute();
      await db
        .updateTable('cashier_period')
        .set((eb) => ({
          closed: 0,
          revision: eb('revision', '+', 1),
          closed_at: null,
          closed_by: null,
        }))
        .where('period', '=', p.lastClosed)
        .execute();
      await t.log.write({
        action: 'cashier.period.reopen',
        summary: `出纳反结账 ${formatPeriod(p.lastClosed)}`,
        detail: {
          period: p.lastClosed,
          removedDerivedOpening: p.reopenRemovesYear ? p.current : null,
        },
      });
      return { period: p.lastClosed };
    });
  },
});
