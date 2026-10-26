import { z } from 'zod';
import { zDate, zId } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  BatchSaveSchema,
  CategorySchema,
  EmployeeSchema,
  FilterSchema,
  MappingSchema,
  BulkInputSchema,
  PasteInputSchema,
  ReportInputSchema,
  SalaryQuerySchema,
} from '../shared';
import { payrollService } from './service';
import { previewBulk, applyBulk, previewPaste, applyPaste } from './bulk';
import { salaryReport, querySalary } from './reports';
import { closePayroll, reopenPayroll } from './closing';
const m = moduleKit(manifest);
const version = z.object({ id: zId, revision: z.number().int().nonnegative() });
const plan = version.extend({ kind: z.enum(['payment', 'allocation']), date: zDate });
export const payrollRouter = m.router({
  previewBulk: m.procedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(BulkInputSchema)
    .query(({ ctx, input }) => previewBulk(ctx.svc, input)),
  applyBulk: m.procedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(BulkInputSchema.extend({ hash: z.string(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => applyBulk(ctx.svc, input, input.hash, input.confirmed)),
  previewPaste: m.procedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PasteInputSchema)
    .query(({ ctx, input }) => previewPaste(ctx.svc, input)),
  applyPaste: m.procedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(PasteInputSchema.extend({ hash: z.string(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => applyPaste(ctx.svc, input, input.hash, input.confirmed)),
  report: m.procedure
    .meta({ permission: 'payroll.salary.view' })
    .input(ReportInputSchema)
    .query(({ ctx, input }) => salaryReport(ctx.svc, input)),
  exportReport: m.procedure
    .meta({ permission: 'payroll.export' })
    .input(ReportInputSchema)
    .query(({ ctx, input }) => salaryReport(ctx.svc, input)),
  querySalary: m.procedure
    .meta({ permission: 'payroll.salary.view' })
    .input(SalaryQuerySchema)
    .query(({ ctx, input }) => querySalary(ctx.svc, input)),
  close: m.procedure
    .meta({ permission: 'payroll.close' })
    .input(version.extend({ confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => closePayroll(ctx.svc, input.id, input.revision, input.confirmed)),
  reopen: m.procedure
    .meta({ permission: 'payroll.reopen' })
    .input(version.extend({ confirmed: z.boolean() }))
    .mutation(({ ctx, input }) =>
      reopenPayroll(ctx.svc, input.id, input.revision, input.confirmed),
    ),
  exportQuery: m.procedure
    .meta({ permission: 'payroll.export' })
    .input(SalaryQuerySchema)
    .query(({ ctx, input }) => querySalary(ctx.svc, input)),
  salaryEmployees: m.procedure.meta({ permission: 'payroll.salary.view' }).query(async ({ ctx }) =>
    (await payrollService(ctx.svc).employees()).map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      departmentName: e.departmentName,
      disabled: e.disabled,
    })),
  ),
  categories: m.procedure
    .meta({ permission: 'payroll.salary.view' })
    .query(({ ctx }) => payrollService(ctx.svc).categories()),
  saveCategory: m.procedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(CategorySchema)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).saveCategory(input)),
  employees: m.procedure
    .meta({ permission: 'payroll.hr.view' })
    .query(({ ctx }) => payrollService(ctx.svc).employees()),
  saveEmployee: m.procedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(EmployeeSchema)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).saveEmployee(input)),
  departments: m.procedure
    .meta({ permission: 'payroll.hr.view' })
    .query(({ ctx }) => payrollService(ctx.svc).departments()),
  createDepartment: m.procedure
    .meta({ permission: 'payroll.hr.edit' })
    .input(z.object({ code: z.string().min(1).max(30), name: z.string().min(1).max(60) }))
    .mutation(({ ctx, input }) => payrollService(ctx.svc).createDepartment(input)),
  batches: m.procedure
    .meta({ permission: 'payroll.salary.view' })
    .input(FilterSchema)
    .query(({ ctx, input }) => payrollService(ctx.svc).batches(input)),
  batch: m.procedure
    .meta({ permission: 'payroll.salary.view' })
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => payrollService(ctx.svc).batch(input.id)),
  saveBatch: m.procedure
    .meta({ permission: 'payroll.salary.edit' })
    .input(BatchSaveSchema)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).saveBatch(input)),
  calculate: m.procedure
    .meta({ permission: 'payroll.salary.calculate' })
    .input(version)
    .mutation(({ ctx, input }) => payrollService(ctx.svc).calculate(input.id, input.revision)),
  taxConfig: m.procedure
    .meta({ permission: 'payroll.salary.view' })
    .query(({ ctx }) => payrollService(ctx.svc).taxConfig()),
  confirmTax: m.procedure
    .meta({ permission: 'payroll.tax.configure' })
    .mutation(({ ctx }) => payrollService(ctx.svc).confirmTax()),
  mapping: m.procedure
    .meta({ permission: 'payroll.voucher' })
    .input(z.object({ categoryId: zId }))
    .query(({ ctx, input }) => payrollService(ctx.svc).mapping(input.categoryId)),
  saveMapping: m.procedure
    .meta({ permission: 'payroll.voucher' })
    .input(z.object({ categoryId: zId, mapping: MappingSchema }))
    .mutation(({ ctx, input }) =>
      payrollService(ctx.svc).saveMapping(input.categoryId, input.mapping),
    ),
  preview: m.procedure
    .meta({ permission: 'payroll.voucher' })
    .input(plan)
    .query(({ ctx, input }) =>
      payrollService(ctx.svc).preview(input.id, input.revision, input.kind, input.date),
    ),
  generate: m.procedure
    .meta({ permission: 'payroll.voucher' })
    .input(plan.extend({ hash: z.string() }))
    .mutation(({ ctx, input }) => payrollService(ctx.svc).generate(input)),
  revoke: m.procedure
    .meta({ permission: 'payroll.voucher' })
    .input(version.extend({ kind: z.enum(['payment', 'allocation']), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) =>
      payrollService(ctx.svc).revoke(input.id, input.revision, input.kind, input.confirmed),
    ),
  exportRows: m.procedure
    .meta({ permission: 'payroll.export' })
    .input(z.object({ id: zId, employeeIds: z.array(zId) }))
    .query(({ ctx, input }) => payrollService(ctx.svc).exportRows(input.id, input.employeeIds)),
});
export type PayrollRouter = typeof payrollRouter;
