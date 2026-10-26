import type { Selectable } from '@caiwu/db';
import { BusinessError, notFound } from '../../errors';
import { levelOfCode, parentCodeOf, formatCodeScheme, type CodeScheme } from '../../code-scheme';
import { DIMENSION_TYPES, type DimensionTypeId } from '../../dimensions';
import type { Account, AccountCategory, BalanceDirection, DimensionItem } from '../../account';
import type { CoreDB } from '../schema';
import { pinyinInitials } from '../pinyin';
import { nowIso, type ServiceContext } from '../context';

type AccountRow = Selectable<CoreDB['account']>;

function toAccount(r: AccountRow, dims: Account['dimensions']): Account {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    fullName: r.full_name,
    parentId: r.parent_id,
    level: r.level,
    categoryId: r.category_id,
    direction: r.direction,
    isLeaf: r.is_leaf === 1,
    disabled: r.disabled === 1,
    isCash: r.is_cash === 1,
    isBank: r.is_bank === 1,
    cashflowRequired: r.cashflow_required === 1,
    isPartner: r.is_partner === 1,
    currency: r.currency_code,
    quantityUnit: r.quantity_unit,
    pinyin: r.pinyin,
    mnemonic: r.mnemonic,
    dimensions: dims,
  };
}

export interface CreateAccountInput {
  code: string;
  name: string;
  categoryId?: string;
  direction?: BalanceDirection;
  isCash?: boolean;
  isBank?: boolean;
  cashflowRequired?: boolean;
  isPartner?: boolean;
  currency?: string | null;
  quantityUnit?: string | null;
  mnemonic?: string | null;
  disabled?: boolean;
  dimensions?: { type: DimensionTypeId; required?: boolean; defaultItemId?: number | null }[];
}

export function accountService(ctx: ServiceContext) {
  const loadDims = async (accountIds?: number[]) => {
    let q = ctx.db.selectFrom('account_dimension').selectAll();
    if (accountIds) q = q.where('account_id', 'in', accountIds.length ? accountIds : [-1]);
    const rows = await q.execute();
    const map = new Map<number, Account['dimensions']>();
    const order = DIMENSION_TYPES.map((d) => d.id as string);
    for (const r of rows) {
      const list = map.get(r.account_id) ?? [];
      list.push({
        type: r.dimension_type as DimensionTypeId,
        required: r.required === 1,
        defaultItemId: r.default_item_id,
      });
      map.set(r.account_id, list);
    }
    for (const list of map.values())
      list.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    return map;
  };

  const self = {
    /** 全部科目（按编码排序），含辅助核算配置。 */
    async list(opts: { includeDisabled?: boolean } = {}): Promise<Account[]> {
      let q = ctx.db.selectFrom('account').selectAll().orderBy('code');
      if (opts.includeDisabled === false) q = q.where('disabled', '=', 0);
      const rows = (await q.execute()) as AccountRow[];
      const dims = await loadDims();
      return rows.map((r) => toAccount(r, dims.get(r.id) ?? []));
    },

    async get(id: number): Promise<Account | null> {
      const r = (await ctx.db
        .selectFrom('account')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()) as AccountRow | undefined;
      if (!r) return null;
      return toAccount(r, (await loadDims([r.id])).get(r.id) ?? []);
    },

    async getByCode(code: string): Promise<Account | null> {
      const r = (await ctx.db
        .selectFrom('account')
        .selectAll()
        .where('code', '=', code)
        .executeTakeFirst()) as AccountRow | undefined;
      if (!r) return null;
      return toAccount(r, (await loadDims([r.id])).get(r.id) ?? []);
    },

    async require(idOrCode: number | string): Promise<Account> {
      const a =
        typeof idOrCode === 'number' ? await self.get(idOrCode) : await self.getByCode(idOrCode);
      if (!a) throw notFound('科目', idOrCode);
      return a;
    },

    async categories(): Promise<AccountCategory[]> {
      const rows = await ctx.db
        .selectFrom('account_category')
        .selectAll()
        .orderBy('sort')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        direction: r.direction,
        isPnl: r.is_pnl === 1,
        sort: r.sort,
      }));
    },

    /**
     * 新增科目：校验编码级次、上级存在，自动算级别、全名、拼音，并把上级改成非末级。
     * 上级已有发生额或期初时拒绝（把上级余额转到下级的流程由科目维护模块负责）。
     */
    async create(input: CreateAccountInput, scheme: CodeScheme): Promise<Account> {
      const code = input.code.trim();
      const name = input.name.trim();
      if (!name)
        throw new BusinessError({ code: 'ACCOUNT_NAME_REQUIRED', message: '科目名称不能为空' });
      const level = levelOfCode(code, scheme);
      if (level == null) {
        throw new BusinessError({
          code: 'ACCOUNT_CODE_INVALID',
          message: `科目编码 ${code} 不符合级次规则 ${formatCodeScheme(scheme)}`,
          hint: `各级编码长度依次为 ${scheme.join('、')} 位`,
        });
      }
      if (await self.getByCode(code)) {
        throw new BusinessError({
          code: 'ACCOUNT_CODE_EXISTS',
          message: `科目编码 ${code} 已经存在`,
        });
      }
      const parentCode = parentCodeOf(code, scheme);
      const parent = parentCode ? await self.getByCode(parentCode) : null;
      if (parentCode && !parent) {
        throw new BusinessError({
          code: 'ACCOUNT_PARENT_MISSING',
          message: `上级科目 ${parentCode} 不存在`,
          hint: '先建立上级科目',
        });
      }
      if (parent?.isLeaf) {
        const used =
          (await ctx.db
            .selectFrom('voucher_line')
            .select('id')
            .where('account_id', '=', parent.id)
            .limit(1)
            .executeTakeFirst()) ??
          (await ctx.db
            .selectFrom('opening_balance')
            .select('id')
            .where('account_id', '=', parent.id)
            .limit(1)
            .executeTakeFirst());
        if (used) {
          throw new BusinessError({
            code: 'ACCOUNT_PARENT_IN_USE',
            message: `上级科目 ${parent.code} ${parent.name} 已有凭证或期初余额，不能直接增加下级`,
            hint: '请在科目维护中使用"增加下级并转移余额"',
          });
        }
      }
      const categoryId = input.categoryId ?? parent?.categoryId;
      if (!categoryId) {
        throw new BusinessError({
          code: 'ACCOUNT_CATEGORY_REQUIRED',
          message: `一级科目 ${code} 必须指定科目类别`,
        });
      }
      const category = (await self.categories()).find((c) => c.id === categoryId);
      if (!category) throw notFound('科目类别', categoryId);
      const now = nowIso(ctx);
      const inserted = await ctx.db
        .insertInto('account')
        .values({
          code,
          name,
          full_name: parent ? `${parent.fullName}/${name}` : name,
          parent_id: parent?.id ?? null,
          level,
          category_id: categoryId,
          direction: input.direction ?? parent?.direction ?? category.direction,
          is_leaf: 1,
          disabled: input.disabled ? 1 : 0,
          is_cash: input.isCash ? 1 : 0,
          is_bank: input.isBank ? 1 : 0,
          cashflow_required: input.cashflowRequired ? 1 : 0,
          is_partner: input.isPartner ? 1 : 0,
          currency_code: input.currency ?? null,
          quantity_unit: input.quantityUnit ?? null,
          pinyin: pinyinInitials(name),
          mnemonic: input.mnemonic ?? null,
          sort: 0,
          created_at: now,
          updated_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (parent?.isLeaf) {
        await ctx.db
          .updateTable('account')
          .set({ is_leaf: 0, updated_at: now })
          .where('id', '=', parent.id)
          .execute();
      }
      for (const d of input.dimensions ?? []) {
        await ctx.db
          .insertInto('account_dimension')
          .values({
            account_id: inserted.id,
            dimension_type: d.type,
            required: d.required === false ? 0 : 1,
            default_item_id: d.defaultItemId ?? null,
          })
          .execute();
      }
      return (await self.get(inserted.id))!;
    },
  };
  return self;
}

