import { BusinessError, notFound, type ModuleManifest } from '@caiwu/core';
import { verifyPassword, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import {
  PermissionSchema,
  UserCreateSchema,
  UserUpdateSchema,
  PasswordSchema,
  PasswordResetSchema,
} from '../shared';
import type { z } from 'zod';

const fail = (code: string, message: string, hint: string): never => {
  throw new BusinessError({ code, message, hint });
};

/** 权限 middleware 之外再检查实时管理员身份，不能仅凭被授予的管理权限提权。 */
export async function requireAdmin(svc: CoreServices) {
  const actor = await loadServiceUser(svc.db, svc.user.id);
  if (!actor?.isAdmin)
    fail('FORBIDDEN', '此操作需要当前账套的启用管理员身份', '请切换到管理员后操作');
}
async function target(svc: CoreServices, id: number) {
  const row = await svc.db
    .selectFrom('app_user')
    .select(['id', 'code', 'name', 'is_admin', 'disabled'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('用户', id);
  return row;
}
function confirm(actual: string, expected: string) {
  if (actual !== expected)
    fail('CONFIRM_REQUIRED', '目标用户确认不一致', '请输入该用户的完整编号后重试');
}
async function keepAdmin(
  svc: CoreServices,
  row: { is_admin: number; disabled: number },
  enabledAdmin: boolean,
) {
  if (!row.is_admin || row.disabled || enabledAdmin) return;
  const admins = await svc.db
    .selectFrom('app_user')
    .select('id')
    .where('is_admin', '=', 1)
    .where('disabled', '=', 0)
    .execute();
  if (admins.length <= 1)
    fail('LAST_ADMIN', '不能停用或降权最后一个启用管理员', '请先建立另一个启用管理员');
}
function validatePermissions(permissions: string[], manifests: readonly ModuleManifest[]) {
  const known = new Set(manifests.flatMap((m) => m.permissions.map((p) => p.id)));
  if (permissions.some((p) => !known.has(p)))
    fail(
      'UNKNOWN_PERMISSION',
      '提交包含当前未加载的权限点',
      '重新打开权限树；历史未加载权限由服务端原样保留',
    );
  return known;
}

export function adminService(svc: CoreServices, manifests: readonly ModuleManifest[]) {
  return {
    async list() {
      await requireAdmin(svc);
      return svc.users.list();
    },
    async create(raw: z.input<typeof UserCreateSchema>) {
      const input = UserCreateSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        await requireAdmin(tsvc);
        validatePermissions(input.permissions, manifests);
        const created = await tsvc.users.create(input);
        await tsvc.log.write({
          action: 'system-admin.user.create',
          targetType: 'app_user',
          targetId: created.id,
          summary: `新增用户 ${created.code}；${created.isAdmin ? '管理员' : '普通用户'}`,
        });
        return { id: created.id, code: created.code };
      });
    },
    async update(raw: z.input<typeof UserUpdateSchema>) {
      const input = UserUpdateSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        await requireAdmin(tsvc);
        const row = await target(tsvc, input.id);
        confirm(input.confirmCode, row.code);
        if (input.disabled && row.id === tsvc.user.id)
          fail('SELF_DISABLE', '不能停用自己', '请由另一个管理员操作');
        await keepAdmin(tsvc, row, !!row.is_admin && !input.disabled);
        await tsvc.db
          .updateTable('app_user')
          .set({
            name: input.name,
            disabled: input.disabled ? 1 : 0,
            updated_at: tsvc.ctx.now().toISOString(),
          })
          .where('id', '=', input.id)
          .execute();
        await tsvc.log.write({
          action: 'system-admin.user.update',
          targetType: 'app_user',
          targetId: input.id,
          summary: `修改用户 ${row.code}；${input.disabled ? '已停用，全部旧会话失效' : '启用'}`,
        });
        return { id: input.id };
      });
    },
    async permissions(id: number) {
      await requireAdmin(svc);
      const row = await target(svc, id);
      const permissions = (
        await svc.db
          .selectFrom('user_permission')
          .select('permission')
          .where('user_id', '=', id)
          .execute()
      ).map((p) => p.permission);
      const known = new Set(manifests.flatMap((m) => m.permissions.map((p) => p.id)));
      return {
        isAdmin: !!row.is_admin,
        permissions: permissions.filter((p) => known.has(p)),
        preservedPermissions: permissions.filter((p) => !known.has(p)),
      };
    },
    async setPermissions(raw: z.input<typeof PermissionSchema>) {
      const input = PermissionSchema.parse(raw);
      await svc.tx(async (tsvc) => {
        await requireAdmin(tsvc);
        const row = await target(tsvc, input.id);
        confirm(input.confirmCode, row.code);
        const known = validatePermissions(input.permissions, manifests);
        await keepAdmin(tsvc, row, input.isAdmin && !row.disabled);
        const old = await tsvc.db
          .selectFrom('user_permission')
          .select('permission')
          .where('user_id', '=', input.id)
          .execute();
        const preserved = old.map((p) => p.permission).filter((p) => !known.has(p));
        await tsvc.users.setPermissions(input.id, [...input.permissions, ...preserved]);
        await tsvc.db
          .updateTable('app_user')
          .set({ is_admin: input.isAdmin ? 1 : 0, updated_at: tsvc.ctx.now().toISOString() })
          .where('id', '=', input.id)
          .execute();
        await tsvc.log.write({
          action: 'system-admin.user.permissions',
          targetType: 'app_user',
          targetId: input.id,
          summary: `修改用户 ${row.code} 授权；全部旧会话失效`,
          detail: {
            isAdmin: input.isAdmin,
            granted: [...new Set(input.permissions)].sort(),
            preserved: preserved.length,
          },
        });
      });
    },
    async changePassword(raw: z.input<typeof PasswordSchema>) {
      const input = PasswordSchema.parse(raw);
      await svc.tx(async (tsvc) => {
        const row = await tsvc.db
          .selectFrom('app_user')
          .select(['password_hash', 'disabled'])
          .where('id', '=', tsvc.user.id)
          .executeTakeFirst();
        if (!row || row.disabled || !(await verifyPassword(input.oldPassword, row.password_hash)))
          fail('OLD_PASSWORD_INVALID', '原密码不正确', '重新输入原密码；忘记时联系管理员重置');
        await tsvc.users.setPassword(tsvc.user.id, input.password);
        await tsvc.log.write({
          action: 'system-admin.password.change',
          targetType: 'app_user',
          targetId: tsvc.user.id,
          summary: '修改本人密码；当前账套全部旧会话失效',
        });
      });
    },
    async resetPassword(raw: z.input<typeof PasswordResetSchema>) {
      const input = PasswordResetSchema.parse(raw);
      await svc.tx(async (tsvc) => {
        await requireAdmin(tsvc);
        const row = await target(tsvc, input.id);
        confirm(input.confirmCode, row.code);
        await tsvc.users.setPassword(input.id, input.password);
        await tsvc.log.write({
          action: 'system-admin.password.reset',
          targetType: 'app_user',
          targetId: input.id,
          summary: `重置用户 ${row.code} 密码；当前账套全部旧会话失效`,
        });
      });
    },
  };
}
