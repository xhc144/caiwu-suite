import { z } from 'zod';
import { BusinessError, zId } from '@caiwu/core';
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
} from '../shared';
import { adminService, requireAdmin } from './service';
import { listLogs } from './logs';
import { collectAudit, textFile } from './audit';
import { runChecks } from './checks';

const m = moduleKit(manifest);
export const systemAdminRouter = m.router({
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
    preflight: m.procedure.meta({ permission: 'system-admin.reset' }).query(({ ctx }) =>
      ctx.svc.tx(async (tsvc) => {
        await requireAdmin(tsvc);
        const book = await tsvc.book.info();
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
              await tsvc.db
                .selectFrom(table)
                .select(tsvc.db.fn.countAll<number>().as('count'))
                .executeTakeFirstOrThrow()
            ).count,
          );
        return {
          book,
          periods: await tsvc.periods.list(),
          template: ctx.app.templates.list().find((t) => t.id === book.templateId) ?? null,
          counts,
          executable: false as const,
          reason:
            '当前版本缺少账套级独占维护锁及包含完整在线备份的原子重置服务。执行入口禁用，尚未备份或更改数据。',
          impact:
            '重置可能删除全部凭证、期初、科目、辅助档案及报表，并影响已加载模块的业务引用。必须完整备份、校验备份可恢复并两次确认。新建账套请使用账套管理。',
        };
      }),
    ),
    execute: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .input(z.object({ confirmBookName: z.string(), confirmed: z.boolean() }))
      .mutation(async ({ ctx }) => {
        await requireAdmin(ctx.svc);
        throw new BusinessError({
          code: 'RESET_UNAVAILABLE',
          message: '系统初始化执行尚未开放',
          hint: '需要账套级独占维护锁、完整在线备份及原子重置服务；当前没有数据被修改',
        });
      }),
    adjustStartDate: m.procedure
      .meta({ permission: 'system-admin.reset' })
      .mutation(async ({ ctx }) => {
        await requireAdmin(ctx.svc);
        throw new BusinessError({
          code: 'RESET_UNAVAILABLE',
          message: '开账日期调整及自动修复尚未开放',
          hint: '必须先具备备份与安全维护服务，不能绕过审核和过账锁',
        });
      }),
  }),
});
export type SystemAdminRouter = typeof systemAdminRouter;
