import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BusinessError } from '@caiwu/core';
import {
  BookStore,
  authenticateUser,
  createCoreServices,
  type CoreServices,
} from '@caiwu/core/server';
import type { AppRuntime, Session } from '@caiwu/server-kit';
import { requireAdmin } from './service';
import { ResetParametersSchema, type ResetParameters } from '../shared';

type Plan = {
  id: string;
  token: string;
  bookId: string;
  bookName: string;
  expiresAt: number;
  replacementId: string;
  revision: string;
  parameters: ResetParameters;
  cancelled?: boolean;
};
const plans = new WeakMap<AppRuntime, Map<string, Plan>>();
// Keep cancellation ownership for the lifetime of this exact login, even after expiry removes
// the executable plan. The weak session key releases receipts when that login is discarded.
const cancellations = new WeakMap<
  Session,
  Map<string, { app: AppRuntime; bookId: string; replacementId: string }>
>();
function cleanupPlans(app: AppRuntime) {
  app.bookStore.cleanupExpiredReplacements();
  for (const [id, plan] of plans.get(app) ?? [])
    if (plan.expiresAt <= Date.now()) plans.get(app)?.delete(id);
}
function fail(code: string, message: string, hint = '原账套保留，请重新预览后再执行'): never {
  throw new BusinessError({ code, message, hint });
}
async function passwordCheck(svc: CoreServices, password: string) {
  await requireAdmin(svc);
  const user = await authenticateUser(svc.db, svc.user.code, password);
  if (!user?.isAdmin)
    fail('RESET_PASSWORD_INVALID', '当前管理员密码不正确', '请重新输入当前管理员密码');
}

export async function resetPreflight(svc: CoreServices, app: AppRuntime) {
  await requireAdmin(svc);
  cleanupPlans(app);
  const book = await svc.book.info();
  const tables = [
    'account',
    'voucher',
    'voucher_line',
    'opening_balance',
    'dimension_item',
    'currency',
    'period',
    'operation_log',
    'app_user',
  ] as const;
  const counts: Record<string, number> = {};
  for (const table of tables)
    counts[table] = Number(
      (
        await svc.db
          .selectFrom(table)
          .select(svc.db.fn.countAll<number>().as('count'))
          .executeTakeFirstOrThrow()
      ).count,
    );
  return {
    book,
    periods: await svc.periods.list(),
    counts,
    template: app.templates.list().find((t) => t.id === book.templateId) ?? null,
    templates: app.templates.list(),
    executable: true,
    draft: ResetParametersSchema.safeParse(await svc.settings.get('resetDraft', null)).data ?? null,
    impact:
      '完整重新初始化会清除当前账套的凭证、期初、辅助档案及工资、资产、库存、报表等业务数据，重建所选制度的科目和基础参数。保留原用户、权限与操作日志。执行前自动保留可恢复的完整保护备份；初始化成功后需要重新登录。',
    reason: '准备并核对初始化内容后，输入当前账套名称和管理员密码，再次确认才能执行。',
  };
}

