import { parseTemplate, type AccountingTemplateInput } from '@caiwu/core';
import type { TemplateSupplement } from '../../preset';

export const medicalSources = {
  chart: 'https://kjs.mof.gov.cn/zhengcefabu/201712/P020171214383017622166.pdf',
  update: 'https://kjs.mof.gov.cn/zhengcefabu/202601/t20260112_3981685.htm',
} as const;

// 独立制度的完整34项一级表；其他险种专用项保留来源并停用，不能混用于居民医保。
const groups = {
  asset:
    '1001库存现金 1002收入户存款 1003财政专户存款 1004支出户存款 1005国库存款 1101暂付款 1201债券投资 1202委托投资',
  liability: '2001暂收款 2101借入款项',
  'net-assets': '3001一般基金结余 3101风险基金结余 3201储备金结余',
  revenue:
    '4001社会保险费收入 4101财政补贴收入 4102集体补助收入 4201利息收入 4202委托投资收益 4301转移收入 4401上级补助收入 4402下级上解收入 4501其他收入 4601待转社会保险费收入 4602待转利息收入',
  expense:
    '5001社会保险待遇支出 5101大病保险支出 5102劳动能力鉴定支出 5103工伤预防费用支出 5104稳定岗位补贴支出 5105技能提升补贴支出 5201转移支出 5301上解上级支出 5302补助下级支出 5401其他支出',
} as const;
const inapplicable: Record<string, string> = {
  '1202': '省级基本养老保险基金专用',
  '3101': '仅提取风险基金的新农合适用；本通用居民医保方案默认不启用',
  '3201': '工伤保险专用',
  '4102': '城乡居民基本养老保险专用',
  '4202': '基本养老保险专用',
  '4601': '职工基本医疗保险专用',
  '4602': '职工基本医疗保险专用',
  '5102': '工伤保险专用',
  '5103': '工伤保险专用',
  '5104': '失业保险专用',
  '5105': '失业保险专用',
};
const direction = (category: string) =>
  category === 'asset' || category === 'expense' ? ('debit' as const) : ('credit' as const);
type Account = AccountingTemplateInput['accounts'][number];
const accounts: Account[] = Object.entries(groups).flatMap(([category, text]) =>
  text.split(' ').map((item): Account => {
    const code = item.slice(0, 4);
    const flow = category === 'revenue' || category === 'expense';
    return {
      code,
      name: item.slice(4),
      category,
      direction: direction(category),
      cash: code === '1001',
      bank: ['1002', '1003', '1004', '1005'].includes(code),
      isContra: false,
      balanceNature: flow ? 'no-closing-balance' : direction(category),
      closingRule: flow ? 'clearing' : 'none',
      disabled: !!inapplicable[code],
      source: `财会〔2017〕28号，PDF物理第6—8页完整一级表及第三部分${code}科目说明；${medicalSources.chart}${inapplicable[code] ? `；${inapplicable[code]}` : ''}`,
      sourceVersion: '财会〔2017〕28号；居民医保2026.1',
      needsReview: false,
      ...(code === '1201'
        ? {
            dimensions: [{ type: 'project' as const, required: true }],
            source: `财会〔2017〕28号1201第二项，PDF物理第16页，按国债种类明细；project为具体国债种类的应用映射；${medicalSources.chart}`,
          }
        : {}),
    };
  }),
);

function detail(
  code: string,
  name: string,
  parent: string,
  clause: string,
  options: { counterparty?: boolean; disabled?: boolean; update?: boolean } = {},
): Account {
  const base = accounts.find((a) => a.code === parent)!;
  return {
    code,
    name,
    category: base.category,
    direction: base.direction,
    isContra: false,
    balanceNature: base.balanceNature,
    closingRule: base.closingRule,
    disabled: options.disabled ?? false,
    partner: options.counterparty ?? false,
    dimensions: options.counterparty ? [{ type: 'partner', required: true }] : [],
    source: `${options.update ? '财会〔2025〕35号' : '财会〔2017〕28号'}${clause}；${options.update ? medicalSources.update : medicalSources.chart}；明细名称按原文（标为其他类的为应用归类），数字后缀为本软件分配；partner为原文对方单位/个人/地区的应用映射，不预造对象`,
    sourceVersion: options.update
      ? '财会〔2025〕35号；居民医保2026.1'
      : '财会〔2017〕28号；居民医保2026.1',
    needsReview: false,
  };
}

