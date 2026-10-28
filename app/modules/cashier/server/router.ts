import { z } from 'zod';
import { zId, zPeriod, zDate } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  CashAccountSchema,
  AutoMatchSchema,
  CheckReceiveSchema,
  CheckIssueSchema,
  DocumentCreateSchema,
  DocumentFilterSchema,
  DocumentSchema,
  EnableSchema,
  GenerateCommitSchema,
  GenerateSchema,
  MatchSchema,
  ReconcileFilterSchema,
} from '../shared';
import { cashierService } from './service';
import { periodService } from './periods';
import { checkService } from './checks';
import { bulkService } from './bulk';
import {
  BulkDeleteSchema,
  BulkDeleteCommitSchema,
  ImportSchema,
  ImportCommitSchema,
} from '../bulk-shared';
import { resetService, ResetSchema } from './reset';
import { resetProtectionFor } from './reset-protection';
import { CashSummarySchema } from '../reports-shared';
import { reportsService } from './reports';
const m = moduleKit(manifest);
export const cashierRouter = m.router({
  summary: m.procedure
    .meta({ permission: 'cashier.view' })
    .input(CashSummarySchema)
    .query(({ ctx, input }) => reportsService(ctx.svc).summary(input)),
  resetPreview: m.procedure
    .meta({ permission: 'cashier.reset' })
    .query(({ ctx }) => resetService(ctx.svc).preview()),
  reset: m.procedure
    .meta({ permission: 'cashier.reset' })
    .input(ResetSchema)
    .mutation(({ ctx, input }) => resetService(ctx.svc, resetProtectionFor(ctx)).reset(input)),
  previewDelete: m.procedure
    .meta({ permission: 'cashier.document.edit' })
    .input(BulkDeleteSchema)
    .mutation(({ ctx, input }) => bulkService(ctx.svc).previewDelete(input)),
  deleteDocuments: m.procedure
    .meta({ permission: 'cashier.document.edit' })
    .input(BulkDeleteCommitSchema)
    .mutation(({ ctx, input }) => bulkService(ctx.svc).deleteDocuments(input)),
  previewImport: m.procedure
    .meta({ permission: 'cashier.document.edit' })
    .input(ImportSchema)
    .mutation(({ ctx, input }) => bulkService(ctx.svc).previewImport(input)),
  importDocuments: m.procedure
    .meta({ permission: 'cashier.document.edit' })
    .input(ImportCommitSchema)
    .mutation(({ ctx, input }) => bulkService(ctx.svc).importDocuments(input)),
  checks: m.procedure
    .meta({ permission: 'cashier.view' })
    .input(
      z
        .object({
          accountId: zId.optional(),
          state: z.enum(['received', 'issued', 'cleared', 'voided']).optional(),
        })
        .default({}),
    )
    .query(({ ctx, input }) => checkService(ctx.svc).list(input)),
  receiveCheck: m.procedure
    .meta({ permission: 'cashier.check.edit' })
    .input(CheckReceiveSchema)
    .mutation(({ ctx, input }) => checkService(ctx.svc).receive(input)),
  issueCheck: m.procedure
    .meta({ permission: 'cashier.check.edit' })
    .input(CheckIssueSchema)
    .mutation(({ ctx, input }) => checkService(ctx.svc).issue(input)),
  finishCheck: m.procedure
    .meta({ permission: 'cashier.check.settle' })
    .input(
      z.object({
        id: zId,
        revision: zId,
        date: zDate,
        state: z.enum(['cleared', 'voided']),
        confirmed: z.literal(true),
      }),
    )
    .mutation(({ ctx, input }) => checkService(ctx.svc).finish(input)),
  periods: m.procedure
    .meta({ permission: 'cashier.view' })
    .query(({ ctx }) => periodService(ctx.svc).preview()),
  closePeriod: m.procedure
    .meta({ permission: 'cashier.period.close' })
    .input(z.object({ period: zPeriod, snapshot: z.string().min(1), confirmed: z.literal(true) }))
    .mutation(({ ctx, input }) => periodService(ctx.svc).close(input)),
  reopenPeriod: m.procedure
    .meta({ permission: 'cashier.period.reopen' })
    .input(z.object({ period: zPeriod, snapshot: z.string().min(1), confirmed: z.literal(true) }))
    .mutation(({ ctx, input }) => periodService(ctx.svc).reopen(input)),
  status: m.procedure
    .meta({ permission: 'cashier.view' })
    .query(({ ctx }) => cashierService(ctx.svc).status()),
  enable: m.procedure
    .meta({ permission: 'cashier.account.edit' })
    .input(EnableSchema)
    .mutation(({ ctx, input }) => cashierService(ctx.svc).enable(input.period)),
  exchangeRate: m.procedure
    .meta({ permission: 'cashier.view' })
    .input(z.object({ currency: z.string().min(1).max(12), period: zPeriod }))
    .query(({ ctx, input }) => ctx.svc.reference.exchangeRate(input.currency, input.period)),
  accounts: m.procedure
    .meta({ permission: 'cashier.view' })
    .input(z.object({ year: z.number().int().min(1900).max(9999).optional() }).default({}))
    .query(({ ctx, input }) => cashierService(ctx.svc).accounts(input.year)),
  saveAccount: m.procedure
    .meta({ permission: 'cashier.account.edit' })
    .input(
      z.object({ data: CashAccountSchema, edit: z.object({ id: zId, revision: zId }).optional() }),
    )
    .mutation(({ ctx, input }) => cashierService(ctx.svc).saveAccount(input.data, input.edit)),
  setDisabled: m.procedure
    .meta({ permission: 'cashier.account.edit' })
    .input(z.object({ id: zId, revision: zId, disabled: z.boolean() }))
    .mutation(({ ctx, input }) =>
      cashierService(ctx.svc).setDisabled(input.id, input.revision, input.disabled),
    ),
  documents: m.procedure
    .meta({ permission: 'cashier.view' })
    .input(DocumentFilterSchema)
    .query(({ ctx, input }) => cashierService(ctx.svc).documents(input)),
  createDocument: m.procedure
    .meta({ permission: 'cashier.document.edit' })
    .input(DocumentCreateSchema)
    .mutation(({ ctx, input }) => cashierService(ctx.svc).createDocument(input)),
  updateDocument: m.procedure
    .meta({ permission: 'cashier.document.edit' })
    .input(z.object({ id: zId, revision: zId, data: DocumentSchema }))
    .mutation(({ ctx, input }) =>
      cashierService(ctx.svc).updateDocument(input.id, input.revision, input.data),
    ),
  removeDocument: m.procedure
    .meta({ permission: 'cashier.document.edit' })
    .input(z.object({ id: zId, revision: zId, confirmed: z.literal(true) }))
    .mutation(({ ctx, input }) => cashierService(ctx.svc).removeDocument(input.id, input.revision)),
  preview: m.procedure
    .meta({ permission: 'cashier.voucher.generate' })
    .input(GenerateSchema)
    .query(({ ctx, input }) => cashierService(ctx.svc).preview(input)),
  generate: m.procedure
    .meta({ permission: 'cashier.voucher.generate' })
    .input(GenerateCommitSchema)
    .mutation(({ ctx, input }) => cashierService(ctx.svc).generate(input)),
  previewRevoke: m.procedure
    .meta({ permission: 'cashier.voucher.generate' })
    .input(z.object({ batchId: zId }))
    .query(({ ctx, input }) => cashierService(ctx.svc).previewRevoke(input.batchId)),
  revoke: m.procedure
    .meta({ permission: 'cashier.voucher.generate' })
    .input(
      z.object({
        batchId: zId,
        confirmed: z.literal(true),
        plan: z
          .object({
            ids: z.array(zId).min(1).max(200),
            expiresAt: z.number().int().safe(),
            fingerprint: z.string().min(1).max(200),
          })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => cashierService(ctx.svc).revoke(input.batchId, input.plan)),
  reconcile: m.procedure
    .meta({ permission: 'cashier.view' })
    .input(ReconcileFilterSchema)
    .query(({ ctx, input }) => cashierService(ctx.svc).reconcile(input)),
  autoMatch: m.procedure
    .meta({ permission: 'cashier.reconcile' })
    .input(AutoMatchSchema)
    .mutation(({ ctx, input }) => cashierService(ctx.svc).autoMatch(input)),
  match: m.procedure
    .meta({ permission: 'cashier.reconcile' })
    .input(MatchSchema)
    .mutation(({ ctx, input }) => cashierService(ctx.svc).match(input)),
  unmatch: m.procedure
    .meta({ permission: 'cashier.reconcile' })
    .input(z.object({ id: zId, confirmed: z.literal(true) }))
    .mutation(({ ctx, input }) => cashierService(ctx.svc).unmatch(input.id)),
});
export type CashierRouter = typeof cashierRouter;
