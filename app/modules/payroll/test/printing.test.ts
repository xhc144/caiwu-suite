import { afterEach, beforeEach, expect, it } from 'vitest';
import { renderPrintDocument } from '@caiwu/print';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS, TaxInputSchema, type Category, type Employee } from '../shared';
import { renderSalaryPrint, type PrintReport } from '../printing';
import { PayrollPrintLayoutSchema } from '../shared-print';

let app: TestApp;
const call = (testApp: TestApp) => testApp.call(payroll);
let api: ReturnType<typeof call>, category: Category, employee: Employee;
beforeEach(async () => {
  app = await createTestApp({ modules: [payroll], product: 'minfei' });
  api = call(app);
  await api.confirmTax();
  category = await api.saveCategory({ name: '合成打印工资', fields: DEFAULT_FIELDS });
  employee = await api.saveEmployee({
    code: 'PRINT01',
    name: '打印人员',
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
    startDate: '2026-01-01',
  });
  const batch = await api.saveBatch({
    categoryId: category.id,
    categoryRevision: category.revision,
    period: 202601,
    rows: [
      {
        employeeId: employee.id,
        values: { base: 1234567 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      },
    ],
  });
  await api.calculate({ id: batch.id, revision: batch.revision });
});
afterEach(async () => app.close());
const request = () => ({
  categoryId: category.id,
  from: 202601,
  to: 202601,
  employeeIds: [employee.id],
  columns: ['gross'],
  kind: 'table' as const,
});
it('w_xt_dysz 工资表、条、汇总独立持久化；重复保存和结构变化不覆盖，权限仍检查', async () => {
  const original = await api.printLayouts({ categoryId: category.id });
  const layout = {
    ...original.layouts.slips,
    title: '独立工资条',
    unitName: '合成单位',
    footer: '签收：______',
    columns: [{ key: 'base', widthMm: 36, integerDigits: 10, decimals: 2 }],
  };
  const saved = await api.savePrintLayout({
    categoryId: category.id,
    categoryRevision: category.revision,
    layout,
  });
  expect(saved.revision).toBe(1);
  const fresh = await api.printLayouts({ categoryId: category.id });
  expect(fresh.layouts.slips).toEqual(saved);
  expect(fresh.layouts.table).toEqual(original.layouts.table);
  expect(fresh.layouts.summary).toEqual(original.layouts.summary);
  await expect(
    api.savePrintLayout({ categoryId: category.id, categoryRevision: category.revision, layout }),
  ).rejects.toThrow('打印格式已被修改');
  expect((await api.printLayouts({ categoryId: category.id })).layouts.slips).toEqual(saved);
  category = await api.saveCategory({ ...category, name: '改名后的合成工资' });
  await expect(
    api.savePrintLayout({
      categoryId: category.id,
      categoryRevision: category.revision - 1,
      layout: saved,
    }),
  ).rejects.toThrow('工资结构已变化');
  const viewer = app.call(
    payroll,
    await app.addUser('print_view', { permissions: ['payroll.salary.view'] }),
  );
  await expect(viewer.printLayouts({ categoryId: category.id })).resolves.toMatchObject({
    layouts: { slips: saved },
  });
  await expect(
    viewer.savePrintLayout({
      categoryId: category.id,
      categoryRevision: category.revision,
      layout: saved,
    }),
  ).rejects.toThrow('权限');
  await expect(viewer.printReport({ report: request(), mode: 'slips' })).rejects.toThrow('权限');
});
it('w_xt_dysz 栏目重复、缺失、数字位数、版面越界失败时保留原设置', async () => {
  const original = await api.printLayouts({ categoryId: category.id });
  const save = (layout: typeof original.layouts.table) =>
    api.savePrintLayout({ categoryId: category.id, categoryRevision: category.revision, layout });
  await expect(save({ ...original.layouts.table, columns: [] })).rejects.toThrow('至少选择');
  await expect(
    save({
      ...original.layouts.table,
      columns: [original.layouts.table.columns[0]!, original.layouts.table.columns[0]!],
    }),
  ).rejects.toThrow('重复');
  await expect(
    save({
      ...original.layouts.table,
      columns: [{ ...original.layouts.table.columns[0]!, key: 'missing' }],
    }),
  ).rejects.toThrow('已不存在');
  await expect(
    save({
      ...original.layouts.table,
      columns: [{ ...original.layouts.table.columns[0]!, decimals: 3 }],
    }),
  ).rejects.toThrow('最多显示两位');
  await expect(
    save({
      ...original.layouts.table,
      columns: [{ ...original.layouts.table.columns[0]!, widthMm: 12 }],
    }),
  ).rejects.toThrow('宽度不足');
  await expect(
    save({
      ...original.layouts.table,
      landscape: false,
      columns: original.layouts.table.columns.map((column) => ({ ...column, widthMm: 80 })),
    }),
  ).rejects.toThrow('总宽度');
  await expect(save({ ...original.layouts.table, rowsPerPage: 40 })).rejects.toThrow('每页记录数');
  expect(await api.printLayouts({ categoryId: category.id })).toEqual(original);
});
it('w_gz_prt_gzb 独立工资条取真实计算快照、元金额与页脚转义；空选或无数据必须重选', async () => {
  const original = await api.printLayouts({ categoryId: category.id });
  await api.savePrintLayout({
    categoryId: category.id,
    categoryRevision: category.revision,
    layout: {
      ...original.layouts.slips,
      title: '<工资条>',
      footer: '<script>签收</script>',
      columns: [{ key: 'base', widthMm: 36, integerDigits: 10, decimals: 2 }],
    },
  });
  const output = await api.printReport({ report: request(), mode: 'slips' });
  expect(output.pages).toBe(1);
  expect(output.job.html).toContain('12345.67');
  expect(output.job.html).toContain('<col style="width:36mm">');
  expect(output.job.html).not.toContain('1234567');
  expect(output.job.html).toContain('&lt;工资条&gt;');
  expect(output.job.html).toContain('&lt;script&gt;签收&lt;/script&gt;');
  expect(output.job.html).toContain('打印人员');
  expect(renderPrintDocument(output.job)).toContain('class="payroll-sheet"');
  await expect(
    api.printReport({ report: { ...request(), employeeIds: [] }, mode: 'slips' }),
  ).rejects.toThrow('请选择报告人员');
  await expect(
    api.printReport({ report: { ...request(), from: 202602, to: 202602 }, mode: 'table' }),
  ).rejects.toThrow('没有选中');
});
it('w_gz_prt_gzb 分页重复表头、最后页全部合计；不够整数宽不截断数字，数量不除100', () => {
  const report: PrintReport = {
    columns: [
      { key: 'gross', name: '应发', kind: 'money' },
      { key: 'hours', name: '工时', kind: 'quantity', unit: '小时' },
      { key: 'memo', name: '姓名', kind: 'basic' },
    ],
    totals: { gross: 3703701 },
    quantityTotals: { hours: '4.500003' },
    rows: Array.from({ length: 3 }, (_, i) => ({
      label: `人员${i}`,
      period: '202601',
      values: { gross: 1234567 },
      quantities: { hours: '1.500001' },
      basicValues: { memo: '<名称>' },
    })),
  };
  const layout = PayrollPrintLayoutSchema.parse({
    mode: 'table',
    title: '合成表',
    rowsPerPage: 2,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    columns: [
      { key: 'hours', widthMm: 40, integerDigits: 5, decimals: 6 },
      { key: 'gross', widthMm: 40, integerDigits: 10, decimals: 2 },
      { key: 'memo', widthMm: 50, integerDigits: 10, decimals: 2 },
    ],
  });
  const output = renderSalaryPrint(report, layout);
  expect(output.pages).toBe(2);
  expect(output.job.html.match(/<thead>/g)).toHaveLength(2);
  expect(output.job.html.match(/全部合计/g)).toHaveLength(1);
  expect(output.job.html).toContain('4.500003');
  expect(output.job.html).toContain('1.500001');
  expect(output.job.html).toContain('37037.01');
  expect(output.job.html).toContain('&lt;名称&gt;');
  expect(output.job.html.indexOf('工时')).toBeLessThan(output.job.html.indexOf('应发'));
  expect(() =>
    renderSalaryPrint(report, {
      ...layout,
      columns: [{ key: 'gross', widthMm: 30, integerDigits: 2, decimals: 2 }],
    }),
  ).toThrow('整数宽度');
});
