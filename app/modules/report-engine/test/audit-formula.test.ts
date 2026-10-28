import { describe, expect, it } from 'vitest';
import { evaluateAudit, parseAudit } from '../server/audit-formula';
import { value, type FormulaContext } from '../server/formula';

const context: FormulaContext = {
  tick() {},
  async balance() {
    return value(100, 'cents');
  },
  async cell(address) {
    if (address === 'A1') return value(100, 'cents');
    if (address === 'A2') return value(101, 'cents');
    if (address === 'B1') return value(1, 'quantity');
    if (address === 'C1') return value(100, 'foreignCents', 'USD');
    if (address === 'C2') return value(100, 'foreignCents', 'EUR');
    throw new Error('缺少单元格来源');
  },
  async reference(_code, address) {
    return context.cell(address);
  },
};
const check = (source: string, tolerance = '0') =>
  evaluateAudit(parseAudit(source), context, tolerance);

describe('w_bb_def 布尔审核白名单', () => {
  it.each([
    ['1 = 1 OR 2 = 3 AND 4 = 5', true],
    ['(1 = 1 OR 2 = 3) AND 4 = 5', false],
    ['NOT (A1 = A2) AND A1 > 0', true],
    ['NOT NOT (1 == 1)', true],
    ['(A1 + A1) / A1 >= 2', true],
    ['REF("101", "A1") = A1 AND A1 <= A2', true],
    ['A1 < A2 AND A1 <> A2 AND A1 != A2', true],
    ['1 = 1 OR 1/0 = 0', true],
    ['1 = 0 AND 1/0 = 0', false],
  ] as const)('优先级、分组与短路：%s', async (source, expected) => {
    expect(await check(source)).toBe(expected);
  });
  it('等于和不等于沿用非负差额阈值，大小比较保持精确比较', async () => {
    expect(await check('A1 = A2', '1')).toBe(true);
    expect(await check('A1 != A2', '1')).toBe(false);
    expect(await check('A1 < A2', '1')).toBe(true);
    expect(await check('A1 * 0.504 = A1 * 0.5')).toBe(true);
  });
  it('单位、币种、缺来源及除零错误不变成不通过或通过', async () => {
    await expect(check('A1 = B1')).rejects.toThrow('单位或币种不一致');
    await expect(check('C1 = C2')).rejects.toThrow('单位或币种不一致');
    await expect(check('D1 = 0')).rejects.toThrow('缺少单元格来源');
    await expect(check('1/0 = 0')).rejects.toThrow('除数为零');
  });
  it.each([
    '',
    'A1',
    '1 < 2 < 3',
    '1 = 1 AND',
    '(1 = 1',
    '1 = 1)',
    'alert(1) = 1',
    '1 === 1',
    '1 = 1; process.exit()',
    '"AND" = 1',
  ])('保存时拒绝畸形表达式：%s', (source) => {
    expect(() => parseAudit(source)).toThrow();
  });
  it('长度与嵌套限制保持可控', () => {
    expect(() => parseAudit('('.repeat(42) + '1=1' + ')'.repeat(42))).toThrow('过于复杂');
    expect(() => parseAudit('1'.repeat(2001))).toThrow('最多2000');
  });
});
