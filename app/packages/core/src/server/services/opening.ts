import { BusinessError } from '../../errors';
import { OPENING_DIMENSION_TYPES, dimensionsKey, type DimensionValues } from '../../dimensions';
import { qtyFromE6, qtyToE6 } from '../../decimal';
import type { Cents } from '../../money';
import { nowIso, type ServiceContext } from '../context';
import { accountService } from './accounts';

export interface OpeningBalanceInput {
  year: number;
  accountId: number;
  /** 项目、客供、部门、个人（现金流量项目不进期初） */
  dimensions?: DimensionValues;
  /** 外币币种；本位币不填 */
  currency?: string | null;
  /** 期初余额（借正贷负，分） */
  balance: Cents;
  /** 年中启用：启用前本年累计借方、贷方 */
  ytdDebit?: Cents;
  ytdCredit?: Cents;
  /** 外币期初余额（借正贷负，分） */
  fcBalance?: Cents;
  /** 数量期初（借正贷负，十进制字符串） */
  quantity?: string;
}

export interface OpeningBalance extends Required<
  Omit<OpeningBalanceInput, 'dimensions' | 'currency'>
> {
  id: number;
  dimensions: DimensionValues;
  currency: string | null;
}

/**
 * 期初余额的读写（每个会计年度一套）。期初录入界面、试算平衡由期初模块负责；
 * 年结时期末处理模块用 replaceYear() 写入新年度的年初数。
 */
export function openingService(ctx: ServiceContext) {
  const accounts = accountService(ctx);
  return {
    async list(year: number): Promise<OpeningBalance[]> {
      const rows = await ctx.db
        .selectFrom('opening_balance')
        .selectAll()
        .where('year', '=', year)
        .orderBy('id')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        year: r.year,
        accountId: r.account_id,
        dimensions: {
          project: r.dim_project,
          partner: r.dim_partner,
          department: r.dim_department,
          person: r.dim_person,
        },
        currency: r.currency_code,
        balance: r.balance,
        ytdDebit: r.ytd_debit,
        ytdCredit: r.ytd_credit,
        fcBalance: r.fc_balance,
        quantity: qtyFromE6(r.quantity_e6),
      }));
    },

    /** 新增或覆盖一条期初（按 年度 + 科目 + 维度组合 + 币种 唯一）。只能录在末级科目上。 */
    async upsert(input: OpeningBalanceInput): Promise<void> {
      const account = await accounts.require(input.accountId);
      if (!account.isLeaf) {
        throw new BusinessError({
          code: 'OPENING_NOT_LEAF',
          message: `科目 ${account.code} ${account.name} 不是末级科目，期初余额要录在末级科目上`,
        });
      }
      const year = await ctx.db
        .selectFrom('fiscal_year')
        .selectAll()
        .where('year', '=', input.year)
        .executeTakeFirst();
      if (!year)
        throw new BusinessError({
          code: 'YEAR_NOT_FOUND',
          message: `${input.year} 年度还没有建立`,
        });
      const dims: DimensionValues = {};
      for (const d of OPENING_DIMENSION_TYPES) dims[d.id] = input.dimensions?.[d.id] ?? null;
      const row = {
        year: input.year,
        account_id: account.id,
        dim_project: dims.project ?? null,
        dim_partner: dims.partner ?? null,
        dim_department: dims.department ?? null,
        dim_person: dims.person ?? null,
        dims_key: dimensionsKey(dims),
        currency_code: input.currency ?? null,
        balance: input.balance,
        ytd_debit: input.ytdDebit ?? 0,
        ytd_credit: input.ytdCredit ?? 0,
        fc_balance: input.fcBalance ?? 0,
        quantity_e6: input.quantity ? qtyToE6(input.quantity) : 0,
        updated_at: nowIso(ctx),
      };
      let q = ctx.db
        .selectFrom('opening_balance')
        .select('id')
        .where('year', '=', row.year)
        .where('account_id', '=', row.account_id)
        .where('dims_key', '=', row.dims_key);
      q =
        row.currency_code == null
          ? q.where('currency_code', 'is', null)
          : q.where('currency_code', '=', row.currency_code);
      const existing = await q.executeTakeFirst();
      if (existing)
        await ctx.db
          .updateTable('opening_balance')
          .set(row)
          .where('id', '=', existing.id)
          .execute();
      else await ctx.db.insertInto('opening_balance').values(row).execute();
    },

    async remove(id: number): Promise<void> {
      await ctx.db.deleteFrom('opening_balance').where('id', '=', id).execute();
    },

    /** 用一组新数据整体替换某年度的期初（年结用），并标记该年期初以此为准。 */
    async replaceYear(year: number, rows: Omit<OpeningBalanceInput, 'year'>[]): Promise<void> {
      await ctx.db.deleteFrom('opening_balance').where('year', '=', year).execute();
      for (const r of rows) await this.upsert({ ...r, year });
      await ctx.db
        .updateTable('fiscal_year')
        .set({ opening_stored: 1 })
        .where('year', '=', year)
        .execute();
    },
  };
}
