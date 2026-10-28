import type { AccountingTemplate, TemplateAccount } from '@caiwu/core';
import { constructionSources as sources } from './sources';

export type ConstructionPresetId =
  | 'construction-cas-revenue-2017'
  | 'construction-small-business-2013'
  | 'construction-enterprise-system-2003';

export type ConstructionPreset = {
  id: ConstructionPresetId;
  version: string;
  name: string;
  baseTemplateId: string;
  baseVersion: string;
  baseRegime: string;
  status: 'current' | 'deprecated';
  effectiveFrom: string;
  description: string;
  /** 必须由调用方提供完整、经原文核定的基表；历史2001基表尚未在本仓库提供。 */
  integration: 'ready' | 'missing-statutory-base';
  expectedBaseAccounts: readonly Pick<
    TemplateAccount,
    'code' | 'name' | 'direction' | 'category'
  >[];
  additions: readonly TemplateAccount[];
  overrides: readonly (Pick<TemplateAccount, 'code'> & Partial<TemplateAccount>)[];
  disableSubtrees: readonly string[];
  sources: AccountingTemplate['sources'];
};

const project = [{ type: 'project' as const, required: true }];
const currentSource = `${sources.enterprise2019.title}；PDF第8页第22项；`;
const smallSource = `${sources.small2011.title}附录；`;
const oldSource = `${sources.construction2003.title}；第二部分（二）；`;

function account(
  code: string,
  name: string,
  category: string,
  direction: 'debit' | 'credit',
  source: string,
  options: Partial<TemplateAccount> = {},
): TemplateAccount {
  return {
    code,
    name,
    category,
    direction,
    dimensions: [],
    balanceNature: direction,
    closingRule: 'none',
    isContra: false,
    needsReview: false,
    source,
    sourceVersion: 'construction-supplement-1.0.0',
    ...options,
  };
}

const contractDimensionNote =
  '按合同明细映射为必填项目辅助，一项项目档案代表一份合同；必填是本预设的应用约束，不是新增法定辅助类型。';

export const constructionCasPreset: ConstructionPreset = {
  id: 'construction-cas-revenue-2017',
  version: '1.0.0',
  name: '建筑施工企业（企业会计准则·新收入准则）',
  baseTemplateId: 'books-enterprise-cas-2006',
  baseVersion: '2006.18+2026.2',
  baseRegime: 'enterprise',
  status: 'current',
  effectiveFrom: '2021-01-01',
  integration: 'ready',
  description:
    '适用于已执行企业会计准则及2017收入准则的施工企业；非上市企业2021年1月1日起执行，上市企业分批提前执行。继承企业完整基表，1490合同结算为软件分配编号，按合同设置价款结算/收入结转及项目辅助。停用旧5401工程施工、5402工程结算，保留原记录来源；不采用2026年9月科目征求意见稿。仅新建账套加载，已有账套不变。模板不代替履约义务、收入确认、税费计算和法定报表。',
  expectedBaseAccounts: [
    { code: '1002', name: '银行存款', category: 'asset', direction: 'debit' },
    { code: '1122', name: '应收账款', category: 'asset', direction: 'debit' },
    { code: '1472', name: '合同履约成本', category: 'asset', direction: 'debit' },
    { code: '1474', name: '合同履约成本减值准备', category: 'asset', direction: 'credit' },
    { code: '1483', name: '合同资产', category: 'asset', direction: 'debit' },
    { code: '1484', name: '合同资产减值准备', category: 'asset', direction: 'credit' },
    { code: '2204', name: '合同负债', category: 'liability', direction: 'credit' },
    { code: '5401', name: '工程施工', category: 'cost', direction: 'debit' },
    { code: '5402', name: '工程结算', category: 'cost', direction: 'credit' },
    { code: '6001', name: '主营业务收入', category: 'pnl', direction: 'credit' },
    { code: '6401', name: '主营业务成本', category: 'pnl', direction: 'debit' },
  ],
  additions: [
    account('1490', '合同结算', 'asset', 'debit', currentSource + contractDimensionNote, {
      balanceNature: 'both',
      dimensions: project,
    }),
    account('149001', '价款结算', 'asset', 'credit', currentSource + contractDimensionNote, {
      balanceNature: 'both',
      dimensions: project,
    }),
    account('149002', '收入结转', 'asset', 'debit', currentSource + contractDimensionNote, {
      balanceNature: 'both',
      dimensions: project,
    }),
  ].map((row) => ({
    ...row,
    source:
      row.source +
      '1490及下级编码由软件自行分配，原文未指定编号；资产类别仅为应用分组，期末须按合同净额借贷侧和流动性列报。',
  })),
  overrides: ['1472', '1474', '1483', '1484', '2204'].map((code) => ({
    code,
    dimensions: project,
    source: `${sources.revenue2017.title}第二十六至三十条、第四十一条；${sources.enterprise2019.title}PDF第8—9页第22、24项；${contractDimensionNote}`,
    sourceVersion: 'construction-supplement-1.0.0',
  })),
  disableSubtrees: ['5401', '5402'],
  sources: [sources.revenue2017, sources.enterprise2019],
};

