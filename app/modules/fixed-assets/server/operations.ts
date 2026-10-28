import {
  BusinessError,
  Decimal,
  qtyToE6,
  isValidDate,
  periodEndDate,
  periodOfDate,
  qtyFromE6,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { sql } from '@caiwu/db';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import {
  BatchSchema,
  CardSchema,
  QuerySchema,
  queryConditionProblem,
  ReportSchema,
  reportKinds,
  type CardInput,
} from '../shared';
import type { FixedAssetsTables } from './migrations';
import { assetService, fail, safeSum as sumCents } from './service';
import { buildAssetHistory, dueDate } from './history';
import {
  deleteAssetVoucher,
  previewAssetVoucherDeletion,
  type AssetVoucherDeletionPlan,
} from './voucher-deletion';

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const table = (s: CoreServices) => s.db.withTables<FixedAssetsTables>();
const permit = (s: CoreServices, p: string) => s.permissions.require(`fixed-assets.${p}`);
export function operations(svc: CoreServices) {
  const db = table(svc),
    assets = assetService(svc);
  const adjustmentInput = async (id: number, date: string) => {
    const c = await assets.assertLifecycleSourceUnlockedInternal(
      id,
      periodOfDate(date),
      'adjustment',
    );
    if (c.disposal_date) fail('DISPOSED', '已注销资产不能调整原值');
    if (date < c.use_date) fail('ADJUST_DATE', '调整日期不能早于使用日期');
    await svc.periods.assertOpen(periodOfDate(date), '调整原值');
    const later = await db
      .selectFrom('fixed_assets_line as l')
      .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
      .select('b.period')
      .where('l.asset_id', '=', id)
      .where('b.period', '>=', periodOfDate(date))
      .executeTakeFirst();
    if (later)
      fail(
        'ADJUST_HISTORY',
        `${c.code} 已计提 ${later.period} 月及以后折旧`,
        '先逆序取消后续折旧，再调整原值',
      );
    const last = await db
      .selectFrom('fixed_assets_adjustment')
      .selectAll()
      .where('asset_id', '=', id)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (last && date < last.date) fail('ADJUST_DATE', '调整日期不能早于最后一笔调整日期');
    return { c, last };
  };
  const self = {
    async adjust(input: {
      id: number;
      date: string;
      value: number;
      note: string;
      expectedOriginal: number;
      expectedChain: number;
      confirmMismatch: boolean;
    }) {
      permit(svc, 'edit');
      return svc.tx(async (ts) => {
        const tdb = table(ts),
          s = assetService(ts),
          o = operations(ts),
          { c, last } = await o.adjustmentInternal(input.id, input.date);
        const chain = last?.after_value ?? c.base_original;
        if (input.expectedOriginal !== c.original || input.expectedChain !== chain)
          fail('STALE', '原值已改变', '刷新卡片后重新预览');
        if (c.original !== chain && !input.confirmMismatch)
          fail(
            'CHAIN_CONFIRM',
            `卡片原值 ${c.original} 分，调整链 ${chain} 分，请确认差异`,
            '核对调整记录后明确确认，以调整链为调整前原值',
          );
        if (input.value < c.residual + c.depreciation || input.value <= 0)
          fail('ADJUST_MIN', '调整后原值不能低于预计残值与已提折旧之和');
        const row = await tdb
          .insertInto('fixed_assets_adjustment')
          .values({
            asset_id: c.id,
            date: input.date,
            before_value: chain,
            after_value: input.value,
            note: input.note,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tdb
          .updateTable('fixed_assets_card')
          .set({ original: input.value, revision: c.revision + 1 })
          .where('id', '=', c.id)
          .execute();
        await s.logInternal('adjustment.create', row.id);
        return row.id;
      });
    },
    async removeAdjustment(id: number, confirm: boolean) {
      permit(svc, 'edit');
      return svc.tx(async (ts) => {
        const tdb = table(ts),
          s = assetService(ts),
          a = await tdb
            .selectFrom('fixed_assets_adjustment')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        if (!a) return;
        const { c, last } = await operations(ts).adjustmentInternal(a.asset_id, a.date);
        if (!confirm) fail('CONFIRM', '删除原值调整需要确认');
        if (last?.id !== id || c.original !== a.after_value)
          fail(
            'ADJUST_ORDER',
            '仅可删除与卡片一致的最后一笔调整',
            '请按调整、折旧发生顺序逆序撤销',
          );
        if (a.before_value < c.depreciation + c.residual)
          fail('ADJUST_MIN', '恢复后的原值低于残值与累计折旧之和');
        await tdb.deleteFrom('fixed_assets_adjustment').where('id', '=', id).execute();
        await tdb
          .updateTable('fixed_assets_card')
          .set({ original: a.before_value, revision: c.revision + 1 })
          .where('id', '=', c.id)
          .execute();
        await s.logInternal('adjustment.delete', id);
      });
    },
    async disposalPreview(id: number, date: string, reasonId: number, generate: boolean) {
      permit(svc, 'view');
      const c = await assets.assertLifecycleSourceUnlockedInternal(
        id,
        periodOfDate(date),
        'disposal',
      );
      await assets.assertChainInternal(c);
      if (c.disposal_date) fail('DISPOSED', '此资产已经注销');
      await assets.masterInternal(reasonId, 'reason');
      const reason = await db
        .selectFrom('fixed_assets_master')
        .select('disabled')
        .where('id', '=', reasonId)
        .executeTakeFirst();
      if (reason?.disabled) fail('REASON', '注销原因已停用');
      const latest = await db
        .selectFrom('fixed_assets_line as l')
        .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
        .select('b.period')
        .where('l.asset_id', '=', id)
        .orderBy('b.period', 'desc')
        .executeTakeFirst();
      if (date < c.use_date || (latest && periodOfDate(date) < latest.period))
        fail(
          'DISPOSAL_DATE',
          `注销日期不能早于使用日期或已计提截止月 ${latest?.period ?? periodOfDate(c.use_date)}`,
          '请调整注销日期',
        );
      await svc.periods.assertOpen(periodOfDate(date), '注销资产');
      const status = await assets.masterInternal(c.status_id, 'status');
      if (
        periodOfDate(date) > periodOfDate(c.use_date) &&
        status.depreciates &&
        c.depreciation < c.original - c.residual &&
        latest?.period !== periodOfDate(date)
      )
        fail(
          'DISPOSAL_DEPRECIATION',
          `${c.code} 尚未计提注销月份 ${periodOfDate(date)} 的折旧`,
          '请先预览并计提当月折旧，再注销资产',
          '/m/fixed-assets/depreciation',
        );

      const lines: VoucherLineInput[] = [];
      let voucherTypeId: number | null = null;
      if (generate) {
        permit(svc, 'voucher');
        const current = await svc.periods.current();
        if (!current) fail('BOOK_NOT_OPEN', '账务系统未开账');
        if (periodOfDate(date) !== current.period && periodOfDate(date) !== latest?.period)
          fail('DISPOSAL_CURRENT', '仅支持当前工作月或最后计提月注销时生成清理凭证');
        const setting = await assets.settingsInternal();
        if (!setting)
          fail(
            'SETTINGS',
            '请先完成凭证设置',
            '设置累计折旧、清理科目和凭证类型',
            '/m/fixed-assets/settings',
          );
        for (const aid of [setting.depreciationAccountId, setting.clearingAccountId])
          await assets.accountInternal(aid);
        if (
          !(await svc.reference.voucherTypes()).some(
            (t) => t.id === setting.voucherTypeId && !t.disabled,
          )
        )
          fail('VOUCHER_TYPE', '凭证类型不存在或停用');
        const category = await assets.masterInternal(c.category_id, 'category'),
          assetAccount = await assets.accountInternal(category.account_id);
        if (c.original - c.depreciation)
          lines.push(
            await assets.voucherLineInternal(
              setting.clearingAccountId,
              c.original - c.depreciation,
              'debit',
              c.department_id,
              `注销资产 ${c.code}`,
            ),
          );
        if (c.depreciation)
          lines.push(
            await assets.voucherLineInternal(
              setting.depreciationAccountId,
              c.depreciation,
              'debit',
              c.department_id,
              `注销资产 ${c.code} 累计折旧`,
            ),
          );
        lines.push(
          await assets.voucherLineInternal(
            assetAccount.id,
            c.original,
            'credit',
            c.department_id,
            `注销资产 ${c.code}`,
          ),
        );
        voucherTypeId = setting.voucherTypeId;
      }
      return {
        code: c.code,
        name: c.name,
        original: c.original,
        depreciation: c.depreciation,
        net: c.original - c.depreciation,
        latestPeriod: latest?.period ?? null,
        lines,
        voucherTypeId,
        token: digest({ c, date, reasonId, generate, lines, voucherTypeId }),
      };
    },
    async dispose(input: {
      id: number;
      date: string;
      reasonId: number;
      generate: boolean;
      confirm: boolean;
      token: string;
    }) {
      permit(svc, 'edit');
      return svc.tx(async (ts) => {
        const s = assetService(ts),
          tdb = table(ts),
          c = await s.cardInternal(input.id);
        if (c.disposal_date === input.date && c.reason_id === input.reasonId) return c.voucher_id;
        if (!input.confirm) fail('CONFIRM', '注销资产需要确认');
        const p = await operations(ts).disposalPreview(
          input.id,
          input.date,
          input.reasonId,
          input.generate,
        );
        if (p.token !== input.token) fail('PREVIEW_CHANGED', '注销预览已改变', '请重新预览');
        const v =
          input.generate && p.voucherTypeId
            ? await ts.vouchers.create({
                date: input.date,
                voucherTypeId: p.voucherTypeId,
                lines: p.lines,
                source: { type: 'disposal', id: String(input.id) },
              })
            : null;
        await tdb
          .updateTable('fixed_assets_card')
          .set({
            disposal_date: input.date,
            reason_id: input.reasonId,
            voucher_id: v?.id ?? null,
            revision: c.revision + 1,
          })
          .where('id', '=', c.id)
          .execute();
        await s.logInternal('dispose', c.id);
        return v?.id ?? null;
      });
    },
    async undoDisposalPreview(id: number) {
      permit(svc, 'edit');
      const c = await assets.cardInternal(id);
      return {
        voucherId: c.voucher_id,
        voucherDeletion: await previewAssetVoucherDeletion(svc, c.voucher_id),
      };
    },
    async undoDisposal(
      id: number,
      confirm: boolean,
      voucherDeletion?: AssetVoucherDeletionPlan,
      expectedVoucherId?: number | null,
    ) {
      permit(svc, 'edit');
      return svc.tx(async (ts) => {
        const s = assetService(ts),
          c = await s.cardInternal(id);
        if (!c.disposal_date) return;
        if (!confirm) fail('CONFIRM', '撤销注销需要确认');
        await ts.periods.assertOpen(periodOfDate(c.disposal_date), '撤销注销');
        const later = await table(ts)
          .selectFrom('fixed_assets_batch')
          .select('id')
          .where('period', '>', periodOfDate(c.disposal_date))
          .executeTakeFirst();
        if (later) fail('REVERSE_ORDER', '已有后续月份折旧', '先逆序取消后续月份');
        await deleteAssetVoucher(ts, c.voucher_id, voucherDeletion, expectedVoucherId);
        await table(ts)
          .updateTable('fixed_assets_card')
          .set({ disposal_date: null, reason_id: null, voucher_id: null, revision: c.revision + 1 })
          .where('id', '=', id)
          .execute();
        await s.logInternal('disposal.undo', id);
      });
    },
    async query(raw: z.input<typeof QuerySchema>) {
      permit(svc, 'view');
      const f = QuerySchema.parse(raw);
      let q = db
        .selectFrom('fixed_assets_line as l')
        .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
        .innerJoin('fixed_assets_card as c', 'c.id', 'l.asset_id')
        .select([
          'l.id',
          'b.period',
          'b.id as batchId',
          'b.voucher_id',
          'c.id as assetId',
          'c.code',
          'c.name',
          'c.use_date',
          'l.amount',
          'l.work_e6',
          'l.issue',
          'l.department_id',
          'l.category_id',
          'l.purpose_id',
        ])
        .where('b.period', '>=', f.from)
        .where('b.period', '<=', f.to);
      if (!f.showZero) q = q.where('l.amount', '!=', 0);
      for (const [v, col] of [
        [f.assetId, 'l.asset_id'],
        [f.departmentId, 'l.department_id'],
        [f.categoryId, 'l.category_id'],
        [f.purposeId, 'l.purpose_id'],
      ] as const)
        if (v) q = q.where(col, '=', v);
      for (const c of f.conditions) {
        const col = (
          { code: 'c.code', name: 'c.name', amount: 'l.amount', useDate: 'c.use_date' } as const
        )[c.field];
        const problem = queryConditionProblem(c);
        if (problem) fail(problem.code, problem.message, problem.hint);
        const value = c.field === 'amount' ? Number(c.value) : c.value;
        if (c.op === 'contains')
          q = q.where(
            sql<boolean>`${sql.ref(col)} like ${`%${c.value.replace(/[\\%_]/g, '\\$&')}%`} escape '\\'`,
          );
        else q = q.where(col, { eq: '=', gt: '>', lt: '<' }[c.op] as '=' | '>' | '<', value);
      }
      const [rows, masters, deps] = await Promise.all([
        q.orderBy('b.period').orderBy('c.code').execute(),
        assets.masters(),
        svc.dimensions.items('department'),
      ]);
      const masterName = (id: number) => {
        const m = masters.find((m) => m.id === id);
        return m ? `${m.code} ${m.name}` : '未分类';
      };
      const groups = new Map<string, number>();
      const detail = rows.map((r) => {
        let dep = deps.find((d) => d.id === r.department_id);
        if (f.departmentLevel === 'top') {
          const seen = new Set<number>();
          while (dep?.parentId && !seen.has(dep.id)) {
            seen.add(dep.id);
            dep = deps.find((d) => d.id === dep?.parentId);
          }
        }
        const cat = masters.find((m) => m.id === r.category_id);
        const parent =
          f.categoryLevel === 'top'
            ? masters
                .filter((m) => m.kind === 'category' && cat?.code.startsWith(m.code))
                .sort((a, b) => a.code.length - b.code.length)[0]
            : cat;
        const department = dep ? `${dep.code} ${dep.name}` : '未分配';
        const category = parent ? `${parent.code} ${parent.name}` : masterName(r.category_id);
        const key = department + ' / ' + category;
        groups.set(key, sumCents([groups.get(key) ?? 0, r.amount]));
        return {
          ...r,
          department,
          category,
          purpose: masterName(r.purpose_id),
          work: qtyFromE6(r.work_e6),
        };
      });
      return {
        rows: detail,
        distribution: [...groups].map(([group, amount]) => ({ group, amount })),
        total: sumCents(detail.map((r) => r.amount)),
      };
    },
    async reports(raw: z.input<typeof ReportSchema>) {
      permit(svc, 'view');
      const f = ReportSchema.parse(raw),
        all = await assets.list({ includeDisposed: true });
      if (f.fromCode && f.toCode && f.fromCode > f.toCode)
        fail('REPORT_RANGE', '编号起始范围不能大于截止范围');
      if (f.kind === 'labels' && f.labelRange === 'serial' && f.fromSerial > f.toSerial)
        fail('LABEL_RANGE', '起始序号不能大于截止序号', '请按当前标签清单填写从小到大的序号范围');
      await svc.periods.require(periodOfDate(f.cutoff));
      const bookStart = (await svc.periods.require((await svc.book.info()).startPeriod)).startDate;
      const [lines, changes, accessories] = await Promise.all([
        db
          .selectFrom('fixed_assets_line as l')
          .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
          .select(['l.asset_id', 'l.amount', 'l.work_e6', 'b.period'])
          .orderBy('b.period')
          .execute(),
        db.selectFrom('fixed_assets_adjustment').selectAll().orderBy('id').execute(),
        db.selectFrom('fixed_assets_accessory').selectAll().execute(),
      ]);
      const selected = all.filter(
        (c) => (!f.fromCode || c.code >= f.fromCode) && (!f.toCode || c.code <= f.toCode),
      );
      const labelCount = selected.filter((c) => c.acquired <= f.cutoff).length;
      let serial = 0;
      const rows: {
        key: string;
        serial: number;
        code: string;
        name: string;
        date: string;
        description: string;
        original: number;
        depreciation: number;
        net: number;
        quantity: string;
        department: string;
        category: string;
        originalChange: number;
        depreciationChange: number;
      }[] = [];
      for (const c of selected) {
        if (c.acquired > f.cutoff) continue;
        serial++;
        if (
          f.kind === 'labels' &&
          f.labelRange === 'serial' &&
          (serial < f.fromSerial || serial > f.toSerial)
        )
          continue;
        let original = c.base_original;
        for (const a of changes.filter((a) => a.asset_id === c.id && a.date <= f.cutoff))
          original = a.after_value;
        const hist = lines.filter(
          (l) =>
            l.asset_id === c.id &&
            (c.disposal_date && periodOfDate(c.disposal_date) === l.period
              ? c.disposal_date
              : periodEndDate(l.period)) <= f.cutoff,
        );
        const depreciation = sumCents([c.opening_depreciation, ...hist.map((l) => l.amount)]);
        const due = dueDate(c.use_date, c.life_months),
          dueYear = Number(due.slice(0, 4));
        const base = {
          key: String(c.id),
          serial,
          code: c.code,
          name: c.name,
          date: c.use_date,
          description: c.model,
          original,
          depreciation,
          net: original - depreciation,
          quantity: c.quantity,
          department: c.department,
          category: c.category,
          originalChange: 0,
          depreciationChange: 0,
        };
        if (
          f.kind === 'due' &&
          (c.method !== '1' || (f.includeEarlier ? dueYear > f.year : dueYear !== f.year))
        )
          continue;
        if (f.kind === 'additions' && Number(c.acquired.slice(0, 4)) !== f.year) continue;
        if (
          f.kind === 'reductions' &&
          (!c.disposal_date ||
            Number(c.disposal_date.slice(0, 4)) !== f.year ||
            c.disposal_date > f.cutoff)
        )
          continue;
        if (f.kind === 'distribution' && c.disposal_date && c.disposal_date <= f.cutoff) continue;
        if (f.kind === 'accessories') {
          for (const a of accessories.filter((a) => a.asset_id === c.id))
            rows.push({
              ...base,
              key: `a${a.id}`,
              name: `${c.name} / ${a.code} ${a.name}`,
              original: a.amount,
              depreciation: 0,
              net: a.amount,
              quantity: qtyFromE6(a.quantity_e6),
              description: `单价 ${a.unit_price} 元；${a.note}`,
            });
          continue;
        }
        if (f.kind === 'ledger') {
          const events = buildAssetHistory(
            c,
            bookStart,
            changes.filter((a) => a.asset_id === c.id),
            lines.filter((l) => l.asset_id === c.id),
          ).filter((e) => e.date <= f.cutoff);
          const yearStart = `${f.year}-01-01`;
          let value = 0,
            running = 0;
          for (const e of events.filter((e) => e.date < yearStart)) {
            value = sumCents([value, e.originalChange]);
            running = sumCents([running, e.depreciationChange]);
          }
          if (value || running)
            rows.push({
              ...base,
              key: `${c.id}-year-opening`,
              date: yearStart,
              description: '年初余额',
              original: value,
              depreciation: running,
              net: value - running,
            });
          for (const e of events.filter(
            (e) => e.date >= yearStart && Number(e.date.slice(0, 4)) === f.year,
          )) {
            value = sumCents([value, e.originalChange]);
            running = sumCents([running, e.depreciationChange]);
            rows.push({
              ...base,
              key: e.key,
              date: e.date,
              description: e.description,
              original: value,
              depreciation: running,
              net: value - running,
              originalChange: e.originalChange,
              depreciationChange: e.depreciationChange,
            });
          }
          continue;
        }
        rows.push({
          ...base,
          date:
            f.kind === 'reductions'
              ? c.disposal_date!
              : f.kind === 'due'
                ? due
                : f.kind === 'additions'
                  ? c.acquired
                  : c.use_date,
        });
      }
      if (f.kind === 'distribution') {
        const result = new Map<string, (typeof rows)[number]>();
        const deps = await svc.dimensions.items('department'),
          masters = await assets.masters();
        for (const r of rows) {
          const c = all.find((c) => String(c.id) === r.key)!;
          let d = deps.find((d) => d.id === c.department_id);
          const seen = new Set<number>();
          while (f.departmentLevel === 'top' && d?.parentId && !seen.has(d.id)) {
            seen.add(d.id);
            d = deps.find((x) => x.id === d?.parentId);
          }
          const cat = masters.find((m) => m.id === c.category_id);
          const top =
            f.categoryLevel === 'top'
              ? masters
                  .filter((m) => m.kind === 'category' && cat?.code.startsWith(m.code))
                  .sort((a, b) => a.code.length - b.code.length)[0]
              : cat;
          const key = `${d?.code ?? ''} / ${top?.code ?? ''}`;
          const old = result.get(key);
          const amount = r[f.measure];
          result.set(key, {
            ...r,
            key,
            code: key,
            name: `${d?.name ?? '未分配'} / ${top?.name ?? '未分类'}`,
            original: sumCents([old?.original ?? 0, amount]),
            depreciation: 0,
            net: 0,
            quantity: '',
            description:
              f.measure === 'original' ? '原值' : f.measure === 'net' ? '净值' : '累计折旧',
          });
        }
        return {
          title: reportKinds[f.kind],
          labelCount,
          rows: [...result.values()],
          total: sumCents([...result.values()].map((r) => r.original)),
          empty: '截止日无在用资产',
        };
      }
      return {
        title: reportKinds[f.kind],
        labelCount,
        rows,
        total:
          f.kind === 'ledger'
            ? sumCents([...new Map(rows.map((r) => [r.code, r.original])).values()])
            : sumCents(rows.map((r) => r.original)),
        empty:
          f.kind === 'accessories'
            ? '此范围没有附属设备'
            : f.kind === 'reductions'
              ? '当年无资产减少'
              : '没有记录，无法打印及导出',
      };
    },
    async exportOpening() {
      permit(svc, 'view');
      return svc.tx(async (ts) => {
        const service = assetService(ts);
        const [cards, masters, departments, accessories] = await Promise.all([
          service.list({ includeDisposed: true }),
          service.masters(),
          ts.dimensions.items('department'),
          table(ts)
            .selectFrom('fixed_assets_accessory')
            .selectAll()
            .orderBy('asset_id')
            .orderBy('code')
            .execute(),
        ]);
        return { cards, masters, departments, accessories };
      });
    },
    async importPreview(rows: { row: number; data: unknown }[]) {
      permit(svc, 'import');
      await svc.periods.assertWritable({
        period: (await svc.book.info()).startPeriod,
        mode: 'opening',
        action: '导入资产期初',
      });
      const seen = new Set<string>();
      const result = [];
      const existing = await assets.list({ includeDisposed: true });
      for (const row of rows) {
        let error = '',
          data: CardInput | null = null,
          status = '待导入';
        try {
          const parsed = CardSchema.safeParse(row.data);
          if (!parsed.success)
            throw new Error(parsed.error.issues.map((i) => i.message).join('；'));
          data = parsed.data;
          const normalized = await assets.normalizeInternal(data, true);
          if (seen.has(data.code)) throw new Error('本次文件设备编号重复');
          seen.add(data.code);
          const c = existing.find((c) => c.code === data!.code);
          if (c) {
            const p = normalized.p;
            const existingAccessories = (await assets.detail(c.id)).accessories.map((a) => ({
              code: a.code,
              name: a.name,
              quantity: a.quantity,
              unitPrice: a.unit_price,
              note: a.note,
            }));
            const accessoryKey = (a: {
              code: string;
              name: string;
              quantity: string;
              unitPrice: string;
              note: string;
            }) => [a.code, a.name, qtyToE6(a.quantity), new Decimal(a.unitPrice).toFixed(), a.note];
            const sameAccessories =
              JSON.stringify(
                existingAccessories.sort((a, b) => a.code.localeCompare(b.code)).map(accessoryKey),
              ) ===
              JSON.stringify(
                [...p.accessories].sort((a, b) => a.code.localeCompare(b.code)).map(accessoryKey),
              );
            if (
              c.name === p.name &&
              c.reference === p.reference &&
              c.category_id === p.categoryId &&
              c.status_id === p.statusId &&
              c.purpose_id === p.purposeId &&
              c.department_id === p.departmentId &&
              c.acquired === p.acquired &&
              c.use_date === p.useDate &&
              c.base_original === p.original &&
              c.residual === normalized.residual &&
              new Decimal(c.rate).eq(p.rate) &&
              c.method === p.method &&
              c.life_months === p.lifeMonths &&
              c.model === p.model &&
              c.unit === p.unit &&
              c.quantity_e6 === qtyToE6(p.quantity) &&
              c.total_work_e6 === qtyToE6(p.totalWork) &&
              c.opening_depreciation === p.openingDepreciation &&
              c.opening_months === p.openingMonths &&
              c.opening_work_e6 === qtyToE6(p.openingWork) &&
              sameAccessories
            )
              status = '已存在，跳过';
            else throw new Error('编号已存在且期初数据不同，禁止覆盖');
          }
        } catch (e) {
          status = '错误';
          error =
            e instanceof BusinessError
              ? e.data.message
              : e instanceof Error
                ? e.message
                : '数据格式错误';
        }
        const rawCode =
          typeof row.data === 'object' &&
          row.data != null &&
          'code' in row.data &&
          typeof row.data.code === 'string'
            ? row.data.code
            : '';
        result.push({ row: row.row, code: data?.code ?? rawCode, status, error, data });
      }
      return {
        rows: result,
        token: digest(result),
        valid: result.every((r) => !r.error),
        count: result.filter((r) => !r.error && r.status === '待导入').length,
      };
    },
    async importConfirm(rows: { row: number; data: unknown }[], token: string, confirm: boolean) {
      permit(svc, 'import');
      return svc.tx(async (ts) => {
        const o = operations(ts),
          p = await o.importPreview(rows);
        if (!confirm) fail('CONFIRM', '期初入库需要确认');
        if (!p.valid) fail('IMPORT_ERRORS', '导入文件存在逐行错误', '修正后重新预览');
        if (p.token !== token) fail('PREVIEW_CHANGED', '导入预览已改变', '请重新预览');
        const hasBatch = await table(ts)
          .selectFrom('fixed_assets_batch')
          .select('id')
          .executeTakeFirst();
        if (hasBatch && p.count)
          fail(
            'IMPORT_AFTER_DEPRECIATION',
            '已有折旧批次，不能追加期初卡片',
            '期初导入应在首次计提前完成',
          );
        const ids = [];
        for (const r of p.rows)
          if (r.status === '待导入' && r.data)
            ids.push(await assetService(ts).saveInternal(r.data, { opening: true }));
        await ts.settings.set('enabled', true);
        await assetService(ts).logInternal('opening.import', ids.length);
        return { imported: ids.length, skipped: p.rows.length - ids.length };
      });
    },
    async enable() {
      permit(svc, 'import');
      await svc.settings.set('enabled', true);
      await assets.logInternal('enable', 'module');
    },
    async reset() {
      permit(svc, 'settings');
      fail(
        'RESET_UNAVAILABLE',
        '尚未提供可恢复的资产清空流程，不能重置已有数据',
        '可正常开通和导入期初；需要重新开始时，请新建账套并保留原账套备查',
      );
    },
    async batchPreview(raw: z.input<typeof BatchSchema>) {
      permit(svc, 'edit');
      const p = BatchSchema.parse(raw);
      if (p.field === 'unit' && !CardSchema.shape.unit.safeParse(p.value).success)
        fail('BATCH_UNIT', '单位不能超过 20 个字', '请缩短单位后重新预览');
      if (
        p.field === 'lifeMonths' &&
        (!/^\d+$/.test(p.value) || Number(p.value) < 30 || Number(p.value) > 12000)
      )
        fail('BATCH_NUMBER', '统一年限必须为 30 至 12000 的整数月');
      if (
        p.field === 'padCode' &&
        (!/^\d+$/.test(p.value) || Number(p.value) < 1 || Number(p.value) > 40)
      )
        fail('BATCH_NUMBER', '补零长度必须为 1 至 40 的整数');
      if (p.field === 'acquired' && !isValidDate(p.value))
        fail('BATCH_DATE', '购置日期格式应为 YYYY-MM-DD');
      const all = await assets.list({ includeDisposed: true }),
        rows = await assets.list(p.filter),
        codes = new Set(all.map((c) => c.code));
      const result = [];
      for (const c of rows) {
        let error = '';
        const value = p.field === 'padCode' ? c.code.padStart(Number(p.value), '0') : p.value;
        try {
          await assets.assertUnlockedInternal(c.id);
          await svc.periods.assertOpen(
            Math.max((await svc.book.info()).startPeriod, periodOfDate(c.use_date)),
            '统一置数',
          );
          if (c.disposal_date) throw new Error('已注销');
          if (p.field === 'padCode' && value !== c.code && codes.has(value))
            throw new Error(`编号 ${value} 已存在，跳过`);
          if (
            p.field === 'lifeMonths' &&
            (c.months ||
              c.depreciation ||
              (await db
                .selectFrom('fixed_assets_line')
                .select('id')
                .where('asset_id', '=', c.id)
                .executeTakeFirst()))
          )
            throw new Error('已有折旧历史，不可改年限');
          if (p.field === 'acquired' && value > c.use_date) throw new Error('购置日期晚于使用日期');
        } catch (e) {
          error =
            e instanceof BusinessError
              ? e.data.message
              : e instanceof Error
                ? e.message
                : '不允许修改';
        }
        result.push({ id: c.id, code: c.code, name: c.name, revision: c.revision, value, error });
        if (!error) codes.add(value);
      }
      return { rows: result, field: p.field, value: p.value, token: digest({ p, result }) };
    },
    async batchApply(raw: z.input<typeof BatchSchema>, token: string, confirm: boolean) {
      permit(svc, 'edit');
      return svc.tx(async (ts) => {
        const p = await operations(ts).batchPreview(raw);
        if (!confirm) fail('CONFIRM', '统一置数需要确认字段和值');
        if (p.token !== token) fail('PREVIEW_CHANGED', '待改记录已改变', '重新筛选并预览');
        let changed = 0;
        for (const r of p.rows) {
          if (r.error) continue;
          const col = {
            model: 'model',
            unit: 'unit',
            lifeMonths: 'life_months',
            acquired: 'acquired',
            padCode: 'code',
          }[p.field] as 'model' | 'unit' | 'life_months' | 'acquired' | 'code';
          await table(ts)
            .updateTable('fixed_assets_card')
            .set({
              [col]: p.field === 'lifeMonths' ? Number(r.value) : r.value,
              revision: r.revision + 1,
            })
            .where('id', '=', r.id)
            .execute();
          changed++;
        }
        await assetService(ts).logInternal('batch', changed);
        return { changed, skipped: p.rows.filter((r) => r.error) };
      });
    },
    adjustmentInternal: adjustmentInput,
  };
  return self;
}
