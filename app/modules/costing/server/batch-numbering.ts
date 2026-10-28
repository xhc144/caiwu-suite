import { formatVoucherNo, periodOfDate, type Voucher } from '@caiwu/core';
import type { CoreServices, VoucherPolicy } from '@caiwu/core/server';
import { digest } from './inventory-read';
import { fail } from './math';
import type { BatchNumberingStep as NumberingStep } from '../fx-batch-shared';

type Row = {
  key: string;
  number: string;
  date: string;
  action: string;
  preview: { links: { purpose: string; voucherId: number }[] } | null;
};
type Input = { purpose: string; voucherTypeId: number; startNumber?: number };

/** 重排只改变编号、版本及更新时间；其余完整内容与创建实例必须仍为预览时的凭证。 */
async function voucherContentFingerprint(svc: CoreServices, id: number) {
  const [row, lines, creation] = await Promise.all([
    svc.db.selectFrom('voucher').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    svc.db
      .selectFrom('voucher_line')
      .selectAll()
      .where('voucher_id', '=', id)
      .orderBy('line_no')
      .orderBy('id')
      .execute(),
    svc.db
      .selectFrom('operation_log')
      .select('id')
      .where('action', '=', 'voucher.create')
      .where('target_type', '=', 'voucher')
      .where('target_id', '=', String(id))
      .orderBy('id', 'desc')
      .executeTakeFirst(),
  ]);
  const { number: _number, revision: _revision, updated_at: _updatedAt, ...header } = row;
  // SQLite 最大 ID 以及毫秒时间均可复用；核心新建日志区分同内容、同时间的重建实例。
  return digest({ header, lines, creationId: creation?.id ?? null });
}

/** 只读核心表；保留版本、来源及状态，不能把外部改动当成本批重排。 */
export async function readBatchVouchers(svc: CoreServices, periods: number[]) {
  if (!periods.length) return [];
  const rows = await svc.db
    .selectFrom('voucher')
    .innerJoin('voucher_type', 'voucher_type.id', 'voucher.voucher_type_id')
    .select([
      'voucher.id',
      'voucher.period',
      'voucher.voucher_type_id',
      'voucher.number',
      'voucher.revision',
      'voucher.status',
      'voucher.voided',
      'voucher.source_module',
      'voucher.source_type',
      'voucher.source_id',
      'voucher.created_by',
      'voucher_type.code as typeCode',
    ])
    .where('voucher.period', 'in', periods)
    .orderBy('voucher.id')
    .execute();
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      contentFingerprint: await voucherContentFingerprint(svc, row.id),
    })),
  );
}
type Snapshot = Awaited<ReturnType<typeof readBatchVouchers>>;
type State = Snapshot[number] & { key: string; label: string };
type Projected = Pick<
  State,
  'period' | 'voucher_type_id' | 'number' | 'typeCode' | 'key' | 'label'
> & { id: number | null };
const group = (v: { period: number; voucher_type_id: number }) =>
  `${v.period}:${v.voucher_type_id}`;
const stateOf = (v: Snapshot[number]): State => ({
  ...v,
  key: `voucher:${v.id}`,
  label: `凭证 ${v.id}（${formatVoucherNo(v.typeCode, v.number)}）`,
});

/** 按成功顺序投影完整映射；新凭证用来源键标识，不猜测 SQLite 分配的 ID。 */
export async function planBatchNumbering(
  svc: CoreServices,
  rows: Row[],
  input: Input,
  policy: VoucherPolicy,
) {
  const steps = new Map<string, NumberingStep>();
  const periods = [...new Set(rows.map((r) => periodOfDate(r.date)))];
  if (!policy.renumberAfterDelete || !rows.some((r) => r.action === 'regenerate'))
    return { steps, periods, groups: [] as string[], initial: [] as Snapshot };
  const all = await readBatchVouchers(svc, periods);
  const targetIds = rows.flatMap((r) =>
    r.action === 'regenerate'
      ? (r.preview?.links.filter((l) => l.purpose === input.purpose).map((l) => l.voucherId) ?? [])
      : [],
  );
  const groups = [
    ...new Set([
      ...all.filter((v) => targetIds.includes(v.id)).map(group),
      ...rows.map((r) => `${periodOfDate(r.date)}:${input.voucherTypeId}`),
    ]),
  ];
  const initial = all.filter((v) => groups.includes(group(v)));
  let projected: Projected[] = initial.map(stateOf);
  let nextNumber = input.startNumber;
  for (const [index, row] of rows.entries()) {
    if (row.action !== 'generate' && row.action !== 'regenerate') continue;
    const targetId = row.preview?.links.find((l) => l.purpose === input.purpose)?.voucherId;
    const target = row.action === 'regenerate' ? projected.find((v) => v.id === targetId) : null;
    const deleted = target
      ? {
          key: target.key,
          label: target.label,
          period: target.period,
          displayNo: formatVoucherNo(target.typeCode, target.number),
        }
      : null;
    const impacts: NumberingStep['impacts'] = [];
    if (target) {
      projected = projected.filter((v) => v !== target);
      if (target.number != null) {
        const affected = projected
          .filter((v) => group(v) === group(target) && v.number != null)
          .sort((a, b) => a.number! - b.number!);
        for (const [i, v] of affected.entries()) {
          impacts.push({
            key: v.key,
            label: v.label,
            period: v.period,
            oldNumber: v.number,
            number: i + 1,
          });
          if (v.number !== i + 1) {
            v.number = i + 1;
          }
        }
      }
    }
    const period = periodOfDate(row.date);
    const number =
      policy.numbering === 'manual'
        ? nextNumber!
        : projected.reduce(
            (max, v) =>
              v.period === period && v.voucher_type_id === input.voucherTypeId
                ? Math.max(max, v.number ?? 0)
                : max,
            0,
          ) + 1;
    const created = {
      key: `new:${row.key}`,
      label: `本批第 ${index + 1} 张新凭证（来源 ${row.number}）`,
      period,
      number,
    };
    steps.set(row.key, { deleted, impacts, created });
    projected.push({
      id: null,
      period,
      voucher_type_id: input.voucherTypeId,
      typeCode: '',
      number,
      key: created.key,
      label: created.label,
    });
    if (policy.numbering === 'manual') nextNumber! += 1;
  }
  return { steps, periods, groups, initial };
}