export const constructionSmallPreset: ConstructionPreset = {
  id: 'construction-small-business-2013',
  version: '1.0.0',
  name: '建筑施工小企业（小企业会计准则·2013起）',
  baseTemplateId: 'books-small-business',
  baseVersion: '2011.17+2016.22',
  baseRegime: 'small-business',
  status: 'current',
  effectiveFrom: '2013-01-01',
  integration: 'ready',
  description:
    '适用于满足小企业会计准则第二条且已选择该准则的建筑业小企业；2013年1月1日起。继承66项一级及2016税金及附加更名，增设4401合同成本/间接费用及1411在库/在用/摊销明细；按合同以项目辅助核算。小企业准则不能与企业准则新收入模型混用。本预设不增设合同毛利、工程结算或合同结算。基表1702累计摊销原文余额方向矛盾待核，保留needsReview及贷方处理方向。仅新建账套加载，已有账套不变。无自动成本分配、税费计算或法定报表。',
  expectedBaseAccounts: [
    { code: '1002', name: '银行存款', category: 'asset', direction: 'debit' },
    { code: '1122', name: '应收账款', category: 'asset', direction: 'debit' },
    { code: '1411', name: '周转材料', category: 'asset', direction: 'debit' },
    { code: '4401', name: '工程施工', category: 'cost', direction: 'debit' },
    { code: '4403', name: '机械作业', category: 'cost', direction: 'debit' },
    { code: '5001', name: '主营业务收入', category: 'pnl', direction: 'credit' },
    { code: '5401', name: '主营业务成本', category: 'pnl', direction: 'debit' },
  ],
  additions: [
    account(
      '141101',
      '在库',
      'asset',
      'debit',
      smallSource + 'PDF第20页1411第二项；二级编码为软件分配。',
    ),
    account(
      '141102',
      '在用',
      'asset',
      'debit',
      smallSource + 'PDF第20页1411第二项；二级编码为软件分配。',
    ),
    account(
      '141103',
      '摊销',
      'asset',
      'credit',
      smallSource + 'PDF第20—21页1411第二项、第三（二）项；二级编码为软件分配。',
      { isContra: true },
    ),
    account(
      '440101',
      '合同成本',
      'cost',
      'debit',
      smallSource + 'PDF第57页4401第二项；' + contractDimensionNote,
      { dimensions: project },
    ),
    account(
      '440102',
      '间接费用',
      'cost',
      'debit',
      smallSource +
        'PDF第57页4401第二项、第三（一）项；月末分配至合同成本；二级编码为软件分配；' +
        contractDimensionNote,
      { closingRule: 'clearing', balanceNature: 'no-closing-balance', dimensions: project },
    ),
  ],
  overrides: [
    {
      code: '4403',
      closingRule: 'clearing',
      balanceNature: 'no-closing-balance',
      source:
        smallSource +
        'PDF第58页4403第四项期末无余额；设备种类仍须由企业建立实际明细，不预造机械档案。',
      sourceVersion: 'construction-supplement-1.0.0',
    },
  ],
  disableSubtrees: [],
  sources: [sources.small2011],
};

