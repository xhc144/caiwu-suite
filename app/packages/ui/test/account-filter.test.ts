import { describe, expect, it } from 'vitest';
import type { Account } from '@caiwu/core';
import { filterAccounts } from '../src/account-select';

const acc = (code: string, name: string, pinyin: string, fullName = name): Account => ({
  id: Number(code),
  code,
  name,
  fullName,
  parentId: null,
  level: 1,
  categoryId: 'asset',
  direction: 'debit',
  isLeaf: true,
  disabled: false,
  isCash: false,
  isBank: false,
  cashflowRequired: false,
  isPartner: false,
  currency: null,
  quantityUnit: null,
  pinyin,
  mnemonic: null,
  dimensions: [],
});

const list = [
  acc('1001', '库存现金', 'kcxj'),
  acc('100201', '工商银行', 'gsyh', '银行存款/工商银行'),
  acc('6602', '管理费用', 'glfy'),
  acc('660201', '办公费', 'bgf', '管理费用/办公费'),
];

describe('科目模糊搜索', () => {
  it('编码前缀优先，再按拼音首字母、名称、全名', () => {
    expect(filterAccounts(list, '6602').map((a) => a.code)).toEqual(['6602', '660201']);
    expect(filterAccounts(list, 'glfy').map((a) => a.code)).toEqual(['6602']);
    expect(filterAccounts(list, '银行').map((a) => a.code)).toEqual(['100201']);
    expect(filterAccounts(list, '管理').map((a) => a.code)).toEqual(['6602', '660201']);
    expect(filterAccounts(list, '').length).toBe(4);
    expect(filterAccounts(list, 'zzz')).toEqual([]);
  });
});
