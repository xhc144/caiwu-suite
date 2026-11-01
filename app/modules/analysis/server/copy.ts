import { BusinessError } from '@caiwu/core';
import { authenticateUser, createCoreServices, type CoreServices } from '@caiwu/core/server';
import type { AppRuntime } from '@caiwu/server-kit';
import type { z } from 'zod';
import { CopyDefinitionSchema, CopySourceSchema } from '../copy';
import { definitionService } from './custom';

type Source = z.input<typeof CopySourceSchema>;
const inaccessible = () =>
  new BusinessError({
    code: 'ANALYSIS_COPY_SOURCE',
    message: '来源账套无法访问，或操作员没有查看分析表的权限',
    hint: '请确认账套及操作员编号、密码，并请管理员授予财务分析查看权限',
  });

/** 只接受受管账套编号，来源独立认证；不返回账务金额或建立来源登录会话。 */
async function readSource<T>(
  app: AppRuntime,
  raw: Source,
  read: (svc: CoreServices) => Promise<T>,
) {
  const input = CopySourceSchema.parse(raw);
  if (!app.bookStore.exists(input.bookId)) throw inaccessible();
  return app.bookStore.withBook(input.bookId, async (book) => {
    const user = await authenticateUser(book.db, input.userCode, input.password);
    if (!user || (!user.isAdmin && !user.permissions.has('analysis.view'))) throw inaccessible();
    return read(
      createCoreServices({
        db: book.db,
        user,
        moduleId: 'analysis',
        now: app.now,
        modules: app.modules.lookup,
        providers: app.modules.providers,
      }),
    );
  });
}

export function copyService(app: AppRuntime, destination: CoreServices) {
  return {
    async sources(source: Source) {
      destination.permissions.require('analysis.definition.edit');
      destination.permissions.require('analysis.view');
      return readSource(app, source, (svc) => definitionService(svc).list());
    },
    async copy(raw: z.input<typeof CopyDefinitionSchema>) {
      destination.permissions.require('analysis.definition.edit');
      destination.permissions.require('analysis.view');
      const input = CopyDefinitionSchema.parse(raw);
      const source = await readSource(app, input.source, (svc) =>
        svc.tx((t) => definitionService(t).get(input.definitionId)),
      );
      if (source.revision !== input.sourceRevision)
        throw new BusinessError({
          code: 'ANALYSIS_COPY_CHANGED',
          message: '来源分析表已修改，请重新选择',
          hint: '请重新读取来源列表，再复制所需版本',
        });
      // 来源快照读取结束后再写目标；目标科目、公式、唯一编号和日志由同一事务校验。
      return definitionService(destination).save({
        code: input.code,
        name: input.name,
        rows: source.rows,
        expectedRevision: 0,
      });
    },
  };
}
