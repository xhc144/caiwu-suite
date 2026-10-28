import { z } from 'zod';
import { BusinessError, zCents, zCode, zDate, zId, zPeriod } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  BatchSchema,
  ListEditSchema,
  AssetPrintSettingsSchema,
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
import { departmentService } from './departments';
import { transferService } from './transfers';
import { recalculationService } from './recalculation';
import { protectedAssetReset, assetResetPreview } from './reset';
import { queryDefinitions } from './query-definitions';
import { saveListEdits } from './list-edit';
import { resetProtectionInfo, previewResetRestore, restoreBeforeReset } from './reset-restore';
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
const withVoucherDeletion = confirmed.extend({
  expectedVoucherId: zId.nullable().optional(),
  voucherDeletion: z
    .object({
      ids: z.array(zId).length(1),
      expiresAt: z.number().int().positive(),
      fingerprint: z.string().min(1),
    })
    .optional(),
});
export const fixedAssetsRouter = m.router({
  masters: view.query(({ ctx }) => assetService(ctx.svc).masters()),
  currencies: view.query(({ ctx }) => ctx.svc.reference.currencies()),
  saveMaster: edit
    .input(z.object({ id: zId.optional(), data: MasterSchema }))
    .mutation(({ ctx, input }) => assetService(ctx.svc).saveMaster(input.data, input.id)),
  removeMaster: edit
    .input(confirmed)
    .mutation(({ ctx, input }) => assetService(ctx.svc).removeMaster(input.id, input.confirm)),
  createDepartment: edit
    .input(z.object({ code: zCode, name: z.string().trim().min(1).max(100) }))
    .mutation(({ ctx, input }) => assetService(ctx.svc).createDepartment(input.code, input.name)),
  departments: view.query(({ ctx }) => departmentService(ctx.svc).list()),
  saveDepartment: edit
    .input(
      z.object({
        id: zId.optional(),
        revision: z.number().int().positive().optional(),
        code: zCode,
        name: z.string().trim().min(1, '部门名称必填').max(100),
        disabled: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) => departmentService(ctx.svc).save(input)),
  setDepartmentDisabled: edit
    .input(id.extend({ disabled: z.boolean(), revision: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      departmentService(ctx.svc).setDisabled(input.id, input.disabled, input.revision),
    ),
  departmentDeletePreview: edit
    .input(id)
    .query(({ ctx, input }) => departmentService(ctx.svc).previewDelete(input.id)),
  removeDepartment: edit
    .input(
      z.object({
        plan: z.object({
          id: zId,
          revision: z.number().int().positive(),
          expiresAt: z.number().int(),
          fingerprint: z.string().min(1),
        }),
        confirm: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => departmentService(ctx.svc).remove(input.plan, input.confirm)),
  list: view.input(CardFilter).query(({ ctx, input }) => assetService(ctx.svc).list(input)),
  saveListEdits: edit
    .input(
      z.object({
        rows: z
          .array(
            z.object({ id: zId, revision: z.number().int().positive(), changes: ListEditSchema }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(({ ctx, input }) => saveListEdits(ctx.svc, input.rows)),
  detail: view.input(id).query(({ ctx, input }) => assetService(ctx.svc).detail(input.id)),
  transfers: view.input(id).query(({ ctx, input }) => transferService(ctx.svc).list(input.id)),
  transfer: edit
    .input(
      id.extend({
        revision: z.number().int().positive(),
        date: zDate,
        departmentId: zId,
        purposeId: zId,
        statusId: zId,
        installation: z.string().max(200).optional(),
        custodian: z.string().max(100).optional(),
        quantity: quantitySchema.optional(),
        note: z.string().trim().min(1, '请填写转移原因').max(500),
        confirm: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => transferService(ctx.svc).save(input)),
  undoTransfer: edit
    .input(confirmed)
    .mutation(({ ctx, input }) => transferService(ctx.svc).undo(input.id, input.confirm)),
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
    .input(withVoucherDeletion)
    .mutation(({ ctx, input }) =>
      assetService(ctx.svc).cancel(
        input.id,
        input.confirm,
        input.voucherDeletion,
        input.expectedVoucherId,
      ),
    ),
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
  voucherDeletePreview: p
    .meta({ permission: 'fixed-assets.voucher' })
    .input(id)
    .query(({ ctx, input }) => assetService(ctx.svc).voucherDeletePreview(input.id)),
  deleteVoucher: p
    .meta({ permission: 'fixed-assets.voucher' })
    .input(withVoucherDeletion)
    .mutation(({ ctx, input }) =>
      assetService(ctx.svc).deleteVoucher(
        input.id,
        input.confirm,
        input.voucherDeletion,
        input.expectedVoucherId,
      ),
    ),
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
  undoDisposalPreview: edit
    .input(id)
    .query(({ ctx, input }) => operations(ctx.svc).undoDisposalPreview(input.id)),
  undoDisposal: edit
    .input(withVoucherDeletion)
    .mutation(({ ctx, input }) =>
      operations(ctx.svc).undoDisposal(
        input.id,
        input.confirm,
        input.voucherDeletion,
        input.expectedVoucherId,
      ),
    ),
  query: view.input(QuerySchema).query(({ ctx, input }) => operations(ctx.svc).query(input)),
  queryDefinitions: view.query(({ ctx }) => queryDefinitions(ctx.svc).list()),
  saveQueryDefinition: view
    .input(
      z.object({
        name: z.string().trim().min(1).max(60),
        query: QuerySchema,
        revision: z.number().int().min(0),
      }),
    )
    .mutation(({ ctx, input }) => queryDefinitions(ctx.svc).save(input)),
  removeQueryDefinition: view
    .input(
      z.object({
        name: z.string().trim().min(1).max(60),
        revision: z.number().int().min(0),
        confirm: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      queryDefinitions(ctx.svc).remove(input.name, input.revision, input.confirm),
    ),
  reports: view.input(ReportSchema).query(({ ctx, input }) => operations(ctx.svc).reports(input)),
  printSettings: view.query(async ({ ctx }) =>
    AssetPrintSettingsSchema.parse(await ctx.svc.settings.get('print', {})),
  ),
  savePrintSettings: p
    .meta({ permission: 'fixed-assets.settings' })
    .input(AssetPrintSettingsSchema)
    .mutation(({ ctx, input }) =>
      ctx.svc.tx(async (svc) => {
        await svc.settings.set('print', input);
        await assetService(svc).logInternal('print.settings', 'layout');
      }),
    ),
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
  recalculationPreview: p
    .meta({ permission: 'fixed-assets.depreciate' })
    .input(CardFilter)
    .query(async ({ ctx, input }) => {
      const result = await recalculationService(ctx.svc).preview(input);
      return { rows: result.rows, token: result.token, totalDifference: result.totalDifference };
    }),
  recalculate: p
    .meta({ permission: 'fixed-assets.depreciate' })
    .input(z.object({ filter: CardFilter, token: z.string(), confirm: z.boolean() }))
    .mutation(({ ctx, input }) =>
      recalculationService(ctx.svc).apply(input.filter, input.token, input.confirm),
    ),
  recalculations: view.query(({ ctx }) => recalculationService(ctx.svc).list()),
  undoRecalculation: p
    .meta({ permission: 'fixed-assets.depreciate' })
    .input(confirmed)
    .mutation(({ ctx, input }) => recalculationService(ctx.svc).undo(input.id, input.confirm)),
  resetPreview: p
    .meta({ permission: 'fixed-assets.reset' })
    .query(({ ctx }) => assetResetPreview(ctx)),
  reset: p
    .meta({ permission: 'fixed-assets.reset' })
    .input(
      z
        .object({
          revision: z.string().min(1),
          bookName: z.string().min(1),
          password: z.string().min(1),
          confirmText: z.string(),
        })
        .optional(),
    )
    .mutation(({ ctx, input }) =>
      input ? protectedAssetReset(ctx, input) : operations(ctx.svc).reset(),
    ),
  resetProtection: p
    .meta({ permission: 'fixed-assets.reset' })
    .query(({ ctx }) => resetProtectionInfo(ctx)),
  resetRestorePreview: p
    .meta({ permission: 'fixed-assets.reset' })
    .mutation(({ ctx }) => previewResetRestore(ctx)),
  resetRestore: p
    .meta({ permission: 'fixed-assets.reset' })
    .input(
      z.object({
        replacementId: z.uuid(),
        bookName: z.string().min(1),
        password: z.string().min(1),
        confirmText: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => restoreBeforeReset(ctx, input)),
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
