import { z } from 'zod';
import { zId } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  BookFilterSchema,
  PreviewSchema,
  CommitSchema,
  SummarySchema,
  ImportSchema,
} from '../shared';
import { commit, detail, list, preview, summary, tAccount, ledgerLink } from './service';
import { exportFile, importCommit, importPreview } from './transfer';
const m = moduleKit(manifest);
const actionProcedures = {
  audit: m.procedure
    .meta({ permission: 'voucher-book.audit' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'audit' })),
  unaudit: m.procedure
    .meta({ permission: 'voucher-book.unaudit' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'unaudit' })),
  delete: m.procedure
    .meta({ permission: 'voucher-book.delete' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'delete' })),
  void: m.procedure
    .meta({ permission: 'voucher-book.void' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'void' })),
  unvoid: m.procedure
    .meta({ permission: 'voucher-book.void' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'unvoid' })),
  copy: m.procedure
    .meta({ permission: 'voucher-book.copy' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'copy' })),
  reverse: m.procedure
    .meta({ permission: 'voucher-book.reverse' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'reverse' })),
  insert: m.procedure
    .meta({ permission: 'voucher-book.insert' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'insert' })),
  modify: m.procedure
    .meta({ permission: 'voucher-book.modify' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'modify' })),
  renumber: m.procedure
    .meta({ permission: 'voucher-book.renumber' })
    .input(PreviewSchema)
    .mutation(({ ctx, input }) => preview(ctx.svc, { ...input, action: 'renumber' })),
};
export const voucherBookRouter = m.router({
  list: m.procedure
    .meta({ permission: 'voucher-book.view' })
    .input(BookFilterSchema)
    .query(({ ctx, input }) => list(ctx.svc, input)),
  ledgerLink: m.procedure
    .meta({ permission: 'voucher-book.view' })
    .input(z.object({ id: zId, lineId: zId }))
    .query(({ ctx, input }) => ledgerLink(ctx.svc, input.id, input.lineId)),
  detail: m.procedure
    .meta({ permission: 'voucher-book.view' })
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => detail(ctx.svc, input.id)),
  preview: m.router(actionProcedures),
  commit: m.procedure
    .meta({ permission: 'voucher-book.view' })
    .input(CommitSchema)
    .mutation(({ ctx, input }) => commit(ctx.svc, input)),
  summary: m.procedure
    .meta({ permission: 'voucher-book.view' })
    .input(SummarySchema)
    .query(({ ctx, input }) => ctx.svc.tx((t) => summary(t, input))),
  summaryExport: m.procedure
    .meta({ permission: 'voucher-book.export' })
    .input(SummarySchema)
    .query(({ ctx, input }) => ctx.svc.tx((t) => summary(t, input))),
  summaryPrint: m.procedure
    .meta({ permission: 'voucher-book.print' })
    .input(SummarySchema)
    .query(({ ctx, input }) => ctx.svc.tx((t) => summary(t, input))),
  tAccountPrint: m.procedure
    .meta({ permission: 'voucher-book.print' })
    .input(BookFilterSchema)
    .query(({ ctx, input }) => ctx.svc.tx((t) => tAccount(t, input))),
  tAccountExport: m.procedure
    .meta({ permission: 'voucher-book.export' })
    .input(BookFilterSchema)
    .query(({ ctx, input }) => ctx.svc.tx((t) => tAccount(t, input))),
  tAccount: m.procedure
    .meta({ permission: 'voucher-book.view' })
    .input(BookFilterSchema)
    .query(({ ctx, input }) => ctx.svc.tx((t) => tAccount(t, input))),
  export: m.procedure
    .meta({ permission: 'voucher-book.export' })
    .input(z.object({ filter: BookFilterSchema, format: z.enum(['json', 'xlsx']) }))
    .query(({ ctx, input }) => ctx.svc.tx((t) => exportFile(t, input.filter, input.format))),
  importPreview: m.procedure
    .meta({ permission: 'voucher-book.import' })
    .input(ImportSchema)
    .mutation(({ ctx, input }) => importPreview(ctx.svc, input)),
  importCommit: m.procedure
    .meta({ permission: 'voucher-book.import' })
    .input(CommitSchema)
    .mutation(({ ctx, input }) => importCommit(ctx.svc, input)),
});
export type VoucherBookRouter = typeof voucherBookRouter;
