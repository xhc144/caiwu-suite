import { z } from 'zod';
import { BusinessError, zCents, zDate, zId, zPeriod } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  BatchSchema,
  CardFilter,
  CardSchema,
  DepreciationConfirm,
  ImportRowSchema,
  MasterSchema,
  MonthSchema,
  QuerySchema,
  ReportSchema,
  SettingsSchema,
  quantitySchema,
} from '../shared';
import { assetService } from './service';
import { operations } from './operations';
const m = moduleKit(manifest);
const p = m.procedure.use(async ({ ctx, next }) => {
  if ((await ctx.svc.book.info()).product === 'qingsong')
    throw new BusinessError({
      code: 'FIXED_ASSETS_PRODUCT',
      message: '当前账套产品不包含固定资产模块',
      hint: '请在民非企或成本会计账套使用固定资产',
    });
  return next();
});
const view = p.meta({ permission: 'fixed-assets.view' });
const edit = p.meta({ permission: 'fixed-assets.edit' });
const id = z.object({ id: zId });
const confirmed = id.extend({ confirm: z.boolean() });
export const fixedAssetsRouter = m.router({
  masters: view.query(({ ctx }) => assetService(ctx.svc).masters()),
  saveMaster: edit
    .input(z.object({ id: zId.optional(), data: MasterSchema }))
    .mutation(({ ctx, input }) => assetService(ctx.svc).saveMaster(input.data, input.id)),
  removeMaster: edit
    .input(confirmed)
    .mutation(({ ctx, input }) => assetService(ctx.svc).removeMaster(input.id, input.confirm)),
  createDepartment: edit
    .input(z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1) }))
    .mutation(({ ctx, input }) => assetService(ctx.svc).createDepartment(input.code, input.name)),
  list: view.input(CardFilter).query(({ ctx, input }) => assetService(ctx.svc).list(input)),
  detail: view.input(id).query(({ ctx, input }) => assetService(ctx.svc).detail(input.id)),
  save: edit
    .input(
      z.object({
        id: zId.optional(),
        revision: z.number().int().positive().optional(),
        data: CardSchema,
      }),
    )
    .mutation(({ ctx, input }) => assetService(ctx.svc).save(input.data, input.id, input.revision)),
  remove: edit
    .input(confirmed)
    .mutation(({ ctx, input }) => assetService(ctx.svc).remove(input.id, input.confirm)),
  setWork: p
    .meta({ permission: 'fixed-assets.depreciate' })
    .input(z.object({ id: zId, period: zPeriod, quantity: quantitySchema }))
    .mutation(({ ctx, input }) =>
      assetService(ctx.svc).setWork(input.id, input.period, input.quantity),
    ),
  preview: view
    .input(MonthSchema)
    .query(({ ctx, input }) => assetService(ctx.svc).preview(input.period)),
  depreciate: p
    .meta({ permission: 'fixed-assets.depreciate' })
    .input(DepreciationConfirm)
    .mutation(({ ctx, input }) => assetService(ctx.svc).depreciate(input)),
  batches: view.query(({ ctx }) => assetService(ctx.svc).batches()),
  cancelPreview: view
    .input(id)
    .query(({ ctx, input }) => assetService(ctx.svc).cancelPreview(input.id)),
  cancel: p
    .meta({ permission: 'fixed-assets.cancel' })
    .input(confirmed)
    .mutation(({ ctx, input }) => assetService(ctx.svc).cancel(input.id, input.confirm)),
  getSettings: p
    .meta({ permission: 'fixed-assets.settings' })
    .query(({ ctx }) => assetService(ctx.svc).getSettings()),
  saveSettings: p
    .meta({ permission: 'fixed-assets.settings' })
    .input(SettingsSchema)
    .mutation(({ ctx, input }) => assetService(ctx.svc).saveSettings(input)),
  voucherPreview: p
    .meta({ permission: 'fixed-assets.voucher' })
    .input(id.extend({ date: zDate.optional() }))
    .query(({ ctx, input }) => assetService(ctx.svc).voucherPreview(input.id, input.date)),
  generateVoucher: p
    .meta({ permission: 'fixed-assets.voucher' })
    .input(id.extend({ token: z.string(), date: zDate.optional() }))
    .mutation(({ ctx, input }) =>
      assetService(ctx.svc).generateVoucher(input.id, input.token, input.date),
    ),
  deleteVoucher: p
    .meta({ permission: 'fixed-assets.voucher' })
    .input(confirmed)
    .mutation(({ ctx, input }) => assetService(ctx.svc).deleteVoucher(input.id, input.confirm)),
  adjust: edit
    .input(
      id.extend({
        date: zDate,
        value: zCents,
        note: z.string().trim().min(1).max(500),
        expectedOriginal: zCents,
        expectedChain: zCents,
        confirmMismatch: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => operations(ctx.svc).adjust(input)),
  removeAdjustment: edit
    .input(confirmed)
    .mutation(({ ctx, input }) => operations(ctx.svc).removeAdjustment(input.id, input.confirm)),
  disposalPreview: view
    .input(id.extend({ date: zDate, reasonId: zId, generate: z.boolean() }))
    .query(({ ctx, input }) =>
      operations(ctx.svc).disposalPreview(input.id, input.date, input.reasonId, input.generate),
    ),
  dispose: edit
    .input(
      id.extend({
        date: zDate,
        reasonId: zId,
        generate: z.boolean(),
        confirm: z.boolean(),
        token: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => operations(ctx.svc).dispose(input)),
  undoDisposal: edit
    .input(confirmed)
    .mutation(({ ctx, input }) => operations(ctx.svc).undoDisposal(input.id, input.confirm)),
  query: view.input(QuerySchema).query(({ ctx, input }) => operations(ctx.svc).query(input)),
  reports: view.input(ReportSchema).query(({ ctx, input }) => operations(ctx.svc).reports(input)),
  exportOpening: view.query(({ ctx }) => operations(ctx.svc).exportOpening()),
  importPreview: p
    .meta({ permission: 'fixed-assets.import' })
    .input(z.object({ rows: z.array(ImportRowSchema).min(1).max(5000) }))
    .mutation(({ ctx, input }) => operations(ctx.svc).importPreview(input.rows)),
  importConfirm: p
    .meta({ permission: 'fixed-assets.import' })
    .input(
      z.object({
        rows: z.array(ImportRowSchema).min(1).max(5000),
        token: z.string(),
        confirm: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      operations(ctx.svc).importConfirm(input.rows, input.token, input.confirm),
    ),
  enable: p
    .meta({ permission: 'fixed-assets.import' })
    .mutation(({ ctx }) => operations(ctx.svc).enable()),
  reset: p
    .meta({ permission: 'fixed-assets.settings' })
    .mutation(({ ctx }) => operations(ctx.svc).reset()),
  batchPreview: edit
    .input(BatchSchema)
    .query(({ ctx, input }) => operations(ctx.svc).batchPreview(input)),
  batchApply: edit
    .input(z.object({ data: BatchSchema, token: z.string(), confirm: z.boolean() }))
    .mutation(({ ctx, input }) =>
      operations(ctx.svc).batchApply(input.data, input.token, input.confirm),
    ),
});
export type FixedAssetsRouter = typeof fixedAssetsRouter;
