import { randomUUID } from 'node:crypto';
import { BusinessError } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { defineServerModule, type AppRuntime, type ServerModule } from '@caiwu/server-kit';
import {
  registerCashierResetProtection,
  type RuntimeResetProtection,
} from '../../../modules/cashier/server';
import { backupService } from '../../../modules/backup/server/service';

function reject(code: string, message: string): never {
  throw new BusinessError({
    code: `CASHIER_PROTECTION_${code}`,
    message,
    hint: '出纳数据尚未清空，请重新登录当前账套，核对备份功能后重新预览',
  });
}

/** 只桥接可信登录上下文；完整快照、文件发布和校验仍由备份模块负责。 */
export function cashierResetProtection(app: AppRuntime): RuntimeResetProtection {
  return async (input, context) => {
    const authorize = async () => {
      const session = app.sessions.get(context.session.token);
      if (
        context.app !== app ||
        context.moduleId !== 'cashier' ||
        context.svc.moduleId !== 'cashier' ||
        input.moduleId !== 'cashier' ||
        input.reason !== 'cashier.reset' ||
        input.bookId !== context.book.id ||
        input.bookId !== context.session.bookId ||
        input.userId !== context.user.id ||
        input.userId !== context.svc.user.id ||
        input.userId !== context.session.userId ||
        session?.bookId !== context.book.id ||
        session.userId !== context.user.id ||
        context.svc.db !== context.book.db ||
        context.svc.db.isTransaction
      )
        reject('CONTEXT', '保护备份与当前登录账套或操作员不一致');
      const user = await loadServiceUser(context.book.db, context.user.id);
      if (!user?.isAdmin) reject('ADMIN', '保护备份须由当前账套的有效管理员办理');
      const svc = createCoreServices({
        db: context.book.db,
        user,
        moduleId: 'backup',
        now: app.now,
        modules: app.modules.lookup,
        providers: app.modules.providers,
      });
      svc.permissions.require('cashier.reset');
      svc.permissions.require('backup.create');
      const book = await svc.book.info();
      if (book.id !== context.book.id) reject('BOOK', '当前文件的账套身份已变化');
      return { svc, user, book };
    };
    if (!app.modules.lookup.manifest('backup'))
      reject('UNAVAILABLE', '当前服务未启用完整账套备份功能');
    const { svc, user, book } = await authorize();
    const service = backupService({ ...context, app, svc, user, moduleId: 'backup' });
    // 每次实际尝试创建新快照。失败后重试不能复用早于新业务的保护副本，
    // 前端的请求编号也不能碰撞或认领手工备份。成功重放由出纳的事务收据处理。
    const backup = await service.create(
      { requestId: randomUUID(), name: `出纳初始化保护 ${input.requestKey.slice(0, 8)}` },
      'pre-restore',
      true,
    );
    if (
      backup.owner_id !== book.id ||
      backup.kind !== 'pre-restore' ||
      backup.status !== 'valid' ||
      !backup.digest ||
      !/^[a-f0-9]{64}$/.test(backup.digest)
    )
      reject('INCOMPLETE', '完整保护备份未完成或摘要无效');
    // 重新打开受管包，检查包摘要、快照摘要、账套身份、迁移及 SQLite 完整性。
    const metadata = await service.verify(backup.id);
    if (metadata.book.id !== book.id || metadata.type !== 'pre-restore')
      reject('IDENTITY', '保护备份中的账套与当前账套不一致');
    const current = await authorize();
    await current.svc.log.write({
      action: 'cashier.reset.protection',
      summary: '出纳重新初始化前的完整保护备份已校验',
      targetType: 'backup_item',
      targetId: backup.id,
      detail: { requestKey: input.requestKey, bookId: book.id, sha256: backup.digest },
    });
    return { id: backup.id, status: 'valid', sha256: backup.digest };
  };
}

export function withCashierResetProtection<R extends ServerModule>(module: R): R {
  if (module.manifest.id !== 'cashier') return module;
  return defineServerModule(module.manifest, {
    ...module,
    lifecycle: {
      ...module.lifecycle,
      start: async (context) => {
        await module.lifecycle?.start?.(context);
        registerCashierResetProtection(context.app, cashierResetProtection(context.app));
      },
    },
  }) as R;
}
