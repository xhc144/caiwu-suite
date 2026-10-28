import { z } from 'zod';
import { zId } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  CloseSchema,
  CloseRangeSchema,
  GenerateSchema,
  PeriodSchema,
  RangeSchema,
  RenumberSchema,
  ReopenSchema,
  RuleSchema,
  TransferSchema,
  YearEndSchema,
  ReverseYearSchema,
  ExchangeSettingsSchema,
  ExchangeDeleteSchema,
  BatchIdSchema,
  BatchStartSchema,
  BatchExecuteSchema,
  BatchDecisionSchema,
} from '../shared';
import * as service from './service';
import * as transfers from './transfers';
import { yearEnd, yearEndPreview } from './year-end';
import { backupReverseYear, reverseYear, reverseYearPlan } from './reverse-year';
import * as exchange from './exchange';
import * as batch from './transfer-batch';
const m = moduleKit(manifest);
export const periodCloseRouter = m.router({
  exchangeSettings: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(PeriodSchema)
    .query(({ ctx, input }) => exchange.exchangeSettings(ctx.svc, input.period)),
  saveExchangeSettings: m.procedure
    .meta({ permission: 'period-close.transfer.edit' })
    .input(ExchangeSettingsSchema)
    .mutation(({ ctx, input }) => exchange.saveExchangeSettings(ctx.svc, input)),
  exchangePreview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(PeriodSchema)
    .query(({ ctx, input }) => exchange.exchangePreview(ctx.svc, input.period)),
  generateExchange: m.procedure
    .meta({ permission: 'period-close.transfer.generate' })
    .input(PeriodSchema.extend({ confirmed: z.boolean(), previewToken: z.string() }))
    .mutation(({ ctx, input }) => exchange.generateExchange(ctx.svc, input)),
  deleteExchangePreview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(PeriodSchema)
    .query(({ ctx, input }) => exchange.deleteExchangePreview(ctx.svc, input.period)),
  deleteExchange: m.procedure
    .meta({ permission: 'period-close.transfer.generate' })
    .input(ExchangeDeleteSchema)
    .mutation(({ ctx, input }) => exchange.deleteExchange(ctx.svc, input)),
  transferBatch: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(PeriodSchema)
    .query(({ ctx, input }) => batch.getTransferBatch(ctx.svc, input.period)),
  startTransferBatch: m.procedure
    .meta({ permission: 'period-close.transfer.generate' })
    .input(BatchStartSchema)
    .mutation(({ ctx, input }) => batch.startTransferBatch(ctx.svc, input)),
  transferBatchPreview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(BatchIdSchema)
    .query(({ ctx, input }) => batch.transferBatchPreview(ctx.svc, input.id)),
  executeTransferBatch: m.procedure
    .meta({ permission: 'period-close.transfer.generate' })
    .input(BatchExecuteSchema)
    .mutation(({ ctx, input }) => batch.executeTransferBatch(ctx.svc, input)),
  decideTransferBatch: m.procedure
    .meta({ permission: 'period-close.transfer.generate' })
    .input(BatchDecisionSchema)
    .mutation(({ ctx, input }) => batch.decideTransferBatch(ctx.svc, input)),
  yearEndPreview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(YearEndSchema.pick({ year: true }))
    .query(({ ctx, input }) => yearEndPreview(ctx.svc, input.year)),
  reverseYearPreview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(YearEndSchema.pick({ year: true }))
    .query(({ ctx, input }) => reverseYearPlan(ctx.svc, input.year, ctx.app.modules.manifests())),
  backupReverseYear: m.procedure
    .meta({ permission: 'period-close.reopen' })
    .input(YearEndSchema.pick({ year: true }))
    .mutation(({ ctx, input }) =>
      backupReverseYear(ctx.svc, ctx.app, ctx.session.bookId, input.year),
    ),
  reverseYear: m.procedure
    .meta({ permission: 'period-close.reopen' })
    .input(ReverseYearSchema)
    .mutation(({ ctx, input }) => reverseYear(ctx.svc, ctx.app, ctx.session.bookId, input)),

  check: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(PeriodSchema)
    .query(({ ctx, input }) => service.checkPeriod(ctx.svc, input.period)),
  rules: m.procedure
    .meta({ permission: 'period-close.view' })
    .query(({ ctx }) => transfers.rules(ctx.svc)),
  saveRule: m.procedure
    .meta({ permission: 'period-close.transfer.edit' })
    .input(
      z.object({ data: RuleSchema, id: zId.optional(), revision: z.number().int().optional() }),
    )
    .mutation(({ ctx, input }) =>
      transfers.saveRule(ctx.svc, input.data, input.id, input.revision),
    ),
  removeRule: m.procedure
    .meta({ permission: 'period-close.transfer.edit' })
    .input(z.object({ id: zId }))
    .mutation(({ ctx, input }) => transfers.removeRule(ctx.svc, input.id)),
  post: m.procedure
    .meta({ permission: 'period-close.post' })
    .input(RangeSchema)
    .mutation(({ ctx, input }) => service.post(ctx.svc, input.from, input.to)),
  unpost: m.procedure
    .meta({ permission: 'period-close.unpost' })
    .input(ReopenSchema)
    .mutation(({ ctx, input }) => service.unpost(ctx.svc, input)),
  preview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(TransferSchema)
    .query(({ ctx, input }) => transfers.transferPreview(ctx.svc, input.period, input.ruleIds)),
  generate: m.procedure
    .meta({ permission: 'period-close.transfer.generate' })
    .input(GenerateSchema)
    .mutation(({ ctx, input }) => transfers.generate(ctx.svc, input)),
  deleteGenerated: m.procedure
    .meta({ permission: 'period-close.transfer.generate' })
    .input(PeriodSchema.extend({ ruleId: zId, confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => transfers.deleteGenerated(ctx.svc, input)),
  close: m.procedure
    .meta({ permission: 'period-close.close' })
    .input(CloseSchema)
    .mutation(({ ctx, input }) => service.closePeriod(ctx.svc, input)),
  closeRangePreview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(RangeSchema)
    .query(({ ctx, input }) => service.closeRangePreview(ctx.svc, input.from, input.to)),
  closeRange: m.procedure
    .meta({ permission: 'period-close.close' })
    .input(CloseRangeSchema)
    .mutation(({ ctx, input }) => service.closeRange(ctx.svc, input)),
  reopen: m.procedure
    .meta({ permission: 'period-close.reopen' })
    .input(ReopenSchema)
    .mutation(({ ctx, input }) => service.reopen(ctx.svc, input)),
  renumberPreview: m.procedure
    .meta({ permission: 'period-close.view' })
    .input(PeriodSchema)
    .query(({ ctx, input }) => service.renumberPreview(ctx.svc, input.period)),
  renumber: m.procedure
    .meta({ permission: 'period-close.close' })
    .input(RenumberSchema)
    .mutation(({ ctx, input }) => service.renumber(ctx.svc, input)),
  yearEnd: m.procedure
    .meta({ permission: 'period-close.year-end' })
    .input(YearEndSchema)
    .mutation(({ ctx, input }) => yearEnd(ctx.svc, input)),
  workflow: m.procedure
    .meta({ permission: 'period-close.post' })
    .input(TransferSchema.extend({ confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => service.workflow(ctx.svc, input)),
});
export type PeriodCloseRouter = typeof periodCloseRouter;
