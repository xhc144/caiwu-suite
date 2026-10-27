import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BookFilterSchema } from '../shared';
import { amountToForm, amountToUrl, conditionAmounts, queryProblem } from './amount-filters';

describe('w_pz_pzxsb / w_pz_zhcx 元输入与历史地址', () => {
  it('正负金额、零、一分及最大可用金额往返保持精确', () => {
    for (const cents of [0, 1, -1, 100, -12345, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])
      expect(amountToUrl(amountToForm(String(cents)))).toBe(String(cents));
    fc.assert(
      fc.property(
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        (cents) => {
          expect(amountToUrl(amountToForm(String(cents)))).toBe(String(cents));
        },
      ),
    );
    expect(amountToUrl('1,234.56')).toBe('123456');
    expect(amountToUrl('（１２．３４）')).toBe('-1234');
    expect(amountToForm('')).toBe('');
    expect(amountToUrl('  ')).toBe('');
  });
  it('无效或超范围的金额用中文说明，不能静默提交', () => {
    for (const invalid of ['字', 'NaN', 'Infinity', '1e9', '--1', '90071992547409.92'])
      expect(() => amountToUrl(invalid)).toThrow(/[\u3400-\u9fff]/);
    for (const invalid of ['0.01', '1e2', 'NaN', '9007199254740992']) {
      expect(amountToForm(invalid)).toBe('金额无效，请重新输入');
      expect(() => amountToUrl(amountToForm(invalid))).toThrow();
    }
  });
  it('综合条件只换算金额，日期、编号、摘要和制单人文字保持原义', () => {
    const rows = [
      { field: 'amount', operator: 'gte', value: '-1' },
      { field: 'amount', operator: 'lte', value: '12345' },
      { field: 'date', operator: 'eq', value: '2026-01-05' },
      { field: 'number', operator: 'eq', value: '12' },
      { field: 'summary', operator: 'contains', value: '金额100分' },
      { field: 'creator', operator: 'eq', value: '张会计' },
    ];
    const url = JSON.stringify(rows);
    const form = conditionAmounts(url, amountToForm);
    expect(JSON.parse(form)).toEqual([
      { ...rows[0], value: '-0.01' },
      { ...rows[1], value: '123.45' },
      ...rows.slice(2),
    ]);
    expect(conditionAmounts(form, amountToUrl)).toBe(url);
    expect(conditionAmounts('', amountToUrl)).toBe('');
    for (const invalid of ['{', '{}', 'null'])
      expect(() => conditionAmounts(invalid, amountToUrl)).toThrow(/[\u3400-\u9fff]/);
  });
  it('非法字段、比较方式、值和范围均产生中文提示', () => {
    for (const condition of [
      { field: 'secret', operator: 'eq', value: 'a' },
      { field: 'amount', operator: 'drop', value: '1' },
      { field: 'date', operator: 'eq', value: '2026-02-30' },
      { field: 'amount', operator: 'contains', value: '1' },
      { field: 'number', operator: 'eq', value: '' },
      { field: 'amount', operator: 'eq', value: '0.01' },
    ]) {
      const parsed = BookFilterSchema.safeParse({ conditions: [condition] });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        for (const issue of parsed.error.issues) {
          expect(queryProblem(issue)).toMatch(/[\u3400-\u9fff]/);
          expect(queryProblem(issue)).not.toMatch(/Invalid|Expected|received|安全整数|整数分/);
        }
    }
    expect(
      queryProblem({ path: ['amountFrom'], message: 'Invalid input: expected number' }),
    ).toContain('起始金额');
    expect(BookFilterSchema.safeParse({ amountFrom: 2, amountTo: 1 }).success).toBe(false);
  });
});
