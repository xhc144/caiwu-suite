import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  SettingsSchema,
  TemplateSchema,
  VoucherSelectionSchema,
  LedgerSelectionSchema,
} from '../shared';
import { printService } from './service';
const m = moduleKit(manifest);
export const printRouter = m.router({
  settings: m.procedure
    .meta({ permission: 'print-settings.view' })
    .query(({ ctx }) => printService(ctx.svc).settings()),
  saveSettings: m.procedure
    .meta({ permission: 'print-settings.settings.edit' })
    .input(SettingsSchema)
    .mutation(({ ctx, input }) => printService(ctx.svc).saveSettings(input)),
  vouchers: m.procedure
    .meta({ permission: 'print-settings.voucher.print' })
    .input(VoucherSelectionSchema)
    .query(({ ctx, input }) => printService(ctx.svc).vouchers(input)),
  ledger: m.procedure
    .meta({ permission: 'print-settings.ledger.print' })
    .input(LedgerSelectionSchema)
    .query(({ ctx, input }) => printService(ctx.svc).ledger(input)),
  ledgerBook: m.procedure
    .meta({ permission: 'print-settings.ledger.print' })
    .input(LedgerSelectionSchema)
    .query(({ ctx, input }) => printService(ctx.svc).ledgerBook(input)),
  ledgerBatch: m.procedure
    .meta({ permission: 'print-settings.ledger.print' })
    .input(LedgerSelectionSchema)
    .query(({ ctx, input }) => printService(ctx.svc).ledgerBatch(input)),
  formats: m.procedure
    .meta({ permission: 'print-settings.view' })
    .query(({ ctx }) => printService(ctx.svc).formats()),
  saveFormat: m.procedure
    .meta({ permission: 'print-settings.format.edit' })
    .input(z.object({ data: TemplateSchema, revision: z.number().int().positive().optional() }))
    .mutation(({ ctx, input }) => printService(ctx.svc).saveFormat(input.data, input.revision)),
  copyFormat: m.procedure
    .meta({ permission: 'print-settings.format.edit' })
    .input(
      z.object({
        source: z.number().int().min(0).max(99),
        code: z.number().int().min(0).max(99),
        name: z.string().trim().min(1).max(80),
      }),
    )
    .mutation(({ ctx, input }) =>
      printService(ctx.svc).copyFormat(input.source, input.code, input.name),
    ),
  removeFormat: m.procedure
    .meta({ permission: 'print-settings.format.edit' })
    .input(z.object({ code: z.number().int().min(0).max(99), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => printService(ctx.svc).removeFormat(input.code, input.confirmed)),
  recordOutput: m.procedure
    .meta({ permission: 'print-settings.view' })
    .input(
      z.object({
        kind: z.enum(['voucher', 'ledger', 'format']),
        action: z.enum(['print', 'pdf']),
        pages: z.number().int().min(1).max(100000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ctx.svc.permissions.require(
        input.kind === 'voucher'
          ? 'print-settings.voucher.print'
          : input.kind === 'ledger'
            ? 'print-settings.ledger.print'
            : 'print-settings.view',
      );
      if (input.action === 'pdf') ctx.svc.permissions.require('print-settings.export');
      await ctx.svc.log.write({
        action: `print.${input.action}.requested`,
        summary: `请求${input.kind === 'voucher' ? '凭证' : input.kind === 'ledger' ? '账簿' : '格式'}${input.action === 'pdf' ? ' PDF 导出' : '打印'}，${input.pages} 页`,
      });
    }),
});
export type PrintRouter = typeof printRouter;
