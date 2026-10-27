import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calculatePool, roundedRatio } from '../server/math';

describe('w_cb_hz 月末加权平均', () => {
  it('成本按全月入库加权，累计尾差守恒，全部出完没有残值', () => {
    const r = calculatePool({
      openingQuantityE6: 1_000_000,
      openingCents: 1,
      receipts: [{ quantityE6: 2_000_000, netCents: 0 }],
      issues: [1, 2, 3].map((id) => ({ id, documentId: id, quantityE6: 1_000_000 })),
      adjustZeroQuantity: false,
    });
    expect(r.lines.map((l) => l.costCents)).toEqual([0, 1, 0]);
    expect(r).toMatchObject({ issuedCents: 1, closingCents: 0, closingQuantity: '0' });
  });
  it('盘亏按实盘数量调整；不把出库销售价格当成本', () => {
    const r = calculatePool({
      openingQuantityE6: 10_000_000,
      openingCents: 1000,
      receipts: [{ quantityE6: 10_000_000, netCents: 3000 }],
      issues: [{ id: 1, documentId: 1, quantityE6: 5_000_000 }],
      actualQuantityE6: 12_000_000,
      adjustZeroQuantity: false,
    });
    expect(r).toMatchObject({
      issuedCents: 1000,
      countCents: -600,
      closingCents: 2400,
      closingQuantity: '12',
      unitCost: '2.000000000000',
    });
  });
  it('零数量残值必须确认调整；调整单列，负库存和无成本基础盘盈拒绝', () => {
    const input = {
      openingQuantityE6: 0,
      openingCents: 1,
      receipts: [],
      issues: [],
      adjustZeroQuantity: false,
    };
    expect(() => calculatePool(input)).toThrow(/没有数量|数量为零/);
    expect(calculatePool({ ...input, adjustZeroQuantity: true })).toMatchObject({
      zeroQuantityAdjustmentCents: -1,
      closingCents: 0,
    });
    expect(() => calculatePool({ ...input, openingCents: 0, actualQuantityE6: 1 })).toThrow(
      /没有可用数量/,
    );
    expect(() =>
      calculatePool({ ...input, issues: [{ id: 1, documentId: 1, quantityE6: 1 }] }),
    ).toThrow(/负库存/);
    expect(() => calculatePool({ ...input, actualQuantityE6: -1 })).toThrow(/实盘/);
  });
  it('金额/数量溢出、非法输入拒绝；负半分也按绝对值四舍五入', () => {
    const base = {
      openingQuantityE6: 1,
      openingCents: 1,
      receipts: [],
      issues: [],
      adjustZeroQuantity: false,
    };
    expect(() => calculatePool({ ...base, openingCents: 0.1 })).toThrow(/安全整数/);
    expect(() =>
      calculatePool({
        ...base,
        openingCents: Number.MAX_SAFE_INTEGER,
        receipts: [{ quantityE6: 1, netCents: 1 }],
      }),
    ).toThrow(/安全整数/);
    expect(roundedRatio(-1n, 2n)).toBe(-1n);
  });
  it('fast-check：接近安全整数上限时的金额乘数量仍精确，整批出完成本不丢分', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: BigInt(Number.MAX_SAFE_INTEGER) }),
        fc.bigInt({ min: 2n, max: BigInt(Number.MAX_SAFE_INTEGER) }),
        (amount, q) => {
          const first = q / 2n;
          const r = calculatePool({
            openingQuantityE6: Number(q),
            openingCents: Number(amount),
            receipts: [],
            issues: [
              { id: 1, documentId: 1, quantityE6: Number(first) },
              { id: 2, documentId: 2, quantityE6: Number(q - first) },
            ],
            adjustZeroQuantity: false,
          });
          expect(BigInt(r.lines[0]!.costCents)).toBe(roundedRatio(amount * first, q));
          expect(BigInt(r.lines[0]!.costCents) + BigInt(r.lines[1]!.costCents)).toBe(amount);
          expect(r.closingCents).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });
  it('fast-check：逐行成本、盘盈亏与结存精确守恒，任意安全大金额不经浮点乘法', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 100 }),
        (q, amount, received, percentage) => {
          const issued = Math.floor((q * percentage) / 100);
          const r = calculatePool({
            openingQuantityE6: q,
            openingCents: amount,
            receipts: [{ quantityE6: q, netCents: received }],
            issues: issued
              ? [
                  { id: 1, documentId: 1, quantityE6: issued },
                  { id: 2, documentId: 2, quantityE6: issued },
                ]
              : [],
            adjustZeroQuantity: false,
          });
          expect(
            BigInt(amount) +
              BigInt(received) +
              BigInt(r.countCents) +
              BigInt(r.zeroQuantityAdjustmentCents),
          ).toBe(BigInt(r.issuedCents) + BigInt(r.closingCents));
          expect(r.lines.reduce((n, l) => n + l.costCents, 0)).toBe(r.issuedCents);
          expect(r.lines.every((l) => Number.isSafeInteger(l.costCents) && l.costCents >= 0)).toBe(
            true,
          );
        },
      ),
      { numRuns: 400 },
    );
  });
});
