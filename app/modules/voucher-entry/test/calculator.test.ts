import { expect, it } from 'vitest';
import fc from 'fast-check';
import { calculateMoney } from '../calculator';

it.each([
  ['0.1 + 0.2', 30],
  ['(100.25 + 20) / 3', 4008],
  ['-1.005', -101],
  ['1.005', 101],
  ['2 + 3 * 4', 1400],
  ['-(2 + 3) * .5', -250],
  ['1/3', 33],
  ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ['-0.001', 0],
])('w_calc：%s 精确得到 %i 分', (expression, cents) =>
  expect(calculateMoney(expression)).toBe(cents),
);

it.each([
  '1/0',
  'NaN',
  'Infinity',
  '1e10',
  'globalThis.alert(1)',
  '2**3',
  '2(3)',
  '(1+2',
  '1+2)',
  '1 2',
  '',
  '90071992547409.92',
  '9'.repeat(201),
])('w_calc：拒绝无效或超出范围的算式 %s', (expression) =>
  expect(() => calculateMoney(expression)).toThrow(),
);

it('w_calc：随机整数分加减用独立整数模型核验，不经浮点金额计算', () => {
  const money = (cents: number) =>
    `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
  fc.assert(
    fc.property(
      fc.integer({ min: -100000000, max: 100000000 }),
      fc.integer({ min: -100000000, max: 100000000 }),
      (a, b) => {
        expect(calculateMoney(`${money(a)} + (${money(b)})`)).toBe(a + b);
        expect(calculateMoney(`${money(a)} - (${money(b)})`)).toBe(a - b);
      },
    ),
    { numRuns: 150 },
  );
});
