import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  PrintLayoutSaveSchema,
  PayrollPrintRequestSchema,
  PayrollPrintLayoutSchema,
  type PayrollPrintLayout,
  type PayrollPrintMode,
} from '../shared-print';
import { printGeometry, renderSalaryPrint } from '../printing';
import { payrollService } from './service';
import { salaryReport } from './reports';
import { fail } from './engine';

export async function printLayouts(svc: CoreServices, categoryId: number) {
  const category = await payrollService(svc).category(categoryId);
  const book = await svc.book.info();
  const modes = ['table', 'slips', 'summary'] as const;
  const titles = { table: '工资表', slips: '工资条', summary: '工资汇总表' };
  const layouts = {} as Record<PayrollPrintMode, PayrollPrintLayout>;
  for (const mode of modes) {
    const saved = await svc.settings.get<PayrollPrintLayout | null>(
      `print-layout.${categoryId}.${mode}`,
      null,
    );
    layouts[mode] = saved
      ? PayrollPrintLayoutSchema.parse(saved)
      : PayrollPrintLayoutSchema.parse({
          mode,
          title: titles[mode],
          unitName: book.orgName || book.name,
          landscape: mode !== 'slips',
          margins: { top: 10, right: 10, bottom: 10, left: 10 },
          columns: ['gross', 'deductions', 'taxAmount', 'net'].map((key) => ({
            key,
            widthMm: 32,
            integerDigits: 10,
            decimals: 2,
          })),
        });
  }
  return { category, categoryRevision: category.revision, layouts };
}
export async function savePrintLayout(
  svc: CoreServices,
  raw: z.input<typeof PrintLayoutSaveSchema>,
) {
  const input = PrintLayoutSaveSchema.parse(raw);
  return svc.tx(async (t) => {
    const category = await payrollService(t).category(input.categoryId);
    if (category.revision !== input.categoryRevision)
      fail('STALE_STRUCTURE', '工资结构已变化，打印格式未保存', '重新打开打印设置，核对栏目后保存');
    const current = (await printLayouts(t, input.categoryId)).layouts[input.layout.mode];
    if (current.revision !== input.layout.revision)
      fail('STALE_PRINT_LAYOUT', '打印格式已被修改，本次内容未覆盖', '重新打开打印设置并合并修改');
    const allowed = new Set([
      'gross',
      'deductions',
      'taxAmount',
      'net',
      ...category.fields.filter((f) => !f.disabled).map((f) => f.key),
    ]);
    for (const column of input.layout.columns) {
      if (!allowed.has(column.key))
        fail('PRINT_COLUMN', '打印栏目已不存在或已停用', '重新选择当前工资类别的栏目');
      const field = category.fields.find((f) => f.key === column.key);
      if (field?.kind !== 'quantity' && column.decimals > 2)
        fail(
          'PRINT_DECIMALS',
          '金额栏目最多显示两位小数',
          '金额按元显示，数量栏目最多显示六位小数',
        );
      if (
        field?.kind !== 'basic' &&
        column.widthMm <
          (column.integerDigits + (column.decimals ? column.decimals + 1 : 0) + 1) *
            input.layout.fontSize *
            0.352778 *
            0.57 +
            2
      )
        fail(
          'PRINT_WIDTH',
          '栏目宽度不足以显示设置的数字位数',
          '增加栏目宽度，或减少整数宽度及小数位数',
        );
    }
    const saved = { ...input.layout, revision: current.revision + 1 };
    // 几何校验与真实渲染共用，保存错误不会覆盖原设置。
    printGeometry(saved);
    await t.settings.set(`print-layout.${input.categoryId}.${saved.mode}`, saved);
    await t.log.write({
      action: 'payroll.print-layout',
      summary: `保存${category.name}的${saved.title}打印格式`,
    });
    return saved;
  });
}
export async function printReport(
  svc: CoreServices,
  raw: z.input<typeof PayrollPrintRequestSchema>,
) {
  const input = PayrollPrintRequestSchema.parse(raw);
  const layout = (await printLayouts(svc, input.report.categoryId)).layouts[input.mode];
  const report = await salaryReport(svc, {
    ...input.report,
    kind:
      input.mode === 'summary'
        ? input.report.kind === 'cumulative'
          ? 'cumulative'
          : 'department'
        : 'table',
    columns: layout.columns.map((c) => c.key),
  });
  return { ...renderSalaryPrint(report, layout), layout };
}
