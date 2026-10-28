import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { BatchIdSchema, CommitSchema, PrepareSchema } from '../shared';
import { legacyImportService } from './service';

const m = moduleKit(manifest);
export const legacyImportRouter = m.router({
  list: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .input(z.object({}).default({}))
    .query(({ ctx }) => legacyImportService(ctx.svc).list()),
  get: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .input(BatchIdSchema)
    .query(({ ctx, input }) => legacyImportService(ctx.svc).get(input.id)),
  template: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .input(z.object({}).default({}))
    .query(({ ctx }) => legacyImportService(ctx.svc).template()),
  prepare: m.procedure
    .meta({ permission: 'legacy-import.prepare' })
    .input(PrepareSchema)
    .mutation(({ ctx, input }) => legacyImportService(ctx.svc).prepare(input)),
  preflight: m.procedure
    .meta({ permission: 'legacy-import.prepare' })
    .input(BatchIdSchema)
    .mutation(({ ctx, input }) => legacyImportService(ctx.svc).preflight(input.id)),
  commit: m.procedure
    .meta({ permission: 'legacy-import.execute' })
    .input(CommitSchema)
    .mutation(({ ctx, input }) =>
      legacyImportService(ctx.svc).commit(input.id, input.revision, input.confirmed),
    ),
  issuesExport: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .input(BatchIdSchema)
    .query(({ ctx, input }) => legacyImportService(ctx.svc).issuesExport(input.id)),
  sourceExport: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .input(BatchIdSchema)
    .query(({ ctx, input }) => legacyImportService(ctx.svc).sourceExport(input.id)),
  originalExport: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .input(BatchIdSchema.extend({ index: z.number().int().min(0).max(19) }))
    .query(({ ctx, input }) => legacyImportService(ctx.svc).originalExport(input.id, input.index)),
});
export type LegacyImportRouter = typeof legacyImportRouter;
