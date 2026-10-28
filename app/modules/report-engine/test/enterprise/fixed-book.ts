import type { AccountingTemplateInput, VoucherInput } from '@caiwu/core';
import { defineManifest } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import { createEnterpriseDraft } from '../../templates/enterprise/mapping';
import { balanceBucket, type EnterpriseConfig } from '../../templates/enterprise/model';
import { readEnterpriseSources } from '../../templates/enterprise/statutory.server';

const evidence = { source: '企业全年合成账套独立会计台账', version: '1' };
const a = (
  code: string,
  name: string,
  category = 'asset',
  extra: Partial<AccountingTemplateInput['accounts'][number]> = {},
): AccountingTemplateInput['accounts'][number] => ({ code, name, category, ...extra });
const partner = { dimensions: [{ type: 'partner' as const, required: true }] };

/** 仅测试登记；无真实企业、原资源或生产模板数据。金额单位均为分。 */
export const fixedBookTemplate: AccountingTemplateInput = {
  schemaVersion: 1,
  id: 'enterprise-twelve-month-test',
  version: '1',
  name: '企业全年合成账套',
  regime: 'enterprise',
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'liability', name: '负债', direction: 'credit' },
    { id: 'equity', name: '权益', direction: 'credit' },
    { id: 'income', name: '损益收入', direction: 'credit', isPnl: true },
    { id: 'expense', name: '损益费用', direction: 'debit', isPnl: true },
  ],
  accounts: [
    a('1001', '库存现金', 'asset', { cash: true }),
    a('1002', '银行存款', 'asset', { bank: true }),
    a('1101', '交易性金融资产'),
    a('1122', '应收账款', 'asset', partner),
    a('1123', '预付账款', 'asset', partner),
    a('1133', '其他应收款'),
    a('1231', '坏账准备', 'asset', { direction: 'credit' }),
    a('123101', '应收账款坏账准备', 'asset', { direction: 'credit' }),
    a('123102', '其他应收款坏账准备', 'asset', { direction: 'credit' }),
    a('1405', '库存商品'),
    a('1471', '存货跌价准备', 'asset', { direction: 'credit' }),
    a('1511', '长期股权投资'),
    a('1512', '长期股权投资减值准备', 'asset', { direction: 'credit' }),
    a('1503', '其他权益工具投资'),
    a('1601', '固定资产'),
    a('1602', '累计折旧', 'asset', { direction: 'credit' }),
    a('1603', '固定资产减值准备', 'asset', { direction: 'credit' }),
    a('1604', '在建工程'),
    a('1605', '在建工程减值准备', 'asset', { direction: 'credit' }),
    a('1606', '固定资产清理'),
    a('1701', '无形资产'),
    a('1702', '累计摊销', 'asset', { direction: 'credit' }),
    a('1703', '无形资产减值准备', 'asset', { direction: 'credit' }),
    a('1801', '长期待摊费用'),
    a('1811', '递延所得税资产'),
    a('2001', '短期借款', 'liability'),
    a('2202', '应付账款', 'liability', partner),
    a('2203', '预收账款', 'liability', partner),
    a('2211', '应付职工薪酬', 'liability'),
    a('2221', '应交税费', 'liability'),
    a('222101', '待抵扣进项税额', 'liability'),
    a('222102', '应交所得税', 'liability'),
    a('2241', '其他应付款', 'liability', partner),
    a('2501', '长期借款', 'liability'),
    a('250101', '一年内到期借款', 'liability'),
    a('250102', '长期借款本金', 'liability'),
    a('2701', '长期应付款', 'liability'),
    a('2702', '未确认融资费用', 'liability', { direction: 'debit' }),
    a('2711', '专项应付款', 'liability'),
    a('2801', '预计负债', 'liability'),
    a('2901', '递延所得税负债', 'liability'),
    a('4001', '实收资本', 'equity'),
    a('4002', '资本公积', 'equity'),
    a('4003', '其他综合收益', 'equity'),
    a('4101', '盈余公积', 'equity'),
    a('4103', '本年利润', 'equity'),
    a('4104', '利润分配', 'equity'),
    a('4201', '库存股', 'equity', { direction: 'debit' }),
    a('6001', '主营业务收入', 'income'),
    a('6051', '其他业务收入', 'income'),
    a('6111', '投资收益', 'income'),
    a('611101', '现金投资收益', 'income'),
    a('611102', '对联营企业和合营企业的投资收益', 'income'),
    a('6115', '资产处置损益', 'income'),
    a('6117', '其他收益', 'income'),
    a('6101', '公允价值变动损益', 'income'),
    a('6301', '营业外收入', 'income'),
    a('6401', '主营业务成本', 'expense'),
    a('6402', '其他业务成本', 'expense'),
    a('6403', '税金及附加', 'expense'),
    a('6501', '研发费用', 'expense'),
    a('6601', '销售费用', 'expense'),
    a('6602', '管理费用', 'expense'),
    a('6603', '财务费用', 'expense'),
    a('660301', '利息费用', 'expense'),
    a('660302', '利息收入', 'expense'),
    a('660303', '手续费', 'expense'),
    a('6701', '资产减值损失', 'expense'),
    a('6702', '信用减值损失', 'expense'),
    a('6711', '营业外支出', 'expense'),
    a('6801', '所得税费用', 'expense'),
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
};

