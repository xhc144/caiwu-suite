import { randomUUID } from 'node:crypto';
import { BusinessError, periodYear, type BusinessErrorData } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { digest } from './buckets';
import { requireOpening } from './preconditions';
import {
  fail,
  generatePreparedItem,
  noLaterRun,
  rules,
  tables,
  transferPreview,
} from './transfers';

type PlannedRule = { id: number; code: string; name: string; order: number };
type BatchResult = {
  ruleId: number;
  status: 'generated' | 'existing' | 'zero' | 'skipped';
  voucherId: number | null;
  basis?: string;
  reason?: string;
};
type BatchState = {
  plan: PlannedRule[];
  cursor: number;
  status: 'active' | 'failed' | 'completed' | 'stopped';
  results: BatchResult[];
  error: BusinessErrorData | null;
};
type BatchRow = {
  id: string;
  period: number;
  user_id: number;
  state: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
type Batch = Omit<BatchRow, 'state' | 'user_id'> & { state: BatchState };
type BatchInput = { id: string; revision: number; confirmed: boolean };

function unpack(row: BatchRow): Batch {
  return {
    id: row.id,
    period: row.period,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
    state: JSON.parse(row.state) as BatchState,
  };
}

async function load(svc: CoreServices, id: string) {
  const row = await tables(svc)
    .selectFrom('period_close_batch')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', svc.ctx.user.id)
    .executeTakeFirst();
  if (!row) fail('BATCH_NOT_FOUND', '找不到本操作员的结转批次', '返回期间页面恢复自己的结转批次');
  return unpack(row);
}

async function save(svc: CoreServices, batch: Batch, state: BatchState) {
  const updatedAt = svc.ctx.now().toISOString();
  const result = await tables(svc)
    .updateTable('period_close_batch')
    .set({ state: JSON.stringify(state), revision: batch.revision + 1, updated_at: updatedAt })
    .where('id', '=', batch.id)
    .where('user_id', '=', svc.ctx.user.id)
    .where('revision', '=', batch.revision)
    .executeTakeFirst();
  if (result.numUpdatedRows !== 1n)
    fail('BATCH_STALE', '结转批次已在其他窗口更新', '刷新批次后再确认，已生成的凭证不会重复生成');
  return { ...batch, state, revision: batch.revision + 1, updated_at: updatedAt };
}

function assertRevision(batch: Batch, revision: number) {
  if (batch.revision !== revision)
    fail('BATCH_STALE', '结转批次已在其他窗口更新', '刷新批次后再确认，已生成的凭证不会重复生成');
}

async function writable(svc: CoreServices, period: number) {
  await svc.periods.assertWritable({ period, mode: 'business', action: '逐项月度结转' });
  await requireOpening(svc, periodYear(period));
  await noLaterRun(svc, period);
}

function describeError(error: unknown): BusinessErrorData {
  return error instanceof BusinessError
    ? error.data
    : {
        code: 'PERIOD_CLOSE_BATCH_GENERATION_FAILED',
        message: '本项生成失败，已撤销本项修改',
        hint: '已完成的结转仍然保留；排查保存失败原因后重试，或明确跳过本项再继续',
      };
}

async function currentPreview(svc: CoreServices, batch: Batch) {
  const next = batch.state.plan[batch.state.cursor];
  if (!next || batch.state.status === 'completed' || batch.state.status === 'stopped') return null;
  const completed = batch.state.results.filter((r) => r.status !== 'skipped');
  const includedIds = [...completed.map((r) => r.ruleId), next.id];
  const definitions = await rules(svc);
  for (const planned of batch.state.plan.filter((r) => includedIds.includes(r.id))) {
    const definition = definitions.find((r) => r.id === planned.id);
    if (!definition || !definition.enabled)
      fail(
        'RULE_DISABLED',
        `结转 ${planned.code} 不存在或已停用`,
        '修正本项后重试，或明确跳过本项',
      );
    if (definition.order !== planned.order)
      fail(
        'BATCH_ORDER_CHANGED',
        `结转 ${planned.code} 的顺序已改变`,
        '恢复已确认的顺序，或停止本批次后重新选择',
      );
  }
  const preview = await transferPreview(svc, batch.period, includedIds, true, {
    allowedPendingRuleIds: batch.state.results
      .filter((r) => r.status === 'generated' || r.status === 'existing')
      .map((r) => r.ruleId),
  });
  for (const prior of completed) {
    const item = preview.items.find((r) => r.ruleId === prior.ruleId);
    if (prior.status === 'generated' || prior.status === 'existing') {
      const voucher = prior.voucherId == null ? null : await svc.vouchers.get(prior.voucherId);
      if (
        !item ||
        item.existingVoucherId !== prior.voucherId ||
        !voucher ||
        voucher.voided ||
        voucher.period !== batch.period ||
        voucher.source?.module !== 'period-close' ||
        voucher.source.type !== 'closing' ||
        voucher.source.id !== `${batch.period}:${prior.ruleId}`
      )
        fail(
          'BATCH_SOURCE_CHANGED',
          '前序已完成的结转凭证已被删除、作废或来源发生变化',
          '停止本批次，核对前序结转后重新选择；不会用模拟分录替代缺失凭证',
        );
    }
    if (prior.status === 'zero' && (!item?.zero || item.existingVoucherId != null))
      fail('BATCH_BASIS_CHANGED', '前序零转出项已经变化', '停止本批次，核对前序结转后重新选择');
    if (!item || (prior.basis && item.basis !== prior.basis))
      fail(
        'BATCH_BASIS_CHANGED',
        '已完成项的结转基数或设置已经变化',
        '停止本批次，核对已完成项后重新选择；不会自动补做或改写原凭证',
      );
  }
  return { ...preview, items: preview.items.filter((r) => r.ruleId === next.id) };
}

export async function getTransferBatch(svc: CoreServices, period: number) {
  const row = await tables(svc)
    .selectFrom('period_close_batch')
    .selectAll()
    .where('period', '=', period)
    .where('user_id', '=', svc.ctx.user.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return row ? unpack(row) : null;
}

export async function startTransferBatch(
  svc: CoreServices,
  input: { period: number; ruleIds: number[]; confirmed: boolean },
) {
  if (!input.confirmed) fail('CONFIRM', '请先确认逐项结转的执行顺序', '取消不会修改账套');
  return svc.tx(async (t) => {
    await writable(t, input.period);
    if (!input.ruleIds.length || new Set(input.ruleIds).size !== input.ruleIds.length)
      fail('NO_SELECTION', '请选择不重复的结转类型', '在结转列表勾选后再开始');
    const selected = (await rules(t)).filter((r) => input.ruleIds.includes(r.id));
    if (selected.length !== input.ruleIds.length || selected.some((r) => !r.enabled))
      fail('RULE_DISABLED', '所选类型不存在或已停用', '重新选择启用的类型');
    const current = await getTransferBatch(t, input.period);
    if (current && (current.state.status === 'active' || current.state.status === 'failed')) {
      if (digest(current.state.plan.map((r) => r.id)) === digest(selected.map((r) => r.id)))
        return current;
      fail(
        'BATCH_ACTIVE',
        '本期还有未结束的逐项结转',
        '先恢复并完成或停止该批次，再选择另一组结转',
      );
    }
    const now = t.ctx.now().toISOString();
    const batch: Batch = {
      id: randomUUID(),
      period: input.period,
      revision: 1,
      created_at: now,
      updated_at: now,
      state: {
        plan: selected.map(({ id, code, name, order }) => ({ id, code, name, order })),
        cursor: 0,
        status: 'active',
        results: [],
        error: null,
      },
    };
    try {
      await currentPreview(t, batch);
    } catch (error) {
      batch.state.status = 'failed';
      batch.state.error = describeError(error);
    }
    await tables(t)
      .insertInto('period_close_batch')
      .values({ ...batch, user_id: t.ctx.user.id, state: JSON.stringify(batch.state) })
      .execute();
    await t.log.write({
      action: 'period-close.batch.start',
      summary: `${input.period} 开始逐项结转`,
      detail: { id: batch.id, order: batch.state.plan.map((r) => r.code) },
    });
    return batch;
  });
}

export async function transferBatchPreview(svc: CoreServices, id: string) {
  const batch = await load(svc, id);
  try {
    const preview = await currentPreview(svc, batch);
    return { batch, preview, error: null };
  } catch (error) {
    return { batch, preview: null, error: describeError(error) };
  }
}

export async function executeTransferBatch(
  svc: CoreServices,
  input: BatchInput & { previewToken: string; number?: number },
) {
  if (!input.confirmed) fail('CONFIRM', '请先确认本项分录预览', '取消不会生成凭证');
  const before = await load(svc, input.id);
  assertRevision(before, input.revision);
  if (before.state.status !== 'active')
    fail('BATCH_STATE', '本批次当前不能执行', '失败时先选择重试、跳过或停止；已结束批次不再执行');
  try {
    return await svc.tx(async (t) => {
      const batch = await load(t, input.id);
      assertRevision(batch, input.revision);
      await writable(t, batch.period);
      const preview = await currentPreview(t, batch);
      if (!preview || preview.previewToken !== input.previewToken)
        fail('PREVIEW_CHANGED', '本项预览已变化', '重新预览并确认最新分录后再执行');
      const item = preview.items[0]!;
      const generated = await generatePreparedItem(t, batch.period, item, input.number);
      let state: BatchState = {
        ...batch.state,
        cursor: batch.state.cursor + 1,
        status: batch.state.cursor + 1 === batch.state.plan.length ? 'completed' : 'active',
        error: null,
        results: [
          ...batch.state.results,
          {
            ruleId: item.ruleId,
            status: item.zero ? 'zero' : generated?.existing ? 'existing' : 'generated',
            voucherId: generated?.id ?? null,
            basis: item.basis,
          },
        ],
      };
      if (state.status === 'active') {
        try {
          await currentPreview(t, { ...batch, state });
        } catch (error) {
          state = { ...state, status: 'failed', error: describeError(error) };
        }
      }
      const saved = await save(t, batch, state);
      await t.log.write({
        action: 'period-close.batch.execute',
        summary: `${batch.period} 逐项结转 ${item.code}${item.zero ? '（转出为零）' : ''}`,
        detail: { id: batch.id, ruleId: item.ruleId, voucherId: generated?.id ?? null },
      });
      return saved;
    });
  } catch (error) {
    if (
      error instanceof BusinessError &&
      ['PERIOD_CLOSE_BATCH_STALE', 'PERIOD_CLOSE_PREVIEW_CHANGED'].includes(error.data.code)
    )
      throw error;
    // 凭证、来源和成功日志所在事务已回滚；另存失败状态，保留前序已完成项。
    return svc.tx(async (t) => {
      const batch = await load(t, input.id);
      assertRevision(batch, input.revision);
      const saved = await save(t, batch, {
        ...batch.state,
        status: 'failed',
        error: describeError(error),
      });
      await t.log.write({
        action: 'period-close.batch.failed',
        summary: `${batch.period} 逐项结转在 ${batch.state.plan[batch.state.cursor]!.code} 失败`,
        detail: { id: batch.id, code: saved.state.error!.code },
      });
      return saved;
    });
  }
}

export async function decideTransferBatch(
  svc: CoreServices,
  input: BatchInput & { decision: 'retry' | 'skip' | 'stop' },
) {
  if (!input.confirmed) fail('CONFIRM', '请先确认本次结转处理选择', '取消会保留批次和已生成凭证');
  return svc.tx(async (t) => {
    const batch = await load(t, input.id);
    assertRevision(batch, input.revision);
    if (batch.state.status === 'completed' || batch.state.status === 'stopped')
      fail('BATCH_STATE', '结转批次已经结束', '查看已完成记录；需要补转时重新选择结转类型');
    if (input.decision === 'stop') {
      const saved = await save(t, batch, { ...batch.state, status: 'stopped' });
      await t.log.write({
        action: 'period-close.batch.stop',
        summary: `${batch.period} 停止逐项结转，保留已完成项`,
        detail: { id: batch.id },
      });
      return saved;
    }
    await writable(t, batch.period);
    if (input.decision === 'skip' && batch.state.status !== 'failed')
      fail('BATCH_STATE', '本项尚未失败', '按预览执行本项，或停止本批次');
    const next = batch.state.plan[batch.state.cursor]!;
    let state: BatchState;
    if (input.decision === 'skip') {
      state = {
        ...batch.state,
        cursor: batch.state.cursor + 1,
        status: batch.state.cursor + 1 === batch.state.plan.length ? 'completed' : 'active',
        error: null,
        results: [
          ...batch.state.results,
          {
            ruleId: next.id,
            status: 'skipped',
            voucherId: null,
            reason: batch.state.error?.message,
          },
        ],
      };
    } else state = { ...batch.state, status: 'active', error: null };
    try {
      await currentPreview(t, { ...batch, state });
    } catch (error) {
      state = { ...state, status: 'failed', error: describeError(error) };
    }
    const saved = await save(t, batch, state);
    await t.log.write({
      action: `period-close.batch.${input.decision}`,
      summary: `${batch.period} ${input.decision === 'skip' ? '跳过' : '重试'}结转 ${next.code}`,
      detail: { id: batch.id, ruleId: next.id, reason: batch.state.error?.message },
    });
    return saved;
  });
}
