import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  calculateEnterprise,
  calculateBalance,
  calculateProfit,
  calculateCashflow,
  enterpriseRanges,
} from '../../templates/enterprise/calculate';
import { balanceBucket } from '../../templates/enterprise/model';
import { suggestEnterpriseRules } from '../../templates/enterprise/mapping';
import { fixture, account, addAccount, provenance } from './fixture';
const ZERO = {
  capital: '0',
  equityPreferred: '0',
  equityPerpetual: '0',
  equityOther: '0',
  capitalReserve: '0',
  treasuryStock: '0',
  otherComprehensive: '0',
  specialReserve: '0',
  surplusReserve: '0',
  retainedEarnings: '0',
  total: '0',
};
describe('企业2019附件2四表', () => {
  it('w_bb_proc 连续两年12个月、真实损益结转与年结，四表逐金额格核对', () => {
    const { c, d } = fixture(),
      r = calculateEnterprise(c, d);
    const balance = {
      cash: '220000',
      tradingAssets: '0',
      derivativeAssets: '0',
      notesReceivable: '0',
      accountsReceivable: '0',
      receivablesFinancing: '0',
      prepayments: '0',
      otherReceivables: '0',
      inventory: '0',
      contractAssets: '0',
      heldForSaleAssets: '0',
      currentNoncurrentAssets: '0',
      otherCurrentAssets: '0',
      currentAssetsTotal: '220000',
      debtInvestments: '0',
      otherDebtInvestments: '0',
      longTermReceivables: '0',
      equityInvestments: '0',
      otherEquityInvestments: '0',
      otherFinancialAssets: '0',
      investmentProperty: '0',
      fixedAssets: '0',
      construction: '0',
      biologicalAssets: '0',
      oilGasAssets: '0',
      rightOfUseAssets: '0',
      intangibleAssets: '0',
      development: '0',
      goodwill: '0',
      longTermPrepaid: '0',
      deferredTaxAssets: '0',
      otherNoncurrentAssets: '0',
      noncurrentAssetsTotal: '0',
      assetsTotal: '220000',
      shortTermLoans: '0',
      tradingLiabilities: '0',
      derivativeLiabilities: '0',
      notesPayable: '0',
      accountsPayable: '0',
      advances: '0',
      contractLiabilities: '0',
      employeePayable: '0',
      taxesPayable: '0',
      otherPayables: '0',
      heldForSaleLiabilities: '0',
      currentNoncurrentLiabilities: '0',
      otherCurrentLiabilities: '0',
      currentLiabilitiesTotal: '0',
      longTermLoans: '0',
      bondsPayable: '0',
      bondPreferred: '0',
      bondPerpetual: '0',
      leaseLiabilities: '0',
      longTermPayables: '0',
      provisions: '0',
      deferredIncome: '0',
      deferredTaxLiabilities: '0',
      otherNoncurrentLiabilities: '0',
      noncurrentLiabilitiesTotal: '0',
      liabilitiesTotal: '0',
      capital: '100000',
      otherEquity: '0',
      equityPreferred: '0',
      equityPerpetual: '0',
      capitalReserve: '0',
      treasuryStock: '0',
      otherComprehensive: '0',
      specialReserve: '0',
      surplusReserve: '0',
      retainedEarnings: '120000',
      equityTotal: '220000',
      liabilitiesEquityTotal: '220000',
      equityOther: '0',
    };
    expect(r.balance.current).toEqual(balance);
    expect(r.balance.previous).toEqual({
      ...balance,
      cash: '160000',
      currentAssetsTotal: '160000',
      assetsTotal: '160000',
      retainedEarnings: '60000',
      equityTotal: '160000',
      liabilitiesEquityTotal: '160000',
    });
    const profit = {
      revenue: '120000',
      cost: '48000',
      taxes: '0',
      selling: '0',
      administration: '0',
      research: '0',
      finance: '0',
      interestExpense: '0',
      interestIncome: '0',
      otherIncome: '0',
      investmentIncome: '0',
      associateIncome: '0',
      derecognitionIncome: '0',
      hedgeIncome: '0',
      fairValueIncome: '0',
      creditImpairment: '0',
      assetImpairment: '0',
      disposalIncome: '0',
      operatingProfit: '72000',
      nonoperatingIncome: '0',
      nonoperatingExpense: '0',
      profitTotal: '72000',
      incomeTax: '12000',
      netProfit: '60000',
      continuingProfit: '60000',
      discontinuedProfit: '0',
      oci: '0',
      ociNonreclass: '0',
      remeasurement: '0',
      equityNonreclass: '0',
      otherEquityFairValue: '0',
      ownCreditRisk: '0',
      otherNonreclass: '0',
      ociReclass: '0',
      equityReclass: '0',
      debtFairValue: '0',
      financialReclassification: '0',
      debtImpairment: '0',
      cashflowHedge: '0',
      translation: '0',
      otherReclass: '0',
      comprehensiveIncome: '60000',
      basicEps: '不适用',
      dilutedEps: '不适用',
    };
    expect(r.profit.current).toEqual(profit);
    expect(r.profit.previous).toEqual(profit);
    const cashflow = {
      salesReceipts: '120000',
      taxRefunds: '0',
      otherOperatingReceipts: '0',
      operatingReceipts: '120000',
      purchases: '48000',
      employees: '0',
      taxPayments: '12000',
      otherOperatingPayments: '0',
      operatingPayments: '60000',
      operatingNet: '60000',
      investmentRecovery: '0',
      investmentReturns: '0',
      assetDisposals: '0',
      businessDisposals: '0',
      otherInvestingReceipts: '0',
      investingReceipts: '0',
      assetPurchases: '0',
      investmentPayments: '0',
      businessPurchases: '0',
      otherInvestingPayments: '0',
      investingPayments: '0',
      investingNet: '0',
      capitalReceipts: '0',
      loanReceipts: '0',
      otherFinancingReceipts: '0',
      financingReceipts: '0',
      debtPayments: '0',
      dividendInterestPayments: '0',
      otherFinancingPayments: '0',
      financingPayments: '0',
      financingNet: '0',
      exchangeEffect: '0',
      cashIncrease: '60000',
      cashOpening: '160000',
      cashClosing: '220000',
      cashScopeChange: '0',
      actualCashClosing: '220000',
    };
    expect(r.cashflow.current).toEqual(cashflow);
    expect(r.cashflow.previous).toEqual({
      ...cashflow,
      cashOpening: '100000',
      cashClosing: '160000',
      actualCashClosing: '160000',
    });
    for (const column of ['current', 'previous'] as const) {
      const matrix = r.equity[column];
      for (const row of [
        'policy',
        'error',
        'otherAdjustment',
        'contributions',
        'ordinaryContributions',
        'instrumentContributions',
        'sharePayments',
        'otherContributions',
        'distribution',
        'surplusAppropriation',
        'distributions',
        'otherDistribution',
        'transfers',
        'capitalizationReserve',
        'capitalizationSurplus',
        'lossRecovery',
        'benefitTransfer',
        'ociTransfer',
        'otherTransfer',
      ])
        expect(matrix[row], row).toEqual(ZERO);
      expect(matrix.previousClosing).toEqual({
        ...ZERO,
        capital: '100000',
        retainedEarnings: column === 'current' ? '60000' : '0',
        total: column === 'current' ? '160000' : '100000',
      });
      expect(matrix.opening).toEqual(matrix.previousClosing);
      expect(matrix.changes).toEqual({ ...ZERO, retainedEarnings: '60000', total: '60000' });
      expect(matrix.comprehensive).toEqual({ ...ZERO, retainedEarnings: '60000', total: '60000' });
      expect(matrix.closing).toEqual({
        ...ZERO,
        capital: '100000',
        retainedEarnings: column === 'current' ? '120000' : '60000',
        total: column === 'current' ? '220000' : '160000',
      });
    }
    expect(r.checks.every((c) => c.difference === '0')).toBe(true);
  });
  it('w_bb_proc P2：存量比较标签取上年12月，流量比较标签取上年同期', () => {
    const { c, d } = fixture();
    c.period = 202506;
    c.scope = 'month';
    c.eps.push(
      {
        from: 202506,
        to: 202506,
        applicable: false,
        preference: '0',
        dilutions: [],
        ...provenance,
      },
      {
        from: 202406,
        to: 202406,
        applicable: false,
        preference: '0',
        dilutions: [],
        ...provenance,
      },
    );
    const r = calculateEnterprise(c, d);
    expect(r.ranges.balancePrevious).toBe(202412);
    expect(r.ranges.previous.to).toBe(202406);
    expect(r.checks.find((x) => x.statement === 'balance' && x.column === 'previous')?.period).toBe(
      202412,
    );
    expect(
      r.checks.find((x) => x.statement === 'cashflow' && x.column === 'previous')?.period,
    ).toBe(202406);
  });
  it('w_bb_proc 年报必须完整年度、缺期及未知启用前比较拒绝', () => {
    const { c, d } = fixture();
    expect(() => enterpriseRanges({ ...c, period: 202511 })).toThrow('12月');
    d.periods = d.periods.filter((p) => p !== 202406);
    expect(() => calculateEnterprise(c, d)).toThrow('缺少会计期间');
    d.periods.push(202406);
    d.startPeriod = 202501;
    expect(() => calculateEnterprise(c, d)).toThrow('早于账套启用');
  });
  it('w_bb_get 标准名称匹配、不猜编码、未知科目准确提示', () => {
    const a = account(9, '固定资产');
    a.code = '999901';
    expect(suggestEnterpriseRules([a]).suggestions[0]?.line).toBe('fixedAssets');
    expect(suggestEnterpriseRules([account(10, '自定义待核')]).unmatched).toHaveLength(1);
  });
  it('w_bb_proc 往来借贷不跨对象抵销且旧分类不能跨报告日', () => {
    const { c, d } = fixture(),
      a = account(9, '预付账款');
    addAccount(
      c,
      d,
      a,
      { accountId: 9, line: 'prepayments', kind: 'payable', role: 'gross' },
      1000,
      202512,
      { partner: 1 },
    );
    d.balances[202512]!.push({
      ...d.balances[202512]!.at(-1)!,
      dimensions: { partner: 2 },
      closing: -800,
    });
    for (const row of d.balances[202512]!.filter((x) => x.accountId === 9))
      c.facts.push({
        period: 202512,
        basis: 'closing',
        bucket: balanceBucket(row),
        current: true,
        ...provenance,
      });
    const r = calculateBalance(c, d, 202512);
    expect(r.prepayments).toBe('1000');
    expect(r.accountsPayable).toBe('800');
    expect(() => calculateBalance(c, d, 202511)).not.toThrow();
    d.balances[202511]!.push(d.balances[202512]!.at(-1)!);
    expect(() => calculateBalance(c, d, 202511)).toThrow('本报告日');
  });
  it('w_bb_proc 同一客户的两个合同不得抵销、同科目支持合同分项', () => {
    const { c, d } = fixture(),
      a = account(9, '合同结算');
    addAccount(
      c,
      d,
      a,
      { accountId: 9, line: 'contractAssets', kind: 'contract', role: 'gross' },
      200,
      202512,
      { partner: 1 },
    );
    const row = d.balances[202512]!.at(-1)!;
    c.facts.push({
      period: 202512,
      basis: 'closing',
      bucket: balanceBucket(row),
      segments: [
        { key: '合同甲', contractId: '甲', amount: '1000', current: true, ...provenance },
        { key: '合同乙', contractId: '乙', amount: '-800', current: true, ...provenance },
      ],
      ...provenance,
    });
    const r = calculateBalance(c, d, 202512);
    expect(r.contractAssets).toBe('1000');
    expect(r.contractLiabilities).toBe('800');
    c.facts.at(-1)!.segments![1]!.amount = '-700';
    expect(() => calculateBalance(c, d, 202512)).toThrow('合计');
  });
  it('w_bb_proc 同一明细优先股、永续债及负债工具按金额拆分', () => {
    const { c, d } = fixture(),
      a = account(9, '其他权益工具', 'equity', 'credit');
    addAccount(
      c,
      d,
      a,
      { accountId: 9, line: 'otherEquity', kind: 'equityInstrument', role: 'gross' },
      -9000,
    );
    c.facts.push({
      period: 202512,
      basis: 'closing',
      bucket: balanceBucket(d.balances[202512]!.at(-1)!),
      parts: [
        {
          id: '优先',
          amount: '-3000',
          classification: 'equity',
          instrument: 'preferred',
          ...provenance,
        },
        {
          id: '永续',
          amount: '-4000',
          classification: 'equity',
          instrument: 'perpetual',
          ...provenance,
        },
        {
          id: '债务',
          amount: '-2000',
          classification: 'liability',
          instrument: 'perpetual',
          duePeriod: 202812,
          current: false,
          ...provenance,
        },
      ],
      ...provenance,
    });
    const r = calculateBalance(c, d, 202512);
    expect(r.equityPreferred).toBe('3000');
    expect(r.equityPerpetual).toBe('4000');
    expect(r.otherEquity).toBe('7000');
    expect(r.bondsPayable).toBe('2000');
    expect(r.bondPerpetual).toBe('2000');
  });
  it('w_bb_proc 流动性分项及递延收益特殊规则', () => {
    const { c, d } = fixture(),
      a = account(9, '长期借款', 'liability', 'credit');
    addAccount(
      c,
      d,
      a,
      { accountId: 9, line: 'longTermLoans', kind: 'maturity', role: 'gross' },
      -9000,
    );
    c.facts.push({
      period: 202512,
      basis: 'closing',
      bucket: balanceBucket(d.balances[202512]!.at(-1)!),
      segments: [
        { key: '本年到期', amount: '-3000', current: true, duePeriod: 202606, ...provenance },
        { key: '以后到期', amount: '-6000', current: false, duePeriod: 202801, ...provenance },
      ],
      ...provenance,
    });
    addAccount(
      c,
      d,
      account(10, '递延收益', 'liability', 'credit'),
      { accountId: 10, line: 'deferredIncome', kind: 'maturity', role: 'gross' },
      -500,
    );
    c.facts.push({
      period: 202512,
      basis: 'closing',
      bucket: balanceBucket(d.balances[202512]!.at(-1)!),
      current: true,
      duePeriod: 202606,
      ...provenance,
    });
    const r = calculateBalance(c, d, 202512);
    expect(r.currentNoncurrentLiabilities).toBe('3000');
    expect(r.longTermLoans).toBe('6000');
    expect(r.deferredIncome).toBe('500');
  });
  it('w_bb_proc 现金逐笔分配守恒，不能用全期相同净额遮掩漏分', () => {
    const { c, d } = fixture();
    c.cashAllocations.shift();
    expect(() =>
      calculateCashflow(c, d, { from: 202401, to: 202412, label: '本年' }, [], 'current'),
    ).toThrow('未分类');
  });
  it('w_bb_proc 无账务转账的现金质押按真实用途列筹资并核实当日余额', () => {
    const { c, d } = fixture();
    const policy = c.cashPolicies.find((p) => p.period === 202512 && p.basis === 'closing')!;
    policy.accounts = [];
    policy.restrictedAccounts = [1];
    c.cashScopeChanges.push({
      period: 202512,
      date: '2025-12-31',
      accountId: 1,
      amount: '-220000',
      kind: 'restriction',
      parts: [
        { line: 'otherFinancingPayments', amount: '-220000', purpose: '非金融企业短期借款质押' },
      ],
      ...provenance,
    });
    const checks: Parameters<typeof calculateCashflow>[3] = [];
    const r = calculateCashflow(
      c,
      d,
      { from: 202501, to: 202512, label: '本年' },
      checks,
      'current',
    );
    expect(r.cashScopeChange).toBe('-220000');
    expect(r.actualCashClosing).toBe('0');
    expect(r.cashClosing).toBe('0');
    expect(r.cashOpening).toBe('160000');
    expect(r.otherFinancingPayments).toBe('220000');
    expect(r.financingNet).toBe('-220000');
    expect(r.cashIncrease).toBe('-160000');
    expect(r.exchangeEffect).toBe('0');
    expect(checks[0]?.difference).toBe('0');
    c.cashScopeChanges[0]!.amount = '-219999';
    expect(() =>
      calculateCashflow(c, d, { from: 202501, to: 202512, label: '本年' }, [], 'current'),
    ).toThrow('当日账面');
  });
  it('w_bb_proc 首日限制及解除限制均以实际期末现金列报，范围变化不计汇兑', () => {
    for (const restriction of [true, false]) {
      const { c, d } = fixture();
      for (const policy of c.cashPolicies) {
        if (
          (restriction && policy.period === 202512 && policy.basis === 'closing') ||
          (!restriction && policy.period <= 202501)
        ) {
          policy.accounts = [];
          policy.restrictedAccounts = [1];
        }
      }
      c.cashScopeChanges.push({
        period: restriction ? 202512 : 202501,
        date: restriction ? '2025-12-01' : '2025-01-01',
        accountId: 1,
        amount: restriction ? '-215000' : '160000',
        kind: restriction ? 'restriction' : 'release',
        parts: [
          {
            line: restriction ? 'otherFinancingPayments' : 'otherFinancingReceipts',
            amount: restriction ? '-215000' : '160000',
            purpose: '非金融企业短借质押及解除',
          },
        ],
        ...provenance,
      });
      if (restriction)
        for (const allocation of c.cashAllocations)
          if (d.entries.some((e) => e.lineId === allocation.lineId && e.period === 202512))
            allocation.parts = [{ line: 'excluded', amount: allocation.parts[0]!.amount }];
      const checks: Parameters<typeof calculateCashflow>[3] = [];
      const r = calculateCashflow(
        c,
        d,
        { from: 202501, to: 202512, label: '本年' },
        checks,
        'current',
      );
      expect(r.cashOpening).toBe(restriction ? '160000' : '0');
      expect(r.cashIncrease).toBe(restriction ? '-160000' : '220000');
      expect(r.financingNet).toBe(restriction ? '-215000' : '160000');
      expect(r.cashScopeChange).toBe(restriction ? '-215000' : '160000');
      expect(r.cashClosing).toBe(restriction ? '0' : '220000');
      expect(r.cashClosing).toBe(r.actualCashClosing);
      expect(r.exchangeEffect).toBe('0');
      expect(checks.every((check) => check.difference === '0')).toBe(true);
    }
  });
  it('w_bb_proc 已确认上期期末范围不能在期初静默切换，首日变化须单独记录', () => {
    const { c, d } = fixture();
    for (const policy of c.cashPolicies.filter((p) => p.period >= 202501)) {
      policy.accounts = [];
      policy.restrictedAccounts = [1];
    }
    for (const allocation of c.cashAllocations)
      if (d.entries.some((e) => e.lineId === allocation.lineId && e.period >= 202501))
        allocation.parts = [{ line: 'excluded', amount: allocation.parts[0]!.amount }];
    expect(() =>
      calculateCashflow(c, d, { from: 202501, to: 202512, label: '本年' }, [], 'current'),
    ).toThrow('期初现金范围与上期期末不一致');
    const opening = c.cashPolicies.find((p) => p.period === 202501 && p.basis === 'opening')!;
    opening.accounts = [1];
    opening.restrictedAccounts = [];
    c.cashScopeChanges.push({
      period: 202501,
      date: '2025-01-01',
      accountId: 1,
      amount: '-160000',
      kind: 'restriction',
      parts: [
        { line: 'otherFinancingPayments', amount: '-160000', purpose: '非金融企业短期借款质押' },
      ],
      ...provenance,
    });
    const result = calculateCashflow(
      c,
      d,
      { from: 202501, to: 202512, label: '本年' },
      [],
      'current',
    );
    expect(result.cashOpening).toBe('160000');
    expect(result.cashScopeChange).toBe('-160000');
    expect(result.cashClosing).toBe('0');
    expect(result.cashIncrease).toBe('-160000');
    expect(result.financingNet).toBe('-160000');
  });
  it('w_bb_proc 比较期持续及终止经营有据重分类不得被账务分部覆盖', () => {
    const { c, d } = fixture();
    c.adjustments.push(
      {
        period: 202412,
        statement: 'profit',
        row: 'discontinuedProfit',
        amount: '10000',
        kind: 'policy',
        ...provenance,
      },
      {
        period: 202412,
        statement: 'profit',
        row: 'continuingProfit',
        amount: '-10000',
        kind: 'policy',
        ...provenance,
      },
    );
    const result = calculateEnterprise(c, d);
    expect(result.profit.previous.discontinuedProfit).toBe('10000');
    expect(result.profit.previous.continuingProfit).toBe('50000');
    expect(result.profit.previous.netProfit).toBe('60000');
    expect(result.profit.current.discontinuedProfit).toBe('0');
    expect(result.profit.current.continuingProfit).toBe('60000');
    expect(result.checks.every((check) => check.difference === '0')).toBe(true);
    c.adjustments.pop();
    const invalid = calculateEnterprise(c, d);
    expect(
      invalid.checks.find(
        (check) => check.row === '净利润＝持续经营＋终止经营' && check.column === 'previous',
      )?.difference,
    ).toBe('-10000');
  });
  it('w_bb_proc 限制及解除必须有活动、用途和守恒分配，不能用汇兑或政策调节绕过', () => {
    const { c, d } = fixture();
    const policy = c.cashPolicies.find((p) => p.period === 202512 && p.basis === 'closing')!;
    policy.accounts = [];
    policy.restrictedAccounts = [1];
    c.cashScopeChanges.push({
      period: 202512,
      date: '2025-12-31',
      accountId: 1,
      amount: '-220000',
      kind: 'restriction',
      ...provenance,
    });
    const change = c.cashScopeChanges[0]!,
      calculate = () => calculateEnterprise(c, d);
    expect(calculate).toThrow('缺少活动分类及用途依据');
    change.parts = [{ line: 'exchangeEffect', amount: '-220000', purpose: '真实短借质押' }];
    expect(calculate).toThrow('不能列作汇率影响或表外调节');
    change.parts[0]!.line = 'otherFinancingPayments';
    change.parts[0]!.amount = '-219999';
    expect(calculate).toThrow('活动分配与实际金额不一致');
    change.parts[0]!.amount = '-220000';
    change.parts[0]!.line = 'otherFinancingReceipts';
    expect(calculate).toThrow('收付方向或用途依据无效');
    change.parts[0]!.line = 'otherFinancingPayments';
    change.kind = 'policy';
    expect(calculate).toThrow('纯政策追溯不能作为期中现金范围调节');
    change.kind = 'restriction';
    change.parts[0]!.purpose = '';
    expect(calculate).toThrow();
  });
  it('w_bb_proc 按用途拆分三类活动并保持正式五六项及比较期首尾勾稽', () => {
    const { c, d } = fixture();
    const previousEnd = c.cashPolicies.find((p) => p.period === 202412 && p.basis === 'closing')!,
      currentStart = c.cashPolicies.find((p) => p.period === 202501 && p.basis === 'opening')!;
    for (const policy of [previousEnd, currentStart]) {
      policy.accounts = [];
      policy.restrictedAccounts = [1];
    }
    c.cashScopeChanges.push(
      {
        period: 202412,
        date: '2024-12-31',
        accountId: 1,
        amount: '-160000',
        kind: 'restriction',
        parts: [
          { line: 'otherOperatingPayments', amount: '-30000', purpose: '经营履约保证金限制' },
          { line: 'otherInvestingPayments', amount: '-50000', purpose: '长期资产投资保证金限制' },
          { line: 'otherFinancingPayments', amount: '-80000', purpose: '非金融企业借款质押' },
        ],
        ...provenance,
      },
      {
        period: 202501,
        date: '2025-01-01',
        accountId: 1,
        amount: '160000',
        kind: 'release',
        parts: [
          { line: 'otherOperatingReceipts', amount: '30000', purpose: '经营履约保证金解除' },
          { line: 'otherInvestingReceipts', amount: '50000', purpose: '长期资产投资保证金解除' },
          { line: 'otherFinancingReceipts', amount: '80000', purpose: '非金融企业借款质押解除' },
        ],
        ...provenance,
      },
    );
    const result = calculateEnterprise(c, d);
    expect(result.cashflow.previous.operatingNet).toBe('30000');
    expect(result.cashflow.previous.investingNet).toBe('-50000');
    expect(result.cashflow.previous.financingNet).toBe('-80000');
    expect(result.cashflow.previous.cashOpening).toBe('100000');
    expect(result.cashflow.previous.cashIncrease).toBe('-100000');
    expect(result.cashflow.previous.cashClosing).toBe('0');
    expect(result.cashflow.current.operatingNet).toBe('90000');
    expect(result.cashflow.current.investingNet).toBe('50000');
    expect(result.cashflow.current.financingNet).toBe('80000');
    expect(result.cashflow.current.cashOpening).toBe('0');
    expect(result.cashflow.current.cashIncrease).toBe('220000');
    expect(result.cashflow.current.cashClosing).toBe('220000');
    expect(result.cashflow.current.exchangeEffect).toBe('0');
    expect(result.cashflow.previous.exchangeEffect).toBe('0');
    expect(result.checks.every((check) => check.difference === '0')).toBe(true);
  });
  it('w_bb_proc 纯政策追溯按同一范围重列期初和比较期，不虚构期中现金收付', () => {
    const { c, d } = fixture();
    const deposit = account(8, '按新政策追溯纳入的短期存款');
    for (const period of d.periods) {
      d.balances[period]!.push({
        ...d.balances[period]![0]!,
        accountId: deposit.id,
        accountCode: deposit.code,
        accountName: deposit.name,
        opening: 10000,
        closing: 10000,
      });
      for (const policy of c.cashPolicies.filter((p) => p.period === period)) {
        policy.accounts.push(deposit.id);
        policy.source = '合成政策变更决定：同一政策追溯覆盖比较期及本期期初期末';
        policy.version = '2';
      }
    }
    d.accounts.push(deposit);
    const previous = calculateCashflow(
        c,
        d,
        { from: 202401, to: 202412, label: '上年' },
        [],
        'previous',
      ),
      current = calculateCashflow(c, d, { from: 202501, to: 202512, label: '本年' }, [], 'current');
    expect(previous.cashOpening).toBe('110000');
    expect(previous.cashClosing).toBe('170000');
    expect(current.cashOpening).toBe('170000');
    expect(current.cashClosing).toBe('230000');
    expect(previous.cashIncrease).toBe('60000');
    expect(current.cashIncrease).toBe('60000');
    expect(previous.cashScopeChange).toBe('0');
    expect(current.cashScopeChange).toBe('0');
  });
  it('w_bb_proc 固定资产净额不重复扣减、缺备抵拒绝', () => {
    const { c, d } = fixture();
    addAccount(
      c,
      d,
      account(9, '固定资产'),
      { accountId: 9, line: 'fixedAssets', kind: 'balance', role: 'gross' },
      10000,
    );
    addAccount(
      c,
      d,
      account(10, '累计折旧', 'asset', 'credit'),
      { accountId: 10, line: 'fixedAssets', kind: 'balance', role: 'depreciation' },
      -2000,
    );
    expect(calculateBalance(c, d, 202512).fixedAssets).toBe('8000');
    expect(() => calculateEnterprise(c, d)).toThrow('缺少组成角色');
  });
  it('w_bb_proc 每股收益按覆盖日数的普通股和反稀释排除', () => {
    const { c, d } = fixture();
    c.shares = [{ from: '2025-01-01', to: '2025-12-31', ordinary: '1000', ...provenance }];
    c.eps.find((e) => e.from === 202501)!.applicable = true;
    c.eps.find((e) => e.from === 202501)!.dilutions = [
      { numerator: '0', shares: '1000', ...provenance },
      { numerator: '100000', shares: '1', ...provenance },
    ];
    const r = calculateProfit(c, d, { from: 202501, to: 202512, label: '本年' });
    expect(r.basicEps).toBe('0.6000');
    expect(r.dilutedEps).toBe('0.3000');
  });
  it('w_bb_get 2026新准则不按发布日期切换、主体强制日期及提前执行独立', () => {
    const { c, d } = fixture();
    c.period = 202612;
    c.scope = 'annual';
    c.adoption.entityClass = 'dualListed';
    expect(() => enterpriseRanges(c)).not.toThrow();
    c.period = 202712;
    expect(() => calculateEnterprise(c, d)).toThrow('已采用2026');
    c.period = 202512;
    c.adoption.cas30_2026 = '2025-01-01';
    expect(() => calculateEnterprise(c, d)).toThrow('正式发布日期');
  });
  it('w_bb_proc fast-check 往来分项方向不抵销', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 100000 }),
        (debit, credit) => {
          const { c, d } = fixture(),
            a = account(9, '预付账款');
          addAccount(
            c,
            d,
            a,
            { accountId: 9, line: 'prepayments', kind: 'payable', role: 'gross' },
            debit - credit,
          );
          const row = d.balances[202512]!.at(-1)!;
          c.facts.push({
            period: 202512,
            basis: 'closing',
            bucket: balanceBucket(row),
            segments: [
              { key: '一', amount: String(debit), current: true, ...provenance },
              { key: '二', amount: String(-credit), current: true, ...provenance },
            ],
            ...provenance,
          });
          const r = calculateBalance(c, d, 202512);
          expect(r.prepayments).toBe(String(debit));
          expect(r.accountsPayable).toBe(String(credit));
        },
      ),
    );
  });
});
it('w_bb_proc 独审回归：负债金融工具到期必须转流动项目', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '应付债券', 'liability', 'credit'),
    { accountId: 9, line: 'bondsPayable', kind: 'equityInstrument', role: 'gross' },
    -10000,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    parts: [
      {
        id: '债券甲',
        amount: '-10000',
        classification: 'liability',
        instrument: 'other',
        current: true,
        duePeriod: 202606,
        ...provenance,
      },
    ],
    ...provenance,
  });
  const b = calculateBalance(c, d, 202512);
  expect(b.currentNoncurrentLiabilities).toBe('10000');
  expect(b.bondsPayable).toBe('0');
});
it('w_bb_proc 独审回归：金融备抵继承目标报告日分类，冲突事实拒绝', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '债权投资'),
    { accountId: 9, line: 'debtInvestments', kind: 'financial', role: 'gross' },
    10000,
  );
  const target = balanceBucket(d.balances[202512]!.at(-1)!);
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: target,
    category: 'amortized',
    sppi: true,
    businessModel: 'collect',
    duePeriod: 202712,
    expectedHoldMonths: 24,
    originallyLongTerm: true,
    ...provenance,
  });
  addAccount(
    c,
    d,
    account(10, '债权投资减值准备', 'asset', 'credit'),
    { accountId: 10, line: 'debtInvestments', kind: 'financial', role: 'allowance' },
    -1000,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    allowanceFor: target,
    ...provenance,
  });
  const b = calculateBalance(c, d, 202512);
  expect(b.debtInvestments).toBe('9000');
  expect(b.currentNoncurrentAssets).toBe('0');
  c.facts.at(-1)!.duePeriod = 202606;
  expect(() => calculateBalance(c, d, 202512)).toThrow('分类与对应资产不一致');
});
it('w_bb_proc 独审回归：其他应收款贷方按对象转其他应付款', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '其他应收款'),
    { accountId: 9, line: 'otherReceivables', kind: 'receivable', role: 'gross' },
    -10000,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    current: true,
    ...provenance,
  });
  const b = calculateBalance(c, d, 202512);
  expect(b.otherReceivables).toBe('0');
  expect(b.otherPayables).toBe('10000');
});
it('w_bb_proc 独审回归：同一合同净资产可以按流动及非流动拆分', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '合同资产'),
    { accountId: 9, line: 'contractAssets', kind: 'contract', role: 'gross' },
    20000,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    segments: [
      { key: '甲-流动', contractId: '合同甲', amount: '10000', current: true, ...provenance },
      { key: '甲-长期', contractId: '合同甲', amount: '10000', current: false, ...provenance },
    ],
    ...provenance,
  });
  const b = calculateBalance(c, d, 202512);
  expect(b.contractAssets).toBe('10000');
  expect(b.otherNoncurrentAssets).toBe('10000');
});
it('w_bb_proc 普通业务或自定义转账伪标损益结转仍计入利润', () => {
  const { c, d } = fixture();
  const original = d.vouchers.find((v) => v.closingKind === 'pnl')!;
  original.source = null;
  const p = calculateProfit(c, d, { from: 202401, to: 202412, label: '本年' });
  expect(p.revenue).toBe('110000');
  expect(p.cost).toBe('44000');
  expect(p.incomeTax).toBe('11000');
  expect(p.netProfit).toBe('55000');
});
it('w_bb_proc 未结转与已结转净利润都与资产负债表闭合', () => {
  const { c, d } = fixture();
  const ids = new Set(
    d.vouchers.filter((v) => v.period === 202512 && v.closingKind === 'pnl').map((v) => v.id),
  );
  d.entries = d.entries.filter((e) => !ids.has(e.voucherId));
  d.vouchers = d.vouchers.filter((v) => !ids.has(v.id));
  const rows = d.balances[202512]!;
  rows.find((r) => r.accountId === 3)!.closing = -10000;
  rows.find((r) => r.accountId === 4)!.closing = 4000;
  rows.find((r) => r.accountId === 5)!.closing = 1000;
  rows.find((r) => r.accountId === 6)!.closing = 5000;
  const r = calculateEnterprise(c, d);
  expect(r.balance.current.retainedEarnings).toBe('120000');
  expect(r.profit.current.netProfit).toBe('60000');
  expect(
    r.checks.find((x) => x.row === '净利润与真实结转及未结转损益' && x.column === 'current')
      ?.difference,
  ).toBe('0');
});
it('w_bb_proc 权益投资无合同到期日不强迫编造期限，交易性与指定OCI分别列报', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '其他权益工具投资'),
    { accountId: 9, line: 'otherEquityInvestments', kind: 'financial', role: 'gross' },
    10000,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    category: 'equity-fvoci',
    nonTrading: true,
    irrevocableElection: true,
    ...provenance,
  });
  expect(calculateBalance(c, d, 202512).otherEquityInvestments).toBe('10000');
  c.rules.at(-1)!.line = 'tradingAssets';
  Object.assign(c.facts.at(-1)!, {
    category: 'fvtpl',
    contractualMaturity: 'none',
    expectedHoldMonths: 24,
  });
  expect(calculateBalance(c, d, 202512).otherFinancialAssets).toBe('10000');
});
it('w_bb_proc 非流动税费借方不得机械冒充递延所得税资产', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '应交税费'),
    { accountId: 9, line: 'taxesPayable', kind: 'receivable', role: 'gross' },
    1000,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    current: false,
    ...provenance,
  });
  const b = calculateBalance(c, d, 202512);
  expect(b.otherNoncurrentAssets).toBe('1000');
  expect(b.deferredTaxAssets).toBe('0');
});
it('w_bb_proc 同一坏账准备科目按真实对象跨项目分配，不需为报表改账务科目', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '应收账款'),
    { accountId: 9, line: 'accountsReceivable', kind: 'receivable', role: 'gross' },
    1000,
  );
  const first = balanceBucket(d.balances[202512]!.at(-1)!);
  c.facts.push({ period: 202512, basis: 'closing', bucket: first, current: true, ...provenance });
  addAccount(
    c,
    d,
    account(10, '其他应收款'),
    { accountId: 10, line: 'otherReceivables', kind: 'receivable', role: 'gross' },
    500,
  );
  const second = balanceBucket(d.balances[202512]!.at(-1)!);
  c.facts.push({ period: 202512, basis: 'closing', bucket: second, current: true, ...provenance });
  addAccount(
    c,
    d,
    account(11, '坏账准备', 'asset', 'credit'),
    { accountId: 11, line: 'accountsReceivable', kind: 'receivable', role: 'allowance' },
    -150,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    segments: [
      { key: '应收账款减值', amount: '-100', allowanceFor: first, ...provenance },
      { key: '其他应收款减值', amount: '-50', allowanceFor: second, ...provenance },
    ],
    ...provenance,
  });
  const b = calculateBalance(c, d, 202512);
  expect(b.accountsReceivable).toBe('900');
  expect(b.otherReceivables).toBe('450');
});
it('w_bb_proc 独审回归：长期应收款按绑定未实现融资收益净额列报', () => {
  const { c, d } = fixture();
  addAccount(
    c,
    d,
    account(9, '长期应收款'),
    { accountId: 9, line: 'longTermReceivables', kind: 'maturity', role: 'gross' },
    10000,
  );
  const target = balanceBucket(d.balances[202512]!.at(-1)!);
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: target,
    current: false,
    duePeriod: 202712,
    ...provenance,
  });
  addAccount(
    c,
    d,
    account(10, '未实现融资收益', 'asset', 'credit'),
    { accountId: 10, line: 'longTermReceivables', kind: 'maturity', role: 'financing' },
    -1000,
  );
  c.facts.push({
    period: 202512,
    basis: 'closing',
    bucket: balanceBucket(d.balances[202512]!.at(-1)!),
    allowanceFor: target,
    ...provenance,
  });
  expect(calculateBalance(c, d, 202512).longTermReceivables).toBe('9000');
});
