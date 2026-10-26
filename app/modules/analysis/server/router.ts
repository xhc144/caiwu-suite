import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { AgingFilterSchema, ConfigInputSchema, ShortcutSchema, TrendFilterSchema } from '../shared';
import { analysisService } from './service';
import { exportAging, exportTrend } from './export';

const m = moduleKit(manifest);
export const analysisRouter = m.router({
  config: m.procedure
    .meta({ permission: 'analysis.aging.view' })
    .query(({ ctx }) => analysisService(ctx.svc).config()),
  saveConfig: m.procedure
    .meta({ permission: 'analysis.definition.edit' })
    .input(ConfigInputSchema)
    .mutation(({ ctx, input }) => analysisService(ctx.svc).saveConfig(input)),
  shortcuts: m.procedure
    .meta({ permission: 'analysis.view' })
    .query(({ ctx }) => analysisService(ctx.svc).shortcuts()),
  saveShortcut: m.procedure
    .meta({ permission: 'analysis.definition.edit' })
    .input(
      z.object({
        kind: ShortcutSchema,
        accountCode: z.string().trim().min(1).max(40),
        expectedRevision: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) => analysisService(ctx.svc).saveShortcut(input)),
  aging: m.procedure
    .meta({ permission: 'analysis.aging.view' })
    .input(AgingFilterSchema)
    .query(({ ctx, input }) => analysisService(ctx.svc).aging(input)),
  trend: m.procedure
    .meta({ permission: 'analysis.view' })
    .input(TrendFilterSchema)
    .query(({ ctx, input }) => analysisService(ctx.svc).trend(input)),
  exportAging: m.procedure
    .meta({ permission: 'analysis.export' })
    .input(AgingFilterSchema)
    .query(async ({ ctx, input }) => {
      ctx.svc.permissions.require('analysis.aging.view');
      const report = await analysisService(ctx.svc).aging(input);
      return { report, base64: await exportAging(report) };
    }),
  exportTrend: m.procedure
    .meta({ permission: 'analysis.export' })
    .input(TrendFilterSchema)
    .query(async ({ ctx, input }) => {
      ctx.svc.permissions.require('analysis.view');
      const report = await analysisService(ctx.svc).trend(input);
      return { report, base64: await exportTrend(report) };
    }),
  printAllowed: m.procedure
    .meta({ permission: 'analysis.export' })
    .input(z.enum(['aging', 'trend']))
    .query(({ ctx, input }) => {
      ctx.svc.permissions.require(input === 'aging' ? 'analysis.aging.view' : 'analysis.view');
      return true;
    }),
});
export type AnalysisRouter = typeof analysisRouter;