// 2024年只有期初，2025及2026各12个月有业务。初始资产1541200、负债299500、权益1241700。
const opening: [string, number, string?][] = [
  ['1001', 10000],
  ['1002', 1000000],
  ['1101', 1000],
  ['1122', 50000, 'A'],
  ['1122', -7000, 'B'],
  ['1123', 9000, 'A'],
  ['1123', -12000, 'B'],
  ['1133', 3000],
  ['123101', -5000],
  ['123102', -300],
  ['1405', 80000],
  ['1471', -8000],
  ['1511', 100000],
  ['1512', -10000],
  ['1503', 1000],
  ['1601', 300000],
  ['1602', -60000],
  ['1603', -10000],
  ['1604', 20000],
  ['1605', -1000],
  ['1606', 2000],
  ['1701', 40000],
  ['1702', -10000],
  ['1703', -1000],
  ['1801', 12000],
  ['1811', 5000],
  ['2001', -100000],
  ['2202', -40000, 'A'],
  ['2202', 6000, 'B'],
  ['2203', -8000, 'A'],
  ['2203', 4000, 'B'],
  ['2211', -6000],
  ['222101', 1500],
  ['222102', -4500],
  ['2241', -5000, 'A'],
  ['2241', 2000, 'B'],
  ['250101', -20000],
  ['250102', -60000],
  ['2701', -25000],
  ['2702', 2000],
  ['2711', -3000],
  ['2801', -4000],
  ['2901', -7000],
  ['4001', -1162700],
  ['4002', -50000],
  ['4101', -10000],
  ['4104', -20000],
  ['4201', 1000],
];

