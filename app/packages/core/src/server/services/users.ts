import { BusinessError } from '../../errors';
import { hashPassword, verifyPassword } from '../password';
import { nowIso, type ServiceContext, type ServiceUser } from '../context';
import type { Kysely } from '@caiwu/db';
import type { CoreDB } from '../schema';

export interface CreateUserInput {
  code: string;
  name: string;
  password: string;
  isAdmin?: boolean;
  permissions?: string[];
}

/** 读取操作员（含权限）。不存在或已停用返回 null。 */
export async function loadServiceUser(
  db: Kysely<CoreDB>,
  userId: number,
): Promise<ServiceUser | null> {
  const u = await db.selectFrom('app_user').selectAll().where('id', '=', userId).executeTakeFirst();
  if (!u || u.disabled) return null;
  const perms = await db
    .selectFrom('user_permission')
    .select('permission')
    .where('user_id', '=', userId)
    .execute();
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    isAdmin: u.is_admin === 1,
    permissions: new Set(perms.map((p) => p.permission)),
  };
}

/** 校验账号密码；成功返回操作员，失败返回 null。 */
export async function authenticateUser(
  db: Kysely<CoreDB>,
  code: string,
  password: string,
): Promise<ServiceUser | null> {
  const u = await db
    .selectFrom('app_user')
    .selectAll()
    .where('code', '=', code.trim())
    .executeTakeFirst();
  if (!u || u.disabled) return null;
  if (!(await verifyPassword(password, u.password_hash))) return null;
  return loadServiceUser(db, u.id);
}

/** 操作员管理的最小实现（新建、授权、改密）。完整的用户与权限界面由系统管理模块提供。 */
export function userService(ctx: ServiceContext) {
  return {
    async list() {
      const rows = await ctx.db.selectFrom('app_user').selectAll().orderBy('code').execute();
      return rows.map((u) => ({
        id: u.id,
        code: u.code,
        name: u.name,
        isAdmin: u.is_admin === 1,
        disabled: u.disabled === 1,
      }));
    },

    async create(input: CreateUserInput) {
      const code = input.code.trim();
      if (!/^[A-Za-z0-9_.-]{1,20}$/.test(code)) {
        throw new BusinessError({
          code: 'USER_CODE_INVALID',
          message: '用户编号只能是 1–20 位字母、数字、下划线',
        });
      }
      const exists = await ctx.db
        .selectFrom('app_user')
        .select('id')
        .where('code', '=', code)
        .executeTakeFirst();
      if (exists)
        throw new BusinessError({ code: 'USER_CODE_EXISTS', message: `用户编号 ${code} 已经存在` });
      const now = nowIso(ctx);
      const { id } = await ctx.db
        .insertInto('app_user')
        .values({
          code,
          name: input.name.trim() || code,
          password_hash: await hashPassword(input.password),
          is_admin: input.isAdmin ? 1 : 0,
          disabled: 0,
          created_at: now,
          updated_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (input.permissions?.length) {
        await ctx.db
          .insertInto('user_permission')
          .values(input.permissions.map((permission) => ({ user_id: id, permission })))
          .execute();
      }
      return (await loadServiceUser(ctx.db, id))!;
    },

    async setPermissions(userId: number, permissions: string[]) {
      await ctx.db.deleteFrom('user_permission').where('user_id', '=', userId).execute();
      if (permissions.length) {
        await ctx.db
          .insertInto('user_permission')
          .values([...new Set(permissions)].map((permission) => ({ user_id: userId, permission })))
          .execute();
      }
    },

    async setPassword(userId: number, password: string) {
      await ctx.db
        .updateTable('app_user')
        .set({ password_hash: await hashPassword(password), updated_at: nowIso(ctx) })
        .where('id', '=', userId)
        .execute();
    },
  };
}
