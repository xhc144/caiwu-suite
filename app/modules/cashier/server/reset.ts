import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BusinessError, periodOfDate, zPeriod } from '@caiwu/core';
import { loadServiceUser, type CoreServices } from '@caiwu/core/server';
import type { CashierTables } from './migrations';

export const ResetSchema = z.object({
  period: zPeriod,
  snapshot: z.string().length(64),
  bookName: z.string().min(1).max(60),
  confirmation: z.literal('清空出纳数据'),
  confirmed: z.literal(true),
  requestKey: z.string().uuid(),
});
type ResetInput = z.infer<typeof ResetSchema>;
export type ResetProtection = (input: {
  requestKey: string;
  bookId: string;
  userId: number;
  moduleId: 'cashier';
  reason: 'cashier.reset';
}) => Promise<{ id: string; status: 'valid'; sha256: string }>;
type ResetReceipt = {
  requestKey: string;
  inputHash: string;
  period: number;
  backupId: string;
  backupDigest: string;
};

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code: string, message: string, hint: string): never {
  throw new BusinessError({
    code: `CASHIER_RESET_${code}`,
    message,
    hint,
    actions: [{ label: '出纳账户与期初', to: '/m/cashier/accounts' }],
  });
}
async function authorize(svc: CoreServices) {
  svc.permissions.require('cashier.reset');
  if (!svc.user.isAdmin)
    fail('ADMIN', '重新初始化须由当前账套管理员办理', '请管理员登录后核对备份和清空范围');
  if (svc.moduleId !== 'cashier') throw new Error('重新初始化必须绑定出纳模块');
  const current = await loadServiceUser(svc.db, svc.user.id);
  if (!current || !current.isAdmin)
    fail('ADMIN', '当前操作员已停用或不再是账套管理员，出纳数据尚未清空', '请重新登录后办理');
}

async function snapshot(svc: CoreServices) {
  const db = svc.db.withTables<CashierTables>();
  const book = await svc.book.info();
  const enabledPeriod = await svc.settings.get<number | null>('enabledPeriod', null);
  if (enabledPeriod == null)
    fail('NOT_ENABLED', '尚未启用出纳，无需重新初始化', '请先保存出纳启用期间');
  const accounts = await db.selectFrom('cashier_account').selectAll().orderBy('id').execute();
  const documents = await db.selectFrom('cashier_document').selectAll().orderBy('id').execute();
  const openings = await db
    .selectFrom('cashier_opening')
    .selectAll()
    .orderBy('account_id')
    .orderBy('period')
    .execute();
  const periods = await db.selectFrom('cashier_period').selectAll().orderBy('period').execute();
  const balances = await db
    .selectFrom('cashier_month_balance')
    .selectAll()
    .orderBy('account_id')
    .orderBy('period')
    .execute();
  const checks = await db.selectFrom('cashier_check').selectAll().orderBy('id').execute();
  const batches = await db.selectFrom('cashier_batch').selectAll().orderBy('id').execute();
  const batchDocuments = await db
    .selectFrom('cashier_batch_document')
    .selectAll()
    .orderBy('batch_id')
    .orderBy('document_id')
    .execute();
  const matches = await db.selectFrom('cashier_match').selectAll().orderBy('id').execute();
  const matchDocuments = await db
    .selectFrom('cashier_match_document')
    .selectAll()
    .orderBy('document_id')
    .execute();
  const matchLines = await db
    .selectFrom('cashier_match_line')
    .selectAll()
    .orderBy('line_id')
    .execute();
  // 按来源查总账，历史映射缺失也不能留下失去原单的来源凭证。
  const vouchers = await svc.db
    .selectFrom('voucher')
    .select(['id', 'revision', 'status', 'source_type', 'source_id'])
    .where('source_module', '=', 'cashier')
    .orderBy('id')
    .execute();
  const settings = await svc.db
    .selectFrom('book_setting')
    .selectAll()
    .where('scope', '=', 'cashier')
    .orderBy('key')
    .execute();
  const corePeriods = await svc.periods.list();
  const years = await svc.db.selectFrom('fiscal_year').selectAll().orderBy('year').execute();
  const data = {
    book,
    enabledPeriod,
    accounts,
    documents,
    openings,
    periods,
    balances,
    checks,
    batches,
    batchDocuments,
    matches,
    matchDocuments,
    matchLines,
    vouchers,
    settings,
    corePeriods,
    years,
  };
  return { ...data, snapshot: hash(data) };
}

