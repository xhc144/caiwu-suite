import { randomUUID } from 'node:crypto';
import { BusinessError } from '@caiwu/core';
import { createCoreServices, loadServiceUser, withServiceScope } from '@caiwu/core/server';
import {
  defineServerModule,
  type AppRuntime,
  type AuthedContext,
  type ServerModule,
} from '@caiwu/server-kit';
import { AutomaticBackupController } from '../../../modules/backup/server/controller';
import { backupService } from '../../../modules/backup/server/service';
import { SettingsSchema } from '../../../modules/backup/shared';

/** A controller belongs to one server instance. Every operation reopens its own scoped lease. */
export function withAutomaticBackup<R extends ServerModule>(
  module: R,
  clock?: ConstructorParameters<typeof AutomaticBackupController>[0],
): R {
  if (module.manifest.id !== 'backup') return module;
  const controller = new AutomaticBackupController(clock);
  const attached = new Set<string>();
  const configurations = new Map<string, string>();
  const attaching = new Map<string, Promise<void>>();
  let exitBackupsCompleted = false;
  const withService = <T>(
    app: AppRuntime,
    id: string,
    fn: (ctx: AuthedContext & { app: AppRuntime }) => Promise<T>,
  ) =>
    withServiceScope(() =>
      app.bookStore.withBook(id, async (book) => {
        const admin = await book.db
          .selectFrom('app_user')
          .select('id')
          .where('disabled', '=', 0)
          .where('is_admin', '=', 1)
          .orderBy('id')
          .executeTakeFirst();
        const user = admin ? await loadServiceUser(book.db, admin.id) : null;
        if (!user)
          throw new BusinessError({
            code: 'BACKUP_ADMIN_MISSING',
            message: '账套没有有效管理员，自动备份未执行',
          });
        const svc = createCoreServices({
          db: book.db,
          user,
          moduleId: 'backup',
          now: app.now,
          modules: app.modules.lookup,
          providers: app.modules.providers,
        });
        return fn({
          app,
          book,
          user,
          svc,
          moduleId: 'backup',
          session: {
            token: '',
            bookId: id,
            userId: user.id,
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
          },
        });
      }),
    );
  const attach = (app: AppRuntime, id: string, startNow = true): Promise<void> => {
    if (attached.has(id)) return Promise.resolve();
    const existing = attaching.get(id);
    if (existing) return existing;
    let initialSettingsRead = true;
    const task = controller
      .attach(id, {
        settings: () => {
          // All real settings and backups were already checked. Avoid a second database read
          // inside the controller's irreversible shutdown cache.
          if (exitBackupsCompleted)
            return Promise.resolve({
              ...SettingsSchema.parse(JSON.parse(configurations.get(id)!)),
              onExit: false,
            });
          return withService(app, id, async (ctx) => {
            const config = await backupService(ctx).settings();
            configurations.set(id, JSON.stringify(config));
            const skipStart = initialSettingsRead && !startNow;
            initialSettingsRead = false;
            return exitBackupsCompleted
              ? { ...config, onExit: false }
              : skipStart
                ? { ...config, onStart: false }
                : config;
          });
        },
        backup: () =>
          withService(app, id, (ctx) =>
            backupService(ctx).create(
              {
                requestId: randomUUID(),
                name: `自动备份 ${app.now().toISOString().slice(0, 19).replaceAll(':', '-')}`,
              },
              'automatic',
              true,
            ),
          ),
      })
      .then(() => {
        attached.add(id);
      })
      .finally(() => {
        attaching.delete(id);
      });
    attaching.set(id, task);
    return task;
  };
  const discover = async (app: AppRuntime) => {
    for (const book of await app.bookStore.list()) {
      await attach(app, book.id);
      const config = await withService(app, book.id, (ctx) => backupService(ctx).settings());
      if (configurations.get(book.id) !== JSON.stringify(config))
        await controller.reconfigure(book.id);
    }
  };
  return defineServerModule(module.manifest, {
    ...module,
    lifecycle: {
      ...module.lifecycle,
      start: async (ctx) => {
        await module.lifecycle?.start?.(ctx);
        await discover(ctx.app);
      },
      bookCreated: async (ctx) => {
        await attach(ctx.app, ctx.bookId, false);
      },
      afterRequest: async (ctx) => {
        if (ctx.procedure?.endsWith('saveSettings')) await discover(ctx.app);
      },
      stop: async (ctx) => {
        await Promise.all(attaching.values());
        // Do not call the module controller's sticky shutdown until all real exit backups succeeded.
        // A failed attempt can legally retry run() on this same live controller.
        for (const id of attached) {
          const config = await withService(ctx.app, id, (c) => backupService(c).settings());
          if (config.enabled && config.onExit) {
            if (controller.status(id).running) await controller.run(id);
            await controller.run(id);
            const failure = controller.status(id).lastFailure;
            if (failure)
              throw new BusinessError({
                code: 'AUTOMATIC_BACKUP_FAILED',
                message: `账套 ${id} 退出备份失败：${failure}`,
                hint: '原账套仍保留，请修正后重新正常退出',
              });
          }
        }
        await module.lifecycle?.stop?.(ctx);
        exitBackupsCompleted = true;
        const failures = await controller.shutdown();
        if (failures.length)
          throw new BusinessError({
            code: 'AUTOMATIC_BACKUP_FAILED',
            message: failures.map((f) => f.reason).join('；'),
          });
      },
    },
  }) as R;
}
