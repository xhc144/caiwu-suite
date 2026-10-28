import { infrastructureSources as sources } from './sources';

type ReferenceAccount = {
  code: string;
  name: string;
  direction: 'debit' | 'credit';
  parentCode: string | null;
  projectRequired: boolean;
  numberOrigin: 'statutory' | 'application';
  locator: string;
};

const financialAccounts: ReferenceAccount[] = [
  {
    code: '1002',
    name: '银行存款',
    direction: 'debit',
    parentCode: null,
    projectRequired: false,
    numberOrigin: 'statutory',
    locator: '第二部分一级表；第三部分1002',
  },
  {
    code: '1601',
    name: '固定资产',
    direction: 'debit',
    parentCode: null,
    projectRequired: false,
    numberOrigin: 'statutory',
    locator: '第二部分一级表；第三部分1601',
  },
  {
    code: '1611',
    name: '工程物资',
    direction: 'debit',
    parentCode: null,
    projectRequired: false,
    numberOrigin: 'statutory',
    locator: 'PDF物理第46—47页1611第三、四项',
  },
  {
    code: '1613',
    name: '在建工程',
    direction: 'debit',
    parentCode: null,
    projectRequired: true,
    numberOrigin: 'statutory',
    locator: 'PDF物理第47—53页1613第一、二、四项',
  },
  ...['建筑安装工程投资', '设备投资', '待摊投资', '其他投资', '待核销基建支出', '基建转出投资'].map(
    (name, i) => ({
      code: `16130${i + 1}`,
      name,
      direction: 'debit' as const,
      parentCode: '1613',
      projectRequired: true,
      numberOrigin: 'application' as const,
      locator: 'PDF物理第47页1613第二项；名称法定，数字后缀由软件拟定',
    }),
  ),
  ...['建筑工程', '安装工程'].map((name, i) => ({
    code: `1613010${i + 1}`,
    name,
    direction: 'debit' as const,
    parentCode: '161301',
    projectRequired: true,
    numberOrigin: 'application' as const,
    locator: 'PDF物理第48页1613第二（一）；名称法定，数字后缀由软件拟定',
  })),
  {
    code: '2302',
    name: '应付账款',
    direction: 'credit',
    parentCode: null,
    projectRequired: false,
    numberOrigin: 'statutory',
    locator: '第二部分一级表；第三部分2302',
  },
];

const budgetAccounts: ReferenceAccount[] = [
  {
    code: '6001',
    name: '财政拨款预算收入',
    direction: 'credit',
    parentCode: null,
    projectRequired: false,
    numberOrigin: 'statutory',
    locator: 'PDF物理第12页一级表、第120页6001',
  },
  {
    code: '7101',
    name: '行政支出',
    direction: 'debit',
    parentCode: null,
    projectRequired: true,
    numberOrigin: 'statutory',
    locator: 'PDF物理第12页一级表、第129—130页7101第二至四项',
  },
  {
    code: '7201',
    name: '事业支出',
    direction: 'debit',
    parentCode: null,
    projectRequired: true,
    numberOrigin: 'statutory',
    locator: 'PDF物理第12页一级表、第130—132页7201',
  },
  {
    code: '8001',
    name: '资金结存',
    direction: 'debit',
    parentCode: null,
    projectRequired: false,
    numberOrigin: 'statutory',
    locator: 'PDF物理第12页一级表、第140—141页8001',
  },
  {
    code: '800102',
    name: '货币资金',
    direction: 'debit',
    parentCode: '8001',
    projectRequired: false,
    numberOrigin: 'application',
    locator: 'PDF物理第140—141页8001第二（二）；数字后缀为软件拟定',
  },
];

/** Intentionally not AccountingTemplate: cannot be registered as a single ledger. */
export const governmentInfrastructureReference = {
  kind: 'dual-system-reference',
  id: 'government-infrastructure-2019-reference',
  version: '2017.25.reference.1',
  effectiveFrom: '2019-01-01',
  allowBookCreation: false,
  scope:
    '执行政府会计准则制度的行政事业单位基建业务纳入单位大账。这里只核对基建相关子集，不是完整政府科目表或单独基建账。',
  financialAccounts,
  budgetAccounts,
  budgetBreakdowns: [
    '资金性质',
    '基本支出/项目支出',
    '支出功能分类项级',
    '部门预算支出经济分类款级',
    '具体项目',
  ],
  blocker:
    '当前AccountingTemplate及凭证/余额服务没有财务会计、预算会计的独立体系标识与同一事项双分录联动；完整政府基表、当年收支分类和后续解释尚未合入。不得将两组科目摊平注册为一套制度。',
  sources: [sources.governmentChart, sources.government2018],
} as const;

export type GovernmentInfrastructureReferenceLine = {
  code: string;
  debit: number;
  credit: number;
  project?: string;
};

/**
 * Read-only arithmetic check of a synthetic paired case. It creates no books or vouchers.
 * Each system balances independently; a financial-only noncash event is valid.
 */
export function checkGovernmentInfrastructurePair(input: {
  financial: readonly GovernmentInfrastructureReferenceLine[];
  budget: readonly GovernmentInfrastructureReferenceLine[];
}): void {
  if (!input.financial.length) throw new Error('必须提供财务会计分录');
  for (const [system, rows, chart] of [
    ['财务会计', input.financial, financialAccounts],
    ['预算会计', input.budget, budgetAccounts],
  ] as const) {
    let balance = 0n;
    for (const row of rows) {
      const account = chart.find((a) => a.code === row.code);
      if (!account) throw new Error(`${system}未核对科目${row.code}`);
      if (chart.some((a) => a.parentCode === row.code))
        throw new Error(`${system}科目须为本参考子集末级`);
      if (account.projectRequired && !row.project?.trim())
        throw new Error(`${system}科目须指定项目`);
      if (
        !Number.isSafeInteger(row.debit) ||
        !Number.isSafeInteger(row.credit) ||
        row.debit < 0 ||
        row.credit < 0 ||
        (row.debit === 0) === (row.credit === 0)
      )
        throw new Error('参考分录须为单侧非零整数分');
      balance += BigInt(row.debit) - BigInt(row.credit);
    }
    if (balance !== 0n) throw new Error(`${system}借贷不平衡，不能与另一体系抵销`);
  }
}

export function requireGovernmentInfrastructureBook(): never {
  throw new Error(governmentInfrastructureReference.blocker);
}
