import { expect, it } from 'vitest';
import fc from 'fast-check';
import {
  balanceSheet,
  incomeStatement,
  cashflowStatement,
} from '../../templates/small-business/statements';
import {
  rowKey,
  incomeDetails,
  entrySignature,
  sum,
  type Role,
} from '../../templates/small-business/configuration';
import { domain, addBalance, balanceRow, entry, classify } from './domain-fixture';
function fullBalance() {
  const d = domain();
  const values: Partial<Record<Role, number>> = {
    money: 100000,
    shortInvestment: 200,
    notesReceivable: 300,
    receivable: 400,
    prepaid: 500,
    dividend: 600,
    interest: 700,
    otherReceivable: 800,
    purchases: 101,
    inTransit: 102,
    raw: 1003,
    materialVariance: -104,
    work: 1005,
    goods: 1006,
    goodsVariance: -107,
    outsourced: 108,
    turnover: 1009,
    biologicalInventory: 110,
    otherInventory: 111,
    currentAsset: 1400,
    bond: 1600,
    equityInvestment: 1700,
    fixed: 18000,
    depreciation: -1900,
    construction: 2100,
    constructionMaterials: 2200,
    disposal: -230,
    biological: 2400,
    biologicalDepreciation: -240,
    intangible: 2500,
    amortization: -250,
    development: 2600,
    deferredExpense: 2700,
    noncurrentAsset: 2800,
    shortLoan: -3100,
    notesPayable: -3200,
    payable: -3300,
    advance: -3400,
    payroll: -3500,
    taxes: 360,
    interestPayable: -370,
    profitPayable: -380,
    otherPayable: -3900,
    currentLiability: -4000,
    longLoan: -4200,
    longPayable: -4300,
    deferredIncome: -4400,
    noncurrentLiability: -4500,
    capital: -48000,
    capitalReserve: -4900,
    surplus: -5000,
    currentProfit: -5100,
    retained: -5100,
    revenue: -100,
  };
  for (const [role, value] of Object.entries(values)) addBalance(d, role as Role, value);
  for (const r of d.closing) {
    const role = d.roles.get(r.accountCode)!;
    if (
      ![
        'prepaid',
        'advance',
        'bond',
        'deferredExpense',
        'longLoan',
        'longPayable',
        'deferredIncome',
        'capital',
        'development',
      ].includes(role)
    )
      continue;
    const parts =
      role === 'prepaid'
        ? [
            { role: 'prepaid' as const, amount: 300 },
            { role: 'noncurrentAsset' as const, amount: 200 },
          ]
        : role === 'advance'
          ? [
              { role: 'advance' as const, amount: -3100 },
              { role: 'noncurrentLiability' as const, amount: -300 },
            ]
          : role === 'bond'
            ? [
                { role: 'bond' as const, amount: 1500 },
                { role: 'currentAsset' as const, amount: 100 },
              ]
            : role === 'deferredExpense'
              ? [
                  { role: 'deferredExpense' as const, amount: 2500 },
                  { role: 'currentAsset' as const, amount: 200 },
                ]
              : ['longLoan', 'longPayable', 'deferredIncome'].includes(role)
                ? [
                    { role, amount: -4000 },
                    { role: 'currentLiability' as const, amount: r.closing + 4000 },
                  ]
                : [{ role, amount: r.closing }];
    for (const period of [202512, 202612])
      d.config.facts.push({
        period,
        key: rowKey(r),
        balance: r.closing,
        reason: '合同期限及性质确认',
        allocations: parts,
      });
  }
  return d;
}
it('w_bb_proc 301全部53行两列独立手算，包含存货差异、折旧、摊销和借方税费负数', () => {
  const s = balanceSheet(fullBalance());
  const expected = [
    100000, 200, 300, 400, 300, 600, 700, 800, 4344, 1003, 1005, 1006, 1009, 1700, 109344, 1500,
    1700, 18000, 1900, 16100, 2100, 2200, -230, 2160, 2250, 2600, 2500, 3000, 35880, 145224, 3100,
    3200, 3300, 3100, 3500, -360, 370, 380, 3900, 4900, 25390, 4000, 4000, 4000, 4800, 16800, 42190,
    48000, 4900, 5000, 10300, 68200, 110390,
  ];
  expect(s.rows).toHaveLength(53);
  for (const r of s.rows)
    for (const c of [0, 1])
      expect(r.amounts[c]?.value, `行${r.line}列${c}`).toBe(expected[r.line - 1]);
  expect(s.checks.map((c) => c.difference)).toEqual([34834, 34834]);
});
it('w_bb_proc 年初与期末期限事实分别核验，余额变化拒绝', () => {
  const d = fullBalance();
  d.config.facts = d.config.facts.filter((f) => f.period !== 202512);
  expect(() => balanceSheet(d)).toThrow(/确认缺失/);
  const next = fullBalance();
  next.config.facts[0]!.balance++;
  expect(() => balanceSheet(next)).toThrow(/余额已变化/);
});
it('w_bb_proc 存货有符号差异不取绝对值', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -1000000, max: 1000000 }),
      fc.integer({ min: -1000000, max: 1000000 }),
      (a, b) => {
        const d = domain();
        addBalance(d, 'materialVariance', a);
        addBalance(d, 'goodsVariance', b);
        expect(balanceSheet(d).rows[8]!.amounts[0].value).toBe(a + b);
      },
    ),
  );
});
function fullIncome() {
  const d = domain();
  let id = 1;
  for (const [line, value] of [
    [4, 1],
    [5, 2],
    [6, 3],
    [7, 4],
    [8, 5],
    [9, 6],
    [10, 7],
    [12, 1101],
    [13, 1301],
    [15, 1501],
    [16, 1601],
    [17, 1701],
    [19, 1700],
    [23, -2301],
    [25, 2501],
    [26, 2601],
    [27, 2701],
    [28, 2801],
    [29, 2901],
  ] as const) {
    const code = String(9000 + line);
    d.roles.set(code, incomeDetails[line]!.role);
    d.config.details[code] = { line, reason: '业务明细' };
    for (let m = 1; m <= 12; m++) d.current.push(entry(code, value, id++, 202600 + m));
  }
  for (const [role, value] of [
    ['revenue', -50001],
    ['cost', 20001],
    ['investmentIncome', -2001],
    ['incomeTax', 1001],
  ] as const) {
    const code = String(9500 + id);
    d.roles.set(code, role);
    for (let m = 1; m <= 12; m++) d.current.push(entry(code, value, id++, 202600 + m));
  }
  d.comparison = d.current.filter((e) => e.period === 202601);
  return d;
}
it('w_bb_proc 302全部32行全年与本月逐格手算', () => {
  const s = incomeStatement(fullIncome());
  const monthly = [
    50001, 20001, 28, 1, 2, 3, 4, 5, 6, 7, 2402, 1101, 1301, 4803, 1501, 1601, 1701, 1700, 1700,
    2001, 23068, 2301, 2301, 13505, 2501, 2601, 2701, 2801, 2901, 11864, 1001, 10863,
  ];
  const annual = [
    600012, 240012, 336, 12, 24, 36, 48, 60, 72, 84, 28824, 13212, 15612, 57636, 18012, 19212,
    20412, 20400, 20400, 24012, 276816, 27612, 27612, 162060, 30012, 31212, 32412, 33612, 34812,
    142368, 12012, 130356,
  ];
  for (const r of s.rows) {
    expect(r.amounts[0].value, `累计行${r.line}`).toBe(annual[r.line - 1]);
    expect(r.amounts[1]?.value, `本月行${r.line}`).toBe(monthly[r.line - 1]);
  }
  expect(s.checks.every((c) => c.difference === 0)).toBe(true);
});
it('w_bb_proc 只有真实损益结转排除，普通自定义转账及利息退款保留，缺明细拒绝', () => {
  const d = fullIncome();
  d.current.push(entry('9004', 123, 999));
  d.closingKinds.set(999, 'custom');
  expect(incomeStatement(d).rows[3]!.amounts[0].value).toBe(135);
  d.closingKinds.set(999, 'pnl');
  expect(incomeStatement(d).rows[3]!.amounts[0].value).toBe(12);
  d.current.push(entry('9019', -200, 1000));
  expect(incomeStatement(d).rows[18]!.amounts[0].value).toBe(20200);
  delete d.config.details['9004'];
  expect(() => incomeStatement(d)).toThrow(/尚未分类/);
});
function fullCash() {
  const d = domain();
  for (const code of ['1001', '1002', '1012']) d.roles.set(code, 'money');
  d.config.cashScope = ['1001', '1002', '1012'].map((account) => ({
    account,
    from: '2025-01-01',
    to: '2026-12-31',
    available: account !== '1012',
    reason: account === '1012' ? '冻结保证金' : '随时可支付',
  }));
  let id = 1;
  for (const [line, value] of [
    [1, 10000],
    [1, -2000],
    [2, 2000],
    [3, -3000],
    [4, -400],
    [5, -500],
    [6, -600],
    [8, 800],
    [9, 900],
    [10, 5000],
    [10, -1000],
    [11, -1100],
    [12, -1200],
    [14, 1400],
    [15, 1500],
    [16, -1600],
    [17, -170],
    [18, -180],
  ] as const) {
    const e = entry('1001', value, id++);
    const other = entry('5001', -value, id++);
    other.voucherId = e.voucherId;
    d.current.push(e, other);
    classify(d, e, [{ line, amount: value }]);
  }
  const e = entry('1001', 1000, id++),
    counter = entry('5001', -1000, id++);
  counter.voucherId = e.voucherId;
  d.current.push(e, counter);
  classify(d, e, [
    { line: 1, amount: 600 },
    { line: 2, amount: 400 },
  ]);
  const a = entry('1001', -777, id++),
    b = entry('1002', 777, id++);
  b.voucherId = a.voucherId;
  d.current.push(a, b, entry('1012', 100000, id));
  d.comparison = d.current;
  return d;
}
it('w_bb_proc 303全部22行逐格手算，受限资金、处置净额、工资利息、退款、内部转存及现金拆分', () => {
  const d = fullCash(),
    b = {
      opening: [balanceRow('1001', 10000), balanceRow('1002', 0), balanceRow('1012', 300000)],
      closing: [balanceRow('1001', 20850), balanceRow('1002', 0), balanceRow('1012', 400000)],
    };
  const s = cashflowStatement(d, [b, b]),
    expected = [
      8600, 2400, 3000, 400, 500, 600, 6500, 800, 900, 4000, 1100, 1200, 3400, 1400, 1500, 1600,
      170, 180, 950, 10850, 10000, 20850,
    ];
  for (const r of s.rows)
    for (const c of [0, 1])
      expect(r.amounts[c]?.value, `行${r.line}列${c}`).toBe(expected[r.line - 1]);
  expect(s.checks.map((c) => c.difference)).toEqual([0, 0]);
});
it('w_bb_proc 现金分配守恒、来源改变和错误内部分类逐笔拒绝', () => {
  const d = fullCash(),
    b = { opening: [], closing: [] };
  d.config.cashAllocations['1']!.parts[0]!.amount--;
  expect(() => cashflowStatement(d, [b, b])).toThrow(/不相等/);
  d.config.cashAllocations['1']!.parts[0]!.amount++;
  d.current[0]!.summary = '改变';
  expect(() => cashflowStatement(d, [b, b])).toThrow(/来源已改变/);
  d.config.cashAllocations['1']!.signature = entrySignature(d.current[0]!, d.current);
  d.config.cashAllocations['1']!.parts = [{ line: 0, amount: 10000 }];
  expect(() => cashflowStatement(d, [b, b])).toThrow(/含非现金科目/);
});
it('w_bb_proc 超出安全整数拒绝', () => {
  expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow(/超出/);
});
it('w_bb_proc 独审回归：应付借余及应收贷余先重分类，再按两时点期限事实列示', () => {
  const d = domain(),
    r = addBalance(d, 'payable', 100, 1, '220201'),
    a = addBalance(d, 'receivable', -200, 2, '112201');
  expect(() => balanceSheet(d)).toThrow(/确认缺失/);
  for (const period of [202512, 202612]) {
    d.config.facts.push(
      {
        period,
        key: rowKey(r),
        balance: 100,
        reason: '18个月预付合同',
        allocations: [
          { role: 'prepaid', amount: 20 },
          { role: 'noncurrentAsset', amount: 80 },
        ],
      },
      {
        period,
        key: rowKey(a),
        balance: -200,
        reason: '18个月预收合同',
        allocations: [
          { role: 'advance', amount: -30 },
          { role: 'noncurrentLiability', amount: -170 },
        ],
      },
    );
  }
  const s = balanceSheet(d);
  expect(s.rows[4]!.amounts.map((v) => v?.value)).toEqual([20, 20]);
  expect(s.rows[27]!.amounts.map((v) => v?.value)).toEqual([80, 80]);
  expect(s.rows[33]!.amounts.map((v) => v?.value)).toEqual([30, 30]);
  expect(s.rows[44]!.amounts.map((v) => v?.value)).toEqual([170, 170]);
  d.config.facts.find((f) => f.period === 202512 && f.key === rowKey(r))!.allocations = [
    { role: 'prepaid', amount: 70 },
    { role: 'noncurrentAsset', amount: 30 },
  ];
  const next = balanceSheet(d);
  expect(next.rows[4]!.amounts.map((v) => v?.value)).toEqual([20, 70]);
});
it('w_bb_proc 独审回归：已归还投资按真实借方明细正数列减项，贷方或资本负数分配拒绝', () => {
  const d = domain();
  addBalance(d, 'returnedCapital', -20);
  expect(() => balanceSheet(d)).toThrow(/不能列负减项/);
  d.closing = [];
  d.opening = [];
  const returned = addBalance(d, 'returnedCapital', 20);
  for (const period of [202512, 202612])
    d.config.facts.push({
      period,
      key: rowKey(returned),
      balance: 20,
      reason: '中外合作协议已归还投资',
      allocations: [{ role: 'returnedCapital', amount: 20 }],
    });
  expect(balanceSheet(d).returnedInvestment).toEqual([20, 20]);
  const c = addBalance(d, 'capital', -100);
  for (const period of [202512, 202612])
    d.config.facts.push({
      period,
      key: rowKey(c),
      balance: -100,
      reason: '错误分配反例',
      allocations: [
        { role: 'capital', amount: -80 },
        { role: 'returnedCapital', amount: -20 },
      ],
    });
  expect(() => balanceSheet(d)).toThrow(/分类去向不适用/);
});
it('w_bb_proc 往来对象借贷方向和期限分配的随机不抵销不变量', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 1000000 }),
      fc.integer({ min: 1, max: 1000000 }),
      fc.integer({ min: 0, max: 100 }),
      (debit, credit, ratio) => {
        const d = domain();
        addBalance(d, 'receivable', debit, 1, '112201');
        const cr = addBalance(d, 'receivable', -credit, 2, '112201'),
          current = Math.floor((credit * ratio) / 100);
        for (const period of [202512, 202612])
          d.config.facts.push({
            period,
            key: rowKey(cr),
            balance: -credit,
            reason: '经确认的期限分配',
            allocations: [
              { role: 'advance', amount: -current },
              { role: 'noncurrentLiability', amount: -(credit - current) },
            ],
          });
        const s = balanceSheet(d);
        expect(s.rows[3]!.amounts[0].value).toBe(debit);
        expect(s.rows[33]!.amounts[0].value).toBe(current);
        expect(s.rows[44]!.amounts[0].value).toBe(credit - current);
      },
    ),
  );
});
it('w_bb_proc 逐笔费用拆分不猜二级科目，拆分净额守恒、退款与签名变化均核验', () => {
  const d = domain();
  d.roles.set('5602', 'administration');
  const e = entry('5602', 1000, 1),
    other = entry('1001', -1000, 2);
  other.voucherId = e.voucherId;
  d.current = [e, other];
  d.comparison = [];
  d.config.incomeAllocations['1'] = {
    signature: entrySignature(e, d.current),
    reason: '同一管理费用分录包含两类实际费用',
    parts: [
      { line: 16, amount: 400 },
      { line: 17, amount: 600 },
    ],
  };
  let s = incomeStatement(d);
  expect(s.rows[13]!.amounts[0].value).toBe(1000);
  expect(s.rows[15]!.amounts[0].value).toBe(400);
  expect(s.rows[16]!.amounts[0].value).toBe(600);
  d.config.incomeAllocations['1']!.parts[0]!.amount--;
  expect(() => incomeStatement(d)).toThrow(/不相等/);
  d.config.incomeAllocations['1']!.parts[0]!.amount++;
  other.summary = '对方业务已改';
  expect(() => incomeStatement(d)).toThrow(/对方分录已改变/);
  s = incomeStatement({ ...d, current: [] });
  expect(s.rows[13]!.amounts[0].value).toBe(0);
});
it('w_bb_proc 现金对方分录改变也必须重新确认分类', () => {
  const d = fullCash();
  d.current[1]!.accountCode = '2001';
  expect(() => cashflowStatement(d, [{ opening: [], closing: [] }, null])).toThrow(/来源已改变/);
});
it('w_bb_proc 随机现金拆分守恒和损益结转前后权益不变量', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -1000000, max: 1000000 }),
      fc.integer({ min: 0, max: 100 }),
      (v, ratio) => {
        const d = domain();
        d.comparison = [];
        d.scopes[1] = null;
        d.roles.set('1001', 'money');
        d.config.cashScope = [
          {
            account: '1001',
            from: '2026-01-01',
            to: '2026-12-31',
            available: true,
            reason: '可随时支付',
          },
        ];
        const a = entry('1001', v, 1),
          b = entry('5001', -v, 2);
        b.voucherId = 1;
        d.current = [a, b];
        const first = Math.trunc((v * ratio) / 100);
        classify(d, a, [
          { line: 1, amount: first },
          { line: 2, amount: v - first },
        ]);
        const s = cashflowStatement(d, [
          { opening: [balanceRow('1001', 1000000)], closing: [balanceRow('1001', 1000000 + v)] },
          null,
        ]);
        expect(s.rows[19]!.amounts[0].value).toBe(v);
        expect(s.checks[0]!.difference).toBe(0);
      },
    ),
  );
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1000000 }),
      fc.integer({ min: 0, max: 1000000 }),
      (revenue, cost) => {
        const d = domain();
        addBalance(d, 'revenue', -revenue);
        addBalance(d, 'cost', cost);
        const before = balanceSheet(d).rows[50]!.amounts[0].value;
        d.closing = [];
        d.opening = [];
        addBalance(d, 'currentProfit', cost - revenue);
        expect(balanceSheet(d).rows[50]!.amounts[0].value).toBe(before);
      },
    ),
  );
});
