import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { FormatChangeSchema, FormatSchema, KindSchema, QuerySchema } from '../shared';
import { ledgersService } from './service';
import { exportReport, printReport } from './output';

const m = moduleKit(manifest);
const OutputSchema = QuerySchema.safeExtend({ columns: FormatSchema.shape.columns });
export const ledgersRouter = m.router({
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
  export: m.procedure
    .meta({ permission: 'ledgers.export' })
    .input(OutputSchema)
    .query(({ ctx, input }) => exportReport(ctx.svc, input)),
  print: m.procedure
    .meta({ permission: 'ledgers.print' })
    .input(OutputSchema)
    .query(({ ctx, input }) => printReport(ctx.svc, input)),
});
export type LedgersRouter = typeof ledgersRouter;
