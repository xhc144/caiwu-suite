import { createHash } from 'node:crypto';
import {
  BusinessError,
  Decimal,
  dimensionName,
  assertCents,
  multiplyToCents,
  notFound,
  periodEndDate,
  periodOfDate,
  qtyFromE6,
  qtyToE6,
  sumCents as coreSumCents,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  CardFilter,
  CardSchema,
  MasterSchema,
  SettingsSchema,
  masterLabels,
  type CardInput,
  type CardFilterInput,
  type Settings,
} from '../shared';
import type { FixedAssetsTables } from './migrations';
import { departmentService } from './departments';
import {
  deleteAssetVoucher,
  previewAssetVoucherDeletion,
  type AssetVoucherDeletionPlan,
} from './voucher-deletion';

export function fail(code: string, message: string, hint = '请检查输入后重试', to?: string): never {
  throw new BusinessError({
    code: `FIXED_ASSETS_${code}`,
    message,
    hint,
    actions: to ? [{ label: '去处理', to }] : undefined,
  });
}
export function safeSum(values: Iterable<number | null | undefined>) {
  try {
    return coreSumCents(values);
  } catch {
    fail('AMOUNT_RANGE', '金额合计超出可精确处理的整数分范围', '请缩小查询或批次范围');
  }
}
const sumCents = safeSum;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nextMonth = (p: number) => (p % 100 === 12 ? p + 89 : p + 1);
const table = (svc: CoreServices) => svc.db.withTables<FixedAssetsTables>();
const requirePermission = (svc: CoreServices, p: string) =>
  svc.permissions.require(`fixed-assets.${p}`);

/** 分配到剩余月份，首月优先分配整数分尾差；工作量法按剩余可折旧额与剩余总量计算。 */
export function calculateDepreciation(
  v: {
    original: number;
    residual: number;
    depreciation: number;
    months: number;
    lifeMonths: number;
    method: string;
    totalWorkE6: number;
    workE6: number;
  },
  currentWorkE6: number,
) {
  const remaining = assertCents(v.original - v.residual - v.depreciation);
  if (remaining < 0) fail('INVALID_BALANCE', '原值小于累计折旧与预计残值之和');
  if (remaining === 0) return 0;
  if (v.method === '1') {
    const months = v.lifeMonths - v.months;
    if (months <= 0)
      fail('LIFE_EXHAUSTED', '使用月数已达到年限，但仍有应提余额', '请检查期初累计月数和残值');
    return Number((BigInt(remaining) + BigInt(months) - 1n) / BigInt(months));
  }
  if (v.method !== '2') fail('METHOD', '该折旧方法尚未实现', '请选择平均年限法或工作量法');
  const work = v.totalWorkE6 - v.workE6;
  if (currentWorkE6 > work || work <= 0) fail('WORK_EXCEEDS', '本月工作量超过剩余总工作量');
  return Math.min(
    remaining,
    assertCents(new Decimal(remaining).mul(currentWorkE6).div(work).toDecimalPlaces(0).toNumber()),
  );
}