export async function createFixedBook() {
  const closingManifest = defineManifest({
    id: 'period-close',
    name: '合成损益结转',
    products: 'all',
    sources: [{ type: 'closing', name: '损益结转', path: '/?source={id}' }],
  });
  const m = moduleKit(closingManifest);
  const closingModule = defineServerModule(closingManifest, { router: m.router({}) });
  const mod = { ...reportServer, templates: [fixedBookTemplate] };
  const app = await createTestApp({
    modules: [mod, closingModule],
    templateId: fixedBookTemplate.id,
    startYear: 2024,
    seed: false,
  });
  try {
    const svc = app.svc;
    await svc.periods.ensureYear(2025);
    await svc.periods.ensureYear(2026);
    const accounts = await svc.accounts.list();
    const id = (code: string) => accounts.find((x) => x.code === code)!.id;
    const partners: Record<string, number> = {};
    for (const code of ['A', 'B'])
      partners[code] = (
        await svc.dimensions.create({ type: 'partner', code, name: `合成往来${code}` })
      ).id;
    const cashProjects: Record<string, number> = {};
    for (const [line, name] of [
      ['salesReceipts', '销售商品、提供劳务收到的现金'],
      ['purchases', '购买商品、接受劳务支付的现金'],
      ['employees', '支付给职工以及为职工支付的现金'],
      ['otherOperatingPayments', '支付其他与经营活动有关的现金'],
      ['taxPayments', '支付的各项税费'],
      ['dividendInterestPayments', '分配股利、利润或偿付利息支付的现金'],
      ['otherOperatingReceipts', '收到其他与经营活动有关的现金'],
      ['investmentReturns', '取得投资收益收到的现金'],
      ['assetDisposals', '处置固定资产、无形资产和其他长期资产收回的现金净额'],
      ['loanReceipts', '取得借款收到的现金'],
      ['debtPayments', '偿还债务支付的现金'],
      ['assetPurchases', '购建固定资产、无形资产和其他长期资产支付的现金'],
      ['investmentPayments', '投资支付的现金'],
      ['investmentRecovery', '收回投资收到的现金'],
      ['capitalReceipts', '吸收投资收到的现金'],
      ['internal', '现金和银行存款内部划转'],
    ] as const) {
      cashProjects[line] = (
        await svc.dimensions.create({
          type: 'cashflow',
          code: `CF${Object.keys(cashProjects).length + 1}`,
          name,
        })
      ).id;
    }
    for (const [code, balance, partner] of opening)
      await svc.opening.upsert({
        year: 2024,
        accountId: id(code),
        balance,
        dimensions: partner ? { partner: partners[partner]! } : {},
      });
    const c = createEnterpriseDraft(
      202612,
      'annual',
      {
        entityClass: 'unlisted',
        financial: '2020-01-01',
        revenue: '2020-01-01',
        lease: '2020-01-01',
        cas30_2026: null,
        ...evidence,
      },
      accounts,
    );
    // 该明细有明确的其他应收款用途；不套用其上级坏账准备的应收账款建议。
    Object.assign(
      c.rules.find((r) => r.accountId === id('123102'))!,
      { line: 'otherReceivables', kind: 'receivable', role: 'allowance' },
    );
    type Row = [string, number, number, string?, string?];
    const post = async (period: number, rows: Row[], closing = false) => {
      const service = closing ? app.svcFor('period-close') : svc;
      const input: VoucherInput = {
        voucherTypeId: (await svc.reference.voucherTypes())[0]!.id,
        date: `${Math.floor(period / 100)}-${String(period % 100).padStart(2, '0')}-${closing ? '28' : '15'}`,
        lines: rows.map(([code, debit, credit, partner, cashLine]) => ({
          accountId: id(code),
          debit,
          credit,
          summary: closing ? '合成月度损益结转' : '合成月度业务',
          dimensions: {
            ...(partner ? { partner: partners[partner]! } : {}),
            ...(cashLine ? { cashflow: cashProjects[cashLine]! } : {}),
          },
          cashflowDirection: cashLine
            ? cashLine === 'internal'
              ? 'internal'
              : debit > 0
                ? 'inflow'
                : 'outflow'
            : null,
        })),
        ...(closing ? { closingKind: 'pnl', source: { type: 'closing', id: `${period}:1` } } : {}),
      };
      const v = await service.vouchers.create(input);
      await service.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      await service.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
      const posted = (await service.vouchers.get(v.id))!;
      posted.lines.forEach((line, i) => {
        const cashLine = rows[i]![4];
        if (cashLine)
          c.cashAllocations.push({
            lineId: line.id,
            parts: [{ line: cashLine, amount: String(line.debit - line.credit) }],
            ...evidence,
          });
        if (line.accountId === id('4003'))
          c.oci.push({
            lineId: line.id,
            line: 'otherEquityFairValue',
            gross: '100',
            tax: '25',
            ...evidence,
          });
        if (!closing && line.accountId === id('6711'))
          c.discontinued.push({ lineId: line.id, ...evidence });
        const equity = accounts.find((a) => a.id === line.accountId)?.categoryId === 'equity';
        if (!closing && equity && line.accountId !== id('4003') && line.accountId !== id('4103')) {
          const code = rows[i]![0];
          const row =
            code === '4001' || code === '4002'
              ? 'ordinaryContributions'
              : rows.some((r) => r[0] === '4101')
                ? 'surplusAppropriation'
                : 'distributions';
          if (rows.every((r) => ['4103', '4104'].includes(r[0]))) return;
          const column =
            code === '4001'
              ? 'capital'
              : code === '4002'
                ? 'capitalReserve'
                : code === '4101'
                  ? 'surplusReserve'
                  : 'retainedEarnings';
          c.equityEvents.push({
            lineId: line.id,
            row,
            liabilityAmount: '0',
            parts: [{ column, amount: String(line.credit - line.debit) }],
            ...evidence,
          });
        }
      });
    };
    const pair = (
      debit: string,
      credit: string,
      amount: number,
      cashLine?: string,
      p?: string,
    ): Row[] => [
      [debit, amount, 0, debit === '1122' ? p : undefined, debit === '1002' ? cashLine : undefined],
      [
        credit,
        0,
        amount,
        credit === '1122' ? p : undefined,
        credit === '1002' ? cashLine : undefined,
      ],
    ];
    for (const year of [2025, 2026]) {
      const factor = year === 2025 ? 1 : 2;
      for (let month = 1; month <= 12; month++) {
        const period = year * 100 + month,
          n = month * factor;
        const rows: Row[] = [
          ...pair('1002', '6001', 20000 + 1000 * n, 'salesReceipts'),
          ...pair('1122', '6001', 3000, undefined, 'A'),
          ...pair('1002', '1122', 2000, 'salesReceipts', 'A'),
          ...pair('6401', '1405', 6000 + 100 * n),
          ...pair('1405', '1002', 9000 + 100 * n, 'purchases'),
          ...pair('6601', '1002', 1000, 'employees'),
          ...pair('6602', '1602', 500),
          ...pair('6602', '1002', 200, 'otherOperatingPayments'),
          ...pair('6403', '222102', 300),
          ...pair('222102', '1002', 250, 'taxPayments'),
          ...pair('6501', '1002', 400, 'otherOperatingPayments'),
          ...pair('660301', '1002', 200, 'dividendInterestPayments'),
          ...pair('1002', '660302', 50, 'otherOperatingReceipts'),
          ...pair('660303', '1002', 25, 'otherOperatingPayments'),
          ...pair('1002', '611101', 300, 'investmentReturns'),
          ...pair('1511', '611102', 50),
          ...pair('1002', '6115', 100, 'assetDisposals'),
          ...pair('1101', '6101', 70),
          ...pair('6702', '123101', 100),
          ...pair('6701', '1471', 150),
          ...pair('1002', '6117', 200, 'otherOperatingReceipts'),
          ...pair('1002', '6301', 80, 'otherOperatingReceipts'),
          ...pair('6711', '1002', 40, 'otherOperatingPayments'),
          ...pair('6801', '1002', 2000, 'taxPayments'),
          ['1503', 100, 0],
          ['4003', 0, 75],
          ['2901', 0, 25],
          ...pair('1002', '2001', 5000, 'loanReceipts'),
          ...pair('2001', '1002', 1000, 'debtPayments'),
          ...pair('1601', '1002', 2000, 'assetPurchases'),
          ...pair('1511', '1002', 1000, 'investmentPayments'),
          ...pair('1002', '1511', 200, 'investmentRecovery'),
          ['1001', 100, 0, undefined, 'internal'],
          ['1002', 0, 100, undefined, 'internal'],
        ];
        await post(period, rows);
        // 独立写出结转额，不从报表函数或总账余额生成期望/结转。
        await post(
          period,
          [
            ['6001', 23000 + 1000 * n, 0],
            ['611101', 300, 0],
            ['611102', 50, 0],
            ['6115', 100, 0],
            ['6101', 70, 0],
            ['6117', 200, 0],
            ['6301', 80, 0],
            ['660302', 50, 0],
            ['6401', 0, 6000 + 100 * n],
            ['6601', 0, 1000],
            ['6602', 0, 700],
            ['6403', 0, 300],
            ['6501', 0, 400],
            ['660301', 0, 200],
            ['660303', 0, 25],
            ['6702', 0, 100],
            ['6701', 0, 150],
            ['6711', 0, 40],
            ['6801', 0, 2000],
            ['4103', 0, 12935 + 900 * n],
          ],
          true,
        );
        if (month === 1)
          await post(period, [
            ['1002', 12000 * factor, 0, undefined, 'capitalReceipts'],
            ['4001', 0, 10000 * factor],
            ['4002', 0, 2000 * factor],
          ]);
        if (month === 12) {
          await post(period, pair('4103', '4104', 155220 + 70200 * factor));
          await post(period, [
            ['4104', 3000 * factor, 0],
            ['4101', 0, 3000 * factor],
          ]);
          await post(period, [
            ['4104', 6000 * factor, 0],
            ['1002', 0, 6000 * factor, undefined, 'dividendInterestPayments'],
          ]);
        }
      }
    }
    // 每个月既核本月又核累计，年度口径另核权益矩阵；完整来源均来自真实总账。
    for (const p of await svc.periods.list()) {
      for (const basis of ['opening', 'closing'] as const)
        c.cashPolicies.push({
          period: p.period,
          basis,
          accounts: [id('1001'), id('1002')],
          restrictedAccounts: [],
          ...evidence,
        });
      if (p.year >= 2025)
        for (const from of new Set([p.period, p.year * 100 + 1]))
          c.eps.push({
            from,
            to: p.period,
            applicable: true,
            preference: '0',
            dilutions: [],
            ...evidence,
          });
    }
    c.shares.push({ from: '2025-01-01', to: '2026-12-31', ordinary: '100', ...evidence });
    const reportSvc = app.svcFor('report-engine');
    // 分类用报告日余额的身份；金额来自账务，不在配置里覆盖。
    for (const p of await svc.periods.list()) {
      const rows = await svc.ledger.balances({
        periodFrom: p.period,
        periodTo: p.period,
        groupBy: ['partner', 'project', 'department', 'person'],
        rollup: false,
        includeZero: true,
      });
      for (const row of rows)
        for (const basis of ['opening', 'closing'] as const) {
          const rule = c.rules.find((r) => r.accountId === row.accountId)!;
          const f = { period: p.period, basis, bucket: balanceBucket(row), ...evidence };
          if (['receivable', 'payable'].includes(rule.kind))
            c.facts.push({
              ...f,
              current: true,
              ...(row.accountCode === '123101'
                ? {
                    allowanceFor: balanceBucket({
                      accountId: id('1122'),
                      dimensions: { partner: partners.A! },
                    }),
                  }
                : row.accountCode === '123102'
                  ? { allowanceFor: balanceBucket({ accountId: id('1133'), dimensions: {} }) }
                  : {}),
            });
          if (rule.kind === 'financial')
            c.facts.push({
              ...f,
              ...(row.accountCode === '1101'
                ? {
                    category: 'fvtpl' as const,
                    expectedHoldMonths: 3,
                    contractualMaturity: 'none' as const,
                  }
                : {
                    category: 'equity-fvoci' as const,
                    nonTrading: true,
                    irrevocableElection: true,
                  }),
            });
          if (rule.kind === 'maturity')
            c.facts.push({
              ...f,
              current: row.accountCode === '250101',
              duePeriod: 203012,
              ...(row.accountCode === '2702'
                ? { allowanceFor: balanceBucket({ accountId: id('2701'), dimensions: {} }) }
                : {}),
            });
        }
    }
    return {
      app,
      mod,
      c,
      source: (config: EnterpriseConfig) => readEnterpriseSources(reportSvc, config),
    };
  } catch (e) {
    await app.close();
    throw e;
  }
}
