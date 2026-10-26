import { moduleKit } from '@caiwu/server-kit';
import { BusinessError } from '@caiwu/core';
import manifest from '../manifest';
import { OverviewSchema, SearchSchema, ProductSchema, PreferencesSchema } from '../shared';
import { workbenchService } from './service';
const m = moduleKit(manifest);
// W0 会话没有密码版本字段。用户信息更新晚于发令时间时，拒绝本模块旧会话并撤销令牌。
const currentSession = m.procedure.use(async ({ ctx, next }) => {
  const user = await ctx.svc.db
    .selectFrom('app_user')
    .select('updated_at')
    .where('id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!user || Date.parse(user.updated_at) > ctx.session.createdAt) {
    ctx.app.sessions.delete(ctx.session.token);
    throw new BusinessError({
      code: 'UNAUTHORIZED',
      message: '用户信息已更新，请重新登录',
      hint: '请使用当前密码登录后继续工作',
      actions: [{ label: '重新登录', to: `/login/${encodeURIComponent(ctx.session.bookId)}` }],
    });
  }
  return next();
});
export const workbenchRouter = m.router({
  session: currentSession.query(() => ({ valid: true })),
  overview: currentSession
    .meta({ permission: 'workbench.overview.view' })
    .input(OverviewSchema)
    .query(({ ctx, input }) =>
      workbenchService(ctx.svc, ctx.app.modules.manifests(), ctx.app.devMode).overview(
        input.period,
      ),
    ),
  search: currentSession
    .meta({ permission: 'workbench.search' })
    .input(SearchSchema)
    .query(({ ctx, input }) =>
      workbenchService(ctx.svc, ctx.app.modules.manifests(), ctx.app.devMode).search(
        input.term,
        input.period,
        input.limit,
      ),
    ),
  preferences: currentSession.query(({ ctx }) =>
    workbenchService(ctx.svc, ctx.app.modules.manifests(), ctx.app.devMode).preferences(),
  ),
  savePreferences: currentSession
    .meta({ permission: 'workbench.settings' })
    .input(PreferencesSchema)
    .mutation(({ ctx, input }) =>
      workbenchService(ctx.svc, ctx.app.modules.manifests(), ctx.app.devMode).savePreferences(
        input,
      ),
    ),
  switchProduct: currentSession
    .meta({ permission: 'workbench.product.switch' })
    .input(ProductSchema)
    .mutation(({ ctx, input }) =>
      workbenchService(ctx.svc, ctx.app.modules.manifests(), ctx.app.devMode).switchProduct(input),
    ),
});
export type WorkbenchRouter = typeof workbenchRouter;
