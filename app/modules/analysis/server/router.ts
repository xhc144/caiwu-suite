import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { AgingFilterSchema, ConfigInputSchema, ShortcutSchema, TrendFilterSchema } from '../shared';
import { analysisService } from './service';
import { exportAging, exportTrend, exportContracts } from './export';
import {
  ContractFilterSchema,
  ContractInputSchema,
  ContractLinkSchema,
  ContractVersionSchema,
} from '../contracts';
import { contractService } from './contracts';
import {
  CustomFilterSchema,
  DefinitionInputSchema,
  SaveResultSchema,
  ConfirmRemoveSchema,
  AnalysisSheetSchema,
} from '../custom';
import { definitionService, resultService } from './custom';
import { exportAnalysisSheet } from './export';

const m = moduleKit(manifest);
export const analysisRouter = m.router({
  definitions: m.router({
    list: m.procedure
      .meta({ permission: 'analysis.view' })
      .query(({ ctx }) => definitionService(ctx.svc).list()),
    get: m.procedure
      .meta({ permission: 'analysis.view' })
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ ctx, input }) => definitionService(ctx.svc).get(input.id)),
    save: m.procedure
      .meta({ permission: 'analysis.definition.edit' })
      .input(DefinitionInputSchema)
      .mutation(({ ctx, input }) => definitionService(ctx.svc).save(input)),
    remove: m.procedure
      .meta({ permission: 'analysis.definition.edit' })
      .input(ConfirmRemoveSchema)
      .mutation(({ ctx, input }) => definitionService(ctx.svc).remove(input)),
    calculate: m.procedure
      .meta({ permission: 'analysis.view' })
      .input(CustomFilterSchema)
      .query(({ ctx, input }) => definitionService(ctx.svc).calculate(input)),
  }),
  results: m.router({
    list: m.procedure
      .meta({ permission: 'analysis.view' })
      .query(({ ctx }) => resultService(ctx.svc).list()),
    get: m.procedure
      .meta({ permission: 'analysis.view' })
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ ctx, input }) => resultService(ctx.svc).get(input.id)),
    trend: m.procedure
      .meta({ permission: 'analysis.view' })
      .input(TrendFilterSchema)
      .query(({ ctx, input }) => resultService(ctx.svc).trend(input)),
    save: m.procedure
      .meta({ permission: 'analysis.definition.edit' })
      .input(SaveResultSchema)
      .mutation(({ ctx, input }) => resultService(ctx.svc).save(input)),
    remove: m.procedure
      .meta({ permission: 'analysis.definition.edit' })
      .input(ConfirmRemoveSchema)
      .mutation(({ ctx, input }) => resultService(ctx.svc).remove(input)),
    export: m.procedure
      .meta({ permission: 'analysis.export' })
      .input(z.object({ name: z.string().trim().min(1).max(100), sheet: AnalysisSheetSchema }))
      .query(async ({ ctx, input }) => {
        ctx.svc.permissions.require('analysis.view');
        return { base64: await exportAnalysisSheet(input.name, input.sheet) };
      }),
  }),
  contracts: m.router({
    list: m.procedure
      .meta({ permission: 'analysis.contract.view' })
      .query(({ ctx }) => contractService(ctx.svc).list()),
    get: m.procedure
      .meta({ permission: 'analysis.contract.view' })
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ ctx, input }) => contractService(ctx.svc).get(input.id)),
    save: m.procedure
      .meta({ permission: 'analysis.contract.edit' })
      .input(ContractInputSchema)
      .mutation(({ ctx, input }) => contractService(ctx.svc).save(input)),
    review: m.procedure
      .meta({ permission: 'analysis.contract.review' })
      .input(ContractVersionSchema.extend({ reviewed: z.boolean() }))
      .mutation(({ ctx, input }) => contractService(ctx.svc).review(input)),
    remove: m.procedure
      .meta({ permission: 'analysis.contract.edit' })
      .input(ContractVersionSchema.extend({ confirmed: z.boolean() }))
      .mutation(({ ctx, input }) => contractService(ctx.svc).remove(input)),
    candidates: m.procedure
      .meta({ permission: 'analysis.contract.link' })
      .input(z.object({ id: z.number().int().positive(), voucherId: z.number().int().positive() }))
      .query(({ ctx, input }) => contractService(ctx.svc).candidates(input.id, input.voucherId)),
    link: m.procedure
      .meta({ permission: 'analysis.contract.link' })
      .input(ContractLinkSchema)
      .mutation(({ ctx, input }) => contractService(ctx.svc).link(input)),
    unlink: m.procedure
      .meta({ permission: 'analysis.contract.link' })
      .input(
        ContractVersionSchema.extend({
          lineId: z.number().int().positive(),
          confirmed: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) => contractService(ctx.svc).unlink(input)),
    report: m.procedure
      .meta({ permission: 'analysis.contract.view' })
      .input(ContractFilterSchema)
      .query(({ ctx, input }) => contractService(ctx.svc).report(input)),
    export: m.procedure
      .meta({ permission: 'analysis.export' })
      .input(ContractFilterSchema)
      .query(async ({ ctx, input }) => {
        ctx.svc.permissions.require('analysis.contract.view');
        const report = await contractService(ctx.svc).report(input);
        return { report, base64: await exportContracts(report) };
      }),
  }),
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
    .input(z.enum(['aging', 'trend', 'contracts']))
    .query(({ ctx, input }) => {
      ctx.svc.permissions.require(
        input === 'aging'
          ? 'analysis.aging.view'
          : input === 'contracts'
            ? 'analysis.contract.view'
            : 'analysis.view',
      );
      return true;
    }),
});
export type AnalysisRouter = typeof analysisRouter;
