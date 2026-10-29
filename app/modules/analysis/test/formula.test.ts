import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { evaluateFormula, inspectFormula, parseFormula, scaledValue } from '../server/formula';

const evaluate = (s: string) =>
  scaledValue(
    evaluateFormula(
      parseFormula(s),
      () => new Decimal('123.45'),
      (key) => new Decimal(key),
    ),
  );
describe('w_fx_def / w_fx_demo 安全公式', () => {
  it('四则优先级、负号、括号、科目及项目引用，十进制金额准确到分', () => {
    expect(evaluate('0.1 + 0.2')).toBe(30);
    expect(evaluate('100000000000000000000000000000 + 0.01 - 100000000000000000000000000000')).toBe(
      1,
    );
    expect(evaluate('-(2 + 3) * 4 + 1 / 8')).toBe(-1988);
    expect(evaluate('借方("1122") - 项目(2)')).toBe(12145);
    expect(evaluate("累计贷方('6001') / 3")).toBe(4115);
  });
  it.each([
    '1 2',
    '1(2)',
    '借方("1122")余额("1122")',
    '1 +',
    '(1 + 2',
    '借方("1122"',
    'Math.random()',
    'constructor("x")',
    '借方(1122)',
    '项目(0)',
    '项目(1,2)',
    '2 ** 3',
    '1e3',
    '',
  ])('w_fx_demo 缺括号/缺运算符/非法输入阻止：%s', (s) => {
    expect(() => evaluate(s)).toThrow();
  });
  it('w_fx_demo 基数为零/除零明确阻止，不输出无穷或假零', () => {
    expect(() => evaluate('1 / (2 - 2)')).toThrow('除数为零');
    expect(() => evaluate('90071992547410')).toThrow('超出');
  });
  it('限制深度与长度，不能用表达式逃逸执行脚本', () => {
    expect(() => parseFormula('('.repeat(50) + '1' + ')'.repeat(50))).toThrow('复杂');
    expect(() => parseFormula('1'.repeat(1001))).toThrow('1000');
  });
  it('提取科目和项目依赖供存在性、循环引用校验', () => {
    const accounts: string[] = [],
      rows: number[] = [];
    inspectFormula(
      parseFormula('余额("1122") + 项目(10) - 年初("1001")'),
      (fn, code) => accounts.push(`${fn}:${code}`),
      (key) => rows.push(key),
    );
    expect(accounts).toEqual(['余额:1122', '年初:1001']);
    expect(rows).toEqual([10]);
  });
  it('任意合成分值在十进制加减中守恒', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100000000, max: 100000000 }),
        fc.integer({ min: -100000000, max: 100000000 }),
        (a, b) => {
          const left = new Decimal(a).div(100).toFixed(2),
            right = new Decimal(b).div(100).toFixed(2);
          expect(evaluate(`(${left}) + (${right})`)).toBe(a + b);
          expect(evaluate(`(${left}) - (${right})`)).toBe(a - b);
        },
      ),
    );
  });
});
