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
} from '../shared';
import { costingService } from './service';
import { generateVoucher, previewVoucher } from './vouchers';
import { readInventory } from './inventory-read';

const m = moduleKit(manifest);
const view = m.procedure.meta({ permission: 'costing.view' });
const worksheet = m.procedure.meta({ permission: 'costing.worksheet' });
const calculation = m.procedure.meta({ permission: 'costing.calculate' });
const voucher = m.procedure.meta({ permission: 'costing.voucher' });

export const costingRouter = m.router({
  voucherDocuments: voucher.query(({ ctx }) =>
    ctx.svc.tx(async (t) => {
      const through = Math.max(...(await t.periods.list()).map((p) => p.period));
      const snapshot = await readInventory(t, through);
      return snapshot.documents
        .map(({ id, number, date, kind, category }) => ({ id, number, date, kind, category }))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }),
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
  batches: view.query(({ ctx }) => costingService(ctx.svc).batches()),
  commit: calculation
    .input(CommitCalculationSchema)
    .mutation(({ ctx, input }) => costingService(ctx.svc).commit(input)),
  cancelCalculation: calculation
    .input(CancelCalculationSchema)
    .mutation(({ ctx, input }) => costingService(ctx.svc).cancelCalculation(input)),
  profit: view.input(ReportSchema).query(({ ctx, input }) => costingService(ctx.svc).profit(input)),
  previewVoucher: voucher
    .input(VoucherPreviewSchema)
    .query(({ ctx, input }) => previewVoucher(ctx.svc, input)),
  generateVoucher: voucher
    .input(VoucherPreviewSchema)
    .mutation(({ ctx, input }) => generateVoucher(ctx.svc, input)),
});
export type CostingRouter = typeof costingRouter;
