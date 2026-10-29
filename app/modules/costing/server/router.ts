import { z } from 'zod';
import { zId, zPeriod } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  CalculationSchema,
  CommitCalculationSchema,
  CancelCalculationSchema,
  CancelWorksheetSchema,
  ReportSchema,
  SaveWorksheetSchema,
  VoucherPreviewSchema,
  GenerateVoucherSchema,
  DeleteVoucherSchema,
  RegenerateVoucherSchema,
  VoucherTargetSchema,
} from '../shared';
import { costingService } from './service';
import {
  generateVoucher,
  previewVoucher,
  listVoucherDocuments,
  previewVoucherDelete,
  deleteVoucher,
  regenerateVoucher,
  sourceCurrency,
  saveSourceCurrency,
} from './vouchers';
import {
  ProductionSchema,
  SaveProductionSchema,
  CancelProductionSchema,
  ProfitConfigSchema,
  ProfitTransferSchema,
  ProfitTransferDeleteSchema,
  ProductionDraftSchema,
} from '../production-shared';
import {
  SourceCurrencyTargetSchema,
  SaveSourceCurrencySchema,
  BatchVoucherSchema,
  ExecuteBatchVoucherSchema,
} from '../fx-batch-shared';
import { previewVoucherBatch, executeVoucherBatch } from './batch';
import {
  productionContext,
  previewProduction,
  saveProduction,
  previewCancelProduction,
  cancelProduction,
  productionDraft,
  saveProductionDraft,
} from './production';
import {
  profitConfig,
  saveProfitConfig,
  previewProfitTransfer,
  generateProfitTransfer,
  previewDeleteProfitTransfer,
  deleteProfitTransfer,
} from './profit-allocation';

const m = moduleKit(manifest);
const view = m.procedure.meta({ permission: 'costing.view' });
const worksheet = m.procedure.meta({ permission: 'costing.worksheet' });
const calculation = m.procedure.meta({ permission: 'costing.calculate' });
const voucher = m.procedure.meta({ permission: 'costing.voucher' });

export const costingRouter = m.router({
  productionContext: view.query(({ ctx }) => productionContext(ctx.svc)),
  productionDraft: calculation.query(({ ctx }) => productionDraft(ctx.svc)),
  saveProductionDraft: calculation
    .input(ProductionDraftSchema)
    .mutation(({ ctx, input }) => saveProductionDraft(ctx.svc, input)),
  previewProduction: calculation
    .input(ProductionSchema)
    .query(({ ctx, input }) => previewProduction(ctx.svc, input)),
  saveProduction: calculation
    .input(SaveProductionSchema)
    .mutation(({ ctx, input }) => saveProduction(ctx.svc, input)),
  previewCancelProduction: calculation
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => previewCancelProduction(ctx.svc, input.id)),
  cancelProduction: calculation
    .input(CancelProductionSchema)
    .mutation(({ ctx, input }) => cancelProduction(ctx.svc, input)),
  profitConfig: view
    .input(z.object({ period: zPeriod }))
    .query(({ ctx, input }) => profitConfig(ctx.svc, input.period)),
  saveProfitConfig: voucher
    .input(ProfitConfigSchema)
    .mutation(({ ctx, input }) => saveProfitConfig(ctx.svc, input)),
  previewProfitTransfer: voucher
    .input(z.object({ period: zPeriod }))
    .query(({ ctx, input }) => previewProfitTransfer(ctx.svc, input.period)),
  generateProfitTransfer: voucher
    .input(ProfitTransferSchema)
    .mutation(({ ctx, input }) => generateProfitTransfer(ctx.svc, input)),
  previewDeleteProfitTransfer: voucher
    .input(z.object({ period: zPeriod }))
    .query(({ ctx, input }) => previewDeleteProfitTransfer(ctx.svc, input.period)),
  deleteProfitTransfer: voucher
    .input(ProfitTransferDeleteSchema)
    .mutation(({ ctx, input }) => deleteProfitTransfer(ctx.svc, input)),
  sourceCurrency: voucher
    .input(SourceCurrencyTargetSchema)
    .query(({ ctx, input }) => sourceCurrency(ctx.svc, input)),
  saveSourceCurrency: voucher
    .input(SaveSourceCurrencySchema)
    .mutation(({ ctx, input }) => saveSourceCurrency(ctx.svc, input)),
  previewVoucherBatch: voucher
    .input(BatchVoucherSchema)
    .query(({ ctx, input }) => previewVoucherBatch(ctx.svc, input)),
  executeVoucherBatch: voucher
    .input(ExecuteBatchVoucherSchema)
    .mutation(({ ctx, input }) => executeVoucherBatch(ctx.svc, input)),
  voucherDocuments: voucher.query(({ ctx }) => listVoucherDocuments(ctx.svc)),
  context: view.query(({ ctx }) => costingService(ctx.svc).context()),
  preview: view
    .input(CalculationSchema)
    .query(({ ctx, input }) => costingService(ctx.svc).preview(input)),
  worksheets: view.query(({ ctx }) => costingService(ctx.svc).worksheets()),
  worksheet: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => costingService(ctx.svc).worksheet(input.id)),
  saveWorksheet: worksheet
    .input(SaveWorksheetSchema)
    .mutation(({ ctx, input }) => costingService(ctx.svc).saveWorksheet(input)),
  cancelWorksheet: worksheet
    .input(CancelWorksheetSchema)
    .mutation(({ ctx, input }) => costingService(ctx.svc).cancelWorksheet(input)),
  commit: calculation
    .input(CommitCalculationSchema)
    .mutation(({ ctx, input }) => costingService(ctx.svc).commit(input)),
  previewCancelCalculation: calculation.query(({ ctx }) =>
    costingService(ctx.svc).previewCancelCalculation(),
  ),
  cancelCalculation: calculation
    .input(CancelCalculationSchema.optional())
    .mutation(({ ctx, input }) => costingService(ctx.svc).cancelCalculation(input)),
  profit: view.input(ReportSchema).query(({ ctx, input }) => costingService(ctx.svc).profit(input)),
  previewVoucher: voucher
    .input(VoucherPreviewSchema)
    .query(({ ctx, input }) => previewVoucher(ctx.svc, input)),
  generateVoucher: voucher
    .input(GenerateVoucherSchema)
    .mutation(({ ctx, input }) => generateVoucher(ctx.svc, input)),
  previewVoucherDelete: voucher
    .input(VoucherTargetSchema)
    .query(({ ctx, input }) => previewVoucherDelete(ctx.svc, input)),
  deleteVoucher: voucher
    .input(DeleteVoucherSchema)
    .mutation(({ ctx, input }) => deleteVoucher(ctx.svc, input)),
  regenerateVoucher: voucher
    .input(RegenerateVoucherSchema)
    .mutation(({ ctx, input }) => regenerateVoucher(ctx.svc, input)),
});
export type CostingRouter = typeof costingRouter;
