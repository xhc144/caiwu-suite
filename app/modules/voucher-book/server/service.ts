import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { sql } from '@caiwu/db';
import {
  BusinessError,
  notFound,
  periodOfDate,
  sourceRoute,
  VOUCHER_STATUS_LABELS,
  VoucherInputSchema,
  zDate,
  type Voucher,
  type VoucherInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  BookFilterSchema,
  PreviewSchema,
  reportTotals,
  type BookFilter,
  type Selection,
  type PreviewInput,
  type Preview,
  type PreviewRow,
  type Action,
  type CommitInput,
  type ActionResult,
  type NumberMapping,
  type ReversalCashflowRow,
  type SummaryInput,
} from '../shared';
import type { VoucherBookTables } from './migrations';

export function fail(code: string, message: string, hint = '刷新并重新预览后再操作'): never {
  throw new BusinessError({ code: `VOUCHER_BOOK_${code}`, message, hint });
}
export const permissionFor = (action: Action | 'import') =>
  `voucher-book.${action === 'unvoid' ? 'void' : action}`;
export async function requireVoucher(svc: CoreServices, id: number) {
  const v = await svc.vouchers.get(id);
  if (!v) throw notFound('原凭证', id);
  return v;
}
export function sourceUrl(svc: CoreServices, v: Voucher): string | null {
  if (!v.source) return null;
  const manifest = svc.ctx.modules.manifest(v.source.module);
  return (
    (manifest ? sourceRoute(manifest, v.source.type, v.source.id) : null) ??
    `/m/${encodeURIComponent(v.source.module)}`
  );
}
export async function readonlyReasons(svc: CoreServices, v: Voucher) {
  const reasons: string[] = [];
  if (!(await svc.permissions.has('voucher-entry.edit')))
    reasons.push('没有凭证编辑权限，只能查看');
  if (v.status === 'audited' || v.status === 'posted')
    reasons.push(`${VOUCHER_STATUS_LABELS[v.status]}，请到期间处理或取消审核后再修改`);
  if (v.voided) reasons.push('凭证已作废');
  if (v.source) reasons.push(`由 ${v.source.module} 生成，请在来源页面处理`);
  if ((await svc.periods.require(v.period)).status === 'closed') reasons.push('所属期间已结账');
  return reasons;
}

/** 同一查询构造器用于总数、分页、全范围选择和导出；金额使用整数分。 */
export async function filteredQuery(svc: CoreServices, raw: BookFilter) {
  const f = BookFilterSchema.parse(raw);
  let q = svc.db.selectFrom('voucher as v').innerJoin('app_user as u', 'u.id', 'v.created_by');
  if (f.id != null) q = q.where('v.id', '=', f.id);
  if (f.periodFrom != null) q = q.where('v.period', '>=', f.periodFrom);
  if (f.periodTo != null) q = q.where('v.period', '<=', f.periodTo);
  if (f.dateFrom) q = q.where('v.date', '>=', f.dateFrom);
  if (f.dateTo) q = q.where('v.date', '<=', f.dateTo);
  if (f.statuses?.length) q = q.where('v.status', 'in', f.statuses);
  if (f.voucherTypeId != null) q = q.where('v.voucher_type_id', '=', f.voucherTypeId);
  if (f.numberFrom != null) q = q.where('v.number', '>=', f.numberFrom);
  if (f.numberTo != null) q = q.where('v.number', '<=', f.numberTo);
  if (f.amountFrom != null) q = q.where('v.debit_total', '>=', f.amountFrom);
  if (f.amountTo != null) q = q.where('v.debit_total', '<=', f.amountTo);
  if (f.createdBy != null) q = q.where('v.created_by', '=', f.createdBy);
  if (f.sourceModule) q = q.where('v.source_module', '=', f.sourceModule);
  if (f.sourceType) q = q.where('v.source_type', '=', f.sourceType);
  if (f.sourceId) q = q.where('v.source_id', '=', f.sourceId);
  if (!f.includeVoided) q = q.where('v.voided', '=', 0);
  if (f.accountCode) {
    if (!(await svc.accounts.getByCode(f.accountCode)))
      fail('ACCOUNT', `科目 ${f.accountCode} 不存在`, '请从科目表选择现有科目');
    const codes = (await svc.accounts.list())
      .filter((a) => a.code.startsWith(f.accountCode!))
      .map((a) => a.id);
    q = q.where(({ exists, selectFrom }) =>
      exists(
        selectFrom('voucher_line as l')
          .select('l.id')
          .whereRef('l.voucher_id', '=', 'v.id')
          .where('l.account_id', 'in', codes),
      ),
    );
  }
  if (f.summaryContains)
    q = q.where(({ exists, selectFrom }) =>
      exists(
        selectFrom('voucher_line as l')
          .select('l.id')
          .whereRef('l.voucher_id', '=', 'v.id')
          .where(sql<number>`instr(l.summary, ${f.summaryContains})`, '>', 0),
      ),
    );
  for (const c of f.conditions) {
    const op = { eq: '=', ne: '!=', gte: '>=', lte: '<=' } as const;
    if (c.field === 'summary') {
      q = q.where(({ exists, not, selectFrom }) => {
        let line = selectFrom('voucher_line as l')
          .select('l.id')
          .whereRef('l.voucher_id', '=', 'v.id');
        if (c.operator === 'contains' || c.operator === 'notContains')
          line = line.where(sql<number>`instr(l.summary, ${c.value})`, '>', 0);
        else line = line.where('l.summary', c.operator === 'ne' ? '=' : op[c.operator], c.value);
        return c.operator === 'notContains' || c.operator === 'ne'
          ? not(exists(line))
          : exists(line);
      });
    } else if (c.field === 'creator') {
      q =
        c.operator === 'contains' || c.operator === 'notContains'
          ? q.where(
              sql<number>`instr(u.name, ${c.value})`,
              c.operator === 'contains' ? '>' : '=',
              0,
            )
          : q.where('u.name', op[c.operator], c.value);
    } else {
      if (c.operator === 'contains' || c.operator === 'notContains')
        fail('QUERY', '非字符字段不能使用含有');
      if (c.field === 'date') q = q.where('v.date', op[c.operator], c.value);
      else
        q = q.where(
          c.field === 'number' ? 'v.number' : 'v.debit_total',
          op[c.operator],
          Number(c.value),
        );
    }
  }
  return q;
}
export async function selectedIds(svc: CoreServices, selection: Selection) {
  if (selection.ids) return [...new Set(selection.ids)];
  if (!selection.filter) fail('SELECTION', '请选择凭证或先查询');
  return (
    await (await filteredQuery(svc, selection.filter)).select('v.id').orderBy('v.id').execute()
  ).map((r) => r.id);
}
export async function list(svc: CoreServices, raw: BookFilter) {
  return svc.tx(async (t) => {
    const f = BookFilterSchema.parse(raw);
    const q = await filteredQuery(t, f);
    const count = await q
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const rows = await q
      .select('v.id')
      .orderBy('v.period')
      .orderBy('v.voucher_type_id')
      .orderBy('v.number')
      .orderBy('v.id')
      .limit(f.limit)
      .offset(f.offset)
      .execute();
    const items = [];
    for (const row of rows) {
      const v = await requireVoucher(t, row.id);
      items.push({
        ...v,
        readonlyReasons: await readonlyReasons(t, v),
        sourceUrl: sourceUrl(t, v),
      });
    }
    return { items, total: Number(count.n) };
  });
}
export async function detail(svc: CoreServices, id: number) {
  const v = await requireVoucher(svc, id);
  const reversals = await svc.db
    .selectFrom('voucher')
    .select(['id', 'date', 'number', 'debit_total'])
    .where('reversal_of_id', '=', id)
    .execute();
  return {
    ...v,
    readonlyReasons: await readonlyReasons(svc, v),
    sourceUrl: sourceUrl(svc, v),
    reversals,
  };
}

