import { expect, it } from 'vitest';
import { retrospectiveBridge } from '../../templates/nonprofit/retrospective';
import { blankConfiguration, annual } from './fixture';
import type { Configuration, Sources, Statement } from '../../templates/nonprofit/model';

function sources(year: number, to: number, opening: number, closing: number): Sources {
  return {
    from: year * 100 + 1,
    to,
    openingDate: `${year}-01-01`,
    closingDate: `${year}-${String(to % 100).padStart(2, '0')}-${to % 100 === 6 ? '30' : '31'}`,
    accounts: [
      { id: 1, code: '1002', isLeaf: true, isBank: true, categoryId: 'asset' },
      { id: 2, code: '3101', isLeaf: true, categoryId: 'net-assets' },
    ],
    categories: [
      { id: 'asset', isPnl: false },
      { id: 'net-assets', isPnl: false },
    ],
    balances: [
      { accountId: 1, accountCode: '1002', dimensions: {}, opening, closing },
      { accountId: 2, accountCode: '3101', dimensions: {}, opening: -opening, closing: -closing },
    ],
  } as unknown as Sources;
}
function statement(year = 2027): Statement {
  return {
    code: '402',
    name: '业务活动表',
    organization: '合成组织',
    period: { ...annual, code: '402', from: year * 100 + 1, to: year * 100 + 12 },
    columns: [],
    rows: [],
    checks: [],
    notes: [],
    unpostedCount: 0,
  };
}
function change(
  at: 'opening' | 'closing',
  period: number,
  original: number,
  delta: number,
): NonNullable<Configuration['comparison']>['balanceAdjustments'] {
  return [
    { at, period, key: '1002::', originalBalance: original, delta, basis: '合成银行原始追溯底稿' },
    {
      at,
      period,
      key: '3101::',
      originalBalance: -original,
      delta: -delta,
      basis: '合成净资产原始追溯底稿',
    },
  ];
}

it('w_bb_proc 中期追溯本期与累计分别使用真实起点，年末调整由次年年初承接', () => {
  const prior = sources(2026, 202606, 100, 200),
    march = sources(2026, 202603, 100, 160),
    december = sources(2026, 202612, 100, 300),
    current = sources(2027, 202706, 310, 310),
    pc = blankConfiguration('合成中期承接'),
    c = blankConfiguration('合成中期承接', 2027);
  const cs = statement();
  cs.period = { ...cs.period, kind: 'quarter', from: 202704, to: 202706 };
  c.policyChangeReference = '合成政策变更及逐期更正底稿';
  c.comparison = {
    basis: '合成真实可比期间',
    restatements: [],
    balanceAdjustments: [
      ...change('opening', 202601, 100, 2)!,
      ...change('closing', 202603, 160, 5)!,
      ...change('closing', 202606, 200, 8)!,
      ...change('closing', 202612, 300, 10)!,
    ],
    retrospectivePeriods: [
      { at: 'opening', period: 202601, basis: '合成年初全量核对' },
      { at: 'closing', period: 202603, basis: '合成季度起点全量核对' },
      { at: 'closing', period: 202606, basis: '合成季度末全量核对' },
      { at: 'closing', period: 202612, basis: '合成年末全量核对' },
    ],
  };
  expect(
    retrospectiveBridge(current, prior, c, pc, cs, statement(2026), [march, december]),
  ).toEqual({
    netChangeDelta: 3,
    netChangeYtdDelta: 6,
    cashOpeningDelta: 0,
    cashClosingDelta: 0,
  });
  const missing = structuredClone(c);
  missing.comparison!.retrospectivePeriods = missing.comparison!.retrospectivePeriods!.filter(
    (x) => x.period !== 202603,
  );
  expect(() =>
    retrospectiveBridge(current, prior, missing, pc, cs, statement(2026), [march, december]),
  ).toThrow(/202603/);
  const wrong = structuredClone(c);
  wrong.comparison!.balanceAdjustments![4]!.originalBalance++;
  expect(() =>
    retrospectiveBridge(current, prior, wrong, pc, cs, statement(2026), [march, december]),
  ).toThrow(/原余额/);
});