export function assetService(svc: CoreServices) {
  const db = table(svc);
  const card = async (id: number) => {
    const r = await db
      .selectFrom('fixed_assets_card')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('固定资产', id);
    return r;
  };
  const master = async (id: number, kind: string, allowDisabled = false) => {
    const r = await db
      .selectFrom('fixed_assets_master')
      .selectAll()
      .where('id', '=', id)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!r || (!allowDisabled && r.disabled))
      fail(
        'MASTER_MISSING',
        `${masterLabels[kind as keyof typeof masterLabels]}不存在或已停用`,
        '请先新增或启用基础档案',
        '/m/fixed-assets/masters',
      );
    return r;
  };
  const account = async (id: number | null) => {
    if (id == null)
      fail(
        'ACCOUNT_MISSING',
        '未设置凭证科目',
        '请先选择启用的末级科目',
        '/m/fixed-assets/settings',
      );
    const a = await svc.accounts.get(id);
    if (!a)
      fail(
        'ACCOUNT_MISSING',
        `科目 ${id} 不存在或已删除`,
        '请重新选择启用的末级科目',
        '/m/fixed-assets/settings',
      );
    if (a.disabled || !a.isLeaf)
      fail(
        'ACCOUNT_INVALID',
        `科目 ${a.code} ${a.name} 已停用或不是末级科目`,
        '请选择启用的末级科目',
        '/m/fixed-assets/settings',
      );
    return a;
  };
  const voucherLine = async (
    accountId: number,
    amount: number,
    side: 'debit' | 'credit',
    departmentId: number,
    summary: string,
  ): Promise<VoucherLineInput> => {
    const a = await account(accountId);
    if (a.currency || a.quantityUnit)
      fail(
        'ACCOUNT_AUXILIARY',
        `科目 ${a.code} 需要外币或数量信息，当前资产自动凭证不能使用此科目`,
        '请选择普通本位币科目，或补充共享凭证映射能力',
        '/m/fixed-assets/settings',
      );
    const dimensions: NonNullable<VoucherLineInput['dimensions']> = {};
    for (const d of a.dimensions) {
      const itemId = d.type === 'department' ? departmentId : d.defaultItemId;
      if (itemId != null) {
        const item = await svc.dimensions.get(itemId);
        if (!item || item.disabled || !item.isLeaf || item.typeId !== d.type)
          fail(
            'ACCOUNT_DIMENSION',
            `科目 ${a.code} 的辅助核算默认项无效`,
            '请修复科目辅助核算设置',
            '/m/fixed-assets/settings',
          );
        dimensions[d.type] = itemId;
      } else if (d.required)
        fail(
          'ACCOUNT_DIMENSION',
          `科目 ${a.code} 缺少必填辅助核算 ${dimensionName(d.type)}`,
          '请配置有效默认辅助项或更换科目',
          '/m/fixed-assets/settings',
        );
    }
    return { summary, accountId: a.id, [side]: amount, dimensions };
  };
  const log = async (action: string, id: number | string) =>
    svc.log.write({
      action: `fixed-assets.${action}`,
      summary: `固定资产操作：${action}`,
      targetType: 'fixed_assets',
      targetId: id,
    });
  /** 整卡覆盖、物理删除和统一置数会改变既有来源，检查全部来源凭证。 */
  const assertUnlocked = async (id: number) => {
    const c = await card(id);
    const batches = await db
      .selectFrom('fixed_assets_line as l')
      .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
      .select(['b.voucher_id'])
      .where('l.asset_id', '=', id)
      .execute();
    for (const vid of [...batches.map((b) => b.voucher_id), c.voucher_id]) {
      if (vid == null) continue;
      const v = await svc.vouchers.get(vid);
      if (v)
        fail(
          'SOURCE_VOUCHER',
          `${c.code} 已生成${v.status === 'audited' ? '已审核' : v.status === 'posted' ? '已过账' : '待审核'}凭证，不能修改或删除来源`,
          '先在资产模块删除待审核凭证；已审核或过账凭证需先逆序反过账、取消审核',
          `/m/voucher-entry/edit?id=${vid}`,
        );
    }
    return c;
  };
  /**
   * 生命周期业务追加新事件，保留之前月份的折旧快照和凭证。
   * 原值调整会影响当月及后续折旧；注销须先完成当月折旧，故只与后续月份冲突。
   * 注销自身的清理凭证始终保护；每次通过 core 重读凭证状态。
   */
  const assertLifecycleSourceUnlocked = async (
    id: number,
    period: number,
    operation: 'adjustment' | 'disposal',
  ) => {
    const c = await card(id);
    const batches = await db
      .selectFrom('fixed_assets_line as l')
      .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
      .select('b.voucher_id')
      .where('l.asset_id', '=', id)
      .where('b.period', operation === 'adjustment' ? '>=' : '>', period)
      .execute();
    for (const vid of [...batches.map((b) => b.voucher_id), c.voucher_id]) {
      if (vid == null) continue;
      const v = await svc.vouchers.get(vid);
      if (v)
        fail(
          'SOURCE_VOUCHER',
          `${c.code} 的 ${v.period} 月来源凭证已生成，不能${operation === 'adjustment' ? '调整会影响该来源的原值' : '逆序注销资产'}`,
          '先从后续业务逆序处理；凭证已审核或过账时需先反过账、取消审核',
          `/m/voucher-entry/edit?id=${vid}`,
        );
    }
    return c;
  };
  const assertChain = async (c: Awaited<ReturnType<typeof card>>) => {
    const changes = await db
      .selectFrom('fixed_assets_adjustment')
      .selectAll()
      .where('asset_id', '=', c.id)
      .orderBy('id')
      .execute();
    let expected = c.base_original;
    for (const a of changes) {
      if (a.before_value !== expected)
        fail(
          'CHAIN',
          `${c.code} 原值调整链不连续：应为 ${expected} 分，记录为 ${a.before_value} 分`,
          '请逆序检查并撤销异常调整',
          '/m/fixed-assets/cards?id=' + c.id,
        );
      expected = a.after_value;
    }
    if (expected !== c.original)
      fail(
        'CHAIN',
        `${c.code} 卡片原值 ${c.original} 分与调整链 ${expected} 分不一致`,
        '请在原值调整页面查看差异并确认修复',
        '/m/fixed-assets/cards?id=' + c.id,
      );
    return expected;
  };
  const assertNoFuture = async (period: number) => {
    const last = await db
      .selectFrom('fixed_assets_batch')
      .select('period')
      .orderBy('period', 'desc')
      .executeTakeFirst();
    if (last && last.period > period)
      fail(
        'FUTURE_BATCH',
        `已有 ${last.period} 月折旧，不能改动 ${period} 月历史`,
        '从最后计提月逆序取消折旧',
      );
  };
  const normalize = async (raw: CardInput, opening: boolean, retainedDepartmentId?: number) => {
    const p = CardSchema.parse(raw);
    for (const [id, kind] of [
      [p.categoryId, 'category'],
      [p.statusId, 'status'],
      [p.purposeId, 'purpose'],
    ] as const)
      await master(id, kind);
    const dep = await svc.dimensions.get(p.departmentId);
    if (
      !dep ||
      dep.typeId !== 'department' ||
      (dep.disabled && dep.id !== retainedDepartmentId) ||
      !dep.isLeaf
    )
      fail('DEPARTMENT', '请选择启用的末级部门', '请在基础档案新增部门', '/m/fixed-assets/masters');
    if (p.method === '1' && p.lifeMonths < 30 && !p.confirmShortLife)
      fail('SHORT_LIFE', `使用年限为 ${p.lifeMonths} 月，少于 30 月`, '复核单位为月后勾选确认');
    if (p.acquired > p.useDate) fail('DATE_ORDER', '购置日期不能晚于使用日期');
    const residual =
      p.residual ?? assertCents(new Decimal(p.original).mul(p.rate).toDecimalPlaces(0).toNumber());
    if (residual > p.original || p.openingDepreciation > p.original - residual)
      fail('OPENING_BALANCE', '预计残值或期初累计折旧超过可折旧原值');
    if (qtyToE6(p.openingWork) > qtyToE6(p.totalWork))
      fail('OPENING_WORK', '期初累计工作量超过总工作量');
    if (p.method === '1' && p.openingMonths > p.lifeMonths)
      fail('OPENING_MONTHS', '期初累计月数超过使用年限');
    if (
      p.method === '1' &&
      p.openingMonths === p.lifeMonths &&
      p.openingDepreciation < p.original - residual
    )
      fail(
        'OPENING_EXHAUSTED',
        '期初累计月数已达年限，但折旧尚未提足',
        '请复核期初月数、折旧和残值',
      );
    if (
      p.method === '2' &&
      qtyToE6(p.openingWork) === qtyToE6(p.totalWork) &&
      p.openingDepreciation < p.original - residual
    )
      fail('OPENING_EXHAUSTED', '期初工作量已用完，但折旧尚未提足', '请复核期初工作量、折旧和残值');
    const start = (await svc.book.info()).startPeriod;
    if (opening) {
      await svc.periods.assertWritable({ period: start, mode: 'opening', action: '导入资产期初' });
      if (periodOfDate(p.useDate) > start) fail('OPENING_DATE', '期初卡片使用日期不能晚于开账月份');
    } else {
      if (periodOfDate(p.useDate) < start)
        fail(
          'OPENING_ONLY',
          '启用期间之前已使用的资产请通过期初导入录入',
          '请在期初导入预览并核对累计数',
          '/m/fixed-assets/opening',
        );
      await svc.periods.assertOpen(Math.max(start, periodOfDate(p.useDate)), '保存资产');
      if (p.openingDepreciation || p.openingMonths || qtyToE6(p.openingWork))
        fail(
          'OPENING_ONLY',
          '期初累计数请通过期初导入录入',
          '请使用期初导入并核对逐行预览',
          '/m/fixed-assets/opening',
        );
    }
    const codes = new Set<string>();
    for (const a of p.accessories) {
      if (codes.has(a.code)) fail('ACCESSORY_DUPLICATE', `附属设备编号 ${a.code} 重复`);
      codes.add(a.code);
      try {
        multiplyToCents(a.quantity, a.unitPrice);
      } catch {
        fail('ACCESSORY_AMOUNT', `附属设备 ${a.code} 数量与单价的乘积金额超出范围`);
      }
    }
    return { p, residual };
  };
  const saveInternal = async (
    raw: CardInput,
    opts: { id?: number; revision?: number; opening?: boolean } = {},
  ) => {
    const old = opts.id ? await assertUnlocked(opts.id) : null;
    const { p, residual } = await normalize(raw, opts.opening ?? false, old?.department_id);
    if (!old && !opts.opening)
      await assertNoFuture(Math.max((await svc.book.info()).startPeriod, periodOfDate(p.useDate)));
    if (old) {
      await svc.periods.assertOpen(
        Math.max((await svc.book.info()).startPeriod, periodOfDate(old.use_date)),
        '修改资产',
      );
    }
    if (old && old.revision !== opts.revision)
      fail('STALE', '卡片已被其他操作修改', '刷新后重新编辑');
    if (old?.disposal_date) fail('DISPOSED', '已注销资产不能修改');
    const duplicate = await db
      .selectFrom('fixed_assets_card')
      .select('id')
      .where('code', '=', p.code)
      .executeTakeFirst();
    if (duplicate && duplicate.id !== old?.id) fail('DUPLICATE', `设备编号 ${p.code} 已存在`);
    if (old && old.code !== p.code && !p.confirmCodeChange)
      fail(
        'CODE_CONFIRM',
        `设备编号由 ${old.code} 改为 ${p.code}，相关记录将按稳定 ID 保持关联`,
        '请明确确认改编号',
      );
    if (old) {
      const history = await db
        .selectFrom('fixed_assets_line')
        .select('id')
        .where('asset_id', '=', old.id)
        .executeTakeFirst();
      const changes = await db
        .selectFrom('fixed_assets_adjustment')
        .select('id')
        .where('asset_id', '=', old.id)
        .executeTakeFirst();
      if (p.original !== old.original)
        fail('USE_ADJUSTMENT', '原值变更请使用原值调整', '在卡片操作中选择原值调整');
      if (
        (history || changes || old.opening_depreciation) &&
        (residual !== old.residual ||
          p.method !== old.method ||
          p.lifeMonths !== old.life_months ||
          qtyToE6(p.totalWork) !== old.total_work_e6 ||
          p.useDate !== old.use_date ||
          p.categoryId !== old.category_id ||
          p.purposeId !== old.purpose_id ||
          p.departmentId !== old.department_id ||
          p.statusId !== old.status_id)
      )
        fail(
          'HISTORY',
          '资产已有折旧或调整，不能覆盖计算参数和分配维度',
          '先逆序撤销相关记录；期初累计数不可覆盖',
        );
    }
    const values = {
      code: p.code,
      name: p.name,
      reference: p.reference,
      category_id: p.categoryId,
      status_id: p.statusId,
      purpose_id: p.purposeId,
      department_id: p.departmentId,
      acquired: p.acquired,
      use_date: p.useDate,
      original: p.original,
      residual,
      rate: p.rate,
      method: p.method,
      life_months: p.lifeMonths,
      model: p.model,
      unit: p.unit,
      quantity_e6: qtyToE6(p.quantity),
      total_work_e6: qtyToE6(p.totalWork),
    };
    let id = old?.id;
    if (old)
      await db
        .updateTable('fixed_assets_card')
        .set({ ...values, revision: old.revision + 1 })
        .where('id', '=', old.id)
        .execute();
    else {
      const r = await db
        .insertInto('fixed_assets_card')
        .values({
          ...values,
          base_original: p.original,
          is_opening: opts.opening ? 1 : 0,
          depreciation: p.openingDepreciation,
          months: p.openingMonths,
          work_e6: qtyToE6(p.openingWork),
          opening_depreciation: p.openingDepreciation,
          opening_months: p.openingMonths,
          opening_work_e6: qtyToE6(p.openingWork),
          disposal_date: null,
          reason_id: null,
          voucher_id: null,
          revision: 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      id = r.id;
    }
    await db.deleteFrom('fixed_assets_accessory').where('asset_id', '=', id!).execute();
    for (const a of p.accessories)
      await db
        .insertInto('fixed_assets_accessory')
        .values({
          asset_id: id!,
          code: a.code,
          name: a.name,
          quantity_e6: qtyToE6(a.quantity),
          unit_price: a.unitPrice,
          amount: multiplyToCents(a.quantity, a.unitPrice),
          note: a.note,
        })
        .execute();
    await log(old ? 'card.update' : 'card.create', id!);
    return id!;
  };
  const settings = async () => {
    const s = await svc.settings.get<Settings | null>('voucher', null);
    if (!s)
      fail(
        'SETTINGS',
        '尚未设置累计折旧、清理科目和凭证类型',
        '请完成资产凭证设置',
        '/m/fixed-assets/settings',
      );
    await account(s.depreciationAccountId);
    await account(s.clearingAccountId);
    const type = (await svc.reference.voucherTypes()).find(
      (t) => t.id === s.voucherTypeId && !t.disabled,
    );
    if (!type)
      fail(
        'VOUCHER_TYPE',
        '凭证类型不存在或已停用',
        '请重新设置凭证类型',
        '/m/fixed-assets/settings',
      );
    return s;
  };
  const batch = async (id: number) => {
    const b = await db
      .selectFrom('fixed_assets_batch')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!b) throw notFound('折旧批次', id);
    return b;
  };
  const self = {
    async masters() {
      requirePermission(svc, 'view');
      return db
        .selectFrom('fixed_assets_master')
        .selectAll()
        .orderBy('kind')
        .orderBy('code')
        .execute();
    },
    async saveMaster(raw: z.input<typeof MasterSchema>, id?: number) {
      requirePermission(svc, 'edit');
      return svc.tx(async (ts) => {
        const p = MasterSchema.parse(raw),
          tdb = table(ts);
        if (id) await assetService(ts).masterInternal(id, p.kind);
        if (p.accountId != null) await assetService(ts).accountInternal(p.accountId);
        const dup = await tdb
          .selectFrom('fixed_assets_master')
          .select('id')
          .where('kind', '=', p.kind)
          .where('code', '=', p.code)
          .executeTakeFirst();
        if (dup && dup.id !== id)
          fail('MASTER_DUPLICATE', `${masterLabels[p.kind]}编码 ${p.code} 重复`);
        const values = {
          kind: p.kind,
          code: p.code,
          name: p.name,
          account_id: p.accountId,
          rate: p.rate,
          depreciates: p.depreciates ? 1 : 0,
          disabled: p.disabled ? 1 : 0,
        };
        if (id) {
          await tdb.updateTable('fixed_assets_master').set(values).where('id', '=', id).execute();
          return id;
        }
        return (
          await tdb
            .insertInto('fixed_assets_master')
            .values(values)
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      });
    },
    async removeMaster(id: number, confirm: boolean) {
      requirePermission(svc, 'edit');
      return svc.tx(async (ts) => {
        const tdb = table(ts),
          m = await tdb
            .selectFrom('fixed_assets_master')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        if (!m) throw notFound('基础档案', id);
        const field = {
          category: 'category_id',
          purpose: 'purpose_id',
          status: 'status_id',
          reason: 'reason_id',
        }[m.kind] as 'category_id' | 'purpose_id' | 'status_id' | 'reason_id';
        const used = await tdb
          .selectFrom('fixed_assets_card')
          .select(['code', 'name'])
          .where(field, '=', id)
          .execute();
        if (used.length)
          fail(
            'MASTER_USED',
            `${m.name} 被卡片 ${used.map((c) => `${c.code} ${c.name}`).join('、')} 使用，不能删除`,
            '请将此档案停用；已有卡片和历史记录保留',
            '/m/fixed-assets/masters',
          );
        if (!confirm) fail('CONFIRM', '删除未使用档案需要确认');
        await tdb.deleteFrom('fixed_assets_master').where('id', '=', id).execute();
        await assetService(ts).logInternal('master.delete', id);
      });
    },
    async createDepartment(code: string, name: string) {
      return departmentService(svc).save({ code, name, disabled: false });
    },
    async list(raw: CardFilterInput = {}) {
      requirePermission(svc, 'view');
      const f = CardFilter.parse(raw);
      let q = db.selectFrom('fixed_assets_card').selectAll().orderBy('code');
      if (!f.includeDisposed) q = q.where('disposal_date', 'is', null);
      if (f.id) q = q.where('id', '=', f.id);
      if (f.code) q = q.where('code', 'like', `%${f.code}%`);
      if (f.name) q = q.where('name', 'like', `%${f.name}%`);
      if (f.keyword)
        q = q.where((eb) =>
          eb.or([eb('code', 'like', `%${f.keyword}%`), eb('name', 'like', `%${f.keyword}%`)]),
        );
      for (const [val, col] of [
        [f.categoryId, 'category_id'],
        [f.statusId, 'status_id'],
        [f.departmentId, 'department_id'],
        [f.purposeId, 'purpose_id'],
      ] as const)
        if (val) q = q.where(col, '=', val);
      const [rows, masters, depts] = await Promise.all([
        q.execute(),
        db.selectFrom('fixed_assets_master').selectAll().execute(),
        svc.dimensions.items('department'),
      ]);
      const map = new Map(masters.map((m) => [m.id, `${m.code} ${m.name}`]));
      return rows.map((c) => ({
        ...c,
        net: c.original - c.depreciation,
        category: map.get(c.category_id) ?? '',
        status: map.get(c.status_id) ?? '',
        purpose: map.get(c.purpose_id) ?? '',
        department: depts.find((d) => d.id === c.department_id)?.name ?? '',
        quantity: qtyFromE6(c.quantity_e6),
        totalWork: qtyFromE6(c.total_work_e6),
        work: qtyFromE6(c.work_e6),
      }));
    },
    async detail(id: number) {
      requirePermission(svc, 'view');
      const c = await card(id);
      const accessories = await db
        .selectFrom('fixed_assets_accessory')
        .selectAll()
        .where('asset_id', '=', id)
        .orderBy('code')
        .execute();
      const adjustments = await db
        .selectFrom('fixed_assets_adjustment')
        .selectAll()
        .where('asset_id', '=', id)
        .orderBy('id')
        .execute();
      return {
        card: c,
        accessories: accessories.map((a) => ({ ...a, quantity: qtyFromE6(a.quantity_e6) })),
        adjustments,
        chainValue: adjustments.at(-1)?.after_value ?? c.base_original,
      };
    },
    async save(raw: CardInput, id?: number, revision?: number) {
      requirePermission(svc, 'edit');
      return svc.tx((ts) => assetService(ts).saveInternal(raw, { id, revision }));
    },
    async remove(id: number, confirm: boolean) {
      requirePermission(svc, 'edit');
      return svc.tx(async (ts) => {
        const s = assetService(ts),
          c = await s.assertUnlockedInternal(id),
          tdb = table(ts);
        const hist = await tdb
          .selectFrom('fixed_assets_line')
          .select('id')
          .where('asset_id', '=', id)
          .executeTakeFirst();
        if (c.depreciation || c.months || hist || c.disposal_date)
          fail('DEPRECIATED', '此设备已提折旧或已注销，不能物理删除', '请使用注销，保留资产历史');
        const adj = await tdb
          .selectFrom('fixed_assets_adjustment')
          .select('id')
          .where('asset_id', '=', id)
          .executeTakeFirst();
        if (adj) fail('ADJUSTED', '资产存在原值调整，不能删除', '先逆序删除原值调整');
        if (!confirm) fail('CONFIRM', '删除资产需要确认');
        await ts.periods.assertOpen(
          Math.max((await ts.book.info()).startPeriod, periodOfDate(c.use_date)),
          '删除资产',
        );
        await tdb.deleteFrom('fixed_assets_card').where('id', '=', id).execute();
        await s.logInternal('card.delete', id);
      });
    },
    async setWork(id: number, period: number, quantity: string) {
      requirePermission(svc, 'depreciate');
      return svc.tx(async (ts) => {
        const s = assetService(ts),
          c = await s.cardInternal(id),
          tdb = table(ts);
        await ts.periods.assertOpen(period, '录入工作量');
        await s.assertNoFutureInternal(period);
        if (c.method !== '2' || c.disposal_date)
          fail('WORK_METHOD', '只能录入未注销的工作量法资产');
        if (
          await tdb
            .selectFrom('fixed_assets_batch')
            .select('id')
            .where('period', '=', period)
            .executeTakeFirst()
        )
          fail('WORK_BATCH', '本月已计提，不能修改工作量', '先取消本月折旧');
        if (period <= periodOfDate(c.use_date))
          fail('WORK_DATE', '使用当月及以前不提折旧，无需录入工作量');
        const value = qtyToE6(quantity);
        if (value < 0 || value > c.total_work_e6 - c.work_e6)
          fail('WORK_EXCEEDS', `${c.code} 本月工作量超过剩余总工作量`);
        await tdb
          .insertInto('fixed_assets_work')
          .values({ asset_id: id, period, quantity_e6: value })
          .onConflict((oc) =>
            oc.columns(['asset_id', 'period']).doUpdateSet({ quantity_e6: value }),
          )
          .execute();
      });
    },
    async preview(period: number) {
      requirePermission(svc, 'view');
      await svc.periods.assertOpen(period, '计提折旧');
      await assertNoFuture(period);
      const existing = await db
        .selectFrom('fixed_assets_batch')
        .selectAll()
        .where('period', '=', period)
        .executeTakeFirst();
      if (existing) return { period, existingId: existing.id, token: '', rows: [], total: 0 };
      const last = await db
        .selectFrom('fixed_assets_batch')
        .select('period')
        .orderBy('period', 'desc')
        .executeTakeFirst();
      if (last && nextMonth(last.period) !== period)
        fail('MONTH_GAP', `请先计提 ${nextMonth(last.period)} 月`, '折旧必须按月份连续进行');
      const cards = await db.selectFrom('fixed_assets_card').selectAll().orderBy('id').execute();
      if (!cards.length)
        fail(
          'NO_CARDS',
          '没有资产卡片可计提折旧',
          '请先新增资产或导入期初卡片',
          '/m/fixed-assets/cards',
        );
      if (!last) {
        const first = Math.max(
          (await svc.book.info()).startPeriod,
          Math.min(...cards.map((c) => nextMonth(periodOfDate(c.use_date)))),
        );
        if (period > first) fail('MONTH_GAP', `请先计提 ${first} 月`, '首次计提不能跳过应提月份');
      }
      const work = await db
        .selectFrom('fixed_assets_work')
        .selectAll()
        .where('period', '=', period)
        .execute();
      const rows = [];
      for (const c of cards) {
        await assertChain(c);
        if (c.work_e6 < 0 || c.total_work_e6 < c.work_e6)
          fail('WORK_EXCEEDS', `${c.code} 累计工作量超过总工作量`);
        const recordedWork = work.find((w) => w.asset_id === c.id);
        if (
          c.method === '2' &&
          recordedWork &&
          recordedWork.quantity_e6 > c.total_work_e6 - c.work_e6
        )
          fail('WORK_EXCEEDS', `${c.code} 本月工作量超过剩余总工作量`);
        if (c.original < c.depreciation + c.residual)
          fail('INVALID_BALANCE', `${c.code} 原值小于累计折旧与残值之和`);
        const status = await master(c.status_id, 'status', true);
        const base = {
          assetId: c.id,
          code: c.code,
          name: c.name,
          amount: 0,
          workE6: 0,
          monthCount: 0,
          beforeDepreciation: c.depreciation,
          beforeMonths: c.months,
          beforeWorkE6: c.work_e6,
          original: c.original,
          residual: c.residual,
          categoryId: c.category_id,
          purposeId: c.purpose_id,
          departmentId: c.department_id,
          revision: c.revision,
          issue: '',
          blocking: false,
          skip: false,
        };
        if (periodOfDate(c.use_date) >= period) {
          rows.push({ ...base, issue: '使用当月及以前不提折旧' });
          continue;
        }
        if (c.disposal_date && periodOfDate(c.disposal_date) < period) {
          rows.push({ ...base, issue: '已注销' });
          continue;
        }
        if (!status.depreciates) {
          rows.push({ ...base, issue: '设备状态不计提折旧' });
          continue;
        }
        if (c.original - c.residual === c.depreciation) {
          rows.push({ ...base, issue: '已提足折旧' });
          continue;
        }
        const w = work.find((w) => w.asset_id === c.id);
        if ((c.method === '1' && !c.life_months) || (c.method === '2' && !w)) {
          rows.push({
            ...base,
            issue: c.method === '2' ? '缺少当月工作量' : '缺少使用年限（月）',
            skip: true,
          });
          continue;
        }
        const amount = calculateDepreciation(
          {
            original: c.original,
            residual: c.residual,
            depreciation: c.depreciation,
            months: c.months,
            lifeMonths: c.life_months,
            method: c.method,
            totalWorkE6: c.total_work_e6,
            workE6: c.work_e6,
          },
          w?.quantity_e6 ?? 0,
        );
        rows.push({
          ...base,
          amount,
          workE6: c.method === '2' ? (w?.quantity_e6 ?? 0) : 0,
          monthCount: c.method === '2' && !w?.quantity_e6 ? 0 : 1,
        });
      }
      return {
        period,
        existingId: null,
        token: digest({ period, rows, last }),
        rows,
        total: sumCents(rows.map((r) => r.amount)),
      };
    },
    async depreciate(input: {
      period: number;
      token: string;
      skipMissing: boolean;
      confirm: true;
    }) {
      requirePermission(svc, 'depreciate');
      return svc.tx(async (ts) => {
        const s = assetService(ts),
          tdb = table(ts),
          preview = await s.preview(input.period);
        if (preview.existingId) return preview.existingId;
        if (preview.token !== input.token)
          fail('PREVIEW_CHANGED', '卡片或工作量已改变，折旧预览已失效', '请重新预览后确认');
        if (preview.rows.some((r) => r.skip) && !input.skipMissing)
          fail(
            'MISSING_INPUT',
            `以下设备缺少数据：${preview.rows
              .filter((r) => r.skip)
              .map((r) => r.code + ' ' + r.issue)
              .join('；')}`,
            '返回补录或明确确认跳过',
          );
        const b = await tdb
          .insertInto('fixed_assets_batch')
          .values({ period: input.period, voucher_id: null, created_at: new Date().toISOString() })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const r of preview.rows) {
          await tdb
            .insertInto('fixed_assets_line')
            .values({
              batch_id: b.id,
              asset_id: r.assetId,
              amount: r.amount,
              work_e6: r.workE6,
              month_count: r.monthCount,
              issue: r.issue,
              before_depreciation: r.beforeDepreciation,
              before_months: r.beforeMonths,
              before_work_e6: r.beforeWorkE6,
              original: r.original,
              residual: r.residual,
              category_id: r.categoryId,
              purpose_id: r.purposeId,
              department_id: r.departmentId,
            })
            .execute();
          if (r.monthCount)
            await tdb
              .updateTable('fixed_assets_card')
              .set({
                depreciation: r.beforeDepreciation + r.amount,
                months: r.beforeMonths + r.monthCount,
                work_e6: r.beforeWorkE6 + r.workE6,
                revision: r.revision + 1,
              })
              .where('id', '=', r.assetId)
              .execute();
        }
        await s.logInternal('depreciate', b.id);
        return b.id;
      });
    },
    async batches() {
      requirePermission(svc, 'view');
      const rows = await db
        .selectFrom('fixed_assets_batch')
        .selectAll()
        .orderBy('period', 'desc')
        .execute();
      return Promise.all(
        rows.map(async (b) => {
          const lines = await db
            .selectFrom('fixed_assets_line')
            .select('amount')
            .where('batch_id', '=', b.id)
            .execute();
          return {
            ...b,
            total: sumCents(lines.map((l) => l.amount)),
            requiresVoucher: lines.some((l) => l.amount !== 0),
            voucher: b.voucher_id ? await svc.vouchers.get(b.voucher_id) : null,
          };
        }),
      );
    },
    async cancelPreview(id: number) {
      requirePermission(svc, 'view');
      const b = await batch(id),
        lines = await db
          .selectFrom('fixed_assets_line as l')
          .innerJoin('fixed_assets_card as c', 'c.id', 'l.asset_id')
          .select(['c.code', 'c.name', 'l.asset_id', 'l.amount', 'l.work_e6', 'l.month_count'])
          .where('l.batch_id', '=', id)
          .execute();
      return {
        batch: b,
        lines,
        total: sumCents(lines.map((l) => l.amount)),
        voucherDeletion: b.voucher_id ? await previewAssetVoucherDeletion(svc, b.voucher_id) : null,
      };
    },
    async cancel(
      id: number,
      confirm: boolean,
      voucherDeletion?: AssetVoucherDeletionPlan,
      expectedVoucherId?: number | null,
    ) {
      requirePermission(svc, 'cancel');
      return svc.tx(async (ts) => {
        const s = assetService(ts),
          tdb = table(ts);
        const b = await tdb
          .selectFrom('fixed_assets_batch')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!b) return; // 原子成功后的重试
        await ts.periods.assertOpen(b.period, '取消折旧');
        await s.assertNoFutureInternal(b.period);
        if (!confirm) fail('CONFIRM', `需要确认取消 ${b.period} 月折旧`);
        const lines = await tdb
          .selectFrom('fixed_assets_line')
          .selectAll()
          .where('batch_id', '=', id)
          .execute();
        for (const l of lines) {
          const c = await s.cardInternal(l.asset_id);
          const changes = await tdb
            .selectFrom('fixed_assets_adjustment')
            .select('id')
            .where('asset_id', '=', c.id)
            .where('date', '>=', periodEndDate(b.period))
            .executeTakeFirst();
          if (
            c.original !== l.original ||
            c.residual !== l.residual ||
            c.depreciation !== l.before_depreciation + l.amount ||
            c.months !== l.before_months + l.month_count ||
            c.work_e6 !== l.before_work_e6 + l.work_e6 ||
            c.disposal_date ||
            changes
          )
            fail(
              'REVERSE_ORDER',
              `${c.code} 已有后续原值调整或注销，不能直接撤销折旧`,
              '先逆序撤销后续调整或注销',
            );
        }
        await deleteAssetVoucher(ts, b.voucher_id, voucherDeletion, expectedVoucherId);
        if (b.voucher_id) {
          await tdb
            .updateTable('fixed_assets_batch')
            .set({ voucher_id: null })
            .where('id', '=', id)
            .execute();
        }
        for (const l of lines)
          await tdb
            .updateTable('fixed_assets_card')
            .set({
              depreciation: l.before_depreciation,
              months: l.before_months,
              work_e6: l.before_work_e6,
              revision: (await s.cardInternal(l.asset_id)).revision + 1,
            })
            .where('id', '=', l.asset_id)
            .execute();
        await tdb.deleteFrom('fixed_assets_batch').where('id', '=', id).execute();
        await s.logInternal('cancel', id);
      });
    },
    async getSettings() {
      requirePermission(svc, 'settings');
      return svc.settings.get<Settings | null>('voucher', null);
    },
    async saveSettings(input: Settings) {
      requirePermission(svc, 'settings');
      return svc.tx(async (ts) => {
        const p = SettingsSchema.parse(input),
          s = assetService(ts);
        await s.accountInternal(p.depreciationAccountId);
        await s.accountInternal(p.clearingAccountId);
        if (
          !(await ts.reference.voucherTypes()).some((v) => v.id === p.voucherTypeId && !v.disabled)
        )
          fail('VOUCHER_TYPE', '请选择启用的凭证类型');
        await ts.settings.set('voucher', p);
        await s.logInternal('settings', 'voucher');
      });
    },
    async voucherPreview(id: number, date?: string) {
      requirePermission(svc, 'voucher');
      const b = await batch(id),
        s = await settings();
      const current = await svc.periods.current();
      if (!current) fail('BOOK_NOT_OPEN', '账务系统未开账，不能生成凭证', '请先开账');
      const voucherDate = date ?? periodEndDate(b.period);
      if (periodOfDate(voucherDate) !== b.period)
        fail('VOUCHER_DATE', '折旧凭证日期必须属于来源月份');
      await svc.periods.assertOpen(periodOfDate(voucherDate), '生成凭证');
      const lines = await db
        .selectFrom('fixed_assets_line')
        .selectAll()
        .where('batch_id', '=', id)
        .where('amount', '>', 0)
        .orderBy('asset_id')
        .execute();
      if (!lines.length)
        fail(
          'NO_DEPRECIATION',
          '无折旧数据，不能生成凭证',
          '先计提有效折旧',
          '/m/fixed-assets/depreciation',
        );
      const rawLines: VoucherLineInput[] = [];
      for (const l of lines) {
        const purpose = await master(l.purpose_id, 'purpose', true);
        const debit = await account(purpose.account_id);
        rawLines.push(
          await voucherLine(
            debit.id,
            l.amount,
            'debit',
            l.department_id,
            `${b.period} 月固定资产折旧`,
          ),
        );
        rawLines.push(
          await voucherLine(
            s.depreciationAccountId,
            l.amount,
            'credit',
            l.department_id,
            `${b.period} 月累计折旧`,
          ),
        );
      }
      const result = mergeVoucherLines(rawLines);
      if (sumCents(result.map((l) => l.debit)) !== sumCents(result.map((l) => l.credit)))
        fail('UNBALANCED', '借贷不平，不能生成凭证');
      return {
        date: voucherDate,
        voucherTypeId: s.voucherTypeId,
        lines: result,
        total: sumCents(lines.map((l) => l.amount)),
        token: digest({ b, result, voucherDate, s }),
      };
    },
    async generateVoucher(id: number, token: string, date?: string) {
      requirePermission(svc, 'voucher');
      return svc.tx(async (ts) => {
        const s = assetService(ts),
          tdb = table(ts),
          b = await s.batchInternal(id);
        if (b.voucher_id) {
          const v = await ts.vouchers.get(b.voucher_id);
          if (v) return v;
          fail('VOUCHER_LINK', '凭证关联异常', '请检查来源关联，不能刷新覆盖');
        }
        const p = await s.voucherPreview(id, date);
        if (p.token !== token) fail('PREVIEW_CHANGED', '凭证预览已改变', '请重新预览');
        const duplicates = await ts.vouchers.list({
          sourceModule: 'fixed-assets',
          sourceType: 'depreciation',
          sourceId: String(id),
        });
        if (duplicates.items.length)
          fail(
            'VOUCHER_DUPLICATE',
            '已有相同来源凭证，不能重复生成',
            '请检查来源关联，不可刷新已审核凭证',
          );
        const v = await ts.vouchers.create({
          date: p.date,
          voucherTypeId: p.voucherTypeId,
          lines: p.lines,
          source: { type: 'depreciation', id: String(id) },
        });
        await tdb
          .updateTable('fixed_assets_batch')
          .set({ voucher_id: v.id })
          .where('id', '=', id)
          .execute();
        await s.logInternal('voucher.create', id);
        return v;
      });
    },
    async voucherDeletePreview(id: number) {
      requirePermission(svc, 'voucher');
      const b = await batch(id);
      return {
        voucherId: b.voucher_id,
        voucherDeletion: await previewAssetVoucherDeletion(svc, b.voucher_id),
      };
    },
    async deleteVoucher(
      id: number,
      confirm: boolean,
      voucherDeletion?: AssetVoucherDeletionPlan,
      expectedVoucherId?: number | null,
    ) {
      requirePermission(svc, 'voucher');
      if (!confirm) fail('CONFIRM', '删除凭证需要确认');
      return svc.tx(async (ts) => {
        const b = await assetService(ts).batchInternal(id);
        await deleteAssetVoucher(ts, b.voucher_id, voucherDeletion, expectedVoucherId);
        if (b.voucher_id) {
          await table(ts)
            .updateTable('fixed_assets_batch')
            .set({ voucher_id: null })
            .where('id', '=', id)
            .execute();
          await assetService(ts).logInternal('voucher.delete', id);
        }
      });
    },
    // 仅供事务内组合使用；不暴露为路由。
    cardInternal: card,
    masterInternal: (id: number, kind: string) => master(id, kind, true),
    accountInternal: account,
    assertUnlockedInternal: assertUnlocked,
    assertLifecycleSourceUnlockedInternal: assertLifecycleSourceUnlocked,
    assertNoFutureInternal: assertNoFuture,
    assertChainInternal: assertChain,
    saveInternal,
    normalizeInternal: normalize,
    batchInternal: batch,
    logInternal: log,
    settingsInternal: settings,
    voucherLineInternal: voucherLine,
  };
  return self;
}

/** 相同科目、方向与辅助维度合并，保持分配金额精确且减少分录数。 */
export function mergeVoucherLines(lines: VoucherLineInput[]): VoucherLineInput[] {
  const groups = new Map<string, VoucherLineInput>();
  for (const l of lines) {
    const key = JSON.stringify([l.accountId, l.dimensions, l.debit ? 'debit' : 'credit']);
    const old = groups.get(key);
    groups.set(
      key,
      old
        ? {
            ...old,
            debit: sumCents([old.debit, l.debit]),
            credit: sumCents([old.credit, l.credit]),
          }
        : l,
    );
  }
  return [...groups.values()];
}
