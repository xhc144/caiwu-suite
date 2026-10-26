import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { LogFilterSchema, type LogFilter } from '../shared';

export const ACTION_NAMES: Record<string, string> = {
  'auth.login': '登录',
  'system-admin.user.create': '新增用户',
  'system-admin.user.update': '修改用户',
  'system-admin.user.permissions': '分配权限',
  'system-admin.password.change': '自改密码',
  'system-admin.password.reset': '重置密码',
  'system-admin.audit.export': '导出通用审计资料',
  'system-admin.logs.export': '导出操作日志',
  'system-admin.session.switch': '切换用户',
};
/** 业务详情仅开放本模块写入的固定字段；不透传其它模块自由 JSON。 */
function detailText(action: string, detail: string | null): string {
  if (!detail) return '';
  try {
    const d = JSON.parse(detail) as Record<string, unknown>;
    if (action === 'system-admin.user.permissions')
      return `管理员：${d.isAdmin === true ? '是' : '否'}；保留未加载权限：${Number(d.preserved) || 0} 项`;
    if (action === 'system-admin.audit.export')
      return `年度：${Number(d.year) || 0}；资料合计：${Number(d.total) || 0} 条`;
  } catch {
    /* 旧日志详情无法解析时不返回原文 */
  }
  return '';
}
export async function listLogs(svc: CoreServices, raw: LogFilter, exportAll = false) {
  const f = LogFilterSchema.parse(raw);
  let q = svc.db
    .selectFrom('operation_log')
    .select([
      'id',
      'at',
      'user_id',
      'user_name',
      'module',
      'action',
      'target_type',
      'target_id',
      'summary',
      'detail',
    ])
    .where('at', '>=', `${f.from}T00:00:00.000Z`)
    .where('at', '<=', `${f.to}T23:59:59.999Z`);
  if (!svc.user.isAdmin) {
    // 委派日志查看权也只允许本人、非系统管理的业务记录，避免敏感管理日志外泄。
    q = q
      .where('user_id', '=', svc.user.id)
      .where('module', '!=', 'system-admin')
      .where('action', 'not like', 'auth.%')
      .where('action', 'not like', 'system-admin.%');
  }
  if (f.userId) q = q.where('user_id', '=', f.userId);
  if (f.module) q = q.where('module', '=', f.module);
  if (f.action) {
    const matches = Object.entries(ACTION_NAMES)
      .filter(([, name]) => name.includes(f.action!))
      .map(([code]) => code);
    q = q.where((eb) =>
      eb.or([
        eb('action', 'like', `%${f.action}%`),
        ...(matches.length ? [eb('action', 'in', matches)] : []),
      ]),
    );
  }
  if (f.target) q = q.where('target_id', '=', f.target);
  const totalRow = await q
    .clearSelect()
    .select(svc.db.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  const total = Number(totalRow.count);
  if (exportAll && total > 10000)
    throw new BusinessError({
      code: 'EXPORT_TOO_LARGE',
      message: '日志超过单次 10000 条上限',
      hint: '缩小日期或用户筛选范围后导出',
    });
  const rows = await q
    .orderBy('id', 'desc')
    .limit(exportAll ? 10000 : f.pageSize)
    .offset(exportAll ? 0 : (f.page - 1) * f.pageSize)
    .execute();
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      at: r.at,
      userId: r.user_id,
      userName: r.user_name ?? '系统',
      module: r.module,
      moduleName:
        r.module === 'core'
          ? '系统'
          : (svc.ctx.modules.manifest(r.module)?.name ?? `未加载模块（${r.module}）`),
      action: r.action,
      actionName: ACTION_NAMES[r.action] ?? `业务操作（${r.action}）`,
      target: r.target_id ?? '',
      summary: r.summary,
      detail: detailText(r.action, r.detail),
      to:
        r.target_type === 'voucher' && /^\d+$/.test(r.target_id ?? '')
          ? `/m/voucher-entry/edit?id=${r.target_id}`
          : r.target_type === 'app_user'
            ? '/m/system-admin/users'
            : null,
    })),
  };
}
