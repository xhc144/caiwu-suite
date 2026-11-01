import { describe, expect, it } from 'vitest';
import { parseContractEditorMoney, readContractDraft } from '../contract-editor-values';

describe('w_ht_htda 金额原文与草稿恢复', () => {
  it.each([
    '错误金额',
    '90071992547409.92',
    '-1',
    '-0.001',
    '',
    'NaN',
    '1.234',
    '0.001',
    '90071992547409.911',
    '1.2300',
  ])('非法原文 %s 不转换成旧金额', (value) => {
    expect(() => parseContractEditorMoney(value, '合同金额')).toThrow();
    expect(readContractDraft({ code: 'HT001', amount: value, opening: '坏的期初' })).toMatchObject({
      amount: value,
      opening: '坏的期初',
    });
  });
  it('最大安全金额、最小分值及旧数字分值草稿精确恢复', () => {
    expect(parseContractEditorMoney('90071992547409.91', '合同金额')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseContractEditorMoney('0.01', '期初收付款')).toBe(1);
    expect(parseContractEditorMoney('￥１，２３４．５０元', '合同金额')).toBe(123450);
    expect(() => parseContractEditorMoney('￥１．２３４元', '合同金额')).toThrow('两位小数');
    expect(
      readContractDraft({ amount: Number.MAX_SAFE_INTEGER, opening: 1, expectedRevision: 3 }),
    ).toMatchObject({ amount: '90071992547409.91', opening: '0.01', expectedRevision: 3 });
  });
});