/** Build a new empty book through the existing core constructor. Never clear another module's tables. */
export async function prepareReset(
  svc: CoreServices,
  app: AppRuntime,
  session: Session,
  parameters: ResetParameters,
  password: string,
) {
  await passwordCheck(svc, password);
  cleanupPlans(app);
  const book = await svc.book.info();
  if (book.baseCurrency !== 'CNY')
    fail(
      'RESET_CURRENCY_UNSUPPORTED',
      '当前账套本位币暂不支持完整重新初始化',
      '请保留原账套，并联系管理员核对本位币转换方案',
    );
  app.templates.get(parameters.templateId);
  const revision = app.bookStore.revision(book.id);
  const retained = await svc.tx(async (s) => ({
    users: await s.db.selectFrom('app_user').selectAll().execute(),
    permissions: await s.db.selectFrom('user_permission').selectAll().execute(),
    logs: await s.db.selectFrom('operation_log').selectAll().execute(),
  }));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-initialize-'));
  const blank = new BookStore({
    dataDir: dir,
    templates: app.templates,
    migrationSets: () => app.modules.migrationSets(),
    modules: app.modules.lookup,
    now: app.now,
  });
  let staged: Awaited<ReturnType<BookStore['prepareReplacement']>>;
  try {
    const fresh = await blank.create({
      ...parameters,
      product: book.product,
      adminCode: svc.user.code,
      adminName: svc.user.name,
      adminPassword: randomUUID(),
    });
    const opened = blank.open(fresh.id);
    const freshSvc = createCoreServices({ ...svc.ctx, db: opened.db, scope: undefined });
    await freshSvc.tx(async (s) => {
      await s.db.deleteFrom('user_permission').execute();
      await s.db.deleteFrom('operation_log').execute();
      await s.db.deleteFrom('app_user').execute();
      if (retained.users.length) await s.db.insertInto('app_user').values(retained.users).execute();
      if (retained.permissions.length)
        await s.db.insertInto('user_permission').values(retained.permissions).execute();
      if (retained.logs.length)
        await s.db.insertInto('operation_log').values(retained.logs).execute();
      await s.voucherPolicy.set({
        numbering: parameters.numbering,
        renumberAfterDelete: false,
        allowModifyOthers: false,
      });
      await s.log.write({
        action: 'system-admin.reset.complete',
        summary: `完整重新初始化账套「${parameters.name}」`,
        detail: {
          previousName: book.name,
          templateId: parameters.templateId,
          startYear: parameters.startYear,
          startMonth: parameters.startMonth,
        },
      });
    });
    const bytes = opened.raw.serialize();
    const replacementInput = {
      bookId: book.id,
      sourceBookId: fresh.id,
      bytes,
      length: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      expectedRevision: revision,
      expiresAt: Date.now() + 300_000,
    };
    staged = await app.bookStore.prepareReplacement(replacementInput);
  } finally {
    await blank.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
  const plan: Plan = {
    id: randomUUID(),
    token: session.token,
    bookId: book.id,
    bookName: book.name,
    revision,
    replacementId: staged.replacementId,
    expiresAt: staged.expiresAt,
    parameters,
  };
  const entries = plans.get(app) ?? new Map<string, Plan>();
  entries.set(plan.id, plan);
  plans.set(app, entries);
  const owned = cancellations.get(session) ?? new Map();
  owned.set(plan.id, { app, bookId: plan.bookId, replacementId: plan.replacementId });
  cancellations.set(session, owned);
  return {
    planId: plan.id,
    bookId: book.id,
    bookName: book.name,
    parameters,
    expiresAt: plan.expiresAt,
    retainedUsers: retained.users.length,
    retainedLogs: retained.logs.length,
  };
}

export function cancelReset(app: AppRuntime, session: Session, planId: string) {
  const receipt = cancellations.get(session)?.get(planId);
  if (!receipt || receipt.app !== app || receipt.bookId !== session.bookId)
    fail('RESET_PLAN_EXPIRED', '初始化预览已过期或不属于当前登录');
  try {
    const result = app.bookStore.cancelReplacement({
      bookId: receipt.bookId,
      replacementId: receipt.replacementId,
    });
    return { ok: true as const, ...result };
  } finally {
    // Core cancels before removing staging; cleanup failure must not leave execution enabled.
    const status = app.bookStore.replacementStatus(receipt.replacementId).status;
    const plan = plans.get(app)?.get(planId);
    if (plan && (status === 'cancelled' || status === 'expired')) plan.cancelled = true;
  }
}

export async function executeReset(
  app: AppRuntime,
  session: Session,
  input: {
    planId: string;
    confirmBookName: string;
    password: string;
  },
) {
  const plan = plans.get(app)?.get(input.planId);
  if (
    !plan ||
    plan.cancelled ||
    plan.token !== session.token ||
    plan.bookId !== session.bookId ||
    plan.expiresAt <= Date.now()
  ) {
    cleanupPlans(app);
    fail('RESET_PLAN_EXPIRED', '初始化预览已过期或不属于当前登录');
  }
  if (app.bookStore.replacementStatus(plan.replacementId).status !== 'prepared')
    fail('RESET_PLAN_EXPIRED', '初始化预览已过期或已取消，请重新预览');
  if (plan.bookName !== input.confirmBookName)
    fail('RESET_CONFIRM_FAILED', '输入的账套名称与初始化目标不一致', '请准确输入当前账套名称');
  try {
    await app.lifecycle.maintainBook({
      token: session.token,
      bookId: plan.bookId,
      permission: 'system-admin.reset',
      confirmation: {
        bookId: plan.bookId,
        bookName: input.confirmBookName,
        password: input.password,
      },
      authorize: async (svc) => {
        await requireAdmin(svc);
        if (app.bookStore.revision(plan.bookId) !== plan.revision)
          fail('RESET_TARGET_CHANGED', '预览后账套资料发生变化，初始化未执行');
      },
      plan: {
        kind: 'replace',
        replacementId: plan.replacementId,
        validate: async (opened) => {
          const row = await opened.db.selectFrom('book_info').selectAll().executeTakeFirstOrThrow();
          if (
            row.book_id !== plan.bookId ||
            row.name !== plan.parameters.name ||
            row.template_id !== plan.parameters.templateId
          )
            fail('RESET_RESULT_INVALID', '初始化结果验证未通过，正在恢复原账套');
        },
      },
    });
  } catch (error) {
    // A committed replacement can still report a staging cleanup failure. Never retry the reset.
    if (app.bookStore.replacementStatus(plan.replacementId).status !== 'done') {
      if (error instanceof BusinessError) throw error;
      fail(
        'RESET_FAILED',
        '完整初始化未完成，请核对账套恢复状态',
        '请重新登录核对原账套；若账套已隔离，须先修复存储，再由管理员恢复保护副本。请保留保护备份，不要反复执行初始化',
      );
    }
  }
  const result = app.bookStore.replacementStatus(plan.replacementId);
  plans.get(app)?.delete(plan.id);
  return {
    ok: true as const,
    relogin: true as const,
    protectionId: result.protectionId,
    cleanupPending: result.cleanupPending,
    bookId: plan.bookId,
  };
}