const DirectionSchema = z.object({ cashflowDirection: z.enum(['inflow', 'outflow', 'internal']) });
export async function cashflowCheck(svc: CoreServices, v: Voucher) {
  const warnings: string[] = [],
    errors: string[] = [];
  const accounts = new Map((await svc.accounts.list()).map((a) => [a.id, a]));
  let internalNet = 0n;
  const internalRows: string[] = [];
  for (const l of v.lines) {
    const a = accounts.get(l.accountId);
    const prefix = `${v.period} ${v.displayNo} 第${l.lineNo}行`;
    if (!l.dimensions.cashflow) {
      if (a?.cashflowRequired) warnings.push(`${prefix} 未设置现金流量项目，是否继续审核？`);
      continue;
    }
    const item = await svc.dimensions.get(l.dimensions.cashflow);
    if (!item || item.typeId !== 'cashflow' || item.disabled || !item.isLeaf) {
      errors.push(`${prefix} 现金流量项目不存在、已停用或非末级`);
      continue;
    }
    if (!a?.cashflowRequired) {
      errors.push(`${prefix} 科目未启用现金流量，不应填写现金流量项目`);
      continue;
    }
    const parsed = DirectionSchema.safeParse(item.attrs);
    if (!parsed.success) {
      if ('cashflowDirection' in item.attrs) {
        errors.push(`${prefix} 现金流量方向元数据非法，请到基础档案修正`);
        continue;
      }
      warnings.push(`${prefix} 项目 ${item.code} 没有方向元数据，无法核验，请核对后确认`);
      continue;
    }
    const direction = parsed.data.cashflowDirection;
    // 与录入正式保存一致：红字按实际净额判断流向，内部项单独配平。
    const signed = BigInt(l.debit) - BigInt(l.credit);
    if (direction === 'internal') {
      internalNet += signed;
      internalRows.push(prefix);
    }
    if ((direction === 'inflow' && signed < 0n) || (direction === 'outflow' && signed > 0n))
      errors.push(
        `${prefix} 现金流量方向 ${direction === 'inflow' ? '流入' : direction === 'outflow' ? '流出' : '内部转移'} 与金额方向冲突`,
      );
  }
  if (internalNet !== 0n)
    errors.push(`${internalRows[0]}等内部现金流入流出未配平，差额 ${internalNet} 分`);
  return { warnings, errors };
}
export function copiedInput(
  v: Voucher,
  date = v.date,
  voucherTypeId = v.voucherTypeId,
): VoucherInput {
  return {
    date,
    voucherTypeId,
    attachments: v.attachments,
    note: v.note,
    lines: v.lines.map((l) => ({
      summary: l.summary,
      accountId: l.accountId,
      dimensions: l.dimensions,
      currency: l.currency,
      exchangeRate: l.exchangeRate,
      fcAmount: l.fcAmount,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      debit: l.debit,
      credit: l.credit,
      settlementMethodId: l.settlementMethodId,
      refNo: l.refNo,
      bizDate: l.bizDate,
    })),
  };
}
export function reversedInput(v: Voucher, date: string, voucherTypeId: number): VoucherInput {
  const input = copiedInput(v, date, voucherTypeId);
  return {
    ...input,
    reversalOfId: v.id,
    lines: input.lines.map((l) => ({
      ...l,
      debit: l.debit ? -l.debit : 0,
      credit: l.credit ? -l.credit : 0,
      fcAmount: l.fcAmount == null ? null : -l.fcAmount,
      quantity: l.quantity == null ? null : new Decimal(l.quantity).negated().toFixed(),
    })),
  };
}
/** 外部收付必须逐行由用户选择；内部转移原项目保留，不能借映射改成外部项配平。 */
async function reversalCashflow(svc: CoreServices, original: Voucher, generated: VoucherInput) {
  const accounts = new Map((await svc.accounts.list()).map((a) => [a.id, a]));
  const items = await svc.dimensions.items('cashflow');
  const rows: ReversalCashflowRow[] = [];
  const checking = structuredClone(original);
  for (const [index, line] of original.lines.entries()) {
    const account = accounts.get(line.accountId);
    if (!account?.cashflowRequired) continue;
    const old = items.find((d) => d.id === line.dimensions.cashflow);
    const parsed = DirectionSchema.safeParse(old?.attrs);
    const next = generated.lines[index]!;
    const signed = BigInt(next.debit ?? 0) - BigInt(next.credit ?? 0);
    const direction =
      parsed.success && parsed.data.cashflowDirection === 'internal'
        ? 'internal'
        : signed > 0n
          ? 'inflow'
          : 'outflow';
    rows.push({
      lineNo: line.lineNo,
      account: `${account.code} ${account.name}`,
      originalItem: old ? `${old.code} ${old.name}` : '未设置或项目不存在',
      direction,
      debit: next.debit ?? 0,
      credit: next.credit ?? 0,
      options:
        direction === 'internal'
          ? []
          : items
              .filter((d) => {
                const meta = DirectionSchema.safeParse(d.attrs);
                return (
                  !d.disabled &&
                  d.isLeaf &&
                  meta.success &&
                  meta.data.cashflowDirection === direction
                );
              })
              .map((d) => ({ id: d.id, label: `${d.code} ${d.name}` })),
    });
    // 待选外部项不沿用原方向；只用内部项和非现金科目做生成前核验。
    checking.lines[index]!.dimensions = {
      ...line.dimensions,
      cashflow: direction === 'internal' ? line.dimensions.cashflow : null,
    };
  }
  const check = await cashflowCheck(svc, checking);
  if (check.errors.length)
    fail('CASHFLOW', check.errors.join('；'), '请先在来源页面修正现金流量项目或内部配平后重新预览');
  return rows;
}
async function mappedReversal(
  svc: CoreServices,
  original: Voucher,
  generated: VoucherInput,
  mappings: CommitInput['cashflowMappings'],
) {
  const rows = await reversalCashflow(svc, original, generated);
  const requested = new Map<number, number>();
  for (const mapping of mappings ?? []) {
    const row = rows.find((r) => r.lineNo === mapping.lineNo && r.direction !== 'internal');
    if (!row || requested.has(mapping.lineNo))
      fail(
        'CASHFLOW_MAPPING',
        `第${mapping.lineNo}行现金流量映射重复或不允许修改`,
        '请重新预览并逐行选择',
      );
    if (!row.options.some((o) => o.id === mapping.itemId))
      fail(
        'CASHFLOW_MAPPING',
        `第${mapping.lineNo}行现金流量项目无效或方向冲突`,
        '请选择该行列出的有效反向项目',
      );
    requested.set(mapping.lineNo, mapping.itemId);
  }
  const result = structuredClone(generated);
  for (const row of rows.filter((r) => r.direction !== 'internal')) {
    const itemId = requested.get(row.lineNo);
    if (itemId == null)
      fail(
        'CASHFLOW_MAPPING',
        `第${row.lineNo}行尚未选择红冲现金流量项目`,
        '请在红冲预览中逐行选择对应项目；没有选项时请先维护同方向的末级现金流量项目',
      );
    const index = original.lines.findIndex((l) => l.lineNo === row.lineNo);
    result.lines[index]!.dimensions = { ...result.lines[index]!.dimensions, cashflow: itemId };
  }
  return result;
}
export function numberMapping(vouchers: Voucher[], byDate: boolean): NumberMapping[] {
  return vouchers
    .filter((v) => v.number != null)
    .sort(
      (a, b) => (byDate ? a.date.localeCompare(b.date) : 0) || a.number! - b.number! || a.id - b.id,
    )
    .map((v, i) => ({ id: v.id, from: v.number!, to: i + 1, label: `${v.date} ${v.displayNo}` }));
}
/** 仅供公共编号策略接入后启用；当前 W0 不提供模式，实际遵循 core 的允许断号语义。 */
export function computerDeletionReason(selected: Voucher[], group: Voucher[]): string | null {
  if (new Set(selected.map((v) => `${v.period}:${v.voucherTypeId}`)).size !== 1)
    return '计算机编号只允许删除同月同类型凭证';
  const ids = new Set(selected.map((v) => v.id));
  const min = Math.min(...selected.map((v) => v.number ?? Infinity));
  if (group.some((v) => !ids.has(v.id) && v.number != null && v.number > min))
    return '计算机编号只允许从最高号向前删除';
  return null;
}
export async function group(svc: CoreServices, period: number, type: number) {
  const rows = await svc.db
    .selectFrom('voucher')
    .select('id')
    .where('period', '=', period)
    .where('voucher_type_id', '=', type)
    .where('number', 'is not', null)
    .orderBy('id')
    .execute();
  const vouchers: Voucher[] = [];
  for (const r of rows) vouchers.push(await requireVoucher(svc, r.id));
  return vouchers;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function metadata(svc: CoreServices) {
  return digest({
    accounts: await svc.accounts.list(),
    dimensions: await svc.dimensions.items('cashflow'),
  });
}
async function rowPreview(
  svc: CoreServices,
  id: number,
  action: Action,
  requested?: PreviewInput,
): Promise<PreviewRow> {
  const v = await svc.vouchers.get(id);
  if (!v)
    return {
      id,
      revision: 0,
      label: `凭证 ${id}`,
      eligible: false,
      reasons: ['原凭证不存在'],
      warnings: [],
      sourceUrl: null,
      periodUrl: '/m/period-close',
    };
  const reasons: string[] = [],
    warnings: string[] = [];
  const periodUrl = `/m/period-close?period=${v.period}`;
  const modifying = ['delete', 'void', 'unvoid', 'insert', 'renumber', 'modify'].includes(action);
  // 复制、反冲只写目标期间，原凭证可以来自已结账期间。
  if (
    !['copy', 'reverse'].includes(action) &&
    (await svc.periods.require(v.period)).status === 'closed'
  )
    reasons.push('所属期间已结账，请去期间处理');
  if (modifying && v.source && v.source.module !== 'voucher-book')
    reasons.push(`其它模块来源 ${v.source.module}，请到来源单据处理`);
  if (action === 'audit') {
    if (v.createdBy.id === svc.user.id) reasons.push('制单人与审核人相同，请更换用户后审核');
    if (v.status !== 'pending')
      reasons.push(`状态是${VOUCHER_STATUS_LABELS[v.status]}，只有待审核凭证可审核`);
    if (!reasons.length) {
      const c = await cashflowCheck(svc, v);
      reasons.push(...c.errors);
      warnings.push(...c.warnings);
    }
  }
  if (action === 'unaudit' && v.status !== 'audited')
    reasons.push(
      v.status === 'posted' ? '已过账，请先去期间处理反过账' : '只有已审核凭证可取消审核',
    );
  if (action === 'delete' && !['draft', 'pending'].includes(v.status))
    reasons.push('已审核或已过账凭证不能删除');
  if (action === 'delete') {
    const reversals = await svc.db
      .selectFrom('voucher')
      .select('id')
      .where('reversal_of_id', '=', v.id)
      .execute();
    if (reversals.length)
      reasons.push(
        `存在关联红字冲销凭证 ${reversals.map((r) => `#${r.id}`).join('、')}，请先处理冲销凭证，保留完整关联`,
      );
  }
  if (['void', 'unvoid'].includes(action)) {
    if (v.status === 'draft') reasons.push('草稿不需要作废，请直接删除');
    if (v.status === 'posted') reasons.push('已过账凭证不能作废或取消作废，请先反过账');
    if (v.voided === (action === 'void'))
      reasons.push(action === 'void' ? '已经作废，无需重复操作' : '尚未作废');
  }
  if (v.voided && ['audit', 'unaudit', 'reverse'].includes(action)) reasons.push('凭证已作废');
  if (action === 'reverse' && v.status === 'draft') reasons.push('草稿不生成红字冲销凭证');
  if (action === 'modify') {
    if (!['draft', 'pending'].includes(v.status)) reasons.push('只有草稿或待审核凭证可批量修改');
    if (v.voided) reasons.push('作废凭证不能批量修改');
    const change = requested?.change;
    if (!change) reasons.push('请选择修改日期或类型');
    else if (change.field === 'type') {
      if (!change.voucherTypeId) reasons.push('请选择目标凭证类型');
      else if (v.voucherTypeId === change.voucherTypeId)
        reasons.push('修改前后凭证类型一致，不需要修改');
    } else {
      if (!change.date) reasons.push('请选择目标日期');
      else {
        const nextDate = change.keepDay
          ? `${change.date.slice(0, 7)}-${v.date.slice(8)}`
          : change.date;
        if (!zDate.safeParse(nextDate).success) reasons.push(`目标日期 ${nextDate} 不存在`);
        else if (nextDate === v.date) reasons.push('修改前后日期一致，不需要修改');
        else if ((await svc.periods.require(periodOfDate(nextDate))).status === 'closed')
          reasons.push('目标期间已结账，请去期间处理');
      }
    }
  }
  if (action === 'insert' && v.number == null) reasons.push('草稿没有编号，不能作为插入位置');
  return {
    id,
    revision: v.revision,
    label: `${v.date} ${v.displayNo}`,
    eligible: !reasons.length,
    reasons,
    warnings,
    sourceUrl: sourceUrl(svc, v),
    periodUrl,
  };
}
type StoredPlan = {
  input: PreviewInput;
  preview: Preview;
  metadata: string;
  groups: { period: number; type: number; hash: string }[];
  generated: VoucherInput | null;
  reversalHash: string | null;
  updates: { id: number; revision: number; input: VoucherInput }[];
};
export async function savePlan(
  svc: CoreServices,
  action: string,
  payload: unknown,
  token: string = randomUUID(),
) {
  await svc.db
    .withTables<VoucherBookTables>()
    .insertInto('voucher_book_plan')
    .values({
      token,
      user_id: svc.user.id,
      action,
      payload: JSON.stringify(payload),
      created_at: svc.ctx.now().toISOString(),
      result: null,
    })
    .execute();
  return token;
}
export async function loadPlan(svc: CoreServices, token: string) {
  const p = await svc.db
    .withTables<VoucherBookTables>()
    .selectFrom('voucher_book_plan')
    .selectAll()
    .where('token', '=', token)
    .executeTakeFirst();
  if (!p || p.user_id !== svc.user.id) fail('PLAN', '操作预览不存在或属于其它操作员');
  if (svc.ctx.now().getTime() - Date.parse(p.created_at) > 15 * 60 * 1000)
    fail('PLAN_EXPIRED', '预览已超过15分钟，请重新预览');
  return p;
}
export async function finishPlan(svc: CoreServices, token: string, result: ActionResult) {
  await svc.db
    .withTables<VoucherBookTables>()
    .updateTable('voucher_book_plan')
    .set({ result: JSON.stringify(result) })
    .where('token', '=', token)
    .execute();
}
/** 只在业务写入成功后的同一事务内生成，重放确认返回保存的原结果。 */
export async function resultVoucher(svc: CoreServices, id: number) {
  const v = await svc.vouchers.get(id);
  return {
    voucherId: v?.id ?? null,
    voucherLabel: v ? `${v.date} ${v.displayNo}` : null,
    status: v ? (v.voided ? '已作废' : VOUCHER_STATUS_LABELS[v.status]) : '不存在或已删除',
  };
}
export async function preview(svc: CoreServices, raw: PreviewInput): Promise<Preview> {
  const input = PreviewSchema.parse(raw);
  await svc.permissions.require(permissionFor(input.action));
  return svc.tx(async (t) => {
    let ids = await selectedIds(t, input.selection);
    if (input.action === 'renumber') {
      if (!input.period || !input.voucherTypeId) fail('GROUP', '整理编号必须选择期间和凭证类型');
      await t.periods.assertOpen(input.period, '整理编号');
      ids = (await group(t, input.period, input.voucherTypeId)).map((v) => v.id);
    }
    if (!ids.length) fail('EMPTY', '没有可操作的凭证，请先查询或选择凭证');
    if (['copy', 'reverse', 'insert'].includes(input.action) && ids.length !== 1)
      fail('ONE', '请只选择一张原凭证');
    const rows: PreviewRow[] = [];
    for (const id of ids) rows.push(await rowPreview(t, id, input.action, input));
    const mappings: NumberMapping[] = [],
      groups: StoredPlan['groups'] = [],
      warnings: string[] = [];
    let generated: VoucherInput | null = null;
    let reversalHash: string | null = null;
    const updates: StoredPlan['updates'] = [];
    let reversalRows: ReversalCashflowRow[] | undefined;
    if (input.action === 'renumber' || input.action === 'insert') {
      const first = await requireVoucher(t, ids[0]!);
      const all = await group(t, first.period, first.voucherTypeId);
      groups.push({ period: first.period, type: first.voucherTypeId, hash: digest(all) });
      if (all.some((v) => v.source && v.source.module !== 'voucher-book'))
        fail('SOURCE', '编号调整范围含其它模块来源凭证，请先在来源模块核对编号');
      if (input.action === 'renumber') mappings.push(...numberMapping(all, input.byDate));
      else {
        if (!input.input) fail('INPUT', '插入必须提供完整平衡分录，请填写插入内容');
        generated = { ...input.input, number: first.number };
        if (
          periodOfDate(generated.date) !== first.period ||
          generated.voucherTypeId !== first.voucherTypeId
        )
          fail('GROUP', '插入内容必须与插入位置属于同期间同类型');
        mappings.push(
          ...all
            .filter((v) => v.number! >= first.number!)
            .map((v) => ({
              id: v.id,
              from: v.number!,
              to: v.number! + 1,
              label: `${v.date} ${v.displayNo}`,
            })),
        );
      }
      warnings.push('编号变动可能使已打印凭证和账册失配；取消预览不会改动任何凭证');
    }
    if (input.action === 'copy' || input.action === 'reverse') {
      const original = await requireVoucher(t, ids[0]!);
      if (!input.date || !input.voucherTypeId) fail('TARGET', '请选择目标日期和凭证类型');
      await t.periods.assertOpen(periodOfDate(input.date), '生成凭证');
      generated =
        input.action === 'copy'
          ? copiedInput(original, input.date, input.voucherTypeId)
          : reversedInput(original, input.date, input.voucherTypeId);
      if (input.action === 'reverse') {
        reversalRows = await reversalCashflow(t, original, generated);
        const existing = await t.db
          .selectFrom('voucher')
          .select('id')
          .where('reversal_of_id', '=', original.id)
          .execute();
        reversalHash = digest(existing.map((r) => r.id).sort((a, b) => a - b));
        if (existing.length)
          warnings.push(`原凭证已有 ${existing.length} 张冲销凭证，本次确认将再次冲销`);
      }
    }
    if (input.action === 'modify') {
      if (!input.change) fail('MODE', '请选择修改日期或凭证类型');
      const change = input.change;
      const checked = new Set<string>();
      const remember = async (period: number, type: number) => {
        const key = `${period}:${type}`;
        if (checked.has(key)) return;
        checked.add(key);
        groups.push({ period, type, hash: digest(await group(t, period, type)) });
      };
      for (const r of rows.filter((r) => r.eligible)) {
        const v = await requireVoucher(t, r.id);
        const next = copiedInput(v);
        next.draft = v.status === 'draft';
        if (change.field === 'date')
          next.date = change.keepDay
            ? `${change.date!.slice(0, 7)}-${v.date.slice(8)}`
            : change.date!;
        else next.voucherTypeId = change.voucherTypeId!;
        await remember(v.period, v.voucherTypeId);
        await remember(periodOfDate(next.date), next.voucherTypeId);
        updates.push({ id: v.id, revision: v.revision, input: next });
      }
      await trial(t, async (test) => {
        for (const update of updates) {
          const v = await test.vouchers.update(update.id, checkedInput(update.input), {
            expectedRevision: update.revision,
          });
          update.input.number = v.number;
          warnings.push(
            `${rows.find((r) => r.id === update.id)!.label} → ${v.date} ${v.displayNo}`,
          );
        }
      });
      warnings.push(
        '修改日期或类型可能改变所属期间与编号，原范围可能留下断号；已打印凭证与账册可能失配。系统不会更改账套编号模式',
      );
    }
    if (input.action === 'delete') {
      const deleting = new Set(rows.filter((r) => r.eligible).map((r) => r.id));
      const checkedGroups = new Set<string>();
      if (input.compactAfter) await t.permissions.require('voucher-book.renumber');
      for (const r of rows.filter((r) => r.eligible)) {
        const v = await requireVoucher(t, r.id);
        const key = `${v.period}:${v.voucherTypeId}`;
        if (checkedGroups.has(key)) continue;
        checkedGroups.add(key);
        const all = await group(t, v.period, v.voucherTypeId);
        groups.push({ period: v.period, type: v.voucherTypeId, hash: digest(all) });
        const remaining = all.filter((x) => !deleting.has(x.id));
        const gaps = missingNumbers(remaining.map((x) => x.number!));
        warnings.push(
          `${v.period} ${v.voucherTypeCode} 删除后断号：${gaps.length ? gaps.join('、') : '无'}（末尾删除不形成中间断号）`,
        );
        if (input.compactAfter) {
          if (remaining.some((x) => x.source && x.source.module !== 'voucher-book'))
            fail('SOURCE', '删除后整理范围含其它模块来源凭证，不能在这里改号');
          mappings.push(...numberMapping(remaining, false));
        }
      }
      warnings.push(
        input.compactAfter
          ? '删除与已预览的编号整理在同一事务执行；已打印凭证和账册可能失配'
          : '删除分录及凭证，原编号将空出。不会自动整理；可勾选删除后整理并重新预览',
      );
    }
    if (input.action === 'unaudit') warnings.push('取消审核后清除审核人和审核日期，凭证恢复待审核');
    if (generated && rows.every((r) => r.eligible)) {
      await trial(t, async (test) => {
        if (input.action === 'insert')
          await test.vouchers.setNumbers(mappings.map((m) => ({ id: m.id, number: m.to })));
        await test.vouchers.create(checkedInput(generated!));
      });
    }
    const result: Preview = {
      token: randomUUID(),
      action: input.action,
      rows,
      mappings,
      warnings,
      eligibleCount: rows.filter((r) => r.eligible).length,
      skippedCount: rows.filter((r) => !r.eligible).length,
      generatedDebit: generated ? generated.lines.reduce((s, l) => s + (l.debit ?? 0), 0) : null,
      ...(reversalRows ? { reversalCashflow: reversalRows } : {}),
    };
    await savePlan(
      t,
      input.action,
      {
        input,
        preview: result,
        groups,
        generated,
        reversalHash,
        updates,
        metadata: await metadata(t),
      } satisfies StoredPlan,
      result.token,
    );
    return result;
  });
}
export async function commit(svc: CoreServices, input: CommitInput): Promise<ActionResult> {
  if (!input.confirmed) fail('CONFIRM', '请先确认预览');
  return svc.tx(async (t) => {
    const saved = await loadPlan(t, input.token);
    if (saved.action === 'import') fail('PLAN', '请使用导入确认入口');
    const plan = JSON.parse(saved.payload) as StoredPlan;
    const { action } = plan.preview;
    await t.permissions.require(permissionFor(action));
    if (saved.result) return JSON.parse(saved.result) as ActionResult;
    if (action !== 'reverse' && input.cashflowMappings?.length)
      fail('CASHFLOW_MAPPING', '只有红冲操作可以选择反向现金流量项目');
    if (plan.metadata !== (await metadata(t)))
      fail('STALE', '科目或现金流量项目已变更，请重新核验');
    for (const r of plan.preview.rows) {
      const current = await t.vouchers.get(r.id);
      if ((current?.revision ?? 0) !== r.revision)
        fail('STALE', `凭证 ${r.label} 已变更，原确认失效`);
      const check = await rowPreview(t, r.id, action, plan.input);
      if (digest(check) !== digest(r)) fail('STALE', `${r.label} 的操作资格已变化`);
    }
    for (const g of plan.groups)
      if (digest(await group(t, g.period, g.type)) !== g.hash)
        fail('STALE', '该期间编号集合已变化，请重新预览');
    if (plan.reversalHash != null) {
      const existing = await t.db
        .selectFrom('voucher')
        .select('id')
        .where('reversal_of_id', '=', plan.preview.rows[0]!.id)
        .execute();
      if (digest(existing.map((r) => r.id).sort((a, b) => a - b)) !== plan.reversalHash)
        fail('STALE', '原凭证的冲销关系已变更，请重新预览并确认是否再次冲销');
    }
    const eligible = plan.preview.rows.filter((r) => r.eligible);
    if (!eligible.length) fail('EMPTY', '没有合格凭证；请查看每项跳过原因');
    if (eligible.some((r) => r.warnings.length) && !input.cashflowConfirmed)
      fail('CASHFLOW_CONFIRM', '现金流量缺失或方向无法核验，请逐项核对并明确确认继续');
    if (
      (plan.preview.mappings.some((m) => m.from !== m.to) || action === 'modify') &&
      !input.numberingConfirmed
    )
      fail('NUMBER_CONFIRM', '请确认编号变动及已打印凭证、账册的影响');
    const ids = eligible.map((r) => r.id),
      createdIds: number[] = [];
    if (action === 'audit' || action === 'unaudit')
      await t.vouchers.changeStatus({ ids, to: action === 'audit' ? 'audited' : 'pending' });
    if (action === 'delete') {
      if (plan.input.compactAfter) await t.permissions.require('voucher-book.renumber');
      for (const r of eligible) await t.vouchers.delete(r.id, { expectedRevision: r.revision });
      if (plan.input.compactAfter) {
        await t.vouchers.setNumbers(
          plan.preview.mappings
            .filter((m) => m.from !== m.to)
            .map((m) => ({ id: m.id, number: m.to })),
        );
        await t.log.write({
          action: 'voucher-book.number.mapping',
          summary: '删除后编号前后映射',
          detail: { mappings: plan.preview.mappings },
        });
      }
    }
    if (action === 'void' || action === 'unvoid')
      for (const r of eligible)
        await t.vouchers.setVoided(r.id, action === 'void', { expectedRevision: r.revision });
    if (action === 'insert' || action === 'renumber') {
      if (eligible.length !== plan.preview.rows.length)
        fail('INELIGIBLE', '编号调整范围含不能操作的凭证，请先处理阻止原因');
      await t.vouchers.setNumbers(
        plan.preview.mappings
          .filter((m) => m.from !== m.to)
          .map((m) => ({ id: m.id, number: m.to })),
      );
      await t.log.write({
        action: 'voucher-book.number.mapping',
        summary: '凭证编号前后映射',
        detail: { mappings: plan.preview.mappings },
      });
    }
    if (action === 'modify') {
      for (const u of plan.updates)
        await t.vouchers.update(u.id, checkedInput(u.input), { expectedRevision: u.revision });
      await t.log.write({
        action: 'voucher-book.modify.mapping',
        summary: '批量修改凭证日期或类型',
        detail: { changes: plan.preview.warnings },
      });
    }
    if (plan.generated) {
      await t.periods.assertOpen(periodOfDate(plan.generated.date), '生成凭证');
      const generated =
        action === 'reverse'
          ? {
              ...(await mappedReversal(
                t,
                await requireVoucher(t, ids[0]!),
                plan.generated,
                input.cashflowMappings,
              )),
              source: { type: 'reversal', id: String(ids[0]) },
            }
          : plan.generated;
      const created = await t.vouchers.create(checkedInput(generated));
      if (action === 'reverse') {
        const check = await cashflowCheck(t, created);
        if (check.errors.length || check.warnings.length)
          fail(
            'CASHFLOW',
            check.errors.concat(check.warnings).join('；'),
            '请重新预览并选择有效的现金流量项目',
          );
      }
      createdIds.push(created.id);
    }
    const result: ActionResult = {
      successCount: createdIds.length || ids.length,
      skippedCount: plan.preview.skippedCount,
      createdIds,
      message: `成功 ${createdIds.length || ids.length} 张，跳过 ${plan.preview.skippedCount} 张`,
      rows: await Promise.all(
        plan.preview.rows.map(async (r) => ({
          key: String(r.id),
          label: r.label,
          outcome: r.eligible ? ('success' as const) : ('skipped' as const),
          reasons: r.eligible ? [] : r.reasons,
          ...(await resultVoucher(t, r.eligible && createdIds.length ? createdIds[0]! : r.id)),
        })),
      ),
    };
    await finishPlan(t, input.token, result);
    await t.log.write({
      action: `voucher-book.${action}`,
      summary: result.message,
      detail: {
        ids,
        skipped: plan.preview.rows.filter((r) => !r.eligible),
        createdIds,
        ...(action === 'reverse' ? { cashflowMappings: input.cashflowMappings ?? [] } : {}),
      },
    });
    return result;
  });
}
export async function summary(svc: CoreServices, input: SummaryInput) {
  if (input.filter.statuses?.length && input.filter.statuses.every((s) => s === 'draft')) return [];
  const ids = await selectedIds(svc, {
    filter: {
      ...input.filter,
      includeVoided: false,
      statuses: input.filter.statuses?.filter((s) => s !== 'draft') ?? [
        'pending',
        'audited',
        'posted',
      ],
    },
  });
  const accounts = await svc.accounts.list();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const totals = new Map<
    string,
    {
      code: string;
      name: string;
      currency: string;
      debit: number;
      credit: number;
      fcDebit: number;
      fcCredit: number;
    }
  >();
  for (const id of ids) {
    const v = await requireVoucher(svc, id);
    if (v.status === 'draft') continue;
    for (const l of v.lines) {
      let a = byId.get(l.accountId)!;
      if (input.level === 'root') while (a.parentId != null) a = byId.get(a.parentId)!;
      const currency = input.foreign ? (l.currency ?? 'CNY') : 'CNY';
      const key = `${a.id}:${currency}`;
      const total = totals.get(key) ?? {
        code: a.code,
        name: a.fullName,
        currency,
        debit: 0,
        credit: 0,
        fcDebit: 0,
        fcCredit: 0,
      };
      if (
        ![
          total.debit + l.debit,
          total.credit + l.credit,
          total.fcDebit + (l.fcAmount ?? 0),
          total.fcCredit + (l.fcAmount ?? 0),
        ].every(Number.isSafeInteger)
      )
        fail('AMOUNT_RANGE', '汇总金额超过安全整数范围，请缩小查询区间');
      total.debit += l.debit;
      total.credit += l.credit;
      if (input.foreign) {
        total.fcDebit += l.debit !== 0 ? (l.fcAmount ?? (currency === 'CNY' ? l.debit : 0)) : 0;
        total.fcCredit += l.credit !== 0 ? (l.fcAmount ?? (currency === 'CNY' ? l.credit : 0)) : 0;
      }
      totals.set(key, total);
    }
  }
  return [...totals.values()].sort(
    (a, b) => a.code.localeCompare(b.code) || a.currency.localeCompare(b.currency),
  );
}
export async function tAccount(svc: CoreServices, filter: BookFilter) {
  if (!filter.accountCode) fail('ACCOUNT', '没有选择科目，请先选择科目');
  const ids = await selectedIds(svc, { filter: { ...filter, includeVoided: false } });
  const rows = [];
  for (const id of ids) {
    const v = await requireVoucher(svc, id);
    if (v.status === 'draft') continue;
    for (const l of v.lines.filter((l) => l.accountCode.startsWith(filter.accountCode!)))
      rows.push({
        ...l,
        voucherId: id,
        displayNo: v.displayNo,
        date: v.date,
        voucherTypeCode: v.voucherTypeCode,
      });
  }
  reportTotals(rows);
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.voucherTypeCode.localeCompare(b.voucherTypeCode) ||
      a.displayNo.localeCompare(b.displayNo) ||
      a.voucherId - b.voucherId ||
      a.lineNo - b.lineNo,
  );
}

