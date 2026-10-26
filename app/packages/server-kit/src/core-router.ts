import { z } from 'zod';
import {
  BalanceQuerySchema,
  BusinessError,
  CreateBookInputSchema,
  DIMENSION_TYPES,
  DIMENSION_TYPE_IDS,
  EntryFilterSchema,
  MENU_GROUPS,
  PRODUCTS,
  VoucherFilterSchema,
  zId,
  type CurrentUser,
} from '@caiwu/core';
import { authenticateUser, createCoreServices, seedDemoData } from '@caiwu/core/server';
import { authedProcedure, publicProcedure } from './procedures';
import { t } from './trpc';

const currentUser = (u: {
  id: number;
  code: string;
  name: string;
  isAdmin: boolean;
  permissions: ReadonlySet<string>;
}): CurrentUser => ({
  id: u.id,
  code: u.code,
  name: u.name,
  isAdmin: u.isAdmin,
  permissions: [...u.permissions].sort(),
});

/**
 * 核心接口：账套、登录、基础资料读取、凭证与账表读取。
 * 写操作（凭证保存、审核、过账等）由各业务模块提供，核心接口只读。
 */
export const coreRouter = t.router({
  bootstrap: publicProcedure.query(({ ctx }) => ({
    devMode: ctx.app.devMode,
    version: ctx.app.version,
    products: PRODUCTS,
    menuGroups: MENU_GROUPS,
    dimensionTypes: DIMENSION_TYPES,
  })),

  books: t.router({
    list: publicProcedure.query(({ ctx }) => ctx.app.bookStore.list()),
    templates: publicProcedure.query(({ ctx }) => ctx.app.templates.list()),
    create: publicProcedure
      .meta({ noPermission: true })
      .input(CreateBookInputSchema)
      .mutation(({ ctx, input }) => ctx.app.bookStore.create(input)),
  }),

  auth: t.router({
    login: publicProcedure
      .meta({ noPermission: true })
      .input(
        z.object({
          bookId: z.string(),
          userCode: z.string().trim().min(1, '请输入用户编号'),
          password: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.app.bookStore.exists(input.bookId)) {
          throw new BusinessError({ code: 'BOOK_NOT_FOUND', message: '账套不存在，可能已被删除' });
        }
        const book = ctx.app.bookStore.open(input.bookId);
        const user = await authenticateUser(book.db, input.userCode, input.password);
        if (!user) {
          throw new BusinessError({
            code: 'LOGIN_FAILED',
            message: '用户编号或密码不对',
            hint: '忘记密码请联系系统管理员重置',
          });
        }
        const svc = createCoreServices({
          db: book.db,
          user,
          moduleId: null,
          now: ctx.app.now,
          modules: ctx.app.modules.lookup,
        });
        await svc.settings.set('lastOpenedAt', ctx.app.now().toISOString());
        await svc.log.write({ action: 'auth.login', summary: `${user.name} 登录` });
        const session = ctx.app.sessions.create(input.bookId, user.id);
        return { token: session.token, user: currentUser(user), book: await svc.book.info() };
      }),
    logout: authedProcedure.meta({ noPermission: true }).mutation(({ ctx }) => {
      ctx.app.sessions.delete(ctx.session.token);
      return { ok: true };
    }),
    me: authedProcedure.query(async ({ ctx }) => ({
      user: currentUser(ctx.user),
      book: await ctx.svc.book.info(),
      currentPeriod: await ctx.svc.periods.current(),
    })),
  }),

  modules: t.router({
    /** 已加载模块的清单（菜单、权限点、来源单据），授权界面等用 */
    list: authedProcedure.query(({ ctx }) => ctx.app.modules.manifests()),
  }),

  accounts: t.router({
    list: authedProcedure.query(({ ctx }) => ctx.svc.accounts.list()),
    categories: authedProcedure.query(({ ctx }) => ctx.svc.accounts.categories()),
  }),

  dimensions: t.router({
    items: authedProcedure
      .input(z.object({ type: z.enum(DIMENSION_TYPE_IDS).optional() }).default({}))
      .query(({ ctx, input }) => ctx.svc.dimensions.items(input.type)),
  }),

  periods: t.router({
    list: authedProcedure.query(({ ctx }) => ctx.svc.periods.list()),
    current: authedProcedure.query(({ ctx }) => ctx.svc.periods.current()),
  }),

  reference: t.router({
    currencies: authedProcedure.query(({ ctx }) => ctx.svc.reference.currencies()),
    voucherTypes: authedProcedure.query(({ ctx }) => ctx.svc.reference.voucherTypes()),
    settlementMethods: authedProcedure.query(({ ctx }) => ctx.svc.reference.settlementMethods()),
    summaries: authedProcedure.query(({ ctx }) => ctx.svc.reference.summaries()),
  }),

  vouchers: t.router({
    get: authedProcedure
      .input(z.object({ id: zId }))
      .query(({ ctx, input }) => ctx.svc.vouchers.get(input.id)),
    list: authedProcedure
      .input(VoucherFilterSchema)
      .query(({ ctx, input }) => ctx.svc.vouchers.list(input)),
  }),

  /** 只在开发模式可用 */
  dev: t.router({
    /** 给当前账套预置演示数据（辅助档案、汇率、摘要），已有的跳过。仅管理员。 */
    seedDemo: authedProcedure.meta({ noPermission: true }).mutation(async ({ ctx }) => {
      if (!ctx.app.devMode)
        throw new BusinessError({ code: 'DEV_ONLY', message: '只有开发模式可以预置演示数据' });
      if (!ctx.user.isAdmin)
        throw new BusinessError({ code: 'FORBIDDEN', message: '只有管理员可以预置演示数据' });
      await seedDemoData(ctx.svc, (await ctx.svc.book.info()).startPeriod);
      return { ok: true };
    }),
  }),

  ledger: t.router({
    balances: authedProcedure
      .input(BalanceQuerySchema)
      .query(({ ctx, input }) => ctx.svc.ledger.balances(input)),
    entries: authedProcedure
      .input(EntryFilterSchema)
      .query(({ ctx, input }) => ctx.svc.ledger.entries(input)),
  }),
});

export type CoreRouter = typeof coreRouter;

function _coreShell() {
  return t.router({ core: coreRouter });
}
/** 前端 core 接口的类型（路径 core.*） */
export type CoreShell = ReturnType<typeof _coreShell>;