async function validate(svc: CoreServices, input: ResetInput) {
  await authorize(svc);
  const state = await snapshot(svc);
  if (input.bookName !== state.book.name)
    fail('CONFIRMATION', '输入的账套名称与当前账套不一致', `请核对并输入「${state.book.name}」`);
  if (state.snapshot !== input.snapshot)
    fail('STALE', '预览后出纳数据或账套期间已变化，尚未清空', '请重新预览并确认最新的清空范围');
  if (state.vouchers.length || state.batchDocuments.some((r) => r.voucher_id != null))
    fail(
      'VOUCHERS',
      '出纳仍有关联凭证，不能清空来源单据',
      '请先在收付单页撤销出纳凭证；已审核或过账的凭证须按正常流程取消后再办理',
    );
  return state;
}

async function assertResetWritable(
  svc: CoreServices,
  state: Awaited<ReturnType<typeof snapshot>>,
  input: ResetInput,
  restoreOwnFlags: boolean,
) {
  const db = svc.db.withTables<CashierTables>();
  // 出纳自己的月结历史就在清空范围内；临时解除标志后仍执行完整的标准期间检查。
  // 只在调用方的事务中使用：任何总账封存或其他依赖失败都会一并回滚临时状态。
  const ownClosed = state.periods.filter((p) => p.closed).map((p) => p.period);
  if (ownClosed.length)
    await db
      .updateTable('cashier_period')
      .set({ closed: 0 })
      .where('period', 'in', ownClosed)
      .execute();
  const affectedPeriods = new Set([
    state.enabledPeriod,
    input.period,
    ...state.periods.map((p) => p.period),
    ...state.documents.map((d) => d.period),
    ...state.checks.flatMap((c) =>
      [c.received_date, c.issued_date, c.finished_date]
        .filter((d): d is string => d != null)
        .map(periodOfDate),
    ),
  ]);
  for (const period of affectedPeriods)
    await svc.periods.assertWritable({ period, mode: 'business', action: '重新初始化出纳' });
  if (restoreOwnFlags && ownClosed.length)
    await db
      .updateTable('cashier_period')
      .set({ closed: 1 })
      .where('period', 'in', ownClosed)
      .execute();
}