accounts.push(
  detail('110101', '异地就医预付金', '1101', '1101第二项，PDF物理第14页，按预付对方地区', {
    counterparty: true,
  }),
  detail('110102', '医保预付金', '1101', '二（一）1，按预付对象', {
    counterparty: true,
    update: true,
  }),
  detail('110103', '集采预付金', '1101', '二（一）2，按预付对象', {
    counterparty: true,
    update: true,
  }),
  detail('110104', '直接结算资金', '1101', '二（一）3，按预付对象', {
    counterparty: true,
    update: true,
  }),
  detail(
    '110105',
    '其他暂付款',
    '1101',
    '1101第二项，PDF物理第14页，其他种类由应用归类；需按实际业务增设种类，并按对方单位/个人',
    { counterparty: true },
  ),
  detail(
    '110106',
    '缴存风险基金',
    '1101',
    '1101第二项，PDF物理第14页；仅风险基金省级统一管理的新农合适用，默认停用',
    { counterparty: true, disabled: true },
  ),
  detail(
    '200101',
    '异地就医预付金',
    '2001',
    '2001第二项，PDF物理第19页；参保地区上级归集预付金，按对方单位/地区',
    { counterparty: true },
  ),
  detail(
    '200102',
    '异地就医清算资金',
    '2001',
    '2001第二项，PDF物理第19页；参保地区上级归集清算资金，按对方单位/地区',
    { counterparty: true },
  ),
  detail(
    '200103',
    '异地就医资金',
    '2001',
    '2001第二项，PDF物理第19页；就医地区接收预付及清算资金，按对方单位/地区',
    { counterparty: true },
  ),
  detail(
    '200104',
    '其他暂收款',
    '2001',
    '2001第二项，PDF物理第19页；其他种类由应用归类，需按实际业务增设种类，并按对方单位/个人',
    { counterparty: true },
  ),
  detail(
    '200105',
    '待确认收入',
    '2001',
    '二（二），须经国家医保局和财政部备案同意才可采用，默认停用，不能因预收保费自动启用',
    { update: true, disabled: true },
  ),
  detail(
    '200106',
    '缴存风险基金',
    '2001',
    '2001第二项，PDF物理第19页；仅省级接收风险基金业务，默认停用',
    { counterparty: true, disabled: true },
  ),
  ...[
    ['01', '当期'],
    ['02', '预缴'],
    ['03', '清欠'],
    ['04', '补缴'],
  ].map(([suffix, name]) =>
    detail(
      `4001${suffix}`,
      name!,
      '4001',
      '4001第二项，PDF物理第28页，可按缴费性质设置；2026未备案预收不改为待确认收入',
    ),
  ),
  ...[
    ['01', '住院费用支出'],
    ['02', '门诊费用支出'],
    ['03', '其他费用支出'],
  ].map(([suffix, name]) =>
    detail(`5001${suffix}`, name!, '5001', '5001第二项（五），PDF物理第40页，城乡居民医保三项明细'),
  ),
  detail('510101', '商业保险机构承办', '5101', '二（三），下设四项支出明细', { update: true }),
  detail('510102', '自行经办待遇支出', '5101', '二（三），与商业保险机构承办分列', {
    update: true,
  }),
  ...[
    ['01', '划转保费支出'],
    ['02', '风险赔付'],
    ['03', '盈余返还'],
    ['04', '其他支出'],
  ].map(([suffix, name]) =>
    detail(
      `510101${suffix}`,
      name!,
      '5101',
      `二（三）${Number(suffix)}，商业保险机构承办项下；盈余返还贷记该支出明细，不作为收入`,
      { counterparty: true, update: true },
    ),
  ),
);

export const residentMedicalTemplate = parseTemplate({
  schemaVersion: 1,
  id: 'resident-medical-insurance-2026',
  version: '1.0.0',
  name: '城乡居民基本医疗保险基金（2026）',
  regime: 'resident-medical-insurance',
  description:
    '社会保险经办机构的城乡居民基本医疗保险基金，含新农合现行替代口径。每险种独立建账，一般收付实现制；不是医院、基层医疗机构或经办机构自身行政账。保留完整34项法定一级表，其他险种专用及有条件风险基金默认停用；含2026医保预付金、集采预付金、直接结算资金、大病保险规定明细。待确认收入须国家医保局和财政部备案同意，默认停用。数字明细后缀及辅助映射为应用设置，不预造地区、机构、个人或国债种类；财政补贴和其他支出还需按适用财务制度增设实际业务明细。仅支持2026年起新账，不自动转换旧账、确认收入、结转或生成法定报表。',
  order: 55,
  status: 'current',
  devOnly: false,
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit', isPnl: false },
    { id: 'liability', name: '负债', direction: 'credit', isPnl: false },
    { id: 'net-assets', name: '净资产', direction: 'credit', isPnl: false },
    { id: 'revenue', name: '收入', direction: 'credit', isPnl: true },
    { id: 'expense', name: '支出', direction: 'debit', isPnl: true },
  ],
  accounts: accounts.sort((a, b) => a.code.localeCompare(b.code)),
  voucherTypes: [{ code: '记', name: '记账凭证' }],
  currencies: [],
  reports: [],
  sources: [
    {
      title: '社会保险基金会计制度（财会〔2017〕28号）',
      file: medicalSources.chart,
      note: 'PDF物理第2—5页总说明、6—8页34项一级表、14/19页往来、28页收入、40页居民医保支出；第5页明文废止财会〔2008〕1号新农合制度。',
    },
    {
      title: '《社会保险基金会计制度》补充规定（财会〔2025〕35号）',
      file: medicalSources.update,
      note: '2026-01-01施行；二（一）三类预付、二（二）备案后的待确认收入、二（三）大病保险；四为新旧衔接，不在本模板自动执行。',
    },
  ],
} satisfies AccountingTemplateInput);

export const supplement: TemplateSupplement = { templates: [residentMedicalTemplate] };
