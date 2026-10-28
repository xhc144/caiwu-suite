import { createHash } from 'node:crypto';
import { BusinessError, Decimal, assertCents, periodEndDate, periodOfDate } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { Selectable } from '@caiwu/db';
import type { CardFilterInput } from '../shared';
import type { FixedAssetsTables } from './migrations';
import { assetService, calculateDepreciation, fail, safeSum } from './service';
import { allocationAt } from './transfers';

type Card = Selectable<FixedAssetsTables['fixed_assets_card']>;
type Line = Selectable<FixedAssetsTables['fixed_assets_line']>;
type Snapshot = { cards: Card[]; lines: Line[]; context?: Record<string, string> };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const monthIndex = (period: number) => Math.floor(period / 100) * 12 + (period % 100);
const subset = (state: Snapshot, ids: number[]): Snapshot => ({
  cards: state.cards.filter((c) => ids.includes(c.id)),
  lines: state.lines.filter((l) => ids.includes(l.asset_id)),
  ...(state.context && {
    context: Object.fromEntries(ids.map((id) => [id, state.context![id]!])),
  }),
});
// Older records contain only cards and lines. Keep their original exact comparison.
const matches = (current: Snapshot, expected: Snapshot) =>
  digest(expected.context ? current : { cards: current.cards, lines: current.lines }) ===
  digest(expected);

