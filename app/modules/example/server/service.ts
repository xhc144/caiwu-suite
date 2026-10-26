import {
  BusinessError,
  formatMoney,
  moduleRoute,
  notFound,
  periodOfDate,
  VOUCHER_STATUS_LABELS,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { MemoInputSchema, type Memo, type MemoInput } from '../shared';
import type { ExampleTables } from './migrations';

/**
 * 业务逻辑放在这里（router 只做参数和权限），方便单测。
 * svc 是绑定到本模块的核心服务：生成的凭证自动记为本模块来源。
 */
export function memoService(svc: CoreServices) {
  const db = svc.db.withTables<ExampleTables>();

  const load = async (id: number) => {
    const row = await db
      .selectFrom('example_memo')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('记账单', id);
    return row;
  };

  /** 已生成凭证的记账单不能改、不能删（与原版出纳单据规则一致）。 */
  const assertNoVoucher = (row: { voucher_id: number | null }, action: string) => {
    if (row.voucher_id != null) {
      throw new BusinessError({
        code: 'EXAMPLE_MEMO_HAS_VOUCHER',
        message: `这张记账单已经生成了凭证，不能${action}`,
        hint: '先删除生成的凭证（凭证还没审核时可以删除），再来修改',
        actions: [
          { label: '查看凭证', to: moduleRoute('voucher-entry', `/edit?id=${row.voucher_id}`) },
        ],
      });
    }
  };

  const validate = async (raw: MemoInput) => {
    const input = MemoInputSchema.parse(raw);
    const debit = await svc.accounts.require(input.debitAccountId);
    const credit = await svc.accounts.require(input.creditAccountId);
    for (const a of [debit, credit]) {
      if (!a.isLeaf)
        throw new BusinessError({
          code: 'EXAMPLE_NOT_LEAF',
          message: `科目 ${a.code} ${a.name} 不是末级科目`,
        });
    }
    if (debit.id === credit.id)
      throw new BusinessError({
        code: 'EXAMPLE_SAME_ACCOUNT',
        message: '借方科目和贷方科目不能相同',
      });
    const needsDept = debit.dimensions.some((d) => d.type === 'department' && d.required);
    if (needsDept && input.departmentId == null) {
      throw new BusinessError({
        code: 'EXAMPLE_DEPT_REQUIRED',
        message: `科目 ${debit.code} ${debit.name} 需要选择部门`,
      });
    }
    await svc.periods.assertOpen(periodOfDate(input.date), '保存记账单');
    return input;
  };

  const self = {
    async list(filter: { keyword?: string; id?: number } = {}): Promise<Memo[]> {
      let q = db
        .selectFrom('example_memo as m')
        .innerJoin('account as da', 'da.id', 'm.debit_account_id')
        .innerJoin('account as ca', 'ca.id', 'm.credit_account_id')
        .leftJoin('dimension_item as d', 'd.id', 'm.department_id')
        .leftJoin('voucher as v', 'v.id', 'm.voucher_id')
        .leftJoin('voucher_type as vt', 'vt.id', 'v.voucher_type_id')
        .select([
          'm.id',
          'm.date',
          'm.period',
          'm.summary',
          'm.debit_account_id',
          'm.credit_account_id',
          'm.amount',
          'm.department_id',
          'm.voucher_id',
          'm.created_at',
          'da.full_name as debit_name',
          'da.code as debit_code',
          'ca.full_name as credit_name',
          'ca.code as credit_code',
          'd.name as department_name',
          'v.number as voucher_number',
          'v.status as voucher_status',
          'vt.code as voucher_type_code',
        ])
        .orderBy('m.date', 'desc')
        .orderBy('m.id', 'desc');
      if (filter.id) q = q.where('m.id', '=', filter.id);
      if (filter.keyword) q = q.where('m.summary', 'like', `%${filter.keyword}%`);
      const rows = await q.execute();
      return rows.map((r) => ({
        id: r.id,
        date: r.date,
        period: r.period,
        summary: r.summary,
        debitAccountId: r.debit_account_id,
        debitAccountName: `${r.debit_code} ${r.debit_name}`,
        creditAccountId: r.credit_account_id,
        creditAccountName: `${r.credit_code} ${r.credit_name}`,
        amount: r.amount,
        departmentId: r.department_id,
        departmentName: r.department_name,
        voucherId: r.voucher_id,
        voucherNo:
          r.voucher_id != null
            ? `${r.voucher_type_code}-${String(r.voucher_number).padStart(4, '0')}`
            : null,
        voucherStatus: r.voucher_status ? VOUCHER_STATUS_LABELS[r.voucher_status] : null,
        createdAt: r.created_at,
      }));
    },

    async create(raw: MemoInput): Promise<Memo> {
      const input = await validate(raw);
      const now = new Date().toISOString();
      const { id } = await db
        .insertInto('example_memo')
        .values({
          date: input.date,
          period: periodOfDate(input.date),
          summary: input.summary,
          debit_account_id: input.debitAccountId,
          credit_account_id: input.creditAccountId,
          amount: input.amount,
          department_id: input.departmentId ?? null,
          voucher_id: null,
          created_by: svc.user.id,
          created_at: now,
          updated_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await svc.log.write({
        action: 'example.memo.create',
        summary: `新增记账单：${input.summary}`,
        targetType: 'example_memo',
        targetId: id,
      });
      return (await self.list({ id }))[0]!;
    },

    async update(id: number, raw: MemoInput): Promise<Memo> {
      assertNoVoucher(await load(id), '修改');
      const input = await validate(raw);
      await db
        .updateTable('example_memo')
        .set({
          date: input.date,
          period: periodOfDate(input.date),
          summary: input.summary,
          debit_account_id: input.debitAccountId,
          credit_account_id: input.creditAccountId,
          amount: input.amount,
          department_id: input.departmentId ?? null,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', id)
        .execute();
      return (await self.list({ id }))[0]!;
    },

    async remove(id: number): Promise<void> {
      assertNoVoucher(await load(id), '删除');
      await db.deleteFrom('example_memo').where('id', '=', id).execute();
    },

    /** 生成凭证：记账单和凭证在同一个事务里，要么都成功要么都不变。 */
    async generateVoucher(id: number): Promise<Memo> {
      await svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<ExampleTables>();
        const row = await tdb
          .selectFrom('example_memo')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw notFound('记账单', id);
        if (row.voucher_id != null) {
          throw new BusinessError({
            code: 'EXAMPLE_ALREADY_VOUCHERED',
            message: '这张记账单已经生成过凭证了',
          });
        }
        const types = await tsvc.reference.voucherTypes();
        const type = types.find((t) => !t.disabled);
        if (!type)
          throw new BusinessError({
            code: 'EXAMPLE_NO_VOUCHER_TYPE',
            message: '没有可用的凭证类型',
          });
        const voucher = await tsvc.vouchers.create({
          voucherTypeId: type.id,
          date: row.date,
          lines: [
            {
              summary: row.summary,
              accountId: row.debit_account_id,
              debit: row.amount,
              dimensions: { department: row.department_id },
            },
            { summary: row.summary, accountId: row.credit_account_id, credit: row.amount },
          ],
          source: { type: 'memo', id: String(row.id) },
        });
        await tdb
          .updateTable('example_memo')
          .set({ voucher_id: voucher.id })
          .where('id', '=', id)
          .execute();
        await tsvc.log.write({
          action: 'example.memo.voucher',
          summary: `记账单「${row.summary}」生成凭证 ${voucher.displayNo}，金额 ${formatMoney(row.amount)}`,
          targetType: 'example_memo',
          targetId: id,
        });
      });
      return (await self.list({ id }))[0]!;
    },

    /** 删除生成的凭证（凭证已审核时不允许，由 core 检查并给出提示）。 */
    async deleteVoucher(id: number): Promise<Memo> {
      await svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<ExampleTables>();
        const row = await tdb
          .selectFrom('example_memo')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw notFound('记账单', id);
        if (row.voucher_id == null) return;
        await tsvc.vouchers.delete(row.voucher_id);
        await tdb
          .updateTable('example_memo')
          .set({ voucher_id: null })
          .where('id', '=', id)
          .execute();
      });
      return (await self.list({ id }))[0]!;
    },
  };
  return self;
}
