import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocateFifo, cents } from '../server/fifo';

describe('w_fx_zl FIFO 不变量', () => {
  it('任意红字、回款、期初、边界配置均保持有符号合计与原始金额一致', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { maxLength: 100 }),
        (amounts) => {
          const lots = amounts.map((amount, i) => ({
            lineId: i,
            voucherId: i,
            voucherNo: '测试',
            date: '2026-04-01',
            bizDate: i % 5 === 0 ? null : `2026-0${(i % 3) + 1}-01`,
            amount,
            remaining: 0,
          }));
          const result = allocateFifo(lots, '2026-04-15', [0, 30, 60, 90]);
          const total = amounts.reduce((n, a) => n + a, 0);
          expect(result.allocated).toBe(total);
          expect(result.closing).toBe(total);
          expect(result.buckets.every((n) => n >= 0)).toBe(true);
          expect(result.reverse).toBeLessThanOrEqual(0);
          const reordered = allocateFifo([...lots].reverse(), '2026-04-15', [0, 30, 60, 90]);
          expect(reordered.buckets).toEqual(result.buckets);
          expect(reordered.unaged).toBe(result.unaged);
        },
      ),
    );
  });
  it('金额溢出明确拒绝，不输出不精确金额', () => {
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(/安全整数/);
  });
});
