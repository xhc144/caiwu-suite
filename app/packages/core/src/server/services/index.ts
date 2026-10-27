import { withTransaction, type Kysely } from '@caiwu/db';
import type { ServiceContext, ServiceUser } from '../context';
import type { CoreDB } from '../schema';
import { accountService, dimensionService } from './accounts';
import {
  bookService,
  logService,
  periodService,
  permissionService,
  referenceService,
  settingsService,
} from './basic';
import { ledgerService } from './ledger';
import { openingService } from './opening';
import { userService } from './users';
import { voucherPolicyService } from './voucher-policy';
import { voucherService } from './vouchers';
import type { InventoryService } from '../../inventory';
import { currentServiceScope } from '../service-scope';
import {
  inventoryService,
  withCoreServiceTransaction,
  assertCoreServiceTransaction,
} from './inventory';

/**
 * 核心服务。模块的 router 里通过 ctx.svc 拿到，已经绑定当前账套、当前操作员和当前模块。
 *
 *   ctx.svc.vouchers.create({...})      生成凭证（唯一允许写凭证表的方式）
 *   ctx.svc.ledger.balances({...})      余额
 *   ctx.svc.ledger.entries({...})       分录明细
 *   ctx.svc.opening.upsert({...})       期初余额
 *   ctx.svc.accounts.list()             科目
 *   ctx.svc.tx(async (svc) => {...})    事务：回调里只能用传进来的 svc
 */
export interface CoreServices {
  ctx: ServiceContext;
  inventory: InventoryService;
  /** 当前账套的数据库（Kysely）。核心表可读；除凭证、分录外的核心表可以直接写。 */
  db: Kysely<CoreDB>;
  user: ServiceUser;
  moduleId: string | null;
  book: ReturnType<typeof bookService>;
  periods: ReturnType<typeof periodService>;
  accounts: ReturnType<typeof accountService>;
  dimensions: ReturnType<typeof dimensionService>;
  reference: ReturnType<typeof referenceService>;
  voucherPolicy: ReturnType<typeof voucherPolicyService>;
  vouchers: ReturnType<typeof voucherService>;
  ledger: ReturnType<typeof ledgerService>;
  opening: ReturnType<typeof openingService>;
  users: ReturnType<typeof userService>;
  settings: ReturnType<typeof settingsService>;
  log: ReturnType<typeof logService>;
  permissions: ReturnType<typeof permissionService>;
  /**
   * 在事务里执行。回调里**只能**用传进来的 svc（它绑定了事务），
   * 用外面的 svc 或 db 会被检测到并报错（否则会卡死）。
   */
  tx<T>(fn: (svc: CoreServices) => Promise<T>): Promise<T>;
}

export function createCoreServices(ctx: ServiceContext): CoreServices {
  ctx = { ...ctx, scope: ctx.scope ?? currentServiceScope() };
  const svc: CoreServices = {
    get inventory() {
      return inventoryService(svc);
    },
    ctx,
    db: ctx.db,
    user: ctx.user,
    moduleId: ctx.moduleId,
    book: bookService(ctx),
    periods: periodService(ctx),
    accounts: accountService(ctx),
    dimensions: dimensionService(ctx),
    reference: referenceService(ctx),
    voucherPolicy: voucherPolicyService(ctx),
    vouchers: voucherService(ctx),
    ledger: ledgerService(ctx),
    opening: openingService(ctx),
    users: userService(ctx),
    settings: settingsService(ctx),
    log: logService(ctx),
    permissions: permissionService(ctx),
    async tx<T>(fn: (svc: CoreServices) => Promise<T>): Promise<T> {
      assertCoreServiceTransaction(svc);
      return withTransaction(ctx.db, (db) => {
        const transactionSvc = createCoreServices({ ...ctx, db });
        return withCoreServiceTransaction(transactionSvc, () => fn(transactionSvc));
      });
    },
  };
  return svc;
}

export { accountService, dimensionService } from './accounts';
export type { CreateAccountInput, CreateDimensionItemInput } from './accounts';
export { voucherService, type VoucherProblem } from './vouchers';
export { ledgerService } from './ledger';
export { openingService, type OpeningBalance, type OpeningBalanceInput } from './opening';
export { authenticateUser, loadServiceUser, userService, type CreateUserInput } from './users';
export type { LogEntryInput } from './basic';

export { voucherPolicyService, VoucherPolicySchema, type VoucherPolicy } from './voucher-policy';