/** 2003已核增设科目与明细；缺完整基表及成本编码复核，禁止冒充完整制度。 */
export const constructionSystem2003Preset: ConstructionPreset = {
  id: 'construction-enterprise-system-2003',
  version: '1.0.0',
  name: '施工企业会计核算办法（2004起·企业会计制度适用范围）',
  baseTemplateId: 'enterprise-system-2001',
  baseVersion: '2000.25',
  baseRegime: 'enterprise-system',
  status: 'deprecated',
  effectiveFrom: '2004-01-01',
  integration: 'missing-statutory-base',
  description:
    '财会〔2003〕27号于2004年1月1日起用于执行《企业会计制度》的施工企业；不是企业会计准则新收入模型。此处deprecated表示应用不作现行默认，不表示2003办法被2015通知废止。包含7项增设一级、1281及5101/5401补充与规定明细。缺完整2001制度基表，禁止作为完整模板注册。本仓库尚未核得1992制度完整官方科目表，不能认定已精确还原原版a08。',
  expectedBaseAccounts: [
    { code: '1281', name: '存货跌价准备', category: 'asset', direction: 'credit' },
    { code: '5101', name: '主营业务收入', category: 'pnl', direction: 'credit' },
    { code: '5401', name: '主营业务成本', category: 'pnl', direction: 'debit' },
  ],
  additions: [
    account('1233', '周转材料', 'asset', 'debit', oldSource + '1233第一、九项。'),
    account(
      '123301',
      '在库周转材料',
      'asset',
      'debit',
      oldSource + '1233第二、五项；明细编号为软件分配。',
    ),
    account(
      '123302',
      '在用周转材料',
      'asset',
      'debit',
      oldSource + '1233第二、五项；明细编号为软件分配。',
    ),
    account(
      '123303',
      '周转材料摊销',
      'asset',
      'credit',
      oldSource + '1233第二、五项；明细编号为软件分配。',
      { isContra: true },
    ),
    account(
      '128101',
      '合同预计损失准备',
      'asset',
      'credit',
      oldSource + '1281第二、四、五项；明细编号为软件分配；' + contractDimensionNote,
      { isContra: true, dimensions: project },
    ),
    account(
      '1506',
      '临时设施',
      'asset',
      'debit',
      oldSource + '1506第四、五项；具体种类和使用部门由企业建立，未伪造设施。',
      { dimensions: [{ type: 'department', required: true }] },
    ),
    account(
      '1507',
      '临时设施摊销',
      'asset',
      'credit',
      oldSource + '1507第三项只进行总分类、不设明细；第四项贷方余额。',
      { isContra: true },
    ),
    account(
      '1702',
      '临时设施清理',
      'asset',
      'debit',
      oldSource + '1702第三、四项按被清理设施名称明细；余额可反映清理价值或清理净收入。',
      { balanceNature: 'both' },
    ),
    account(
      '2123',
      '工程结算',
      'liability',
      'credit',
      oldSource + '2123第二、三、四项；完工与工程施工对冲；' + contractDimensionNote,
      { dimensions: project },
    ),
    account('4104', '工程施工', 'cost', 'debit', oldSource + '4104第一、二、五项。'),
    account(
      '410401',
      '合同成本',
      'cost',
      'debit',
      oldSource + '4104第二（一）项；明细编号为软件分配。',
    ),
    ...['人工费', '材料费', '机械使用费', '其他直接费', '间接费用'].map((name, i) =>
      account(
        `4104010${i + 1}`,
        name,
        'cost',
        'debit',
        oldSource + '4104第二（一）项成本项目；明细编号为软件分配；' + contractDimensionNote,
        { dimensions: project },
      ),
    ),
    account(
      '410402',
      '合同毛利',
      'cost',
      'debit',
      oldSource +
        '4104第二（二）、第三项；可借记或贷记；明细编号为软件分配；' +
        contractDimensionNote,
      { dimensions: project, balanceNature: 'both' },
    ),
    account('4110', '机械作业', 'cost', 'debit', oldSource + '4110第一、二、四项。', {
      balanceNature: 'no-closing-balance',
      closingRule: 'clearing',
    }),
    ...['承包工程', '机械作业'].map((name, i) =>
      account(
        `41100${i + 1}`,
        name,
        'cost',
        'debit',
        oldSource + '4110第二项；明细编号为软件分配；机械种类和成本项目须按实际设备建立。',
        { balanceNature: 'no-closing-balance', closingRule: 'clearing' },
      ),
    ),
  ],
  overrides: ['5101', '5401'].map((code) => ({
    code,
    dimensions: project,
    closingRule: 'profit' as const,
    balanceNature: 'no-closing-balance' as const,
    source:
      oldSource + '5101/5401第四、五项：按合同明细、期末结转本年利润；' + contractDimensionNote,
    sourceVersion: 'construction-supplement-1.0.0',
    ...(code === '5401'
      ? {
          needsReview: true,
          source:
            oldSource +
            '主营业务成本第四、五项；常州转载成本号印作5102，5401定位尚须完整2001基表原文核定，禁止据此注册历史模板。',
        }
      : {}),
  })),
  disableSubtrees: [],
  sources: [sources.construction2003],
};

export const constructionPresets: readonly ConstructionPreset[] = [
  constructionCasPreset,
  constructionSmallPreset,
  constructionSystem2003Preset,
];
