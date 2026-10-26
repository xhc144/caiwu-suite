import { pinyin } from 'pinyin-pro';
import {
  BusinessError,
  notFound,
  levelOfCode,
  parentCodeOf,
  DIMENSION_TYPES,
  type Account,
  type DimensionTypeId,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  AccountInputSchema,
  DimensionInputSchema,
  type AccountInput,
  type AccountData,
  type DimensionInput,
  type Confirmation,
} from '../shared';
import type { MasterdataTables } from './migrations';

export function fail(code: string, message: string, hint = '请修改后重试'): never {
  throw new BusinessError({
    code: `MASTERDATA_${code}`,
    message,
    hint,
    actions: [
      { label: '科目维护', to: '/m/masterdata/accounts' },
      { label: '辅助档案', to: '/m/masterdata/dimensions' },
    ],
  });
}
export async function protectReferences<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof Error &&
      /FOREIGN KEY constraint failed|SQLITE_CONSTRAINT_FOREIGNKEY/.test(error.message)
    )
      fail(
        'REFERENCE',
        '档案仍被其他业务引用，不能删除',
        '请保留或停用；先在引用它的业务中解除关联后再删除',
      );
    throw error;
  }
}
export const initials = (s: string) =>
  pinyin(s, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .replace(/\s+/g, '')
    .toLowerCase();
const timestamp = () => new Date().toISOString();
const allActiveChild = (accounts: Account[], id: number) =>
  accounts.some((a) => a.parentId === id && !a.disabled);
export const matches = (keyword: string, values: unknown[]) =>
  values.join(' ').toLowerCase().includes(keyword.trim().toLowerCase());
export function checkLocate(keyword: string, locate: boolean) {
  if (locate && !keyword.trim())
    fail(
      'SEARCH_EMPTY',
      '请输入定位条件',
      '可输入编码、名称、拼音首字母或助记码；查询可留空显示全部',
    );
}
export function confirmRequired(warnings: Confirmation[], confirmations: string[]) {
  const pending = warnings.filter((w) => !confirmations.includes(w.key));
  if (pending.length)
    fail(
      'CONFIRM_REQUIRED',
      pending.map((w) => w.message).join('；'),
      '请预览并逐项确认；取消不会写入任何数据',
    );
}
export async function accountUsed(svc: CoreServices, id: number) {
  return !!(
    (await svc.db
      .selectFrom('voucher_line')
      .select('id')
      .where('account_id', '=', id)
      .limit(1)
      .executeTakeFirst()) ??
    (await svc.db
      .selectFrom('opening_balance')
      .select('id')
      .where('account_id', '=', id)
      .limit(1)
      .executeTakeFirst())
  );
}
export async function dimensionUsed(svc: CoreServices, id: number) {
  const line = await svc.db
    .selectFrom('voucher_line')
    .select('id')
    .where((eb) => eb.or(DIMENSION_TYPES.map((d) => eb(d.column, '=', id))))
    .limit(1)
    .executeTakeFirst();
  const opening = await svc.db
    .selectFrom('opening_balance')
    .select('id')
    .where((eb) =>
      eb.or([
        eb('dim_project', '=', id),
        eb('dim_partner', '=', id),
        eb('dim_department', '=', id),
        eb('dim_person', '=', id),
      ]),
    )
    .limit(1)
    .executeTakeFirst();
  const defaults = await svc.db
    .selectFrom('account_dimension')
    .select('account_id')
    .where('default_item_id', '=', id)
    .limit(1)
    .executeTakeFirst();
  return !!(line ?? opening ?? defaults);
}
const dimSemantics = (a: { dimensions: Account['dimensions'] }) =>
  JSON.stringify(
    a.dimensions
      .map((d) => ({ type: d.type, required: d.required }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  );

export function masterdataService(svc: CoreServices) {
  const db = svc.db.withTables<MasterdataTables>();
  const self = {
    async accounts(keyword = '', locate = false) {
      checkLocate(keyword, locate);
      return (await svc.accounts.list()).filter((a) =>
        matches(keyword, [a.code, a.name, a.fullName, a.pinyin, a.mnemonic]),
      );
    },
    async moneyRoots() {
      const confirmed = await db.selectFrom('masterdata_money_root').selectAll().execute();
      // 新建账套先运行迁移、后载入模板；模板明确的资金标志也是已知语义。
      const templateRoots = (await svc.accounts.list()).filter(
        (a) => a.parentId == null && (a.isCash || a.isBank),
      );
      return [
        ...confirmed,
        ...templateRoots
          .filter((a) => !confirmed.some((r) => r.account_id === a.id))
          .map((a) => ({
            account_id: a.id,
            kind: a.isCash ? ('cash' as const) : ('bank' as const),
          })),
      ];
    },
    async setMoneyRoot(accountId: number, kind: 'cash' | 'bank' | 'other', confirmed: boolean) {
      if (!confirmed)
        fail('CONFIRM_REQUIRED', '请确认该科目层级在本账套中确属现金、银行存款或其他货币资金');
      const a = await svc.accounts.require(accountId);
      const category = (await svc.accounts.categories()).find((c) => c.id === a.categoryId);
      if (a.parentId != null || category?.name !== '资产')
        fail('MONEY_ROOT', '请选择本账套资产类的一级货币资金科目');
      await svc.tx(async (tsvc) => {
        await tsvc.db
          .withTables<MasterdataTables>()
          .insertInto('masterdata_money_root')
          .values({ account_id: accountId, kind })
          .onConflict((o) => o.column('account_id').doUpdateSet({ kind }))
          .execute();
        await tsvc.log.write({
          action: 'masterdata.money.confirm',
          summary: `确认货币资金层级：${a.code} ${a.name}`,
          targetType: 'account',
          targetId: accountId,
        });
      });
    },
    async prepareAccount(
      raw: AccountInput,
    ): Promise<{ data: AccountData; warnings: Confirmation[]; similar: Account[] }> {
      const data = AccountInputSchema.parse(raw);
      data.quantityUnit = data.quantityUnit || null;
      data.currency = data.currency || null;
      const scheme = (await svc.book.info()).codeScheme;
      const level = levelOfCode(data.code, scheme);
      if (level == null)
        fail(
          'ACCOUNT_CODE',
          `科目编码不符合本账套 ${scheme.join('-')} 规则`,
          `各级长度为 ${scheme.join('、')} 位；请在账套配置中调整级次，不能另换模板规避`,
        );
      const existing = data.id ? await svc.accounts.require(data.id) : null;
      const duplicate = await svc.accounts.getByCode(data.code);
      if (duplicate && duplicate.id !== data.id)
        fail('ACCOUNT_DUPLICATE', `科目编码 ${data.code} 已存在`, '请修改编码，或打开已有科目编辑');
      const parentCode = parentCodeOf(data.code, scheme);
      const parent = parentCode ? await svc.accounts.getByCode(parentCode) : null;
      if (parentCode && !parent)
        fail('ACCOUNT_PARENT', `上级科目 ${parentCode} 不存在`, '请先建立上级科目');
      if (parent?.disabled)
        fail('ACCOUNT_PARENT_DISABLED', '上级科目已停用，不能增加或移动下级', '先启用上级科目');
      if (parent && parent.id === data.id) fail('ACCOUNT_CYCLE', '科目不能作为自己的上级');
      if (parent?.isLeaf && parent.id !== existing?.parentId && (await accountUsed(svc, parent.id)))
        fail(
          'ACCOUNT_PARENT_USED',
          '上级末级科目已有凭证或期初，不能直接增加下级',
          '保留原科目核算；余额转移流程尚未提供',
        );
      if (existing && existing.code !== data.code) {
        const child = await db
          .selectFrom('account')
          .select('id')
          .where('parent_id', '=', existing.id)
          .limit(1)
          .executeTakeFirst();
        if (child)
          fail(
            'ACCOUNT_CHILD_RECODE',
            '有下级的科目暂不支持修改编码',
            '请保留编码；整棵树迁移需要独立安全流程',
          );
        if (
          existing.parentId !== parent?.id &&
          (await self.moneyRoots()).some((r) => r.account_id === existing.id) &&
          parent != null
        )
          fail('MONEY_ROOT', '已确认的货币资金根不能移入其他科目');
      }
      data.categoryId = data.categoryId ?? parent?.categoryId;
      if (!data.categoryId) fail('ACCOUNT_CATEGORY', '一级科目必须指定类别');
      const category = (await svc.accounts.categories()).find((c) => c.id === data.categoryId);
      if (!category) fail('ACCOUNT_CATEGORY', '所选科目类别不存在');
      if (parent && data.categoryId !== parent.categoryId)
        fail('ACCOUNT_CATEGORY', '下级科目类别须与上级一致');
      if (new Set(data.dimensions.map((d) => d.type)).size !== data.dimensions.length)
        fail('ACCOUNT_DIMENSION', '同一辅助核算不能重复启用');
      for (const d of data.dimensions)
        if (d.defaultItemId != null) {
          const item = await svc.dimensions.get(d.defaultItemId);
          if (!item || item.typeId !== d.type || item.disabled || !item.isLeaf)
            fail(
              'DEFAULT_ITEM',
              `默认${DIMENSION_TYPES.find((t) => t.id === d.type)?.name ?? '辅助项'}必须是对应类型的在用末级档案`,
              '请重新选择默认项',
            );
        }
      if (data.isCash && data.isBank) fail('MONEY_FLAGS', '现金与银行标志不能同时启用');
      if (data.isCash || data.isBank || data.cashflowRequired) {
        const roots = await self.moneyRoots();
        const all = await svc.accounts.list();
        let a = parent;
        const ids = new Set<number>();
        if (existing) ids.add(existing.id);
        while (a) {
          ids.add(a.id);
          a = all.find((x) => x.id === a!.parentId) ?? null;
        }
        if (!roots.some((r) => ids.has(r.account_id)))
          fail(
            'MONEY_ONLY',
            '仅本账套已确认的现金、银行存款、其他货币资金层级可选现金、银行或现金流量标志',
            '先在货币资金范围确认本账套的科目语义；不按固定编号或名称猜测',
          );
      }
      if (data.disabled && existing && allActiveChild(await svc.accounts.list(), existing.id))
        fail('ACCOUNT_CHILDREN', '请先停用在用下级，再停用父科目');
      if (data.currency) {
        const currency = (await svc.reference.currencies()).find((c) => c.code === data.currency);
        if (
          !currency ||
          (currency.disabled && existing?.currency !== data.currency) ||
          currency.isBase
        )
          fail('CURRENCY', '请选择在用的外币币种，本位币无需复币核算');
      }
      if (existing && (await accountUsed(svc, existing.id))) {
        const changed =
          existing.direction !== data.direction ||
          existing.categoryId !== data.categoryId ||
          existing.code !== data.code ||
          existing.currency !== data.currency ||
          existing.quantityUnit !== data.quantityUnit ||
          existing.isCash !== data.isCash ||
          existing.isBank !== data.isBank ||
          existing.cashflowRequired !== data.cashflowRequired ||
          existing.isPartner !== data.isPartner ||
          dimSemantics(existing) !== dimSemantics(data);
        if (changed)
          fail(
            'ACCOUNT_USED',
            '该科目已有凭证或期初，不能改变编码、方向、类别或核算语义',
            '可以修改名称、助记码、默认项或停用；需要调整核算时请新建科目',
          );
      }
      if (
        existing &&
        !existing.isLeaf &&
        (existing.direction !== data.direction ||
          existing.categoryId !== data.categoryId ||
          existing.currency !== data.currency ||
          existing.quantityUnit !== data.quantityUnit ||
          existing.isCash !== data.isCash ||
          existing.isBank !== data.isBank ||
          existing.cashflowRequired !== data.cashflowRequired ||
          existing.isPartner !== data.isPartner ||
          dimSemantics(existing) !== dimSemantics(data))
      )
        fail(
          'ACCOUNT_CHILD_SEMANTICS',
          '已有下级的科目暂不允许改变核算语义',
          '请在未使用末级维护核算属性，或新建独立科目；不重新解释下级历史',
        );
      const all = await svc.accounts.list();
      const similar = all.filter(
        (a) => a.id !== data.id && (a.name.includes(data.name) || data.name.includes(a.name)),
      );
      const warnings: Confirmation[] = [];
      const directionChanged = !existing || existing.direction !== data.direction;
      const label = data.direction === 'debit' ? '借' : '贷';
      if (level === 1 && directionChanged) {
        warnings.push(
          {
            key: `direction:${data.code}:${label}:1`,
            message: `一级科目 ${data.code} ${data.name} 余额方向确认为「${label}」？`,
          },
          {
            key: `direction:${data.code}:${label}:2`,
            message: `再次确认：一级科目 ${data.code} ${data.name} 按「${label}」方核算，是否继续？`,
          },
        );
      }
      if (parent && parent.direction !== data.direction && directionChanged)
        warnings.push({
          key: `parentDirection:${data.code}`,
          message: `${data.code} 余额方向「${label}」与上级不同，是否仍使用？`,
        });
      if (similar.some((a) => a.name === data.name) && (!existing || existing.name !== data.name))
        warnings.push({
          key: `duplicateName:${data.code}`,
          message: `${data.code} ${data.name} 已有相同名称科目：${similar.map((a) => `${a.code} ${a.fullName}`).join('；')}。仍单独建立？`,
        });
      if (
        data.currency &&
        !['资产', '负债'].includes(category.name) &&
        (!existing || existing.currency !== data.currency)
      )
        warnings.push({
          key: `currencyCategory:${data.code}`,
          message: `${data.code} 非资产、负债科目通常不使用复币核算，确认保留该设置？`,
        });
      return { data, warnings, similar };
    },
    async saveAccount(raw: AccountInput): Promise<Account> {
      return svc.tx(async (tsvc) => masterdataService(tsvc).writeAccount(raw));
    },
    /** 仅由已开启的事务调用，导入与批量共用同一校验。 */
    async writeAccount(raw: AccountInput): Promise<Account> {
      if (!svc.db.isTransaction) throw new Error('科目写入需要事务');
      const { data, warnings } = await self.prepareAccount(raw);
      confirmRequired(warnings, data.confirmations);
      for (const r of await self.moneyRoots())
        await db
          .insertInto('masterdata_money_root')
          .values(r)
          .onConflict((o) => o.column('account_id').doNothing())
          .execute();
      if (!data.id) return svc.accounts.create(data, (await svc.book.info()).codeScheme);
      const before = await svc.accounts.require(data.id);
      const parentCode = parentCodeOf(data.code, (await svc.book.info()).codeScheme);
      const parent = parentCode ? await svc.accounts.getByCode(parentCode) : null;
      await db
        .updateTable('account')
        .set({
          code: data.code,
          name: data.name,
          parent_id: parent?.id ?? null,
          category_id: data.categoryId!,
          direction: data.direction,
          level: levelOfCode(data.code, (await svc.book.info()).codeScheme)!,
          disabled: +data.disabled,
          is_cash: +data.isCash,
          is_bank: +data.isBank,
          cashflow_required: +data.cashflowRequired,
          is_partner: +data.isPartner,
          currency_code: data.currency,
          quantity_unit: data.quantityUnit,
          mnemonic: data.mnemonic,
          pinyin: initials(data.name),
          updated_at: timestamp(),
        })
        .where('id', '=', data.id)
        .execute();
      await db.deleteFrom('account_dimension').where('account_id', '=', data.id).execute();
      for (const d of data.dimensions)
        await db
          .insertInto('account_dimension')
          .values({
            account_id: data.id,
            dimension_type: d.type,
            required: +d.required,
            default_item_id: d.defaultItemId,
          })
          .execute();
      await self.rebuildAccounts();
      if (before.code !== data.code)
        await svc.log.write({
          action: 'masterdata.account.recode',
          summary: `科目编码 ${before.code} → ${data.code}`,
          targetType: 'account',
          targetId: data.id,
        });
      return svc.accounts.require(data.id);
    },
    async rebuildAccounts() {
      const rows = await svc.accounts.list();
      const ordered = [...rows].sort((a, b) => a.level - b.level);
      const names = new Map<number, string>();
      for (const a of ordered) {
        const parentName = a.parentId == null ? null : names.get(a.parentId);
        if (a.parentId != null && parentName == null)
          fail('ACCOUNT_TREE', '科目树存在缺失上级，整理未写入', '请检查科目层级后重试');
        const fullName = parentName ? `${parentName}/${a.name}` : a.name;
        names.set(a.id, fullName);
        await db
          .updateTable('account')
          .set({
            full_name: fullName,
            pinyin: initials(a.name),
            is_leaf: rows.some((c) => c.parentId === a.id) ? 0 : 1,
          })
          .where('id', '=', a.id)
          .execute();
      }
    },
    async accountDeleteImpact(id: number) {
      const a = await svc.accounts.require(id);
      if (
        await db
          .selectFrom('account')
          .select('id')
          .where('parent_id', '=', id)
          .limit(1)
          .executeTakeFirst()
      )
        fail('ACCOUNT_CHILDREN', '存在下级科目，不能删除', '先处理未使用的下级，或停用该科目');
      if (await accountUsed(svc, id))
        fail(
          'ACCOUNT_USED',
          '已有凭证发生或期初记录（含辅助、外币、数量及账前累计），不能删除',
          '可停用科目，历史仍保留',
        );
      if (
        await db
          .selectFrom('masterdata_currency_account')
          .select('currency_code')
          .where('account_id', '=', id)
          .executeTakeFirst()
      )
        fail('ACCOUNT_REFERENCE', '科目已用作汇兑损益科目，不能删除', '先调整汇兑损益设置');
      if ((await self.moneyRoots()).some((r) => r.account_id === id))
        fail('ACCOUNT_REFERENCE', '科目是已确认的货币资金根，不能删除', '保留或停用该科目');
      const siblings =
        a.parentId == null
          ? []
          : await db
              .selectFrom('account')
              .select('id')
              .where('parent_id', '=', a.parentId)
              .execute();
      return {
        message:
          siblings.length === 1
            ? '删除后，上级将恢复为末级科目，可直接用于新业务。确认此影响后删除？'
            : '确认删除该未使用科目？',
      };
    },
    async removeAccount(id: number, confirmed: boolean) {
      return protectReferences(() =>
        svc.tx(async (tsvc) => {
          const service = masterdataService(tsvc);
          const impact = await service.accountDeleteImpact(id);
          if (!confirmed) fail('CONFIRM_REQUIRED', impact.message);
          await tsvc.db.deleteFrom('account').where('id', '=', id).execute();
          await service.rebuildAccounts();
          await tsvc.log.write({
            action: 'masterdata.account.delete',
            summary: `删除未使用科目 ${id}`,
            targetType: 'account',
            targetId: id,
          });
        }),
      );
    },
    async batchPreview(parentId: number, start: number, names: string[]) {
      const parent = await svc.accounts.require(parentId);
      if (parent.disabled) fail('ACCOUNT_PARENT_DISABLED', '父科目已停用');
      if (parent.isLeaf && (await accountUsed(svc, parentId)))
        fail('ACCOUNT_PARENT_USED', '父科目已有凭证或期初，不能直接增加下级');
      const scheme = (await svc.book.info()).codeScheme;
      const width = scheme[parent.level];
      if (width == null)
        fail(
          'ACCOUNT_CAPACITY',
          '已到本账套配置的最末级',
          '请在账套配置中增加级次；本模块不修改账套编码规则',
        );
      if (start + names.length > 10 ** width)
        fail(
          'ACCOUNT_CAPACITY',
          `当前级仅有 ${width} 位，所填范围超出容量`,
          '请减少数量或调整起始编号；需要更多编码时在账套配置增加本级位数',
        );
      const rows: AccountInput[] = names.map((name, i) => ({
        ...parent,
        id: undefined,
        code: parent.code + String(start + i).padStart(width, '0'),
        name,
        dimensions: parent.dimensions.map((d) => ({
          ...d,
          type: d.type as 'project' | 'partner' | 'department' | 'person',
        })),
      }));
      for (const row of rows) await self.prepareAccount(row);
      return rows;
    },
    async batch(parentId: number, start: number, names: string[], confirmations: string[]) {
      return svc.tx(async (tsvc) => {
        const service = masterdataService(tsvc);
        const rows = await service.batchPreview(parentId, start, names);
        confirmRequired([{ key: 'batch', message: '确认按预览批量建立下级科目？' }], confirmations);
        for (const row of rows) await service.writeAccount({ ...row, confirmations });
        return rows.length;
      });
    },
    async dimensionScheme(type: DimensionTypeId) {
      const defaults: Record<DimensionTypeId, number[]> = {
        project: [4, 2, 2, 2],
        partner: [4, 2, 2, 2],
        department: [2, 2, 2, 2, 2],
        person: [3, 2, 2, 2, 1],
        cashflow: [4, 2, 2, 2],
      };
      return svc.settings.get(`scheme:${type}`, defaults[type]);
    },
    async setDimensionScheme(type: DimensionTypeId, scheme: number[]) {
      await svc.tx(async (tsvc) => {
        const items = await tsvc.dimensions.items(type);
        const lengths = scheme.map((_, i) => scheme.slice(0, i + 1).reduce((a, b) => a + b, 0));
        for (const a of items) {
          if (!lengths.includes(a.code.length))
            fail(
              'DIMENSION_SCHEME',
              `新规则与现有编码 ${a.code} 不一致`,
              '请选兼容现有数据的规则，或先调整未使用档案编号',
            );
          const p = items.find((p) => p.id === a.parentId);
          if (
            p &&
            (lengths.indexOf(a.code.length) !== lengths.indexOf(p.code.length) + 1 ||
              !a.code.startsWith(p.code))
          )
            fail('DIMENSION_SCHEME', `现有分类 ${a.code} 与新规则不一致`);
        }
        await tsvc.settings.set(`scheme:${type}`, scheme);
      });
    },
    async dimensions(type: DimensionTypeId, keyword = '', locate = false) {
      checkLocate(keyword, locate);
      return (await svc.dimensions.items(type)).filter((a) =>
        matches(keyword, [a.code, a.name, a.pinyin, a.attrs.shortName]),
      );
    },
    async saveDimension(raw: DimensionInput) {
      return svc.tx(async (tsvc) => masterdataService(tsvc).writeDimension(raw));
    },
    async writeDimension(raw: DimensionInput) {
      if (!svc.db.isTransaction) throw new Error('辅助档案写入需要事务');
      const data = DimensionInputSchema.parse(raw);
      const existing = data.id ? await svc.dimensions.get(data.id) : null;
      if (data.id && !existing) throw notFound('辅助档案', data.id);
      if (existing && existing.typeId !== data.type)
        fail('DIMENSION_TYPE', '不能改变已有档案的类型');
      const duplicate = await svc.dimensions.getByCode(data.type, data.code);
      if (duplicate && duplicate.id !== data.id)
        fail(
          'DIMENSION_DUPLICATE',
          `编号 ${data.code} 已存在`,
          '请更换编号；修改编号不会改变档案ID',
        );
      const scheme = await self.dimensionScheme(data.type);
      const lengths = scheme.map((_, i) => scheme.slice(0, i + 1).reduce((a, b) => a + b, 0));
      const level = lengths.indexOf(data.code.length);
      if (level < 0)
        fail(
          'DIMENSION_CODE',
          `编号长度不符合 ${scheme.join('-')} 分级规则`,
          '最多5级，总长度不超过10位；可在分级规则设置中调整',
        );
      const items = await svc.dimensions.items();
      const parent = items.find((a) => a.id === data.parentId);
      if (data.parentId != null && (!parent || parent.typeId !== data.type))
        fail('DIMENSION_PARENT', '分类上级不存在或类型不同');
      if (data.parentId === data.id && data.id != null) fail('DIMENSION_CYCLE', '分类不能指向自身');
      let cursor = parent;
      const seen = new Set<number>();
      while (cursor) {
        if (cursor.id === data.id || seen.has(cursor.id))
          fail('DIMENSION_CYCLE', '分类关系不能成环');
        seen.add(cursor.id);
        cursor = items.find((a) => a.id === cursor!.parentId);
      }
      if (
        parent &&
        (parent.disabled ||
          !data.code.startsWith(parent.code) ||
          lengths.indexOf(parent.code.length) !== level - 1)
      )
        fail('DIMENSION_PARENT', '编码须接续在用上级，且属于下一层级');
      if (!parent && level > 0) fail('DIMENSION_PARENT', '多级编号必须指定存在的直接上级');
      if (parent?.isLeaf && (await dimensionUsed(svc, parent.id)))
        fail('DIMENSION_USED', '上级档案已被凭证、期初或默认项引用，不能改为分类');
      if (data.type === 'partner' && !existing && !data.attrs.role)
        fail('PARTNER_ROLE', '请选择客户、供应商或双向角色');
      if (data.type === 'cashflow' && !existing && !data.attrs.cashflowDirection)
        fail('CASHFLOW_DIRECTION', '新增现金流量项目必须指定方向');
      if (existing) {
        const used = await dimensionUsed(svc, existing.id);
        if (
          used &&
          (existing.parentId !== data.parentId ||
            (data.type === 'cashflow' &&
              existing.attrs.cashflowDirection !== data.attrs.cashflowDirection) ||
            (data.type === 'partner' && existing.attrs.role !== data.attrs.role))
        )
          fail(
            'DIMENSION_USED',
            '已有引用，不能改变分类、角色或现金流量方向',
            '名称和编号可修改，财务语义需保留；也可以停用并新增档案',
          );
        for (const c of items.filter((c) => c.parentId === existing.id))
          if (!c.code.startsWith(data.code) || c.code.length <= data.code.length)
            fail('DIMENSION_CHILDREN', '新编号与已有下级不一致', '先调整未使用下级，或保留原编号');
        if (data.disabled && items.some((c) => c.parentId === existing.id && !c.disabled))
          fail('DIMENSION_CHILDREN', '请先停用在用下级，再停用分类');
        await db
          .updateTable('dimension_item')
          .set({
            code: data.code,
            name: data.name,
            parent_id: data.parentId,
            disabled: +data.disabled,
            attrs: JSON.stringify({ ...existing.attrs, ...data.attrs }),
            pinyin: initials(data.name),
            updated_at: timestamp(),
          })
          .where('id', '=', existing.id)
          .execute();
        if (existing.code !== data.code)
          await svc.log.write({
            action: 'masterdata.dimension.recode',
            summary: `档案编号 ${existing.code} → ${data.code}`,
            targetType: 'dimension_item',
            targetId: existing.id,
          });
      } else {
        const created = await svc.dimensions.create(data);
        data.id = created.id;
      }
      await self.rebuildDimensions();
      return (await svc.dimensions.get(data.id!))!;
    },
    async rebuildDimensions() {
      const items = await svc.dimensions.items();
      for (const a of items)
        await db
          .updateTable('dimension_item')
          .set({ is_leaf: items.some((c) => c.parentId === a.id) ? 0 : 1 })
          .where('id', '=', a.id)
          .execute();
    },
    async removeDimension(id: number, confirmed: boolean) {
      return protectReferences(() =>
        svc.tx(async (tsvc) => {
          const item = await tsvc.dimensions.get(id);
          if (!item) throw notFound('辅助档案', id);
          if (await dimensionUsed(tsvc, id))
            fail(
              'DIMENSION_USED',
              '档案已被凭证、期初或科目默认项引用，不能删除',
              '请停用以保留历史',
            );
          if (
            await tsvc.db
              .selectFrom('dimension_item')
              .select('id')
              .where('parent_id', '=', id)
              .executeTakeFirst()
          )
            fail('DIMENSION_CHILDREN', '分类有下级档案，不能删除');
          if (!confirmed) fail('CONFIRM_REQUIRED', '确认删除未使用档案？');
          await tsvc.db.deleteFrom('dimension_item').where('id', '=', id).execute();
          await masterdataService(tsvc).rebuildDimensions();
          await tsvc.log.write({
            action: 'masterdata.dimension.delete',
            summary: `删除 ${item.code} ${item.name}`,
            targetType: 'dimension_item',
            targetId: id,
          });
        }),
      );
    },
  };
  return self;
}
