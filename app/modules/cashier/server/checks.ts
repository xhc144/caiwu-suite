import { BusinessError, notFound, periodOfDate } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import { CheckReceiveSchema, CheckIssueSchema } from '../shared';
import type { CashierTables } from './migrations';
import { assertOpen } from './service';

const tables = (svc: CoreServices) => svc.db.withTables<CashierTables>();
function fail(code: string, message: string, hint = '刷新支票登记簿，核对当前状态后操作'): never {
  throw new BusinessError({
    code: `CASHIER_CHECK_${code}`,
    message,
    hint,
    actions: [{ label: '支票登记簿', to: '/m/cashier/checks' }],
  });
}
async function selected(svc: CoreServices, id: number, revision: number) {
  const row = await tables(svc)
    .selectFrom('cashier_check')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('支票', id);
  if (row.revision !== revision) fail('STALE', '支票状态已经变化，请刷新后重新确认');
  return row;
}
async function bank(svc: CoreServices, id: number) {
  const a = await tables(svc)
    .selectFrom('cashier_account')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!a) throw notFound('出纳账户', id);
  const core = await svc.accounts.require(a.core_account_id);
  if (a.disabled || !core.isBank || core.disabled || !core.isLeaf)
    fail('ACCOUNT', '支票必须登记在未停用的银行末级账户', '请先核对出纳银行账户');
  return a;
}
export const checkService = (svc: CoreServices) => ({
  list: (input: { accountId?: number; state?: 'received' | 'issued' | 'cleared' | 'voided' }) => {
    let q = tables(svc)
      .selectFrom('cashier_check as c')
      .innerJoin('cashier_account as a', 'a.id', 'c.account_id')
      .selectAll('c')
      .select(['a.name as accountName', 'a.currency']);
    if (input.accountId != null) q = q.where('c.account_id', '=', input.accountId);
    if (input.state != null) q = q.where('c.state', '=', input.state);
    return q.orderBy('c.id', 'desc').execute();
  },
  async receive(raw: z.input<typeof CheckReceiveSchema>) {
    const input = CheckReceiveSchema.parse(raw);
    return svc.tx(async (t) => {
      await assertOpen(t, periodOfDate(input.receivedDate));
      await bank(t, input.accountId);
      const db = tables(t);
      const existing = await db
        .selectFrom('cashier_check')
        .selectAll()
        .where('account_id', '=', input.accountId)
        .where('number', '=', input.number)
        .executeTakeFirst();
      if (existing) fail('DUPLICATE', '本银行账户已经登记此支票号，不能重复领用');
      const row = await db
        .insertInto('cashier_check')
        .values({
          account_id: input.accountId,
          number: input.number,
          received_date: input.receivedDate,
          note: input.note,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .updateTable('cashier_account')
        .set({ used: 1 })
        .where('id', '=', input.accountId)
        .execute();
      await t.log.write({
        action: 'cashier.check.receive',
        summary: `领用支票 ${input.number}`,
        targetId: row.id,
        detail: input,
      });
      return row;
    });
  },
  async issue(raw: z.input<typeof CheckIssueSchema>) {
    const input = CheckIssueSchema.parse(raw);
    return svc.tx(async (t) => {
      const row = await selected(t, input.id, input.revision);
      if (row.state !== 'received') fail('STATE', '只有已领用且未签发的支票可以签发');
      if (input.date < row.received_date) fail('DATE', '签发日期不能早于领用日期');
      await assertOpen(t, periodOfDate(input.date));
      await bank(t, row.account_id);
      await tables(t)
        .updateTable('cashier_check')
        .set({
          state: 'issued',
          issued_date: input.date,
          payee: input.payee,
          amount: input.amount,
          revision: row.revision + 1,
        })
        .where('id', '=', row.id)
        .execute();
      await t.log.write({
        action: 'cashier.check.issue',
        summary: `签发支票 ${row.number}`,
        targetId: row.id,
        detail: input,
      });
    });
  },
  async finish(input: { id: number; revision: number; date: string; state: 'cleared' | 'voided' }) {
    return svc.tx(async (t) => {
      const row = await selected(t, input.id, input.revision);
      if (row.state === 'cleared' || row.state === 'voided')
        fail('STATE', '已兑付或已作废的支票不能再次变更');
      if (input.state === 'cleared' && row.state !== 'issued')
        fail('STATE', '未签发的支票不能登记兑付');
      if (input.date < (row.issued_date ?? row.received_date))
        fail('DATE', '兑付或作废日期不能早于签发（或领用）日期');
      await assertOpen(t, periodOfDate(input.date));
      await tables(t)
        .updateTable('cashier_check')
        .set({ state: input.state, finished_date: input.date, revision: row.revision + 1 })
        .where('id', '=', row.id)
        .execute();
      await t.log.write({
        action: `cashier.check.${input.state}`,
        summary: `${input.state === 'cleared' ? '兑付' : '作废'}支票 ${row.number}`,
        targetId: row.id,
        detail: input,
      });
    });
  },
});