// ---------------------------------------------------------------- 辅助核算维度

type DimRow = Selectable<CoreDB['dimension_item']>;

function toItem(r: DimRow): DimensionItem {
  return {
    id: r.id,
    typeId: r.type_id as DimensionTypeId,
    code: r.code,
    name: r.name,
    parentId: r.parent_id,
    isLeaf: r.is_leaf === 1,
    pinyin: r.pinyin,
    disabled: r.disabled === 1,
    attrs: JSON.parse(r.attrs) as Record<string, unknown>,
  };
}

export interface CreateDimensionItemInput {
  type: DimensionTypeId;
  code: string;
  name: string;
  parentId?: number | null;
  attrs?: Record<string, unknown>;
  disabled?: boolean;
}

export function dimensionService(ctx: ServiceContext) {
  const self = {
    async types() {
      return ctx.db.selectFrom('dimension_type').selectAll().orderBy('sort').execute();
    },

    async items(
      type?: DimensionTypeId,
      opts: { includeDisabled?: boolean } = {},
    ): Promise<DimensionItem[]> {
      let q = ctx.db.selectFrom('dimension_item').selectAll().orderBy('type_id').orderBy('code');
      if (type) q = q.where('type_id', '=', type);
      if (opts.includeDisabled === false) q = q.where('disabled', '=', 0);
      return ((await q.execute()) as DimRow[]).map(toItem);
    },

    async get(id: number): Promise<DimensionItem | null> {
      const r = (await ctx.db
        .selectFrom('dimension_item')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()) as DimRow | undefined;
      return r ? toItem(r) : null;
    },

    async getByCode(type: DimensionTypeId, code: string): Promise<DimensionItem | null> {
      const r = (await ctx.db
        .selectFrom('dimension_item')
        .selectAll()
        .where('type_id', '=', type)
        .where('code', '=', code)
        .executeTakeFirst()) as DimRow | undefined;
      return r ? toItem(r) : null;
    },

    async create(input: CreateDimensionItemInput): Promise<DimensionItem> {
      const code = input.code.trim();
      const name = input.name.trim();
      if (!code || !name) {
        throw new BusinessError({
          code: 'DIMENSION_ITEM_INVALID',
          message: '编码和名称都不能为空',
        });
      }
      if (await self.getByCode(input.type, code)) {
        throw new BusinessError({
          code: 'DIMENSION_CODE_EXISTS',
          message: `编码 ${code} 已经存在`,
        });
      }
      const now = nowIso(ctx);
      const r = await ctx.db
        .insertInto('dimension_item')
        .values({
          type_id: input.type,
          code,
          name,
          parent_id: input.parentId ?? null,
          is_leaf: 1,
          pinyin: pinyinInitials(name),
          disabled: input.disabled ? 1 : 0,
          attrs: JSON.stringify(input.attrs ?? {}),
          sort: 0,
          created_at: now,
          updated_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (input.parentId) {
        await ctx.db
          .updateTable('dimension_item')
          .set({ is_leaf: 0 })
          .where('id', '=', input.parentId)
          .execute();
      }
      return (await self.get(r.id))!;
    },
  };
  return self;
}
