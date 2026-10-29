import { z } from 'zod';
import { BusinessError, zId, zDate } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  AuditSchema,
  LogFilterSchema,
  PasswordResetSchema,
  PasswordSchema,
  PermissionSchema,
  UserCreateSchema,
  UserUpdateSchema,
  ResetPrepareSchema,
  ResetParametersSchema,
  ResetExecuteSchema,
} from '../shared';
import { adminService, requireAdmin } from './service';
import { listLogs } from './logs';
import { collectAudit, textFile } from './audit';
import { runChecks } from './checks';
import { operationDate, setOperationDate } from './operation-date';
import { resetPreflight, prepareReset, executeReset, cancelReset } from './reset';

const m = moduleKit(manifest);
export const systemAdminRouter = m.router({
  operationDate: m.router({
    get: m.procedure
      .meta({ noPermission: true })
      .query(({ ctx }) => operationDate(ctx.svc, ctx.session)),
    set: m.procedure
      .meta({ noPermission: true })
      .input(z.object({ date: zDate }))
      .mutation(({ ctx, input }) => setOperationDate(ctx.svc, ctx.session, input.date)),
  }),
  users: m.router({
    list: m.procedure
      .meta({ permission: 'system-admin.users.manage' })
      .query(({ ctx }) => adminService(ctx.svc, ctx.app.modules.manifests()).list()),
    create: m.procedure
      .meta({ permission: 'system-admin.users.manage' })
      .input(UserCreateSchema)
      .mutation(({ ctx, input }) =>
        adminService(ctx.svc, ctx.app.modules.manifests()).create(input),
      ),
    update: m.procedure
      .meta({ permission: 'system-admin.users.manage' })
      .input(UserUpdateSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await adminService(ctx.svc, ctx.app.modules.manifests()).update(input);
        ctx.app.sessions.deleteForUser(ctx.session.bookId, input.id);
        return result;
      }),
    permissions: m.procedure
      .meta({ permission: 'system-admin.permissions.manage' })
      .input(z.object({ id: zId }))
      .query(({ ctx, input }) =>
        adminService(ctx.svc, ctx.app.modules.manifests()).permissions(input.id),
      ),
    setPermissions: m.procedure
      .meta({ permission: 'system-admin.permissions.manage' })
      .input(PermissionSchema)
      .mutation(async ({ ctx, input }) => {
        await adminService(ctx.svc, ctx.app.modules.manifests()).setPermissions(input);
        ctx.app.sessions.deleteForUser(ctx.session.bookId, input.id);
        return { ok: true };
      }),
    resetPassword: m.procedure
      .meta({ permission: 'system-admin.password.reset' })
      .input(PasswordResetSchema)
      .mutation(async ({ ctx, input }) => {
        await adminService(ctx.svc, ctx.app.modules.manifests()).resetPassword(input);
        ctx.app.sessions.deleteForUser(ctx.session.bookId, input.id);
        return { ok: true };
      }),
  }),
  changePassword: m.procedure
    .meta({ permission: 'system-admin.password' })
    .input(PasswordSchema)
    .mutation(async ({ ctx, input }) => {
      await adminService(ctx.svc, ctx.app.modules.manifests()).changePassword(input);
      ctx.app.sessions.deleteForUser(ctx.session.bookId, ctx.user.id);
      return { ok: true };
    }),
  switchUser: m.procedure
    .meta({ permission: 'system-admin.view' })
    .input(z.object({ confirmed: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      await ctx.svc.log.write({
        action: 'system-admin.session.switch',
        summary: '确认未保存风险后切换用户；当前会话失效',
      });
      ctx.app.sessions.delete(ctx.session.token);
      return { ok: true };
    }),
  logs: m.router({
    list: m.procedure
      .meta({ permission: 'system-admin.logs.view' })
      .input(LogFilterSchema)
      .query(({ ctx, input }) => listLogs(ctx.svc, input)),
    export: m.procedure
      .meta({ permission: 'system-admin.logs.view' })
      .input(LogFilterSchema)
      .mutation(async ({ ctx, input }) => {
        const data = await listLogs(ctx.svc, input, true);
        if (!data.rows.length)
          throw new BusinessError({
            code: 'NO_DATA',
            message: '当前筛选没有日志',
            hint: '调整筛选后重试',
          });
        const file = textFile(`操作日志-${input.from}-${input.to}.json`, {
          范围: input,
          总数: data.total,
          日志: data.rows,
        });
        await ctx.svc.log.write({
          action: 'system-admin.logs.export',
          summary: `导出操作日志 ${data.total} 条`,
        });
        return file;
      }),
  }),
  checks: m.procedure
    .meta({ permission: 'system-admin.check' })
    .query(({ ctx }) => ctx.svc.tx(runChecks)),
  audit: m.router({
    preview: m.procedure
      .meta({ permission: 'system-admin.audit.export' })
      .input(AuditSchema)
      .query(({ ctx, input }) =>
        ctx.svc.tx(async (tsvc) => {
          const { data, digest, total } = await collectAudit(tsvc, input);
          return {
            book: data.book,
            year: data.year,
            counts: data.counts,
            totals: data.totals,
            digest,
            total,
          };
        }),
      ),
    export: m.procedure
      .meta({ permission: 'system-admin.audit.export' })
      .input(AuditSchema.extend({ digest: z.string().length(64) }))
      .mutation(({ ctx, input }) =>
        ctx.svc.tx(async (tsvc) => {
          const result = await collectAudit(tsvc, input);
          if (result.digest !== input.digest)
            throw new BusinessError({
              code: 'PREVIEW_CHANGED',
              message: '资料已变化，请重新预览',
              hint: '核对最新数量后再次导出',
            });
          if (!result.total)
            throw new BusinessError({
              code: 'NO_DATA',
              message: '所选年度与范围没有资料',
              hint: '调整年度或范围后重新预览',
            });
          const file = textFile(`通用审计资料-${input.year}.json`, result.data);
          await tsvc.log.write({
            action: 'system-admin.audit.export',
            summary: `导出 ${input.year} 年通用审计资料，共 ${result.total} 条`,
            detail: { year: input.year, total: result.total },
          });
          return file;
        }),
      ),
  }),
  reset: m.router({
    preflight: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .query(({ ctx }) => ctx.svc.tx((svc) => resetPreflight(svc, ctx.app))),
    saveDraft: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .input(ResetParametersSchema)
      .mutation(({ ctx, input }) =>
        ctx.svc.tx(async (svc) => {
          await requireAdmin(svc);
          await svc.settings.set('resetDraft', input);
          await svc.log.write({
            action: 'system-admin.reset.draft',
            summary: '保存系统初始化参数（未执行初始化）',
          });
          return { ok: true };
        }),
      ),
    prepare: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .input(ResetPrepareSchema)
      .mutation(({ ctx, input }) =>
        prepareReset(ctx.svc, ctx.app, ctx.session, input.parameters, input.password),
      ),
    execute: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .input(ResetExecuteSchema)
      .mutation(async ({ ctx, input }) => {
        await requireAdmin(ctx.svc);
        return executeReset(ctx.app, ctx.session, input);
      }),
    cancel: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .input(z.object({ planId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireAdmin(ctx.svc);
        return cancelReset(ctx.app, ctx.session, input.planId);
      }),
    adjustStartDate: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .mutation(async ({ ctx }) => {
        await requireAdmin(ctx.svc);
        throw new BusinessError({
          code: 'RESET_UNAVAILABLE',
          message: '开账日期调整及自动修复尚未开放',
          hint: '当前支持完整重新初始化；保留已有业务的开账日期迁移尚未实现',
        });
      }),
  }),
});
export type SystemAdminRouter = typeof systemAdminRouter;
