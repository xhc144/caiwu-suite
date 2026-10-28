import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BalanceFunctionSchema, balanceFormula } from '../shared';
import { evaluate, finalize, parseFormula, value, type FormulaContext } from '../server/formula';

const context: FormulaContext = {
  cell: async () => {
    throw new Error('禁止读取');
  },
  reference: async () => {
    throw new Error('禁止读取');
  },
  balance: async () => {
    throw new Error('禁止读取');
  },
  tick: () => {},
};
describe('w_bb_def_help / w_bb_proc 白名单公式', () => {
  it.each(['S01("1001")', 'w1()', 'F(1)', 'S(2,"1001")'])(
    'w_bb_def_help 旧函数 %s 缺少说明时给出可操作的迁移提示，不猜测取数',
    (source) => {
      expect(() => parseFormula(source)).toThrow(/旧版函数.*缺少.*F8.*重新选择科目和取数指标/);
    },
  );
  it.each([
    'SUM(1,2',
    '(1+2))',
    'UNKNOWN(1)',
    '1 2',
    'A1 B1',
    '1(2)',
    '1+',
    'SUM()',
    'REF(1,"A1")',
    'BALANCE("1001")',
  ])('w_bb_def_help 括号/未知函数/相邻计算项/参数校验 %s', (source) => {
    expect(() => parseFormula(source)).toThrow();
  });
  it.each([
    'globalThis.process.exit()',
    'process.exit(1)',
    'Function("return 1")()',
    'eval("1")',
    'A1.constructor',
    'A1["x"]',
    'SUM(1);process.exit()',
    'import("node:fs")',
    '__proto__',
    '1//1',
  ])('w_bb_def_help 攻击source只会报错且不执行 %s', (source) => {
    expect(() => parseFormula(source)).toThrow();
  });
  it('w_bb_def_help 长度、计算项、深度均受限', () => {
    expect(() => parseFormula('1'.repeat(2001))).toThrow(/过长/);
    expect(() => parseFormula('-'.repeat(60) + '1')).toThrow(/过深/);
    expect(() => parseFormula(Array(260).fill('1').join('+'))).toThrow(/过多/);
  });
  it('w_bb_proc 除零/区域非法/文本参与运算是错误，不产生NaN', async () => {
    await expect(evaluate(parseFormula('1/0'), context)).rejects.toThrow(/除数为零/);
    await expect(evaluate(parseFormula('SUM(B2:A1)'), context)).rejects.toThrow(/倒置/);
    await expect(evaluate(parseFormula('"x"+1'), context)).rejects.toThrow(/字符串/);
  });
  it('w_bb_def_help 四则优先级、括号、一元负号以及Decimal精度', async () => {
    const result = await evaluate(parseFormula('-(1+2)*3+0.1+0.2'), context);
    expect(result.amount.toFixed()).toBe('-8.7');
    expect(finalize(value('9007199254740991', 'cents')).amount.toFixed()).toBe('9007199254740991');
    expect(() => finalize(value('9007199254740992', 'cents'))).toThrow(/安全/);
  });
  it('w_bb_def_help 新签名为向导和后端共用，拒绝缺币种、缺辅助或现金流期初，接受真实累计指标', () => {
    const input = {
      account: '1001',
      metric: 'closing',
      unit: 'cents',
      currency: 'CNY',
      direction: 'signed',
      dimension: 'none',
      item: '',
    } as const;
    expect(() => parseFormula(balanceFormula(input))).not.toThrow();
    for (const unit of ['foreignCents', 'quantity'] as const)
      for (const metric of ['ytdDebit', 'ytdCredit'] as const)
        expect(() =>
          parseFormula(
            balanceFormula({
              ...input,
              unit,
              metric,
              currency: unit === 'foreignCents' ? 'USD' : 'CNY',
            }),
          ),
        ).not.toThrow();
    for (const patch of [
      { currency: '' },
      { dimension: 'project' },
      { unit: 'foreignCents', currency: '' },
      { dimension: 'cashflow', item: 'CF01' },
    ])
      expect(BalanceFunctionSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('四则运算随机性质：整数金额乘比例后加回另一项与手算一致', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -1000000, max: 1000000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000000, max: 1000000 }),
        async (a, b, c) => {
          const result = await evaluate(parseFormula(`(${a})*(${b})+(${c})`), context);
          expect(result.amount.toFixed()).toBe(String(a * b + c));
        },
      ),
      { numRuns: 100 },
    );
  });
});
