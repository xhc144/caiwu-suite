import { parseTemplate, type AccountingTemplate, type TemplateAccount } from '@caiwu/core';
import { infrastructureSources as sources } from './sources';

// 1995原文二（一）完整46项。不是按编码首位推断现代资产/负债类别。
const primaryRows = [
  ['101', '建筑安装工程投资'],
  ['102', '设备投资'],
  ['103', '待摊投资'],
  ['104', '其他投资'],
  ['111', '交付使用资产'],
  ['121', '应收生产单位投资借款'],
  ['201', '固定资产'],
  ['202', '累计折旧'],
  ['203', '固定资产清理'],
  ['211', '器材采购'],
  ['212', '采购保管费'],
  ['213', '库存设备'],
  ['214', '库存材料'],
  ['218', '材料成本差异'],
  ['219', '委托加工器材'],
  ['231', '限额存款'],
  ['232', '银行存款'],
  ['233', '现金'],
  ['241', '预付备料款'],
  ['242', '预付工程款'],
  ['251', '应收有偿调出器材及工程款'],
  ['252', '其他应收款'],
  ['253', '应收票据'],
  ['261', '拨付所属投资借款'],
  ['271', '待处理财产损失'],
  ['281', '有价证券'],
  ['301', '基建拨款'],
  ['302', '联营拨款'],
  ['303', '企业债券资金'],
  ['304', '基建投资借款'],
  ['305', '上级拨入投资借款'],
  ['306', '其他借款'],
  ['311', '待冲基建支出'],
  ['321', '上级拨入资金'],
  ['331', '应付器材款'],
  ['332', '应付工程款'],
  ['341', '应付工资'],
  ['342', '应付福利费'],
  ['351', '应付有偿调入器材及工程款'],
  ['352', '其他应付款'],
  ['353', '应付票据'],
  ['361', '应交税金'],
  ['362', '应交基建包干节余'],
  ['363', '应交基建收入'],
  ['364', '其他应交款'],
  ['401', '留成收入'],
] as const;

const detailGroups = [
  {
    parent: '101',
    clause: '第101号第四项',
    project: true,
    names: ['建设工程投资', '安装工程投资'],
  },
  {
    parent: '102',
    clause: '第102号第三项',
    project: true,
    names: ['在安装设备', '不需要安装设备', '工具及器具'],
  },
  {
    parent: '103',
    clause: '第103号第二、四项',
    project: true,
    names: [
      '建设单位管理费',
      '土地征用及迁移补偿费',
      '勘察设计费',
      '研究试验费',
      '可行性研究费',
      '临时设施费',
      '设备检验费',
      '延期付款利息',
      '负荷联合试车费',
      '包干节余',
      '坏账损失',
      '借款利息',
      '合同公证及工程质量监测费',
      '企业债券利息',
      '土地使用税',
      '汇兑损益',
      '国外借款手续费及承诺费',
      '施工机构转移费',
      '报废工程损失',
      '耕地占用税',
      '土地复垦及补偿费',
      '投资方向调节税',
      '固定资产损失',
      '器材处理亏损',
      '设备盘亏及毁损',
      '调整器材调拨价格折价',
      '企业债券发行费用',
      '其他待摊投资',
    ],
  },
  {
    parent: '104',
    clause: '第104号第三项',
    project: true,
    names: [
      '房屋购置',
      '基本畜禽支出',
      '林木支出',
      '办公生活用家具、器具购置',
      '可行性研究固定资产购置',
      '无形资产',
      '递延资产',
    ],
  },
  {
    parent: '111',
    clause: '第111号第六、七项',
    project: true,
    names: ['固定资产', '流动资产', '无形资产', '递延资产'],
  },
  {
    parent: '251',
    clause: '第251号第三项',
    partner: true,
    names: ['调出设备', '调出材料', '转出未完工程'],
  },
  {
    parent: '271',
    clause: '第271号第五项',
    names: ['待处理固定资产损失', '待处理设备损失', '待处理材料损失'],
  },
  {
    parent: '301',
    clause: '第301号第二至五项',
    project: true,
    names: [
      '以前年度拨款',
      '本年预算拨款',
      '本年基建基金拨款',
      '本年进口设备转账拨款',
      '本年煤代油专用基金拨款',
      '本年自筹资金拨款',
      '待转自筹资金拨款',
      '本年器材转账拨款',
      '本年财政贴息资金拨款',
      '本年其他拨款',
      '预收下年度预算拨款',
      '本年交回结余资金',
    ],
  },
  { parent: '303', clause: '第303号第八项', names: ['债券本金', '债券利息'] },
  {
    parent: '304',
    clause: '第304号第二、七项',
    names: [
      '拨改贷投资借款',
      '国家开发银行投资借款',
      '国家专业投资公司委托借款',
      '部门统借基建基金借款',
      '部门基建基金借款',
      '特种拨改贷投资借款',
      '建设银行投资借款',
      '煤代油投资借款',
      '国外借款',
      '其他投资借款',
    ],
  },
  { parent: '306', clause: '第306号第二、四项', names: ['国内储备借款', '周转借款'] },
  {
    parent: '351',
    clause: '第351号第三项',
    partner: true,
    names: ['调入设备', '调入材料', '转入未完工程'],
  },
];

