import { confirmationFingerprint } from '../confirmation';
import { withTransaction, type Selectable } from '@caiwu/db';
import { BusinessError, notFound } from '../../errors';
import { levelOfCode, parentCodeOf, formatCodeScheme, type CodeScheme } from '../../code-scheme';
import { DIMENSION_TYPES, type DimensionTypeId } from '../../dimensions';
import type {
  Account,
  AccountCategory,
  AccountClosingRule,
  BalanceDirection,
  DimensionItem,
} from '../../account';
import type { CoreDB } from '../schema';
import { pinyinInitials } from '../pinyin';
import { nowIso, type ServiceContext } from '../context';
import { logService, permissionService } from './basic';
import { dimensionColumn } from '../../dimensions';
import type { DependencyBlock } from '../inventory-provider';

type AccountRow = Selectable<CoreDB['account']>;

function toAccount(r: AccountRow, dims: Account['dimensions']): Account {
  return {
    id: r.id,
    code: r.code,
    isContra: r.is_contra === 1,
    balanceNature: r.balance_nature,
    closingRule: r.closing_rule,
    sourceVersion: r.source_version,
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
  isContra?: boolean;
  balanceNature?: 'debit' | 'credit' | 'both' | 'no-closing-balance';
  closingRule?: AccountClosingRule;
  source?: string;
  sourceVersion?: string;
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
    /** Native template provenance is separate from the stable account picker shape. */
    async provenance(id: number) {
      const row = await ctx.db
        .selectFrom('account')
        .select(['id', 'source', 'source_version', 'is_contra', 'balance_nature', 'closing_rule'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw notFound('科目', id);
      return {
        accountId: row.id,
        source: row.source,
        sourceVersion: row.source_version,
        isContra: row.is_contra === 1,
        balanceNature: row.balance_nature,
        closingRule: row.closing_rule,
      };
    },

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
          is_contra: input.isContra ? 1 : 0,
          balance_nature: input.balanceNature ?? null,
          // 新增明细继承明确的上级用途，不能把6901的明细重新纳入普通损益。
          closing_rule: input.closingRule ?? parent?.closingRule ?? null,
          source: input.source ?? null,
          source_version: input.sourceVersion ?? null,
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
    revision: r.revision,
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
  const permission = () =>
    permissionService(ctx).require(
      ctx.moduleId === 'payroll'
        ? 'payroll.hr.edit'
        : ctx.moduleId === 'fixed-assets'
          ? 'fixed-assets.edit'
          : 'masterdata.dimensions.edit',
    );
  const validateParent = async (
    parentId: number | null | undefined,
    type: DimensionTypeId,
    id?: number,
  ) => {
    const seen = new Set<number>(id == null ? [] : [id]);
    let current = parentId;
    while (current != null) {
      if (seen.has(current))
        throw new BusinessError({ code: 'DIMENSION_CYCLE', message: '上级不能是自身或下级' });
      seen.add(current);
      const item = await self.get(current);
      if (!item || item.typeId !== type) throw notFound('同类型上级档案', current);
      if (item.disabled)
        throw new BusinessError({ code: 'DIMENSION_PARENT_DISABLED', message: '上级档案已停用' });
      current = item.parentId;
    }
  };
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
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => dimensionService({ ...ctx, db }).create(input));
      await validateParent(input.parentId, input.type);
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

    async update(
      id: number,
      input: Omit<CreateDimensionItemInput, 'type'>,
      opts: { expectedRevision: number },
    ): Promise<DimensionItem> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) =>
          dimensionService({ ...ctx, db }).update(id, input, opts),
        );
      permission();
      const old = await self.get(id);
      if (!old) throw notFound('辅助档案', id);
      if (old.revision !== opts.expectedRevision)
        throw new BusinessError({
          code: 'DIMENSION_STALE',
          message: '档案已变化，请刷新后重新保存',
        });
      const code = input.code.trim(),
        name = input.name.trim();
      if (!code || !name)
        throw new BusinessError({
          code: 'DIMENSION_ITEM_INVALID',
          message: '编码和名称都不能为空',
        });
      const duplicate = await self.getByCode(old.typeId, code);
      if (duplicate && duplicate.id !== id)
        throw new BusinessError({ code: 'DIMENSION_CODE_EXISTS', message: `编码 ${code} 已存在` });
      const parentId = input.parentId === undefined ? old.parentId : input.parentId;
      await validateParent(parentId, old.typeId, id);
      const children = await ctx.db
        .selectFrom('dimension_item')
        .select('id')
        .where('parent_id', '=', id)
        .execute();
      if (
        old.isLeaf &&
        parentId !== old.parentId &&
        (await self.references(id)).some((b) => b.count > 0)
      )
        throw new BusinessError({
          code: 'DIMENSION_IN_USE',
          message: '档案已有引用，不能改变层级',
        });
      await ctx.db
        .updateTable('dimension_item')
        .set({
          code,
          name,
          parent_id: parentId,
          pinyin: pinyinInitials(name),
          attrs: JSON.stringify(input.attrs ?? old.attrs),
          disabled: input.disabled == null ? (old.disabled ? 1 : 0) : input.disabled ? 1 : 0,
          revision: opts.expectedRevision + 1,
          updated_at: nowIso(ctx),
          is_leaf: children.length ? 0 : 1,
        })
        .where('id', '=', id)
        .execute();
      if (parentId != null)
        await ctx.db
          .updateTable('dimension_item')
          .set({ is_leaf: 0 })
          .where('id', '=', parentId)
          .execute();
      if (old.parentId != null && old.parentId !== parentId) {
        const siblings = await ctx.db
          .selectFrom('dimension_item')
          .select('id')
          .where('parent_id', '=', old.parentId)
          .execute();
        if (!siblings.length)
          await ctx.db
            .updateTable('dimension_item')
            .set({ is_leaf: 1 })
            .where('id', '=', old.parentId)
            .execute();
      }
      await logService(ctx).write({
        action: 'dimension.update',
        summary: `修改辅助档案 ${code} ${name}`,
        targetId: id,
      });
      return (await self.get(id))!;
    },
    async setDisabled(id: number, disabled: boolean, opts: { expectedRevision: number }) {
      const item = await self.get(id);
      if (!item) throw notFound('辅助档案', id);
      return self.update(id, { code: item.code, name: item.name, disabled }, opts);
    },
    async references(id: number): Promise<DependencyBlock[]> {
      const item = await self.get(id);
      if (!item) throw notFound('辅助档案', id);
      const count = async (query: { execute(): Promise<unknown[]> }) =>
        (await query.execute()).length;
      const blocks: DependencyBlock[] = [
        {
          category: '下级档案',
          count: await count(
            ctx.db.selectFrom('dimension_item').select('id').where('parent_id', '=', id),
          ),
        },
      ];
      const column = dimensionColumn(item.typeId);
      blocks.push({
        category: '凭证分录',
        count: await count(ctx.db.selectFrom('voucher_line').select('id').where(column, '=', id)),
        to: '/m/voucher-book',
      });
      if (item.typeId !== 'cashflow')
        blocks.push({
          category: '期初余额',
          count: await count(
            ctx.db
              .selectFrom('opening_balance')
              .select('id')
              .where(column as 'dim_department', '=', id),
          ),
          to: '/m/opening',
        });
      blocks.push({
        category: '科目默认辅助项',
        count: await count(
          ctx.db
            .selectFrom('account_dimension')
            .select('account_id')
            .where('default_item_id', '=', id),
        ),
        to: '/m/masterdata/accounts',
      });
      for (const provider of ctx.providers?.dimensionReferences ?? [])
        blocks.push(...(await provider(ctx, id)));
      return blocks.filter((b) => b.count > 0);
    },
    async previewDelete(id: number) {
      permission();
      const item = await self.get(id);
      if (!item) throw notFound('辅助档案', id);
      const references = await self.references(id);
      const expiresAt = ctx.now().getTime() + 300_000;
      return {
        id,
        revision: item.revision!,
        expiresAt,
        references,
        fingerprint: await confirmationFingerprint(ctx, 'dimension.delete', {
          item,
          references,
          expiresAt,
        }),
      };
    },
    async delete(
      plan: { id: number; revision: number; expiresAt: number; fingerprint: string },
      confirmed: boolean,
    ): Promise<void> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) =>
          dimensionService({ ...ctx, db }).delete(plan, confirmed),
        );
      permission();
      if (!confirmed)
        throw new BusinessError({ code: 'CONFIRM_REQUIRED', message: '请先确认删除档案' });
      const item = await self.get(plan.id);
      if (!item) throw notFound('辅助档案', plan.id);
      const references = await self.references(plan.id);
      if (
        plan.expiresAt <= ctx.now().getTime() ||
        plan.expiresAt > ctx.now().getTime() + 300_000 ||
        item.revision !== plan.revision ||
        (await confirmationFingerprint(ctx, 'dimension.delete', {
          item,
          references,
          expiresAt: plan.expiresAt,
        })) !== plan.fingerprint
      )
        throw new BusinessError({
          code: 'DIMENSION_STALE',
          message: '删除预览已过期或档案/引用已变化，请重新预览',
        });
      if (references.length)
        throw new BusinessError({
          code: 'DIMENSION_IN_USE',
          message: `不能删除 ${item.code} ${item.name}：${references.map((b) => `${b.category}${b.count}项`).join('、')}`,
          details: { references },
          actions: references.flatMap((b) =>
            b.to ? [{ label: `查看${b.category}`, to: b.to }] : [],
          ),
        });
      await ctx.db.deleteFrom('dimension_item').where('id', '=', plan.id).execute();
      if (item.parentId != null) {
        const siblings = await ctx.db
          .selectFrom('dimension_item')
          .select('id')
          .where('parent_id', '=', item.parentId)
          .execute();
        if (!siblings.length)
          await ctx.db
            .updateTable('dimension_item')
            .set({ is_leaf: 1 })
            .where('id', '=', item.parentId)
            .execute();
      }
      await logService(ctx).write({
        action: 'dimension.delete',
        summary: `删除辅助档案 ${item.code} ${item.name}`,
        targetId: item.id,
      });
    },
  };
  return self;
}
