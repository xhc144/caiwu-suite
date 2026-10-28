import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp } from '@caiwu/testkit';
import payroll from '../server';
import {
  computeValues,
  evaluate,
  parseFormula,
  validateCategory,
  type FormulaContext,
} from '../server/engine';
import { DEFAULT_FIELDS, TaxInputSchema, type Category } from '../shared';

const keys = new Set(['base', 'bonus', 'deduction']);
const run = (expression: string, values: Record<string, number> = {}, context?: FormulaContext) =>
  evaluate(parseFormula(expression, keys).ast, values, context);
const category = (expression: string, condition = ''): Category => ({
  id: 1,
  name: '合成函数月薪',
  revision: 1,
  disabled: false,
  fields: [
    ...DEFAULT_FIELDS,
    { ...DEFAULT_FIELDS[0]!, key: 'extra', name: '计算津贴', kind: 'calculated' },
  ],
  formulas: [
    { name: '计算津贴', target: 'extra', expression, condition, enabled: true, tax: false },
  ],
});

describe('w_xt_gs_edit / w_gz_gzgl 工资公式函数', () => {
  it.each([
    ['abs(-12345)', '12345'],
    ['min(50000, max(20000, 30000))', '30000'],
    ['max(-200, -100)', '-100'],
    ['sum(0.1, 0.2, 0.3)', '0.6'],
    ['round(1250, -2)', '1300'],
    ['round(-1250, -2)', '-1300'],
    ['round(1.255, 2)', '1.26'],
    ['round(-1.255, 2)', '-1.26'],
    ['round(12.5)', '13'],
    ['trunc(1250, -2)', '1200'],
    ['truncate(-1250, -2)', '-1200'],
    ['trunc(1.259, 2)', '1.25'],
    ['int(-1.9)', '-1'],
    ['floor(-1.2)', '-2'],
    ['ceil(-1.2)', '-1'],
    ['ceiling(1.2)', '2'],
    ['sign(-100)', '-1'],
    ['sign(0)', '0'],
    ['sign(100)', '1'],
    ['mod(100, 30)', '10'],
    ['100 % 30', '10'],
    ['SUM(10, ABS(-20))', '30'],
  ])('金额与常数均按分运算，%s = %s', (source, expected) => {
    expect(run(source).toString()).toBe(expected);
  });

  it('w_xt_gs_edit and/or/not 按优先级、括号及短路求值，if/iif 只执行选中分支', () => {
    expect(run('base > 0 and (bonus = 0 or not(deduction <> 0))', { base: 1 }).toNumber()).toBe(1);
    expect(run('not base > 0', { base: -1 }).toNumber()).toBe(1);
    expect(run('not base > 0 and bonus = 0', { base: -1 }).toNumber()).toBe(1);
    expect(run('1 or 0 and 0').toNumber()).toBe(1);
    expect(run('(1 or 0) and 0').toNumber()).toBe(0);
    expect(run('0 and 1 / 0').toNumber()).toBe(0);
    expect(run('1 or 1 / 0').toNumber()).toBe(1);
    expect(run('0 && 1 / 0').toNumber()).toBe(0);
    expect(run('1 || 1 / 0').toNumber()).toBe(1);
    expect(run('!0 and +1').toNumber()).toBe(1);
    expect(run('if(base = 0, 0, bonus / base)').toNumber()).toBe(0);
    expect(run('iif(base > 0, bonus / base, 0)', { base: 2, bonus: 10 }).toNumber()).toBe(5);
    expect(run('if(1, if(0, 1 / 0, 123), 1 / 0)').toNumber()).toBe(123);
  });

  it('w_xt_gs_edit 函数实参及执行条件均纳入依赖和循环检查，未执行分支不能藏未知栏目', () => {
    const parsed = parseFormula('if(base > 0, max(bonus, deduction), 0)', keys);
    expect([...parsed.refs].sort()).toEqual(['base', 'bonus', 'deduction']);
    expect(() => parseFormula('if(0, unknown, 0)', keys)).toThrow('未知栏目');
    expect(() => validateCategory(category('if(base > 0, extra, 0)'))).toThrow('循环');
    expect(() => validateCategory(category('base', 'max(extra, 0) > 0'))).toThrow('循环');
    expect(() =>
      validateCategory({
        ...category('max(base, bonus)'),
        fields: category('0').fields.map((field) =>
          field.key === 'bonus' ? { ...field, disabled: true } : field,
        ),
      }),
    ).toThrow('停用栏目');
  });

  it('w_gz_gzgl 函数结果只在写入栏目时舍入至整数分，条件未满足保持零', () => {
    const c = category('round(base * 0.125, 2)', 'base > 0 and bonus >= 0');
    validateCategory(c);
    expect(computeValues(c, { base: 10003 }).values.extra).toBe(1250);
    expect(computeValues(c, { base: 10003 }).gross).toBe(11253);
    expect(computeValues(c, { base: 0 }).values.extra).toBe(0);
    expect(() =>
      computeValues(category('sum(base, base)'), { base: Number.MAX_SAFE_INTEGER }),
    ).toThrow('安全整数范围');
  });

  it.each([
    ['', '缺少参数'],
    ['today', '左括号'],
    ['today(', '缺少参数'],
    ['today(1)', '0个参数'],
    ['daybefore(20260101 1)', '逗号'],
    ['daybefore(20260101, 1', '右括号'],
    ['daybefore(, 1)', '缺少参数'],
    ['daybefore(20260101,)', '缺少参数'],
    ['daybefore(20260101)', '2个参数'],
    ['monthbefore(20260101, 1, 2)', '2个参数'],
    ['monthbefore(20260101 1)', '逗号'],
    ['monthbefore(20260101, 1', '右括号'],
    ['monthbefore(20260101,)', '缺少参数'],
    ['abs()', '1个参数'],
    ['min()', '1至40个参数'],
    ['if(1, 2)', '3个参数'],
    ['round(1, 2, 3)', '1至2个参数'],
    ['unknownfunction(1)', '未知函数'],
    ['min(1,,2)', '缺少参数'],
    ['1; 2', '不支持的字符'],
    ['constructor(1)', '未知函数'],
    ['base.constructor', '不支持的字符'],
  ])('w_xt_gs_edit 括号、逗号、缺参及白名单：%s 定位拒绝', (source, message) => {
    expect(() => parseFormula(source, keys)).toThrow(/公式第\d+位/);
    expect(() => parseFormula(source, keys)).toThrow(message);
  });

  it('w_xt_gs_edit 函数非法数值给定位提示，超长公式拒绝', () => {
    for (const source of ['round(100, 1.5)', 'trunc(100, 13)', 'mod(10, 0)'])
      expect(() => run(source)).toThrow(/公式第\d+位/);
    expect(() => run('10 % 0')).toThrow('除数为零');
    expect(() => parseFormula('('.repeat(301), keys)).toThrow('不能超过300个字符');
  });

  it('w_gz_gzgl 本版日期约定：today取工资期末，日回退及月回退跨年/闰年/月末准确', () => {
    expect(run('today()', {}, { period: 202402 }).toNumber()).toBe(20240229);
    expect(run('today()', {}, { period: 202602 }).toNumber()).toBe(20260228);
    expect(run('daybefore(20240301, 1)').toNumber()).toBe(20240229);
    expect(run('daybefore(20260101, 1)').toNumber()).toBe(20251231);
    expect(run('monthbefore(20240331, 1)').toNumber()).toBe(20240229);
    expect(run('monthbefore(20260131, 1)').toNumber()).toBe(20251231);
    expect(run('monthbefore(20260331, 0)').toNumber()).toBe(20260331);
    const c = category('if(monthbefore(today(), 1) = 20251231, base * 0.1, 0)');
    expect(computeValues(c, { base: 100000 }, { period: 202601 }).values.extra).toBe(10000);
    expect(computeValues(c, { base: 100000 }, { period: 202602 }).values.extra).toBe(0);
    expect(() => run('today()')).toThrow('有效工资期间');
    expect(() => run('today()', {}, { period: 202613 })).toThrow('有效工资期间');
    for (const expression of [
      'daybefore(20260229, 1)',
      'daybefore(20260101, -1)',
      'monthbefore(20260101, 1.5)',
      'monthbefore(20260101, 120001)',
      'daybefore(10000101, 1)',
    ])
      expect(() => run(expression)).toThrow(/公式第\d+位/);
  });

  it('w_gz_gzgl 金额不变量：限定整数分范围内的函数不改变加法和扣款结果', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000000 }),
        fc.integer({ min: 0, max: 100000000 }),
        (base, bonus) => {
          expect(run('sum(base, bonus)', { base, bonus }).toNumber()).toBe(base + bonus);
          expect(run('max(base, bonus) + min(base, bonus)', { base, bonus }).toNumber()).toBe(
            base + bonus,
          );
          expect(run('abs(base - bonus)', { base, bonus }).toNumber()).toBe(Math.abs(base - bonus));
        },
      ),
    );
  });
});

