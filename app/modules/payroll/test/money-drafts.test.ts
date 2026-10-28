import { expect, it } from 'vitest';
import { validMoneyDraft } from '../web/money-drafts';

it('w_gz_gzgl 非法金额原文与超大金额不得沿用旧数，空白及既有输入格式继续可用', () => {
  for (const raw of ['12..34', '12abc', '--12', '∞', '9999999999999999999999999'])
    expect(validMoneyDraft(raw)).toBe(false);
  for (const raw of ['', ' ', '￥１２３．４５', '1,234.50', '（12.30）', '.25', '12.345'])
    expect(validMoneyDraft(raw)).toBe(true);
  expect(validMoneyDraft('-1', false)).toBe(false);
  expect(validMoneyDraft('（12.30）', false)).toBe(false);
  expect(validMoneyDraft('0', false)).toBe(true);
});
