import { BusinessError } from '@caiwu/core';
import {
  createCoreServices,
  loadServiceUser,
  type CoreServices,
  type OpenBook,
  type ServiceUser,
} from '@caiwu/core/server';
import { businessErrors, t } from './trpc';
import type { Session } from './sessions';

/** 不需要登录的过程（账套列表、新建账套、登录）。 */
export const publicProcedure = t.procedure.use(businessErrors);

export interface AuthedContext {
  session: Session;
  book: OpenBook;
  user: ServiceUser;
  /** 核心服务，已绑定当前账套、当前操作员、当前模块 */
  svc: CoreServices;
  moduleId: string | null;
}

const unauthorized = () =>
  new BusinessError({
    code: 'UNAUTHORIZED',
    message: '登录已失效，请重新登录',
    actions: [{ label: '重新登录', to: '/' }],
  });

/** 需要登录的过程。会按 meta.permission 检查权限。 */
export const authedProcedure = publicProcedure.use(async ({ ctx, meta, next }) => {
  const session = ctx.app.sessions.get(ctx.token);
  if (!session) throw unauthorized();
  if (!ctx.app.bookStore.exists(session.bookId)) {
    ctx.app.sessions.deleteForBook(session.bookId);
    throw unauthorized();
  }
  const book = ctx.app.bookStore.open(session.bookId);
  const user = await loadServiceUser(book.db, session.userId);
  if (!user) {
    ctx.app.sessions.delete(session.token);
    throw unauthorized();
  }
  const svc = createCoreServices({
    db: book.db,
    user,
    moduleId: null,
    now: ctx.app.now,
    modules: ctx.app.modules.lookup,
  });
  if (meta?.permission) svc.permissions.require(meta.permission);
  return next({
    ctx: { session, book, user, svc, moduleId: null as string | null } satisfies AuthedContext,
  });
});

/** 模块的过程：在 authedProcedure 基础上把 svc 绑定到模块（生成的凭证记为该模块来源，参数按模块隔离）。 */
export function moduleProcedure(moduleId: string) {
  return authedProcedure.use(({ ctx, next }) =>
    next({
      ctx: {
        moduleId,
        svc: createCoreServices({ ...ctx.svc.ctx, moduleId }),
      },
    }),
  );
}