describe('w_gz_gzgl 公式实际批次计算', () => {
  it('保存日期公式后按批次期间计算，重复计算保持同一金额与解释', async () => {
    const app = await createTestApp({ modules: [payroll], product: 'minfei' });
    try {
      const api = app.call(payroll);
      const definition = category('if(today() = 20260131, base * 0.1, 0)');
      const saved = await api.saveCategory({
        name: definition.name,
        fields: definition.fields,
        formulas: definition.formulas,
      });
      const employee = await api.saveEmployee({
        code: 'FUNC01',
        name: '合成日期公式人员',
        departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
        startDate: '2026-01-01',
      });
      await api.confirmTax();
      const batch = await api.saveBatch({
        period: 202601,
        categoryId: saved.id,
        categoryRevision: saved.revision,
        rows: [
          {
            employeeId: employee.id,
            values: { base: 100000 },
            tax: TaxInputSchema.parse({ confirmed: true }),
          },
        ],
      });
      const first = await api.calculate({ id: batch.id, revision: batch.revision });
      const second = await api.calculate({ id: first.id, revision: first.revision });
      expect(first.snapshots[0]!.calculatedValues.extra).toBe(10000);
      expect(first.snapshots[0]!.gross).toBe(110000);
      expect(second.snapshots).toEqual(first.snapshots);
    } finally {
      await app.close();
    }
  });

  it('第二位人员执行函数失败时回滚全部计算，保留录入且修正后可重试', async () => {
    const app = await createTestApp({ modules: [payroll], product: 'minfei' });
    try {
      const api = app.call(payroll);
      const definition = category('mod(base, bonus)');
      const saved = await api.saveCategory({
        name: definition.name,
        fields: definition.fields,
        formulas: definition.formulas,
      });
      const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
      const employees = [];
      for (let i = 1; i <= 2; i++)
        employees.push(
          await api.saveEmployee({
            code: `ERR${i}`,
            name: `合成函数人员${i}`,
            departmentId,
            startDate: '2026-01-01',
          }),
        );
      await api.confirmTax();
      const rows = employees.map((employee, index) => ({
        employeeId: employee.id,
        values: { base: 100000, bonus: index === 0 ? 300 : 0 },
        tax: TaxInputSchema.parse({ confirmed: true }),
      }));
      const batch = await api.saveBatch({
        period: 202601,
        categoryId: saved.id,
        categoryRevision: saved.revision,
        rows,
      });
      await expect(api.calculate({ id: batch.id, revision: batch.revision })).rejects.toThrow(
        '除数为零',
      );
      const unchanged = await api.batch({ id: batch.id });
      expect(unchanged.rows).toEqual(rows);
      expect(unchanged.snapshots).toEqual([]);
      expect(unchanged.revision).toBe(batch.revision);
      expect(unchanged.calculated).toBe(false);
      const fixed = await api.saveBatch({
        ...unchanged,
        categoryRevision: saved.revision,
        rows: rows.map((row) => ({ ...row, values: { ...row.values, bonus: 300 } })),
      });
      expect(
        (await api.calculate({ id: fixed.id, revision: fixed.revision })).snapshots.map(
          (row) => row.calculatedValues.extra,
        ),
      ).toEqual([100, 100]);
    } finally {
      await app.close();
    }
  });
});
