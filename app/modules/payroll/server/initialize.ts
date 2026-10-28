import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { authenticateUser, type CoreServices } from '@caiwu/core/server';
import {
  InitializationApplySchema,
  InitializationOptionsSchema,
  InitializationPreviewSchema,
} from '../shared-initialize';
import type { PayrollModuleState } from '../shared-transfer';
import { fail } from './engine';
import {
  assertPayrollReplaceable,
  backupPayrollModule,
  capturePayrollState,
  clearPayrollModule,
  restorePayrollModuleSnapshot,
} from './transfer';

async function authenticateAdministrator(svc: CoreServices, password: string) {
  if (!svc.user.isAdmin) fail('INITIALIZE_ADMIN', '工资初始化仅限当前账套管理员操作');
  const user = await authenticateUser(svc.db, svc.user.code, password);
  if (!user || !user.isAdmin || user.id !== svc.user.id)
    fail(
      'INITIALIZE_PASSWORD',
      '当前管理员密码不正确或权限已变化',
      '重新输入当前登录管理员的完整密码',
    );
}
function retainedState(
  state: PayrollModuleState,
  options: z.output<typeof InitializationOptionsSchema>,
): PayrollModuleState {
  if (options.preserveData) return state;
  return {
    categories: options.keepArchives ? state.categories : [],
    employees: options.keepArchives ? state.employees : [],
    profiles: options.keepArchives ? state.profiles : [],
    settings: options.keepArchives ? state.settings : [],
    batches: [],
    rows: [],
    quantities: [],
    periods: [],
    corrections: [],
    origins: [],
  };
}
async function planInitialization(
  svc: CoreServices,
  options: z.output<typeof InitializationOptionsSchema>,
  expiresAt: number,
) {
  const now = svc.ctx.now().getTime();
  if (expiresAt <= now || expiresAt > now + 300_000)
    fail('INITIALIZE_EXPIRED', '工资初始化预览已过期', '重新预览数据影响并确认');
  const book = await svc.book.info();
  if (options.startPeriod < book.startPeriod)
    fail('INITIALIZE_START', '工资启用期间不能早于账套启用期间');
  await svc.periods.assertWritable({ period: options.startPeriod, action: '初始化工资模块' });
  await assertPayrollReplaceable(svc);
  const state = await capturePayrollState(svc);
  if (state.batches.some((batch) => batch.closed) || state.periods.some((period) => period.closed))
    fail(
      'INITIALIZE_CLOSED',
      '工资存在已结账月份，不能初始化',
      '先核对并按顺序反结账，不得清除冻结工资',
    );
  const originalStartPeriod = await svc.settings.get<number>(
    'initializedStartPeriod',
    book.startPeriod,
  );
  const retained = retainedState(state, options);
  const hash = createHash('sha256')
    .update(JSON.stringify({ bookId: book.id, userId: svc.user.id, options, state, expiresAt }))
    .digest('hex');
  return {
    hash,
    expiresAt,
    bookName: book.name,
    originalStartPeriod,
    counts: {
      categories: state.categories.length,
      employees: state.employees.length,
      batches: state.batches.length,
      rows: state.rows.length,
      quantities: state.quantities.length,
      corrections: state.corrections.length,
    },
    retained: {
      categories: retained.categories.length,
      employees: retained.employees.length,
      batches: retained.batches.length,
      rows: retained.rows.length,
    },
    retainedState: retained,
  };
}
export async function previewInitialization(
  svc: CoreServices,
  raw: z.input<typeof InitializationPreviewSchema>,
) {
  const input = InitializationPreviewSchema.parse(raw);
  await authenticateAdministrator(svc, input.password);
  return svc.tx(async (t) => {
    const { retainedState: _retainedState, ...plan } = await planInitialization(
      t,
      InitializationOptionsSchema.parse(input),
      t.ctx.now().getTime() + 300_000,
    );
    return plan;
  });
}
export async function applyInitialization(
  svc: CoreServices,
  raw: z.input<typeof InitializationApplySchema>,
) {
  const input = InitializationApplySchema.parse(raw);
  if (!input.confirmed)
    fail('INITIALIZE_CONFIRM', '工资初始化须明确确认', '先预览并输入“初始化工资”');
  return svc.tx(async (t) => {
    await authenticateAdministrator(t, input.password);
    const options = InitializationOptionsSchema.parse(input);
    const plan = await planInitialization(t, options, input.expiresAt);
    if (plan.hash !== input.hash)
      fail('INITIALIZE_STALE', '工资资料或初始化选项已变化', '重新预览数据影响后再确认');
    const backup = await backupPayrollModule(t, '工资模块初始化前自动保护副本');
    if (options.preserveData || options.keepArchives)
      await restorePayrollModuleSnapshot(t, plan.retainedState);
    else await clearPayrollModule(t);
    await t.settings.set('initializedStartPeriod', options.startPeriod);
    await t.log.write({
      action: 'payroll.initialize',
      summary: `初始化工资模块，启用期间 ${options.startPeriod}，保留 ${plan.retained.batches} 批工资及 ${plan.retained.employees} 人，保护副本 ${backup.id}`,
    });
    return { backup, startPeriod: options.startPeriod, retained: plan.retained };
  });
}
