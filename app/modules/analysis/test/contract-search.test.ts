import { describe, expect, it } from 'vitest';
import { contractConditionError, matchesContractCondition } from '../contract-search';
const row = {
  code: 'HT-01',
  name: '试验合同',
  partnerName: '供应商甲',
  signed_date: '2026-01-02',
  kind: 'receipt' as const,
  amount: Number.MAX_SAFE_INTEGER,
  opening: 1,
  reviewed_by: null,
  description: '交付商品',
  remark: '第一列',
  remark2: '第二列',
};
describe('w_ht_htda 定位查询', () => {
  it('支持原版档案字段、中文状态、两列备注的定位', () => {
    expect(matchesContractCondition(row, 'code', 'contains', 'ht-')).toBe(true);
    expect(matchesContractCondition(row, 'partnerName', 'contains', '甲')).toBe(true);
    expect(matchesContractCondition(row, 'remark2', 'equal', '第二列')).toBe(true);
    expect(matchesContractCondition(row, 'kind', 'equal', '收款')).toBe(true);
    expect(matchesContractCondition(row, 'reviewed_by', 'equal', '未审核')).toBe(true);
    expect(matchesContractCondition(row, 'signed_date', 'greater', '2026-01-01')).toBe(true);
  });
  it('金额以元解析后比较整数分，不丢失大数的末分', () => {
    expect(matchesContractCondition(row, 'amount', 'equal', '90071992547409.91')).toBe(true);
    expect(matchesContractCondition(row, 'amount', 'greater', '90071992547409.90')).toBe(true);
    expect(matchesContractCondition(row, 'amount', 'less', '90071992547409.90')).toBe(false);
    expect(matchesContractCondition(row, 'opening', 'equal', '0.01')).toBe(true);
    expect(matchesContractCondition(row, 'opening', 'equal', '0')).toBe(false);
  });
  it('错误金额、错误日期不能应用定位条件；空值判断独立', () => {
    expect(contractConditionError('amount', 'equal', '不是金额')).toContain('金额无效');
    expect(contractConditionError('amount', 'equal', '90071992547409.92')).toContain('超出范围');
    expect(contractConditionError('signed_date', 'equal', '2026-02-30')).toContain('日期无效');
    expect(contractConditionError('signed_date', 'contains', '2026-01')).toBeNull();
    expect(matchesContractCondition({ ...row, remark: '' }, 'remark', 'empty', '')).toBe(true);
    expect(matchesContractCondition(row, 'opening', 'notEmpty', '')).toBe(true);
  });
});
