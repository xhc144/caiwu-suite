import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  FormatChangeSchema,
  FormatSchema,
  KindSchema,
  QuerySchema,
  MultiFormatKeySchema,
  MultiFormatChangeSchema,
} from '../shared';
import { PrintOptionsSchema } from '../printing';
import { ledgersService } from './service';
import { exportReport, printReport } from './output';
import { vatRouter } from './vat-router';

const m = moduleKit(manifest);
const OutputSchema = QuerySchema.safeExtend({
  columns: FormatSchema.shape.columns,
  accountCodes: z.array(z.string().trim().min(1).max(40)).max(2000).optional(),
});
export const ledgersRouter = m.router({
  vat: vatRouter,
  report: m.procedure
    .meta({ permission: 'ledgers.view' })
    .input(QuerySchema)
    .query(({ ctx, input }) => ledgersService(ctx.svc).report(input)),
  format: m.procedure
    .meta({ permission: 'ledgers.view' })
    .input(z.object({ kind: KindSchema }))
    .query(({ ctx, input }) => ledgersService(ctx.svc).format(input.kind)),
  saveFormat: m.procedure
    .meta({ permission: 'ledgers.config.edit' })
    .input(FormatChangeSchema)
    .mutation(({ ctx, input }) => ledgersService(ctx.svc).saveFormat(input)),
  restoreFormat: m.procedure
    .meta({ permission: 'ledgers.config.edit' })
    .input(FormatChangeSchema)
    .mutation(({ ctx, input }) => ledgersService(ctx.svc).saveFormat(input, true)),
  multiFormat: m.procedure
    .meta({ permission: 'ledgers.view' })
    .input(MultiFormatKeySchema)
    .query(({ ctx, input }) => ledgersService(ctx.svc).multiFormat(input)),
  saveMultiFormat: m.procedure
    .meta({ permission: 'ledgers.config.edit' })
    .input(MultiFormatChangeSchema)
    .mutation(({ ctx, input }) => ledgersService(ctx.svc).saveMultiFormat(input)),
  export: m.procedure
    .meta({ permission: 'ledgers.export' })
    .input(OutputSchema)
    .query(({ ctx, input }) => exportReport(ctx.svc, input)),
  print: m.procedure
    .meta({ permission: 'ledgers.print' })
    .input(OutputSchema.safeExtend({ printOptions: PrintOptionsSchema.optional() }))
    .query(({ ctx, input }) => printReport(ctx.svc, input)),
});
export type LedgersRouter = typeof ledgersRouter;