export function recalculationService(svc: CoreServices) {
  const db = svc.db.withTables<FixedAssetsTables>();
  const snapshot = async (ids: number[]): Promise<Snapshot> => {
    if (!ids.length) return { cards: [], lines: [], context: {} };
    const [cards, lines, work, adjustments, transfers, accessories, batches, masters] =
      await Promise.all([
        db
          .selectFrom('fixed_assets_card')
          .selectAll()
          .where('id', 'in', ids)
          .orderBy('id')
          .execute(),
        db
          .selectFrom('fixed_assets_line')
          .selectAll()
          .where('asset_id', 'in', ids)
          .orderBy('id')
          .execute(),
        db
          .selectFrom('fixed_assets_work')
          .selectAll()
          .where('asset_id', 'in', ids)
          .orderBy('asset_id')
          .orderBy('period')
          .execute(),
        db
          .selectFrom('fixed_assets_adjustment')
          .selectAll()
          .where('asset_id', 'in', ids)
          .orderBy('id')
          .execute(),
        db
          .selectFrom('fixed_assets_transfer')
          .selectAll()
          .where('asset_id', 'in', ids)
          .orderBy('id')
          .execute(),
        db
          .selectFrom('fixed_assets_accessory')
          .selectAll()
          .where('asset_id', 'in', ids)
          .orderBy('id')
          .execute(),
        db
          .selectFrom('fixed_assets_line as l')
          .innerJoin('fixed_assets_batch as b', 'b.id', 'l.batch_id')
          .select(['l.asset_id', 'b.id', 'b.period', 'b.created_at'])
          .where('l.asset_id', 'in', ids)
          .orderBy('b.id')
          .orderBy('l.asset_id')
          .execute(),
        db.selectFrom('fixed_assets_master').selectAll().orderBy('id').execute(),
      ]);
    return {
      cards,
      lines,
      context: Object.fromEntries(
        cards.map((c) => {
          const assetTransfers = transfers.filter((t) => t.asset_id === c.id);
          const masterIds = new Set([
            c.category_id,
            c.purpose_id,
            c.status_id,
            ...assetTransfers.flatMap((t) => [
              t.from_purpose_id,
              t.to_purpose_id,
              t.from_status_id,
              t.to_status_id,
            ]),
          ]);
          return [
            c.id,
            digest({
              work: work.filter((w) => w.asset_id === c.id),
              adjustments: adjustments.filter((a) => a.asset_id === c.id),
              transfers: assetTransfers,
              accessories: accessories.filter((a) => a.asset_id === c.id),
              batches: batches.filter((b) => b.asset_id === c.id),
              masters: masters.filter((m) => masterIds.has(m.id)),
            }),
          ];
        }),
      ),
    };
  };
  const writable = async (cards: Card[], lines: Line[]) => {
    const assets = assetService(svc);
    const start = (await svc.book.info()).startPeriod;
    for (const c of cards) {
      await assets.assertUnlockedInternal(c.id);
      await assets.assertChainInternal(c);
      if (c.disposal_date)
        fail('RECALCULATE_DISPOSED', `${c.code} 已注销，不能重算`, '先逆序撤销注销');
      await svc.periods.assertWritable({
        period: start,
        mode: 'opening',
        action: '重算历史累计折旧',
      });
      if (!['1', '2'].includes(c.method)) fail('METHOD', '该折旧方法没有可核实的重算公式');
    }
    const batchIds = [...new Set(lines.map((l) => l.batch_id))];
    if (batchIds.length) {
      const batches = await db
        .selectFrom('fixed_assets_batch')
        .selectAll()
        .where('id', 'in', batchIds)
        .execute();
      for (const b of batches)
        await svc.periods.assertWritable({
          period: b.period,
          mode: 'business',
          action: '重算历史累计折旧',
        });
    }
  };
  const write = async (state: Snapshot) => {
    for (const c of state.cards) {
      const current = await assetService(svc).cardInternal(c.id);
      await db
        .updateTable('fixed_assets_card')
        .set({
          opening_depreciation: c.opening_depreciation,
          opening_months: c.opening_months,
          depreciation: c.depreciation,
          months: c.months,
          work_e6: c.work_e6,
          revision: current.revision + 1,
        })
        .where('id', '=', c.id)
        .execute();
    }
    for (const l of state.lines)
      await db
        .updateTable('fixed_assets_line')
        .set({
          amount: l.amount,
          work_e6: l.work_e6,
          month_count: l.month_count,
          issue: l.issue,
          before_depreciation: l.before_depreciation,
          before_months: l.before_months,
          before_work_e6: l.before_work_e6,
          original: l.original,
          residual: l.residual,
          category_id: l.category_id,
          purpose_id: l.purpose_id,
          department_id: l.department_id,
        })
        .where('id', '=', l.id)
        .execute();
  };
  const self = {
    async preview(filter: CardFilterInput) {
      svc.permissions.require('fixed-assets.depreciate');
      const assets = assetService(svc);
      const ids = (await assets.list(filter)).map((c) => c.id).sort((a, b) => a - b);
      if (!ids.length) fail('NO_CARDS', '当前筛选没有可重算的资产');
      const before = await snapshot(ids);
      await writable(before.cards, before.lines);
      const [batches, transfers, changes, work, masters] = await Promise.all([
        db.selectFrom('fixed_assets_batch').selectAll().orderBy('period').execute(),
        db.selectFrom('fixed_assets_transfer').selectAll().orderBy('date').orderBy('id').execute(),
        db
          .selectFrom('fixed_assets_adjustment')
          .selectAll()
          .orderBy('date')
          .orderBy('id')
          .execute(),
        db.selectFrom('fixed_assets_work').selectAll().execute(),
        assets.masters(),
      ]);
      const start = (await svc.book.info()).startPeriod;
      const after: Snapshot = structuredClone(before);
      const rows = [];
      for (const c of after.cards) {
        const originalCard = before.cards.find((x) => x.id === c.id)!;
        const assetTransfers = transfers.filter((t) => t.asset_id === c.id);
        const initial = allocationAt(c, assetTransfers, c.use_date);
        const depreciates = !!masters.find((m) => m.id === initial.status_id)?.depreciates;
        const elapsed = Math.max(0, monthIndex(start) - monthIndex(periodOfDate(c.use_date)) - 1);
        let depreciation = 0,
          months = 0,
          workE6 = c.opening_work_e6;
        if (c.method === '1' && depreciates) {
          months = Math.min(elapsed, c.life_months);
          if (c.life_months <= 0) fail('LIFE_EXHAUSTED', `${c.code} 缺少使用年限`);
          // This equals the repeated integer-cent allocation used by monthly depreciation.
          const value = BigInt(c.base_original - c.residual),
            life = BigInt(c.life_months),
            count = BigInt(months);
          depreciation = Number(
            (value / life) * count + (value % life < count ? value % life : count),
          );
        } else if (c.method === '2') {
          if (c.total_work_e6 <= 0 || workE6 > c.total_work_e6)
            fail('WORK_EXCEEDS', `${c.code} 期初工作量无效`);
          depreciation = assertCents(
            new Decimal(c.base_original - c.residual)
              .mul(workE6)
              .div(c.total_work_e6)
              .toDecimalPlaces(0)
              .toNumber(),
          );
          months = c.opening_months;
        }
        c.opening_depreciation = depreciation;
        c.opening_months = months;
        for (const b of batches) {
          const line = after.lines.find((l) => l.batch_id === b.id && l.asset_id === c.id);
          if (!line) continue;
          const date = periodEndDate(b.period);
          const allocation = allocationAt(c, assetTransfers, date);
          const original =
            changes.filter((a) => a.asset_id === c.id && a.date <= date).at(-1)?.after_value ??
            c.base_original;
          if (original < c.residual + depreciation)
            fail(
              'INVALID_BALANCE',
              `${c.code} 在 ${b.period} 月原值不足以承载重算后的累计折旧`,
              '请先核对原值调整和预计残值',
            );
          Object.assign(line, {
            before_depreciation: depreciation,
            before_months: months,
            before_work_e6: workE6,
            original,
            residual: c.residual,
            purpose_id: allocation.purpose_id,
            department_id: allocation.department_id,
            amount: 0,
            work_e6: 0,
            month_count: 0,
            issue: '',
          });
          if (b.period <= periodOfDate(c.use_date)) line.issue = '使用当月及以前不提折旧';
          else if (!masters.find((m) => m.id === allocation.status_id)?.depreciates)
            line.issue = '设备状态不计提折旧';
          else if (depreciation === original - c.residual) line.issue = '已提足折旧';
          else {
            const w = work.find((w) => w.asset_id === c.id && w.period === b.period);
            if (c.method === '2' && !w) line.issue = '缺少当月工作量';
            else {
              line.amount = calculateDepreciation(
                {
                  original,
                  residual: c.residual,
                  depreciation,
                  months,
                  lifeMonths: c.life_months,
                  method: c.method,
                  totalWorkE6: c.total_work_e6,
                  workE6,
                },
                w?.quantity_e6 ?? 0,
              );
              line.work_e6 = c.method === '2' ? (w?.quantity_e6 ?? 0) : 0;
              line.month_count = c.method === '2' && !line.work_e6 ? 0 : 1;
            }
          }
          depreciation = safeSum([depreciation, line.amount]);
          months += line.month_count;
          workE6 += line.work_e6;
        }
        if (depreciation > c.original - c.residual)
          fail('INVALID_BALANCE', `${c.code} 重算后累计折旧超过当前可折旧原值`);
        c.depreciation = depreciation;
        c.months = months;
        c.work_e6 = workE6;
        rows.push({
          id: c.id,
          code: c.code,
          name: c.name,
          before: originalCard.depreciation,
          after: depreciation,
          difference: depreciation - originalCard.depreciation,
          beforeMonths: originalCard.months,
          afterMonths: months,
          opening: c.opening_depreciation,
          note:
            c.method === '1'
              ? '按使用次月至启用前月重建期初，再依现存月份、调整及状态重算'
              : '按期初累计工作量和已录各月工作量重算；期初累计月数保留',
        });
      }
      return {
        rows,
        token: digest({ before, after, transfers, changes, work, masters, start }),
        before,
        after,
        totalDifference: safeSum(rows.map((r) => r.difference)),
      };
    },
    async apply(filter: CardFilterInput, token: string, confirm: boolean) {
      svc.permissions.require('fixed-assets.depreciate');
      return svc.tx(async (ts) => {
        if (!confirm) fail('CONFIRM', '重算会覆盖累计折旧及相关月记录，请核对差额后明确确认');
        const p = await recalculationService(ts).preview(filter);
        if (p.token !== token)
          fail('PREVIEW_CHANGED', '资产或历史数据已改变', '请重新预览累计折旧重算');
        await recalculationService(ts).write(p.after);
        const current = await recalculationService(ts).snapshot(p.after.cards.map((c) => c.id));
        const record = await ts.db
          .withTables<FixedAssetsTables>()
          .insertInto('fixed_assets_recalculation')
          .values({
            before_json: JSON.stringify(p.before),
            after_json: JSON.stringify(current),
            undo_guard_json: JSON.stringify(current),
            operator: ts.ctx.user.name,
            created_at: ts.ctx.now().toISOString(),
            undone: 0,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await assetService(ts).logInternal('recalculation', record.id);
        return record.id;
      });
    },
    async list() {
      svc.permissions.require('fixed-assets.view');
      const records = await db
        .selectFrom('fixed_assets_recalculation')
        .selectAll()
        .orderBy('id', 'desc')
        .execute();
      const guards = records.map((r) => JSON.parse(r.undo_guard_json ?? r.after_json) as Snapshot);
      const current = await snapshot([...new Set(guards.flatMap((s) => s.cards.map((c) => c.id)))]);
      return Promise.all(
        records.map(async (r, i) => {
          const state = subset(
            current,
            guards[i]!.cards.map((c) => c.id),
          );
          let undoBlockReason: string | null = r.undone ? '已撤回' : null;
          if (!r.undone) {
            if (!matches(state, guards[i]!)) undoBlockReason = '已有后续变更，请先逆序处理';
            else
              try {
                await writable(state.cards, state.lines);
              } catch (error) {
                if (!(error instanceof BusinessError)) throw error;
                undoBlockReason = error.message;
              }
          }
          return {
            id: r.id,
            operator: r.operator,
            created_at: r.created_at,
            undone: r.undone,
            canUndo: undoBlockReason === null,
            undoBlockReason,
          };
        }),
      );
    },
    async undo(id: number, confirm: boolean) {
      svc.permissions.require('fixed-assets.depreciate');
      return svc.tx(async (ts) => {
        if (!confirm) fail('CONFIRM', '撤回重算需要确认');
        const tdb = ts.db.withTables<FixedAssetsTables>();
        const r = await tdb
          .selectFrom('fixed_assets_recalculation')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!r || r.undone) fail('RECALCULATION_MISSING', '重算记录不存在或已经撤回');
        const before = JSON.parse(r.before_json) as Snapshot,
          after = JSON.parse(r.undo_guard_json ?? r.after_json) as Snapshot;
        const service = recalculationService(ts),
          ids = after.cards.map((c) => c.id);
        const current = await service.snapshot(ids);
        if (!matches(current, after))
          fail('REVERSE_ORDER', '重算后已有其他资产业务，不能覆盖后续变更', '请先逆序撤销后续业务');
        await service.writable(current.cards, current.lines);
        await service.write(before);
        const restored = await service.snapshot(ids);
        // Advance only the nearest live predecessor for each asset, and only if
        // its entire expected state (including revision) is this operation's input.
        // Original before/after snapshots stay immutable; no revision is rewound.
        const predecessors = await tdb
          .selectFrom('fixed_assets_recalculation')
          .selectAll()
          .where('id', '<', id)
          .where('undone', '=', 0)
          .orderBy('id', 'desc')
          .execute();
        const pending = new Set(ids);
        for (const predecessor of predecessors) {
          const guard = JSON.parse(
            predecessor.undo_guard_json ?? predecessor.after_json,
          ) as Snapshot;
          const linked = guard.cards.filter((c) => pending.has(c.id)).map((c) => c.id);
          let changed = false;
          for (const assetId of linked) {
            pending.delete(assetId);
            if (!matches(subset(before, [assetId]), subset(guard, [assetId]))) continue;
            guard.cards = guard.cards.map((c) =>
              c.id === assetId ? restored.cards.find((c) => c.id === assetId)! : c,
            );
            guard.lines = [
              ...guard.lines.filter((l) => l.asset_id !== assetId),
              ...restored.lines.filter((l) => l.asset_id === assetId),
            ].sort((a, b) => a.id - b.id);
            if (guard.context) guard.context[assetId] = restored.context![assetId]!;
            changed = true;
          }
          if (changed)
            await tdb
              .updateTable('fixed_assets_recalculation')
              .set({ undo_guard_json: JSON.stringify(guard) })
              .where('id', '=', predecessor.id)
              .execute();
        }
        await tdb
          .updateTable('fixed_assets_recalculation')
          .set({ undone: 1 })
          .where('id', '=', id)
          .execute();
        await assetService(ts).logInternal('recalculation.undo', id);
      });
    },
    snapshot,
    writable,
    write,
  };
  return self;
}