const both = new Set(['203', '218', '252', '271', '301', '331', '352', '361', '364']);
const partners = new Set(['121', '241', '242', '252', '261', '302', '331', '332', '352']);
const source = (locator: string) =>
  `${sources.construction1995.title}；二（二）${locator}；${sources.construction1995.file}`;

const primaries: TemplateAccount[] = primaryRows.map(([code, name], index) => {
  const direction = index < 26 && code !== '202' ? 'debit' : 'credit';
  return {
    code,
    name,
    category: index < 26 ? 'funds-employed' : 'funding-source',
    direction,
    balanceNature: both.has(code) ? 'both' : direction,
    isContra: code === '202' || code === '311',
    closingRule: 'none',
    cash: code === '233',
    bank: code === '232' || code === '231',
    partner: partners.has(code),
    dimensions: partners.has(code) ? [{ type: 'partner', required: true }] : [],
    source: `${source(`第${code}号科目`)}；一级表第${index + 1}项；辅助为应用映射，具体对象由用户建档`,
    sourceVersion: '财会字〔1995〕45号（1996原始版）',
    needsReview: false,
  };
});

const details: TemplateAccount[] = detailGroups.flatMap((group) => {
  const parent = primaries.find((a) => a.code === group.parent)!;
  return group.names.map((name, index) => ({
    ...parent,
    code: `${group.parent}${String(index + 1).padStart(2, '0')}`,
    name,
    direction: group.parent === '301' && index === 11 ? 'debit' : parent.direction,
    balanceNature:
      group.parent === '103' && [15, 22, 23, 25].includes(index)
        ? 'both'
        : group.parent === '301' && index === 11
          ? 'debit'
          : parent.balanceNature,
    partner: group.partner ?? false,
    dimensions: [
      ...(group.project ? [{ type: 'project' as const, required: true }] : []),
      ...(group.partner ? [{ type: 'partner' as const, required: true }] : []),
    ],
    source: `${source(group.clause)}；明细名称按原文；本级数字后缀为软件编码；项目/往来为应用辅助映射`,
  }));
});

export const stateOwnedConstruction1996Template: AccountingTemplate = parseTemplate({
  schemaVersion: 1,
  id: 'state-owned-construction-1996',
  version: '1995.45.1',
  name: '国有建设单位会计制度（1996—1997历史版）',
  regime: 'state-owned-construction-historical',
  status: 'deprecated',
  devOnly: false,
  order: 115,
  codeScheme: '3-2-2',
  description:
    '仅供1996—1997历史核算：财会字〔1995〕45号46项总账及规定的具名明细。1998年起须另考虑补充规定；2019年起执行政府会计制度的单位不得据此单独建立基建账。项目辅助须记录单项/单位工程；其余业务对象、资金来源和实物明细由用户建档。无自动年初冲转或法定报表。',
  categories: [
    { id: 'funds-employed', name: '资金占用', direction: 'debit', isPnl: false },
    { id: 'funding-source', name: '资金来源', direction: 'credit', isPnl: false },
  ],
  accounts: [...primaries, ...details].sort((a, b) => a.code.localeCompare(b.code)),
  voucherTypes: [{ code: '记', name: '记账凭证' }],
  currencies: [],
  reports: [],
  sources: [sources.construction1995, sources.effective1996, sources.government2018],
});