export function resetService(svc: CoreServices, protect?: ResetProtection) {
  return {
    async preview() {
      await authorize(svc);
      return svc.tx(async (t) => {
        const state = await snapshot(t);
        const dates = state.documents.map((d) => d.date).toSorted();
        return {
          bookName: state.book.name,
          enabledPeriod: state.enabledPeriod,
          snapshot: state.snapshot,
          accounts: state.accounts.length,
          openings: state.openings.length,
          documents: state.documents.filter((d) => !d.deleted).length,
          deletedDocuments: state.documents.filter((d) => d.deleted).length,
          checks: state.checks.length,
          matches: state.matches.length,
          closedPeriods: state.periods.filter((p) => p.closed).length,
          vouchers: state.vouchers.length,
          from: dates[0] ?? null,
          to: dates.at(-1) ?? null,
          blocked:
            state.vouchers.length > 0 || state.batchDocuments.some((r) => r.voucher_id != null),
        };
      });
    },
    async reset(raw: ResetInput) {
      await authorize(svc);
      const input = ResetSchema.parse(raw);
      const inputHash = hash(input);
      const prior = await svc.settings.get<ResetReceipt | null>('lastReset', null);
      if (prior?.requestKey === input.requestKey) {
        if (prior.inputHash !== inputHash)
          fail('IDEMPOTENCY', '该初始化请求编号已用于其他内容', '重新预览后再发起新的初始化请求');
        return prior;
      }
      const before = await svc.tx(async (t) => {
        const state = await validate(t, input);
        await assertResetWritable(t, state, input, true);
        return state;
      });
      if (!protect)
        fail(
          'BACKUP_UNAVAILABLE',
          '完整保护备份暂不可用，出纳数据尚未清空',
          '请检查备份功能后重试',
        );
      // 备份不能放入写事务中；等待完整快照和校验成功后，才允许进入删除事务。
      let protection: Awaited<ReturnType<ResetProtection>>;
      try {
        protection = await protect({
          requestKey: input.requestKey,
          bookId: before.book.id,
          userId: svc.user.id,
          moduleId: 'cashier',
          reason: 'cashier.reset',
        });
      } catch (error) {
        fail(
          'BACKUP_FAILED',
          '完整保护备份失败，出纳数据尚未清空',
          error instanceof BusinessError
            ? `${error.data.message}。${error.data.hint ?? '请处理备份问题后重新预览并重试'}`
            : '请检查备份功能和磁盘可用空间后重新预览并重试',
        );
      }
      if (
        protection.status !== 'valid' ||
        !protection.id ||
        !/^[a-f0-9]{64}$/i.test(protection.sha256)
      )
        fail('BACKUP_FAILED', '保护备份未通过完整校验，出纳数据尚未清空', '请检查备份结果后重试');
      return svc.tx(async (t) => {
        const completed = await t.settings.get<ResetReceipt | null>('lastReset', null);
        if (completed?.requestKey === input.requestKey) {
          if (completed.inputHash !== inputHash)
            fail('IDEMPOTENCY', '该初始化请求编号已用于其他内容', '重新预览后再发起新的初始化请求');
          return completed;
        }
        // 备份等待期间有任何改动都要求重新预览，防止删除没有备份覆盖的新业务。
        const state = await validate(t, input);
        await assertResetWritable(t, state, input, false);
        const db = t.db.withTables<CashierTables>();
        await db.deleteFrom('cashier_match_line').execute();
        await db.deleteFrom('cashier_match_document').execute();
        await db.deleteFrom('cashier_match').execute();
        await db.deleteFrom('cashier_batch_document').execute();
        await db.deleteFrom('cashier_batch').execute();
        await db.deleteFrom('cashier_document').execute();
        await db.deleteFrom('cashier_check').execute();
        await db.deleteFrom('cashier_month_balance').execute();
        await db.deleteFrom('cashier_opening').execute();
        await db.deleteFrom('cashier_period').execute();
        await db.deleteFrom('cashier_account').execute();
        // 包括旧导入收据，避免清空后重放旧请求时误报已经导入。
        await t.db.deleteFrom('book_setting').where('scope', '=', 'cashier').execute();
        await t.settings.set('enabledPeriod', input.period);
        const receipt: ResetReceipt = {
          requestKey: input.requestKey,
          inputHash,
          period: input.period,
          backupId: protection.id,
          backupDigest: protection.sha256,
        };
        await t.settings.set('lastReset', receipt);
        await t.log.write({
          action: 'cashier.reset',
          summary: `重新初始化出纳，启用期间 ${input.period}，请重新录入账户期初`,
          detail: {
            oldPeriod: state.enabledPeriod,
            newPeriod: input.period,
            accounts: state.accounts.length,
            documents: state.documents.length,
            checks: state.checks.length,
            matches: state.matches.length,
            backupId: protection.id,
            backupDigest: protection.sha256,
          },
        });
        return receipt;
      });
    },
  };
}
