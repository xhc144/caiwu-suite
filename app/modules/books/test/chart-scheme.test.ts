import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parentCodeOf, parseTemplate } from '@caiwu/core';
import small from '../templates/small-business.json';
import { mapChart } from '../chart-scheme';
import { validateScheme } from '../shared';

const fixture = () =>
  parseTemplate({
    ...small,
    id: 'synthetic-scheme',
    accounts: [
      { code: '2221', name: '合成上级', category: 'liability', direction: 'credit' },
      {
        code: '222101',
        name: '合成二级',
        category: 'liability',
        direction: 'debit',
        partner: true,
        dimensions: [{ type: 'partner', required: true }],
        source: '合成来源',
      },
      { code: '22210109', name: '合成三级', category: 'liability', direction: 'credit' },
    ],
  });

describe('w_xt_kgzb_a3 / w_xt_kmwh_1 确定性级次转换', () => {
  it('4-2-2至4-3-3逐段补零，保留父链、名称、辅助与方向，往返不丢属性', () => {
    const original = fixture();
    const mapped = mapChart(original, '4-3-3');
    expect(mapped.accounts.map((a) => a.code)).toEqual(['2221', '2221001', '2221001009']);
    expect(parentCodeOf('2221001009', [4, 3, 3])).toBe('2221001');
    expect(mapped.accounts[1]).toMatchObject({
      name: '合成二级',
      direction: 'debit',
      partner: true,
      dimensions: [{ type: 'partner', required: true }],
      source: '合成来源',
    });
    expect(mapChart(mapped, '4-2-2')).toEqual(mapChart(original, '4-2-2'));
    expect(mapped.accounts.every((account) => account.sourceVersion === original.version)).toBe(
      true,
    );
    expect(validateScheme(original, '4-3-3')).toEqual([4, 3, 3]);
  });

  it.each(['3-2-2', '4', '4-0-2', '4-7-2', '4-1-1-1-1-1-1-1-1'])(
    'w_xt_kgzb_1 非法宽度或层级溢出拒绝：%s',
    (scheme) => {
      expect(() => mapChart(fixture(), scheme)).toThrow();
    },
  );
  it('w_xt_kgzb_3 重码、缺上级以及目标段长不足拒绝，来源模板保持不变', () => {
    const original = fixture();
    expect(() =>
      mapChart({ ...original, accounts: [...original.accounts, original.accounts[0]!] }, '4-3-3'),
    ).toThrow();
    expect(() =>
      mapChart({ ...original, accounts: original.accounts.slice(1) }, '4-3-3'),
    ).toThrow();
    const overflow = {
      ...original,
      codeScheme: '4-3-3',
      accounts: [original.accounts[0]!, { ...original.accounts[1]!, code: '2221123' }],
    };
    expect(() => mapChart(overflow, '4-2-2')).toThrow(/超出/);
    expect(original).toEqual(fixture());
  });
  it('w_xt_kgzb_a3 任意合法二、三级数值往返一致，映射不重码', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }), (a, b) => {
        const second = `2221${String(a).padStart(2, '0')}`;
        const original = parseTemplate({
          ...fixture(),
          accounts: [
            fixture().accounts[0]!,
            { ...fixture().accounts[1]!, code: second },
            { ...fixture().accounts[2]!, code: `${second}${String(b).padStart(2, '0')}` },
          ],
        });
        const mapped = mapChart(original, '4-3-3');
        expect(new Set(mapped.accounts.map((item) => item.code)).size).toBe(3);
        expect(mapChart(mapped, '4-2-2')).toEqual(mapChart(original, '4-2-2'));
      }),
    );
  });
});
