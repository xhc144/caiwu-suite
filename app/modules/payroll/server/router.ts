import {
  PayrollTransferInputSchema,
  PayrollTransferApplySchema,
  PayrollTransferRestorePreviewSchema,
  PayrollTransferRestoreSchema,
} from '../shared-transfer';
import {
  exportPayrollTransfer,
  inspectPayrollTransfer,
  previewPayrollTransfer,
  applyPayrollTransfer,
  payrollTransferBackups,
  previewPayrollRestore,
  restorePayrollBackup,
  payrollTransferOrigin,
} from './transfer';
import { z } from 'zod';
import { ImportFileSchema, PayrollImportSchema, PayrollImportApplySchema } from '../shared-import';
import { inspectPayrollImport, previewPayrollImport, applyPayrollImport } from './import';
import { BusinessError, zDate, zId } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  BatchSaveSchema,
  CategorySchema,
  EmployeeSchema,
  FilterSchema,
  BulkInputSchema,
  PasteInputSchema,
} from '../shared';
import { payrollService } from './service';
import {
  CorrectionApplySchema,
  CorrectionInputSchema,
  HistoricalTaxConfirmSchema,
} from '../shared-history';
import { previewCorrection, applyCorrection, correctionHistory } from './corrections';
import { historicalTaxConfig, confirmHistoricalTax } from './historical-tax';
import { VoucherMappingSchema, VoucherDeletionPlanSchema } from '../shared-voucher';
import { GroupedSalaryQuerySchema } from '../shared-query';
import {
  HrFieldsSchema,
  HrProfileSchema,
  EmployeeDeleteSchema,
  HrBasicBulkSchema,
  HrBasicBulkApplySchema,
} from '../shared-hr';
import {
  hrFields,
  hrProfile,
  saveHrFields,
  saveHrProfile,
  previewEmployeeDelete,
  deleteEmployee,
  exportPersonnel,
  previewHrBasicBulk,
  applyHrBasicBulk,
} from './hr';
import { previewBulk, applyBulk, previewPaste, applyPaste } from './bulk';
import { salaryReport, querySalary } from './reports';
import { PayrollReportInputSchema } from '../shared-report';
import { PrintLayoutSaveSchema, PayrollPrintRequestSchema } from '../shared-print';
import { printLayouts, savePrintLayout, printReport } from './print-layouts';
import { closePayroll, reopenPayroll } from './closing';
import { ClosingInputSchema, ClosingApplySchema } from '../shared-closing';
import {
  previewCloseMerge,
  applyCloseMerge,
  previewReopenKeep,
  applyReopenKeep,
} from './closing-options';
import { PersonnelBulkInputSchema, PersonnelBulkApplySchema } from '../shared-personnel';
import { previewPersonnelBulk, applyPersonnelBulk } from './personnel-bulk';
import {
  DepartmentDeleteSchema,
  DepartmentStatusSchema,
  DepartmentUpdateSchema,
} from '../shared-departments';
import {
  updateDepartment,
  setDepartmentDisabled,
  previewDepartmentDelete,
  deleteDepartment,
} from './departments';
import { InitializationPreviewSchema, InitializationApplySchema } from '../shared-initialize';
import { previewInitialization, applyInitialization } from './initialize';
const m = moduleKit(manifest);
const payrollProcedure = m.procedure.use(async ({ ctx, next }) => {
  if ((await ctx.svc.book.info()).product === 'qingsong')
    throw new BusinessError({
      code: 'PAYROLL_PRODUCT',
      message: '轻松会计账套不提供工资管理',
      hint: '工资功能适用于民非企会计和成本会计账套，请切换到相应账套',
    });
  return next();
});

