import { z } from 'zod';
import { zId } from '@caiwu/core';
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
} from './vouchers';

const m = moduleKit(manifest);
const view = m.procedure.meta({ permission: 'costing.view' });
const worksheet = m.procedure.meta({ permission: 'costing.worksheet' });
const calculation = m.procedure.meta({ permission: 'costing.calculate' });
const voucher = m.procedure.meta({ permission: 'costing.voucher' });

export const costingRouter = m.router({
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
