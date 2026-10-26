import { describe, expect, it } from 'vitest';
import { BalanceFunctionSchema, balanceFormula } from '../../shared';
import { evaluate, parseFormula, value, type FormulaContext } from '../../server/formula';

const input = {
  account: '1001',
  metric: 'closing',
  unit: 'cents',
  currency: 'CNY',
  direction: 'signed',
  dimension: 'none',
  item: '',
} as const;
const context: FormulaContext = {
  cell: async (address) =>
    address === 'A1' ? value(-103, 'cents') : value(17, 'foreignCents', 'USD'),
  reference: async () => {
    throw new Error('不应调用');
  },
  balance: async () => {
    throw new Error('不应调用');
  },
  tick() {},
};
describe('w_bb_def_help 增量公式校验', () => {
  it('IF假分支的数值零可参与金额加减与SUM，非零普通数值仍拒绝混用', async () => {
    for (const source of ['IF(0,A1,0)+A1', 'SUM(IF(0,A1,0),A1)', 'A1-0']) {
      const result = await evaluate(parseFormula(source), context);
      expect(result.amount.toFixed()).toBe('-103');
      expect(result.unit).toBe('cents');
    }
    await expect(evaluate(parseFormula('IF(0,A1,1)+A1'), context)).rejects.toThrow(/单位/);
  });
  it('七参数序列化逐字保持兼容；八参数经JSON安全转义', () => {
    expect(balanceFormula(input)).toBe(
      'BALANCE("1001","closing","cents","CNY","signed","none","")',
    );
    expect(() =>
      parseFormula(balanceFormula({ ...input, options: { from: 'yearStart' } })),
    ).not.toThrow();
  });
  it.each([
    '{"restriction":"restricted"}',
    '{"closing":"guess"}',
    '{"from":"202613"}',
    '{"side":"guess"}',
    '{"groupBy":["partner","partner"]}',
    '{"groupBy":["cashflow"]}',
    '{"from":"lastYear"}',
    '{"__proto__":{}}',
    'null',
    '[]',
    'not-json',
  ])('未知口径/非法JSON明确拒绝，不回退成默认口径 %s', (options) => {
    const source = balanceFormula(input).slice(0, -1) + ',' + JSON.stringify(options) + ')';
    expect(() => parseFormula(source)).toThrow(/第8参数/);
  });
  it.each([
    { options: { closing: 'exclude' } },
    { direction: 'normal', options: { side: 'credit' } },
    { metric: 'credit', options: { side: 'debit' } },
    { unit: 'quantity', options: { side: 'debit' } },
  ])('不支持的组合不静默转换 %j', (patch) => {
    expect(BalanceFunctionSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it.each(['IF(1,2)', 'IF(1,2,3,4)', 'MAX()', 'MAX(A1:A2)', 'IF("x",1,2)', 'MIN(1,2)'])(
    '函数白名单及参数限制 %s',
    (source) => expect(() => parseFormula(source)).toThrow(),
  );
  it('IF按算术和比较优先级求值，未选分支不会执行，比较只产出普通数值', async () => {
    const run = (source: string) => evaluate(parseFormula(source), context);
    expect((await run('IF(1+2*3=7,9,1/0)')).amount.toFixed()).toBe('9');
    expect((await run('IF(0,1/0,4)')).amount.toFixed()).toBe('4');
    for (const op of ['<', '<=', '<>', '!=']) {
      const result = await run(`A1${op}0`);
      expect(result.amount.toFixed()).toBe('1');
      expect(result.unit).toBe('number');
    }
    await expect(run('IF(A1,1,2)')).rejects.toThrow(/条件/);
  });
  it('MAX可比较金额与零但不能混用非零普通数值、币种和数量', async () => {
    const run = (source: string) => evaluate(parseFormula(source), context);
    expect(await run('MAX(A1,0)')).toMatchObject({ unit: 'cents' });
    expect((await run('MAX(A1,0)')).amount.toFixed()).toBe('0');
    await expect(run('MAX(A1,1)')).rejects.toThrow(/单位/);
    await expect(run('MAX(A1,B1)')).rejects.toThrow(/单位/);
    await expect(run('A1>B1')).rejects.toThrow(/单位/);
  });
});