const version = z.object({ id: zId, revision: z.number().int().nonnegative() });
const plan = version.extend({ kind: z.enum(['payment', 'allocation']), date: zDate });
export const payrollRouter = m.router({
  exportTransfer: payrollProcedure
    .meta({ permission: 'payroll.export' })
    .query(({ ctx }) => exportPayrollTransfer(ctx.svc)),
  inspectTransfer: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PayrollTransferInputSchema)
    .mutation(({ ctx, input }) => inspectPayrollTransfer(ctx.svc, input)),
  previewTransfer: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PayrollTransferInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { next: _next, ...plan } = await previewPayrollTransfer(ctx.svc, input);
      return plan;
    }),
  applyTransfer: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PayrollTransferApplySchema)
    .mutation(({ ctx, input }) => applyPayrollTransfer(ctx.svc, input, input)),
  transferBackups: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .query(({ ctx }) => payrollTransferBackups(ctx.svc)),
  previewTransferRestore: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(PayrollTransferRestorePreviewSchema)
    .mutation(({ ctx, input }) => previewPayrollRestore(ctx.svc, input.id)),
  applyTransferRestore: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(PayrollTransferRestoreSchema)
    .mutation(({ ctx, input }) => restorePayrollBackup(ctx.svc, input)),
  transferOrigin: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => payrollTransferOrigin(ctx.svc, input.id)),
  previewHrBasicBulk: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(HrBasicBulkSchema)
    .query(({ ctx, input }) => previewHrBasicBulk(ctx.svc, input)),
  applyHrBasicBulk: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(HrBasicBulkApplySchema)
    .mutation(({ ctx, input }) => applyHrBasicBulk(ctx.svc, input, input.hash, input.confirmed)),
  previewInitialization: payrollProcedure
    .meta({ permission: 'payroll.initialize' })
    .input(InitializationPreviewSchema)
    .mutation(({ ctx, input }) => previewInitialization(ctx.svc, input)),
  applyInitialization: payrollProcedure
    .meta({ permission: 'payroll.initialize' })
    .input(InitializationApplySchema)
    .mutation(({ ctx, input }) => applyInitialization(ctx.svc, input)),
  previewCorrection: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(CorrectionInputSchema)
    .query(({ ctx, input }) => previewCorrection(ctx.svc, input)),
  applyCorrection: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(CorrectionApplySchema)
    .mutation(({ ctx, input }) => applyCorrection(ctx.svc, input)),
  correctionHistory: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => correctionHistory(ctx.svc, input.id)),
  historicalTaxConfig: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .query(({ ctx }) => historicalTaxConfig(ctx.svc)),
  confirmHistoricalTax: payrollProcedure
    .meta({ permission: 'payroll.tax.configure' })
    .input(HistoricalTaxConfirmSchema)
    .mutation(({ ctx, input }) => confirmHistoricalTax(ctx.svc, input)),
  inspectImport: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(ImportFileSchema)
    .mutation(({ ctx, input }) => inspectPayrollImport(ctx.svc, input)),
  previewImport: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PayrollImportSchema)
    .mutation(({ ctx, input }) => previewPayrollImport(ctx.svc, input)),
  applyImport: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PayrollImportApplySchema)
    .mutation(({ ctx, input }) => applyPayrollImport(ctx.svc, input, input.hash, input.confirmed)),
  hrFields: payrollProcedure
    .meta({ permission: 'payroll.hr.view' })
    .query(({ ctx }) => hrFields(ctx.svc)),
  saveHrFields: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(HrFieldsSchema)
    .mutation(({ ctx, input }) => saveHrFields(ctx.svc, input)),
  hrProfile: payrollProcedure
    .meta({ permission: 'payroll.hr.view' })
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => hrProfile(ctx.svc, input.id)),
  saveHrProfile: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(HrProfileSchema)
    .mutation(({ ctx, input }) => saveHrProfile(ctx.svc, input)),
  previewEmployeeDelete: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(version)
    .query(({ ctx, input }) => previewEmployeeDelete(ctx.svc, input.id, input.revision)),
  deleteEmployee: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(EmployeeDeleteSchema)
    .mutation(({ ctx, input }) => deleteEmployee(ctx.svc, input)),
  exportPersonnel: payrollProcedure
    .meta({ permission: 'payroll.export' })
    .input(z.object({ ids: z.array(zId).min(1).max(500) }))
    .query(({ ctx, input }) => {
      ctx.svc.permissions.require('payroll.hr.view');
      return exportPersonnel(ctx.svc, input.ids);
    }),
  printLayouts: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .input(z.object({ categoryId: zId }))
    .query(({ ctx, input }) => printLayouts(ctx.svc, input.categoryId)),
  savePrintLayout: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PrintLayoutSaveSchema)
    .mutation(({ ctx, input }) => savePrintLayout(ctx.svc, input)),
  printReport: payrollProcedure
    .meta({ permission: 'payroll.export' })
    .input(PayrollPrintRequestSchema)
    .query(({ ctx, input }) => printReport(ctx.svc, input)),
  previewPersonnelBulk: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(PersonnelBulkInputSchema)
    .query(({ ctx, input }) => previewPersonnelBulk(ctx.svc, input)),
  applyPersonnelBulk: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(PersonnelBulkApplySchema)
    .mutation(({ ctx, input }) => applyPersonnelBulk(ctx.svc, input, input.hash, input.confirmed)),
  updateDepartment: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(DepartmentUpdateSchema)
    .mutation(({ ctx, input }) => updateDepartment(ctx.svc, input)),
  setDepartmentDisabled: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(DepartmentStatusSchema)
    .mutation(({ ctx, input }) => setDepartmentDisabled(ctx.svc, input)),
  previewDepartmentDelete: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => previewDepartmentDelete(ctx.svc, input.id)),
  deleteDepartment: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(DepartmentDeleteSchema)
    .mutation(({ ctx, input }) => deleteDepartment(ctx.svc, input)),
  previewBulk: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(BulkInputSchema)
    .query(({ ctx, input }) => previewBulk(ctx.svc, input)),
  applyBulk: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(BulkInputSchema.extend({ hash: z.string(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => applyBulk(ctx.svc, input, input.hash, input.confirmed)),
  previewPaste: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PasteInputSchema)
    .query(({ ctx, input }) => previewPaste(ctx.svc, input)),
  applyPaste: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PasteInputSchema.extend({ hash: z.string(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => applyPaste(ctx.svc, input, input.hash, input.confirmed)),
  report: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .input(PayrollReportInputSchema)
    .query(({ ctx, input }) => salaryReport(ctx.svc, input)),
  exportReport: payrollProcedure
    .meta({ permission: 'payroll.export' })
    .input(PayrollReportInputSchema)
    .query(({ ctx, input }) => salaryReport(ctx.svc, input)),
  querySalary: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .input(GroupedSalaryQuerySchema)
    .query(({ ctx, input }) => querySalary(ctx.svc, input)),
  close: payrollProcedure
    .meta({ permission: 'payroll.close' })
    .input(version.extend({ confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => closePayroll(ctx.svc, input.id, input.revision, input.confirmed)),
  previewCloseMerge: payrollProcedure
    .meta({ permission: 'payroll.close' })
    .input(ClosingInputSchema)
    .query(({ ctx, input }) => previewCloseMerge(ctx.svc, input)),
  applyCloseMerge: payrollProcedure
    .meta({ permission: 'payroll.close' })
    .input(ClosingApplySchema)
    .mutation(({ ctx, input }) => applyCloseMerge(ctx.svc, input)),
  previewReopenKeep: payrollProcedure
    .meta({ permission: 'payroll.reopen' })
    .input(ClosingInputSchema)
    .query(({ ctx, input }) => previewReopenKeep(ctx.svc, input)),
  applyReopenKeep: payrollProcedure
    .meta({ permission: 'payroll.reopen' })
    .input(ClosingApplySchema)
    .mutation(({ ctx, input }) => applyReopenKeep(ctx.svc, input)),
  reopen: payrollProcedure
    .meta({ permission: 'payroll.reopen' })
    .input(version.extend({ confirmed: z.boolean() }))
    .mutation(({ ctx, input }) =>
      reopenPayroll(ctx.svc, input.id, input.revision, input.confirmed),
    ),
  exportQuery: payrollProcedure
    .meta({ permission: 'payroll.export' })
    .input(GroupedSalaryQuerySchema)
    .query(({ ctx, input }) => querySalary(ctx.svc, input)),
  salaryEmployees: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .query(async ({ ctx }) =>
      (await payrollService(ctx.svc).employees()).map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        departmentId: e.departmentId,
        departmentName: e.departmentName,
        startDate: e.startDate,
        endDate: e.endDate,
        disabled: e.disabled,
      })),
    ),
  categories: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .query(({ ctx }) => payrollService(ctx.svc).categories()),
  saveCategory: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(CategorySchema)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).saveCategory(input)),
  employees: payrollProcedure
    .meta({ permission: 'payroll.hr.view' })
    .query(({ ctx }) => payrollService(ctx.svc).employees()),
  saveEmployee: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(EmployeeSchema)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).saveEmployee(input)),
  departments: payrollProcedure
    .meta({ permission: 'payroll.hr.view' })
    .query(({ ctx }) => payrollService(ctx.svc).departments()),
  createDepartment: payrollProcedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(z.object({ code: z.string().min(1).max(30), name: z.string().min(1).max(60) }))
    .mutation(({ ctx, input }) => payrollService(ctx.svc).createDepartment(input)),
  batches: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .input(FilterSchema)
    .query(({ ctx, input }) => payrollService(ctx.svc).batches(input)),
  batch: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => payrollService(ctx.svc).batch(input.id)),
  saveBatch: payrollProcedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(BatchSaveSchema)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).saveBatch(input)),
  calculate: payrollProcedure
    .meta({ permission: 'payroll.salary.calculate' })
    .input(version)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).calculate(input.id, input.revision)),
  taxConfig: payrollProcedure
    .meta({ permission: 'payroll.salary.view' })
    .query(({ ctx }) => payrollService(ctx.svc).taxConfig()),
  confirmTax: payrollProcedure
    .meta({ permission: 'payroll.tax.configure' })
    .mutation(({ ctx }) => payrollService(ctx.svc).confirmTax()),
  mapping: payrollProcedure
    .meta({ permission: 'payroll.voucher' })
    .input(z.object({ categoryId: zId }))
    .query(({ ctx, input }) => payrollService(ctx.svc).mapping(input.categoryId)),
  saveMapping: payrollProcedure
    .meta({ permission: 'payroll.voucher' })
    .input(z.object({ categoryId: zId, mapping: VoucherMappingSchema }))
    .mutation(({ ctx, input }) =>
      payrollService(ctx.svc).saveMapping(input.categoryId, input.mapping),
    ),
  preview: payrollProcedure
    .meta({ permission: 'payroll.voucher' })
    .input(plan)
    .query(({ ctx, input }) =>
      payrollService(ctx.svc).preview(input.id, input.revision, input.kind, input.date),
    ),
  generate: payrollProcedure
    .meta({ permission: 'payroll.voucher' })
    .input(plan.extend({ hash: z.string() }))
    .mutation(({ ctx, input }) => payrollService(ctx.svc).generate(input)),
  previewRevoke: payrollProcedure
    .meta({ permission: 'payroll.voucher' })
    .input(version.extend({ kind: z.enum(['payment', 'allocation']) }))
    .query(({ ctx, input }) =>
      payrollService(ctx.svc).previewRevoke(input.id, input.revision, input.kind),
    ),
  revoke: payrollProcedure
    .meta({ permission: 'payroll.voucher' })
    .input(
      version.extend({
        kind: z.enum(['payment', 'allocation']),
        confirmed: z.boolean(),
        deletionPlan: VoucherDeletionPlanSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      payrollService(ctx.svc).revoke(
        input.id,
        input.revision,
        input.kind,
        input.confirmed,
        input.deletionPlan,
      ),
    ),
  exportRows: payrollProcedure
    .meta({ permission: 'payroll.export' })
    .input(z.object({ id: zId, employeeIds: z.array(zId) }))
    .query(({ ctx, input }) => payrollService(ctx.svc).exportRows(input.id, input.employeeIds)),
});
export type PayrollRouter = typeof payrollRouter;
