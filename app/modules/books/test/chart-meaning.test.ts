import { describe, expect, it } from 'vitest';
import { nativeMeaning } from '../chart-meaning';

describe('w_xt_kmwh_1 备抵、双向和结转性质', () => {
  it('备抵独立于显示方向，不改变科目类别或禁止反向余额', () => {
    expect(
      nativeMeaning(
        { contra: true, balanceNature: 'one-sided', closingRule: 'none', scope: '合成一般业务' },
        'credit',
      ),
    ).toEqual({ isContra: true, balanceNature: 'credit' });
  });
  it('共同科目明确双向；结转规则单独保留，映射为共享无结转余额性质', () => {
    expect(
      nativeMeaning(
        { contra: false, balanceNature: 'two-sided', closingRule: 'none', scope: '合成共同业务' },
        'debit',
      ),
    ).toEqual({ isContra: false, balanceNature: 'both' });
    expect(
      nativeMeaning(
        { contra: false, balanceNature: 'two-sided', closingRule: 'profit', scope: '合成损益' },
        'credit',
      ),
    ).toEqual({ isContra: false, balanceNature: 'no-closing-balance' });
    expect(
      nativeMeaning(
        {
          contra: false,
          balanceNature: 'one-sided',
          closingRule: 'seasonal-allocation',
          scope: '合成季节性生产',
        },
        'debit',
      ),
    ).toEqual({ isContra: false, balanceNature: 'debit' });
  });
});