it('w_bb_proc 中期比较也核对真正上年年末，不能把六月余额承接到次年年初', () => {
  const c = blankConfiguration('合成中期', 2027),
    pc = blankConfiguration('合成中期');
  const cs = statement();
  cs.period = { ...cs.period, kind: 'month', from: 202706, to: 202706 };
  expect(() =>
    retrospectiveBridge(
      sources(2027, 202706, 200, 200),
      sources(2026, 202606, 100, 200),
      c,
      pc,
      cs,
      statement(2026),
    ),
  ).toThrow(/上年度年末真实来源/);
  expect(() =>
    retrospectiveBridge(
      sources(2027, 202706, 200, 200),
      sources(2026, 202606, 100, 200),
      c,
      pc,
      cs,
      statement(2026),
      [sources(2026, 202612, 100, 300)],
    ),
  ).toThrow(/次年年初/);
});

it('w_bb_proc 混合资金按两个原时点逐部分重列，现金范围变化不使用期末分类回填年初', () => {
  const prior = sources(2026, 202612, 100, 150),
    current = sources(2027, 202712, 160, 160),
    pc = blankConfiguration('合成混合资金'),
    c = blankConfiguration('合成混合资金', 2027);
  const scope: Configuration['cashScope'] = [
    {
      account: '1002',
      included: true,
      partitioned: true,
      restricted: true,
      agency: false,
      equivalent: false,
      basis: '合成可用及受限部分文件',
    },
  ];
  const fact = (
    at: string,
    balance: number,
    available: number,
  ): Configuration['balanceFacts'][number] => ({
    at,
    key: '1002::',
    balance,
    allocations: [
      {
        row: 'cash',
        amount: available,
        agency: false,
        cashIncluded: true,
        sourceReference: '合成可用款凭据',
      },
      {
        row: 'cash',
        amount: balance - available,
        agency: false,
        cashIncluded: false,
        sourceReference: '合成受限款凭据',
      },
    ],
  });
  pc.cashScope = scope;
  pc.balanceFacts = [fact('2026-01-01', 100, 60), fact('2026-12-31', 150, 90)];
  c.policyChangeReference = '合成会计政策追溯及原始银行凭据';
  c.comparison = {
    basis: '合成混合资金历史重列',
    restatements: [],
    balanceAdjustments: change('closing', 202612, 150, 10),
    cashRestatements: [
      {
        at: 'opening',
        basis: '合成原年初分类文件',
        cashPolicy: '合成追溯政策',
        cashScope: scope,
        balanceFacts: [fact('2026-01-01', 100, 70)],
      },
      {
        at: 'closing',
        basis: '合成原年末分类文件',
        cashPolicy: '合成追溯政策',
        cashScope: scope,
        balanceFacts: [fact('2026-12-31', 160, 100)],
      },
    ],
  };
  const ps = { ...statement(2026), code: '403' as const, cashOpening: 60, cashClosing: 90 },
    cs = { ...statement(), code: '403' as const, cashOpening: 100, cashClosing: 100 };
  expect(retrospectiveBridge(current, prior, c, pc, cs, ps)).toEqual({
    netChangeDelta: 10,
    netChangeYtdDelta: 10,
    cashOpeningDelta: 10,
    cashClosingDelta: 10,
  });
  const bad = structuredClone(c);
  bad.comparison!.cashRestatements![0]!.balanceFacts[0]!.balance++;
  expect(() => retrospectiveBridge(current, prior, bad, pc, cs, ps)).toThrow(/原时点真实余额/);
  const missing = structuredClone(c);
  delete missing.comparison!.cashRestatements;
  expect(() => retrospectiveBridge(current, prior, missing, pc, cs, ps)).toThrow(
    /现金范围分配不完整/,
  );
});
