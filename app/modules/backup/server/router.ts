import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  ConfirmSchema,
  CreateSchema,
  DeleteSchema,
  IdSchema,
  NameSchema,
  SettingsSchema,
  UploadSchema,
} from '../shared';
import { backupService } from './service';
import { automaticStatus, reconfigureAutomaticBackups } from './automatic';

const m = moduleKit(manifest);
const id = z.object({ id: IdSchema });
export const backupRouter = m.router({
  overview: m.procedure.meta({ permission: 'backup.view' }).query(async ({ ctx }) => ({
    ...(await backupService(ctx).overview()),
    ...automaticStatus(ctx.app, ctx.book.id),
  })),
  list: m.procedure
    .meta({ permission: 'backup.view' })
    .query(({ ctx }) => backupService(ctx).list()),
  create: m.procedure
    .meta({ permission: 'backup.create' })
    .input(CreateSchema)
    .mutation(({ ctx, input }) => backupService(ctx).create(input)),
  cancel: m.procedure
    .meta({ permission: 'backup.create' })
    .input(id)
    .mutation(({ ctx, input }) => backupService(ctx).cancel(input.id)),
  verify: m.procedure
    .meta({ permission: 'backup.verify' })
    .input(id)
    .mutation(({ ctx, input }) => backupService(ctx).verify(input.id)),
  download: m.procedure
    .meta({ permission: 'backup.export' })
    .input(id)
    .mutation(({ ctx, input }) => backupService(ctx).download(input.id)),
  upload: m.procedure
    .meta({ permission: 'backup.verify' })
    .input(UploadSchema)
    .mutation(({ ctx, input }) => backupService(ctx).upload(input)),
  saveSettings: m.procedure
    .meta({ permission: 'backup.settings' })
    .input(SettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const config = await backupService(ctx).saveSettings(input);
      await reconfigureAutomaticBackups(ctx.app, ctx.book.id);
      return config;
    }),
  prune: m.procedure
    .meta({ permission: 'backup.prune' })
    .input(DeleteSchema)
    .mutation(({ ctx, input }) => backupService(ctx).prune(input)),
  preview: m.procedure
    .meta({ permission: 'backup.restore' })
    .input(
      z.object({
        id: IdSchema,
        purpose: z.enum(['copy', 'overwrite']),
        name: NameSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => backupService(ctx).preview(input.id, input.purpose, input.name)),
  cancelPlan: m.procedure
    .meta({ permission: 'backup.restore' })
    .input(id)
    .mutation(({ ctx, input }) => backupService(ctx).cancelPlan(input.id)),
  prepareOverwrite: m.procedure
    .meta({ permission: 'backup.restore' })
    .input(z.object({ planId: IdSchema }))
    .mutation(({ ctx, input }) => backupService(ctx).prepareOverwrite(input.planId)),
  restore: m.procedure
    .meta({ permission: 'backup.restore' })
    .input(ConfirmSchema)
    .mutation(({ ctx, input }) => backupService(ctx).restore(input)),
});
export type BackupRouter = typeof backupRouter;
