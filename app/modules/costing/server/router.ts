import { z } from 'zod';
import { zId } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  CalculationSchema,
  CancelWorksheetSchema,
  ReportSchema,
  SaveWorksheetSchema,
  VoucherPreviewSchema,
} from '../shared';
import { costingService } from './service';
import { generateVoucher, previewVoucher } from './vouchers';
import { inventoryReader } from './inventory-read';

const m = moduleKit(manifest);
const view = m.procedure.meta({ permission: 'costing.view' });
const worksheet = m.procedure.meta({ permission: 'costing.worksheet' });
const calculation = m.procedure.meta({ permission: 'costing.calculate' });
const voucher = m.procedure.meta({ permission: 'costing.voucher' });

export const costingRouter = m.router({
  voucherDocuments: voucher.query(async ({ ctx }) =>
    (await inventoryReader(ctx.svc))
      .selectFrom('inventory_document')
      .select(['id', 'number', 'date', 'kind', 'category'])
      .orderBy('date', 'desc')
      .orderBy('id', 'desc')
      .execute(),
  ),
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
    .input(CalculationSchema)
    .mutation(({ ctx, input }) => costingService(ctx.svc).commit(input)),
  cancelCalculation: calculation.mutation(({ ctx }) => costingService(ctx.svc).cancelCalculation()),
  profit: view.input(ReportSchema).query(({ ctx, input }) => costingService(ctx.svc).profit(input)),
  previewVoucher: voucher
    .input(VoucherPreviewSchema)
    .query(({ ctx, input }) => previewVoucher(ctx.svc, input)),
  generateVoucher: voucher
    .input(VoucherPreviewSchema)
    .mutation(({ ctx, input }) => generateVoucher(ctx.svc, input)),
});
export type CostingRouter = typeof costingRouter;