/** Historical supplement only: new codes are explicitly application-assigned. */
export const stateOwnedConstruction1998Template: AccountingTemplate = parseTemplate({
  ...stateOwnedConstruction1996Template,
  id: 'state-owned-construction-1998',
  version: '1995.45+1998.17.1',
  order: 116,
  name: '国有建设单位会计制度（1998补充规定历史版）',
  description:
    '历史核算预设：1998-01-01起补充规定合入1995基表，限定本包1998—2018范围；并非宣告全部单位2019年一律废止。执行政府会计制度的单位2019年起不得独立基建建账。保留企业债券资金303；新增105待核销基建支出、106转出投资、308项目资本公积为软件分配编码，不冒充法定统一编号。尚未覆盖后续专项修订、国库集中支付及法定报表。',
  sources: [...stateOwnedConstruction1996Template.sources, sources.construction1998],
  accounts: [
    ...stateOwnedConstruction1996Template.accounts
      .filter((a) => a.code !== '30109')
      .map((a) =>
        a.code === '302'
          ? {
              ...a,
              name: '项目资本',
              partner: false,
              dimensions: [],
              source: `${sources.construction1998.title}；附件1一（一），沿用原302编码；${sources.construction1998.file}`,
              sourceVersion: '财会字〔1998〕17号',
            }
          : a.code === '10312'
            ? {
                ...a,
                name: '借款利息支出',
                balanceNature: 'both',
                source: `${sources.construction1998.title}；附件1一（七），财政贴息冲减借款利息支出；沿用原10312软件明细编号；${sources.construction1998.file}`,
                sourceVersion: '财会字〔1998〕17号',
              }
            : a,
      ),
    ...(
      [
        ['105', '待核销基建支出', 'funds-employed', 'debit', '（三）'],
        ['106', '转出投资', 'funds-employed', 'debit', '（五）'],
        ['308', '项目资本公积', 'funding-source', 'credit', '（二）'],
      ] as const
    ).map(([code, name, category, direction, clause]) => ({
      code,
      name,
      category,
      direction,
      dimensions: [],
      balanceNature: direction,
      closingRule: 'none' as const,
      needsReview: false,
      source: `${sources.construction1998.title}；附件1一${clause}；软件分配编码，原文未规定数字；${sources.construction1998.file}`,
      sourceVersion: '财会字〔1998〕17号',
    })),
    ...(['国家资本', '法人资本', '个人资本'] as const).map((name, index) => ({
      code: `3020${index + 1}`,
      name,
      category: 'funding-source',
      direction: 'credit' as const,
      balanceNature: 'credit' as const,
      dimensions: [],
      closingRule: 'none' as const,
      source: `${sources.construction1998.title}；附件1一（一）；明细后缀为软件分配；${sources.construction1998.file}`,
      sourceVersion: '财会字〔1998〕17号',
      needsReview: false,
    })),
  ].sort((a, b) => a.code.localeCompare(b.code)),
});

export const infrastructureHistoricalTemplates = [
  stateOwnedConstruction1996Template,
  stateOwnedConstruction1998Template,
] as const;

/** Host wizard must call this before allowing a historical choice. */
export function assertInfrastructureHistoricalPeriod(templateId: string, startYear: number): void {
  const range =
    templateId === stateOwnedConstruction1996Template.id
      ? [1996, 1997]
      : templateId === stateOwnedConstruction1998Template.id
        ? [1998, 2018]
        : null;
  if (!range || !Number.isInteger(startYear) || startYear < range[0]! || startYear > range[1]!)
    throw new Error('该基建历史模板与启用年份不匹配，请根据单位适用制度选择企业预设或政府双体系');
}
