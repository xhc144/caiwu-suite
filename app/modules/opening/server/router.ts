import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  BatchSchema,
  YearSchema,
  FileSchema,
  ImportSchema,
  RemoveSchema,
  CleanupSchema,
  PrintSchema,
} from '../shared';
import { openingService, trial } from './service';
import { exportExcel, previewExcel, importExcel } from './excel';
import { openingPrint } from './print';
const m = moduleKit(manifest);
export const openingRouter = m.router({
  list: m.procedure
    .meta({ permission: 'opening.view' })
    .input(YearSchema)
    .query(({ ctx, input }) => openingService(ctx.svc).list(input.year)),
  years: m.procedure.meta({ permission: 'opening.view' }).query(async ({ ctx }) => ({
    book: await ctx.svc.book.info(),
    years: await ctx.svc.periods.years(),
  })),
  trial: m.procedure
    .meta({ permission: 'opening.view' })
    .input(YearSchema)
    .query(({ ctx, input }) => trial(ctx.svc, input.year)),
  save: m.procedure
    .meta({ permission: 'opening.edit' })
    .input(BatchSchema)
    .mutation(({ ctx, input }) => openingService(ctx.svc).save(input.year, input.changes)),
  remove: m.procedure
    .meta({ permission: 'opening.edit' })
    .input(RemoveSchema)
    .mutation(({ ctx, input }) => openingService(ctx.svc).remove(input)),
  setLock: m.procedure
    .meta({ permission: 'opening.lock' })
    .input(YearSchema.extend({ locked: z.boolean() }))
    .mutation(({ ctx, input }) => openingService(ctx.svc).setLock(input.year, input.locked)),
  cleanupPreview: m.procedure
    .meta({ permission: 'opening.edit' })
    .input(YearSchema)
    .query(({ ctx, input }) => openingService(ctx.svc).cleanupPreview(input.year)),
  cleanup: m.procedure
    .meta({ permission: 'opening.edit' })
    .input(CleanupSchema)
    .mutation(({ ctx, input }) =>
      openingService(ctx.svc).cleanup(input.year, input.expected, input.confirmation),
    ),
  export: m.procedure
    .meta({ permission: 'opening.view' })
    .input(YearSchema)
    .query(({ ctx, input }) => exportExcel(ctx.svc, input.year)),
  print: m.procedure
    .meta({ permission: 'opening.view' })
    .input(PrintSchema)
    .query(({ ctx, input }) => openingPrint(ctx.svc, input)),
  preview: m.procedure
    .meta({ permission: 'opening.import' })
    .input(FileSchema)
    .mutation(({ ctx, input }) => previewExcel(ctx.svc, input)),
  import: m.procedure
    .meta({ permission: 'opening.import' })
    .input(ImportSchema)
    .mutation(({ ctx, input }) => importExcel(ctx.svc, input)),
});
export type OpeningRouter = typeof openingRouter;
