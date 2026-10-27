import type { CoreServices } from '@caiwu/core/server';
import { ReportInputSchema, SalaryQuerySchema, type ReportInput, type SalaryRow } from '../shared';
import type { z } from 'zod';
import { payrollService } from './service';
import { fail, sum } from './engine';
import type { PayrollTables } from './migrations';
const builtins = ['gross', 'deductions', 'taxAmount', 'net'];
const builtinNames: Record<string, string> = {
  gross: '应发',
  deductions: '扣款',
  taxAmount: '个税',
  net: '实发',
};
export function decomposeCash(net: number, denominations: number[], label = '实发工资') {
  if (!Number.isSafeInteger(net) || net < 0)
    fail(
      'CASH_NEGATIVE',
      `存在负${label}，不能计算现金票面`,
      '先检查所选工资栏目，负数不生成负张数',
    );
  const units = [...new Set(denominations)].sort((a, b) => b - a);
  let remainder = net;
  const notes = units.map((unit) => {
    if (!Number.isSafeInteger(unit) || unit <= 0) fail('CASH_UNIT', '面额须为正整数分');
    const count = Math.floor(remainder / unit);
    remainder -= count * unit;
    return { unit, count };
  });
  return { notes, remainder, total: net };
}
async function snapshots(svc: CoreServices, categoryId: number, from: number, to: number) {
  if (to < from) fail('REPORT_RANGE', '结束期间不能早于开始期间', '修正查询期间，原查询条件会保留');
  const rows = await svc.db
    .withTables<PayrollTables>()
    .selectFrom('payroll_batch as b')
    .innerJoin('payroll_row as r', 'r.batch_id', 'b.id')
    .select(['b.id', 'b.period', 'r.snapshot_json'])
    .where('b.category_id', '=', categoryId)
    .where('b.period', '>=', from)
    .where('b.period', '<=', to)
    .where('b.calculated', '=', 1)
    .orderBy('b.period')
    .orderBy('r.employee_id')
    .execute();
  return rows.map((r) => ({
    batchId: r.id,
    period: r.period,
    row: JSON.parse(r.snapshot_json!) as SalaryRow,
  }));
}
export async function salaryReport(svc: CoreServices, raw: ReportInput) {
  const input = ReportInputSchema.parse(raw),
    c = await payrollService(svc).category(input.categoryId);
  const fields = new Map(c.fields.map((f) => [f.key, f.name]));
  if (new Set(input.columns).size !== input.columns.length)
    fail('REPORT_COLUMN', '汇总栏目重复', '每个金额栏目只选择一次');
  const people = await payrollService(svc).employees();
  if (input.employeeIds.some((id) => !people.some((e) => e.id === id)))
    fail('REPORT_SCOPE', '没有选中本账套人员或含未知人员', '重新选择本账套人员，原条件将保留');
  for (const col of input.columns)
    if (!builtins.includes(col) && !fields.has(col))
      fail('REPORT_COLUMN', `未知汇总栏目 ${col}`, '选择工资金额栏目');
  const cashName = builtinNames[input.cashField] ?? fields.get(input.cashField);
  if (input.kind === 'cash') {
    if (!builtins.includes(input.cashField) && !fields.has(input.cashField))
      fail('REPORT_COLUMN', `未知票面工资栏目 ${input.cashField}`, '选择本工资类别的金额栏目');
    if (!input.columns.includes(input.cashField))
      fail('REPORT_COLUMN', `票面计算必须选择${cashName}栏目`, '在汇总栏目中加入票面所用工资栏目');
  }
  const selected = (await snapshots(svc, input.categoryId, input.from, input.to)).filter(
    (s) =>
      input.employeeIds.includes(s.row.employeeId) &&
      (!input.departmentId || s.row.employee.departmentId === input.departmentId),
  );
  if (!selected.length)
    fail('EMPTY_SELECTION', '没有选中可输出的工资数据', '选择已计算期间和人员，核对部门范围');
  const value = (r: SalaryRow, col: string) =>
    builtins.includes(col)
      ? r[col as 'gross' | 'deductions' | 'taxAmount' | 'net']
      : (r.calculatedValues[col] ?? 0);
  const totals = Object.fromEntries(
    input.columns.map((col) => [col, sum(selected.map((s) => value(s.row, col)))]),
  );
  type ReportRow = {
    key: string;
    label: string;
    period: string;
    values: Record<string, number>;
    notes: { unit: number; count: number }[];
    remainder: number;
  };
  const result = new Map<string, ReportRow>();
  for (const s of selected) {
    const r = s.row;
    const key =
      input.kind === 'department'
        ? String(r.employee.departmentId)
        : input.kind === 'cumulative' || input.kind === 'cash'
          ? String(r.employeeId)
          : `${s.batchId}:${r.employeeId}`;
    const label =
      input.kind === 'department'
        ? r.employee.departmentName
        : `${r.employee.code} ${r.employee.name} · ${r.employee.departmentName}`;
    let target = result.get(key);
    if (!target) {
      target = {
        key,
        label,
        period: input.kind === 'table' ? String(s.period) : `${input.from}—${input.to}`,
        values: {},
        notes: [],
        remainder: 0,
      };
      result.set(key, target);
    }
    for (const col of input.columns)
      target.values[col] = sum([target.values[col] ?? 0, value(r, col)]);
    if (input.kind === 'cash') {
      const cash = decomposeCash(value(r, input.cashField), input.denominations, cashName);
      target.remainder = sum([target.remainder, cash.remainder]);
      for (const note of cash.notes) {
        let n = target.notes.find((n) => n.unit === note.unit);
        if (!n) {
          n = { unit: note.unit, count: 0 };
          target.notes.push(n);
        }
        n.count = sum([n.count, note.count]);
      }
    }
  }
  return {
    kind: input.kind,
    totals,
    columns: input.columns.map((key) => ({
      key,
      name: builtinNames[key] ?? fields.get(key)!,
    })),
    rows: [...result.values()],
    sourceBatches: [...new Set(selected.map((s) => s.batchId))],
    cashColumn: input.kind === 'cash' ? { key: input.cashField, name: cashName! } : null,
  };
}
export async function querySalary(svc: CoreServices, raw: z.input<typeof SalaryQuerySchema>) {
  const input = SalaryQuerySchema.parse(raw);
  await payrollService(svc).category(input.categoryId);
  const all = await snapshots(svc, input.categoryId, input.from, input.to);
  return all
    .filter(({ row: r }) =>
      input.conditions.every((c) => {
        if (c.field === 'code' || c.field === 'name' || c.field === 'department') {
          const actual = c.field === 'department' ? r.employee.departmentName : r.employee[c.field];
          return c.operator === 'equals'
            ? actual === c.value
            : c.operator === 'contains'
              ? actual.includes(c.value)
              : !actual.includes(c.value);
        }
        const actual = c.field === 'startDate' ? r.employee.startDate : r[c.field];
        switch (c.operator) {
          case 'equals':
            return actual === c.value;
          case 'gt':
            return actual > c.value;
          case 'gte':
            return actual >= c.value;
          case 'lt':
            return actual < c.value;
          case 'lte':
            return actual <= c.value;
        }
      }),
    )
    .map((s) => ({ batchId: s.batchId, period: s.period, ...s.row }));
}