/** core 嵌套 tx 复用事务；预览试写用显式保存点回滚。 */
export async function trial<T>(
  svc: CoreServices,
  fn: (svc: CoreServices) => Promise<T>,
): Promise<T> {
  if (!svc.db.isTransaction) throw new Error('校验试写必须在事务内');
  await sql`SAVEPOINT voucher_book_validation`.execute(svc.db);
  try {
    return await fn(svc);
  } finally {
    await sql`ROLLBACK TO SAVEPOINT voucher_book_validation`.execute(svc.db);
    await sql`RELEASE SAVEPOINT voucher_book_validation`.execute(svc.db);
  }
}

export function missingNumbers(numbers: number[]): string[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const gaps: string[] = [];
  let previous = 0;
  for (const n of sorted) {
    if (n > previous + 1)
      gaps.push(n === previous + 2 ? String(previous + 1) : `${previous + 1}-${n - 1}`);
    previous = n;
  }
  return gaps;
}

export async function ledgerLink(svc: CoreServices, id: number, lineId: number) {
  const v = await requireVoucher(svc, id);
  const l = v.lines.find((l) => l.id === lineId);
  if (!l || !(await svc.accounts.get(l.accountId)))
    fail('ACCOUNT', '科目不存在或分录已变更，无法打开明细账');
  const params = new URLSearchParams({
    account: l.accountCode,
    from: String(v.period),
    to: String(v.period),
    dims: JSON.stringify(l.dimensions),
  });
  return `/m/ledgers/detail?${params}`;
}

/** core 逐行累加金额前，模块保证所有中间合计仍为安全整数分。 */
export function checkedInput(raw: VoucherInput): VoucherInput {
  const input = VoucherInputSchema.parse(raw);
  let debit = 0n,
    credit = 0n;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  for (const l of input.lines) {
    debit += BigInt(l.debit);
    credit += BigInt(l.credit);
    if (debit > max || debit < -max || credit > max || credit < -max)
      fail('AMOUNT_RANGE', '凭证合计超过安全整数分范围，请拆分凭证');
  }
  return input;
}