export function initialBatchState(initial: Snapshot): State[] {
  return initial.map(stateOf);
}

export async function assertBatchState(
  svc: CoreServices,
  plan: { periods: number[]; groups: string[] },
  expected: State[],
) {
  const current = (await readBatchVouchers(svc, plan.periods)).filter((v) =>
    plan.groups.includes(group(v)),
  );
  const fingerprint = (vouchers: Snapshot) =>
    digest(
      [...vouchers]
        .sort((a, b) => a.id - b.id)
        .map((v) => [
          v.id,
          v.period,
          v.voucher_type_id,
          v.number,
          v.revision,
          v.status,
          v.voided,
          v.source_module,
          v.source_type,
          v.source_id,
          v.created_by,
          v.typeCode,
          v.contentFingerprint,
        ]),
    );
  if (fingerprint(current) !== fingerprint(expected))
    fail('STALE', '凭证版本、来源或编号影响已变化，请重新预览后确认');
}

export async function advanceBatchState(
  svc: CoreServices,
  expected: State[],
  deletion: {
    ids: number[];
    impacts: { id: number; oldNumber: number | null; number: number }[];
  } | null,
  step: NumberingStep,
  voucher: Voucher,
): Promise<State[]> {
  const next = expected
    .filter((v) => !deletion?.ids.includes(v.id))
    .map((v) => {
      const impact = deletion?.impacts.find((i) => i.id === v.id);
      return impact && impact.number !== v.number
        ? { ...v, number: impact.number, revision: v.revision + 1 }
        : { ...v };
    });
  next.push({
    id: voucher.id,
    period: voucher.period,
    voucher_type_id: voucher.voucherTypeId,
    typeCode: voucher.voucherTypeCode,
    number: voucher.number,
    revision: voucher.revision,
    status: voucher.status,
    voided: voucher.voided ? 1 : 0,
    source_module: voucher.source?.module ?? null,
    source_type: voucher.source?.type ?? null,
    source_id: voucher.source?.id ?? null,
    created_by: voucher.createdBy.id,
    contentFingerprint: await voucherContentFingerprint(svc, voucher.id),
    key: step.created.key,
    label: step.created.label,
  });
  return next;
}

export function assertBatchDeletion(
  expected: State[],
  step: NumberingStep,
  deletion: { ids: number[]; impacts: { id: number; oldNumber: number | null; number: number }[] },
) {
  const keys = new Map(expected.map((v) => [v.id, v.key]));
  const impacts = deletion.impacts.map((v) => ({
    key: keys.get(v.id),
    oldNumber: v.oldNumber,
    number: v.number,
  }));
  const wanted = step.impacts.map(({ key, oldNumber, number }) => ({ key, oldNumber, number }));
  if (
    digest(deletion.ids.map((id) => keys.get(id))) !== digest([step.deleted?.key]) ||
    digest(impacts) !== digest(wanted)
  )
    fail('STALE', '前项结果或删除编号影响与已确认的逐步映射不一致，请重新预览后确认');
}

export function expectedBatchLinks<
  T extends { voucherId: number; revision: number; displayNo: string },
>(links: T[], expected: State[]): T[] {
  return links.map((link) => {
    const state = expected.find((v) => v.key === `voucher:${link.voucherId}`);
    return state
      ? {
          ...link,
          revision: state.revision,
          displayNo: formatVoucherNo(state.typeCode, state.number),
        }
      : link;
  });
}
