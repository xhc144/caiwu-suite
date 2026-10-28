import { z } from 'zod';
import { BusinessError, zId, zPeriod } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  DirectionSchema,
  FileSchema,
  FilterSchema,
  InvoiceSchema,
  PlanSchema,
  SelectionSchema,
  SettingsSchema,
  VatSchema,
  SummarySchema,
  ProcessDraftSchema,
  IssueOptionsSchema,
  IssueSaveSchema,
  IssueDraftSchema,
  RevokeTargetSchema,
  RevokeSchema,
} from '../shared';
import { invoiceService } from './service';
import { invoiceIssueService } from './issue-service';
const m = moduleKit(manifest);
const procedure = m.procedure.use(async ({ ctx, next }) => {
  const book = await ctx.svc.book.info();
  if (book.product !== 'qingsong' && book.product !== 'chengben')
    throw new BusinessError({
      code: 'INVOICE_PRODUCT',
      message: '此产品形态未开放发票模块',
      hint: '请切换到轻松会计或成本会计账套',
      actions: [{ label: '选择账套', to: '/' }],
    });
  return next();
});
const periodInput = z.object({
  period: zPeriod,
  expectedRevision: z.number().int().min(0),
  confirmed: z.boolean(),
});
export const invoiceRouter = m.router({
  issueReferences: procedure
    .meta({ permission: 'invoice.issue' })
    .input(z.object({ invoiceId: zId.optional() }).optional().default({}))
    .query(({ ctx, input }) => invoiceIssueService(ctx.svc).references(input)),
  issueDetails: procedure
    .meta({ permission: 'invoice.issue' })
    .input(z.object({ invoiceId: zId, invoiceRevision: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      invoiceIssueService(ctx.svc).details(input.invoiceId, input.invoiceRevision),
    ),
  previewIssue: procedure
    .meta({ permission: 'invoice.issue' })
    .input(IssueOptionsSchema)
    .mutation(({ ctx, input }) => invoiceIssueService(ctx.svc).preview(input)),
  saveIssue: procedure
    .meta({ permission: 'invoice.issue' })
    .input(IssueSaveSchema)
    .mutation(({ ctx, input }) => invoiceIssueService(ctx.svc).save(input)),
  issueSources: procedure
    .meta({ permission: 'invoice.view' })
    .query(({ ctx }) => invoiceIssueService(ctx.svc).list()),
  issueDraft: procedure
    .meta({ permission: 'invoice.issue' })
    .query(async ({ ctx }) =>
      IssueDraftSchema.nullable().parse(
        await ctx.svc.settings.get(`issueDraft.${ctx.svc.user.id}`, null),
      ),
    ),
  saveIssueDraft: procedure
    .meta({ permission: 'invoice.issue' })
    .input(IssueDraftSchema.nullable())
    .mutation(({ ctx, input }) => ctx.svc.settings.set(`issueDraft.${ctx.svc.user.id}`, input)),
  list: procedure
    .meta({ permission: 'invoice.view' })
    .input(FilterSchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).list(input)),
  save: procedure
    .meta({ permission: 'invoice.edit' })
    .input(
      z.object({
        id: zId.optional(),
        revision: z.number().int().positive().optional(),
        data: InvoiceSchema,
      }),
    )
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).save(input)),
  previewImport: procedure
    .meta({ permission: 'invoice.import' })
    .input(FileSchema)
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).previewImport(input)),
  commitImport: procedure
    .meta({ permission: 'invoice.import' })
    .input(FileSchema)
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).commitImport(input)),
  audit: procedure
    .meta({ permission: 'invoice.audit' })
    .input(z.object({ selection: SelectionSchema, to: z.enum(['audited', 'draft']) }))
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).audit(input.selection, input.to)),
  remove: procedure
    .meta({ permission: 'invoice.edit' })
    .input(z.object({ id: zId, revision: z.number().int().positive(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).remove(input)),
  previewDelete: procedure
    .meta({ permission: 'invoice.edit' })
    .input(FilterSchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).previewDelete(input)),
  deleteBatch: procedure
    .meta({ permission: 'invoice.edit' })
    .input(
      z.object({
        filter: FilterSchema,
        fingerprint: z.string().length(64),
        confirmed: z.boolean(),
        secondConfirmed: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).deleteBatch(input)),
  summary: procedure
    .meta({ permission: 'invoice.view' })
    .input(SummarySchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).summary(input)),
  exportSummary: procedure
    .meta({ permission: 'invoice.export' })
    .input(SummarySchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).summary(input)),
  settings: procedure
    .meta({ permission: 'invoice.settings' })
    .input(z.object({ direction: DirectionSchema }))
    .query(({ ctx, input }) => invoiceService(ctx.svc).settings(input.direction)),
  saveSettings: procedure
    .meta({ permission: 'invoice.settings' })
    .input(SettingsSchema)
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).saveSettings(input)),
  previewVoucher: procedure
    .meta({ permission: 'invoice.voucher' })
    .input(PlanSchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).previewVoucher(input)),
  voucherFields: procedure
    .meta({ permission: 'invoice.voucher' })
    .input(SelectionSchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).voucherFields(input)),
  processDraft: procedure
    .meta({ permission: 'invoice.voucher' })
    .query(async ({ ctx }) =>
      ProcessDraftSchema.nullable().parse(
        await ctx.svc.settings.get(`processDraft.${ctx.svc.user.id}`, null),
      ),
    ),
  saveProcessDraft: procedure
    .meta({ permission: 'invoice.voucher' })
    .input(ProcessDraftSchema.nullable())
    .mutation(({ ctx, input }) => ctx.svc.settings.set(`processDraft.${ctx.svc.user.id}`, input)),
  generate: procedure
    .meta({ permission: 'invoice.voucher' })
    .input(
      PlanSchema.extend({
        fingerprint: z.string().length(64),
        requestId: z.uuid(),
        newAccountsConfirmed: z.boolean().default(false),
        regenerateConfirmed: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).generate(input)),
  groups: procedure
    .meta({ permission: 'invoice.view' })
    .input(z.object({ id: zId.optional() }))
    .query(({ ctx, input }) => invoiceService(ctx.svc).groups(input.id)),
  previewRevoke: procedure
    .meta({ permission: 'invoice.voucher' })
    .input(RevokeTargetSchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).previewRevoke(input)),
  revoke: procedure
    .meta({ permission: 'invoice.voucher' })
    .input(RevokeSchema)
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).revoke(input)),
  vat: procedure
    .meta({ permission: 'invoice.view' })
    .input(VatSchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).vat(input)),
  periods: procedure
    .meta({ permission: 'invoice.view' })
    .query(({ ctx }) => invoiceService(ctx.svc).periods()),
  close: procedure
    .meta({ permission: 'invoice.close' })
    .input(periodInput)
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).setPeriod({ ...input, closed: true })),
  reopen: procedure
    .meta({ permission: 'invoice.reopen' })
    .input(periodInput)
    .mutation(({ ctx, input }) => invoiceService(ctx.svc).setPeriod({ ...input, closed: false })),
  export: procedure
    .meta({ permission: 'invoice.export' })
    .input(FilterSchema)
    .query(({ ctx, input }) => invoiceService(ctx.svc).list(input)),
});
export type InvoiceRouter = typeof invoiceRouter;
