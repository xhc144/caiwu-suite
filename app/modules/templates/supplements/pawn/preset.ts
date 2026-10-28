import {
  mapTemplateScheme,
  parseCodeScheme,
  parseTemplate,
  type AccountingTemplate,
  type AccountingTemplateInput,
} from '@caiwu/core';
import type { TemplatePresetInput, TemplateSupplement } from '../../preset';
import { pawnAccountingNotes, pawnSources } from './sources';

export const PAWN_BASE_TEMPLATE_ID = 'books-enterprise-cas-2006';
export const PAWN_BASE_VERSION = '2006.18+2026.2';
export const PAWN_TEMPLATE_ID = 'pawn-enterprise-cas-2021';
export const PAWN_TEMPLATE_VERSION = '2026.10.28.1';
export const PAWN_CODE_SCHEMES = ['4-2-2', '4-3-3'] as const;
export type PawnCodeScheme = (typeof PAWN_CODE_SCHEMES)[number];

const sourceVersion = '财会〔2009〕11号+财会〔2017〕7号；典当预设2026.10.28.1';
const origin = (clause: string, allocation = false) =>
  `财会〔2009〕11号${clause}；${pawnSources.transition.officialFullText}；${allocation ? '名称据法规核算内容设置，明细编码由软件分配（非统一法定编号）' : '1409为文件指定编号'}；辅助必填为软件分户配置`;
const loanSource =
  `${origin('一（一）、二（一）', true)}；财会〔2006〕18号附录1303、1304；` +
  '贷款类别及本金/利息调整/已减值分户；2021年起依财会〔2017〕7号预期信用损失处理';
const loanDimensions = [
  { type: 'partner' as const, required: true },
  { type: 'project' as const, required: true },
];
const assetDimensions = [{ type: 'project' as const, required: true }];

const collateral = [
  { suffix: '01', name: '动产质押贷款' },
  { suffix: '02', name: '财产权利质押贷款' },
  { suffix: '03', name: '房地产抵押贷款' },
] as const;

const appendAccounts: AccountingTemplateInput['accounts'] = [
  ...collateral.flatMap(({ suffix, name }) => [
    {
      code: `1303${suffix}`,
      name,
      category: 'asset',
      direction: 'debit' as const,
      isContra: false,
      balanceNature: 'debit' as const,
      closingRule: 'none' as const,
      source: loanSource,
      sourceVersion,
      needsReview: false,
    },
    ...[
      { suffix: '01', name: '本金', balanceNature: 'debit' as const },
      { suffix: '02', name: '利息调整', balanceNature: 'both' as const },
      { suffix: '03', name: '已减值', balanceNature: 'debit' as const },
    ].map((detail) => ({
      code: `1303${suffix}${detail.suffix}`,
      name: detail.name,
      category: 'asset',
      direction: 'debit' as const,
      isContra: false,
      balanceNature: detail.balanceNature,
      closingRule: 'none' as const,
      partner: true,
      dimensions: loanDimensions,
      source: loanSource,
      sourceVersion,
      needsReview: false,
    })),
    {
      code: `1304${suffix}`,
      name,
      category: 'asset',
      direction: 'credit' as const,
      isContra: true,
      balanceNature: 'credit' as const,
      closingRule: 'none' as const,
      partner: true,
      dimensions: loanDimensions,
      source: loanSource,
      sourceVersion,
      needsReview: false,
    },
    {
      code: `6011${suffix}`,
      name: `${name}利息收入`,
      category: 'pnl',
      direction: 'credit' as const,
      isContra: false,
      balanceNature: 'no-closing-balance' as const,
      closingRule: 'profit' as const,
      partner: true,
      dimensions: loanDimensions,
      source: `${origin('一（二）、二（四）', true)}；财会〔2006〕18号6011；利息及贷款综合费依实际利率法确认`,
      sourceVersion,
      needsReview: false,
    },
  ]),
  {
    code: '1409',
    name: '绝当物品',
    category: 'asset',
    direction: 'debit',
    isContra: false,
    balanceNature: 'debit',
    closingRule: 'none',
    dimensions: assetDimensions,
    source: origin('一（三）'),
    sourceVersion,
    needsReview: false,
  },
  {
    code: '147101',
    name: '绝当物品',
    category: 'asset',
    direction: 'credit',
    isContra: true,
    balanceNature: 'credit',
    closingRule: 'none',
    dimensions: assetDimensions,
    source: `${origin('一（三）', true)}；财会〔2006〕18号附录1471：存货跌价准备按存货项目/类别明细核算`,
    sourceVersion,
    needsReview: false,
  },
];

// 只覆盖行业分户、来源及新业务禁用的旧分类；不重命名基表父科目。
const overrideAccounts: NonNullable<TemplatePresetInput['accountOverrides']> = [
  ...['1122', '1132', '1221', '2203', '2241'].map((code) => ({
    code,
    partner: true,
    dimensions: loanDimensions,
    source: `${origin('一（二）、一（三）', true)}；按当户/当票核算，不新增或替换一级科目`,
    sourceVersion,
  })),
  {
    code: '6021',
    partner: true,
    dimensions: [{ type: 'partner', required: true }],
    source: `${origin('一（四）', true)}；鉴定评估/咨询收入；贷款实际利率组成部分的综合费归6011，不能重复确认为手续费`,
    sourceVersion,
  },
  ...['1303', '1304', '6011', '6421', '6051', '6402', '1471', '6702'].map((code) => ({
    code,
    source: `${origin('一（一）至（四）', true)}；沿用企业基表；金融资产减值依财会〔2017〕7号预期信用损失规则，存货减值依存货准则`,
    sourceVersion,
  })),
  ...['1501', '1502', '1503'].map((code) => ({
    code,
    disabled: true,
    source:
      '原2006金融工具分类；执行财会〔2017〕7号后的新业务不再使用该分类。本2021年起典当预设禁用；现行分类按业务模式/合同现金流量特征使用基表1513、1515、1516、1101等适用科目。',
    sourceVersion,
  })),
];

export const pawnPreset = {
  id: PAWN_TEMPLATE_ID,
  version: PAWN_TEMPLATE_VERSION,
  name: '典当企业（企业会计准则，2021年起）',
  description:
    '执行企业会计准则及2017金融工具准则的典当企业；2021年起账期使用。含当金分户、实际利率调整、绝当存货及佣金科目；当户/当票使用客供/项目辅助。需自行建立当物备查簿及完成法定报表/附注；不提供自动计息或历史迁移。',
  baseTemplateId: PAWN_BASE_TEMPLATE_ID,
  baseTemplateVersion: PAWN_BASE_VERSION,
  order: 23,
  codeScheme: '4-2-2',
  additionalAccounts: appendAccounts,
  accountOverrides: overrideAccounts,
  sources: [
    {
      title: pawnSources.transition.title,
      file: pawnSources.transition.notice,
      note: pawnSources.transition.note,
    },
    {
      title: pawnSources.financialInstruments.title,
      file: pawnSources.financialInstruments.file,
      note: pawnSources.financialInstruments.note,
    },
    {
      title: pawnSources.revenue.title,
      file: pawnSources.revenue.file,
      note: pawnSources.revenue.note,
    },
    {
      title: pawnSources.regulation.title,
      file: pawnSources.regulation.file,
      note: pawnSources.regulation.note,
    },
  ],
} satisfies TemplatePresetInput;

export const pawnApplicability = {
  effectiveFrom: '2021-01-01',
  originalTemplate: { file: 'a33.acd', name: '典当行模版', displayOrder: '23' },
  supportedCodeSchemes: PAWN_CODE_SCHEMES,
  notes: pawnAccountingNotes,
} as const;

const requiredParents = [
  ['1001', '库存现金', 'asset', 'debit'],
  ['1002', '银行存款', 'asset', 'debit'],
  ['1122', '应收账款', 'asset', 'debit'],
  ['1132', '应收利息', 'asset', 'debit'],
  ['1221', '其他应收款', 'asset', 'debit'],
  ['1303', '贷款', 'asset', 'debit'],
  ['1304', '贷款损失准备', 'asset', 'credit'],
  ['1471', '存货跌价准备', 'asset', 'credit'],
  ['2203', '预收账款', 'liability', 'credit'],
  ['2241', '其他应付款', 'liability', 'credit'],
  ['6011', '利息收入', 'pnl', 'credit'],
  ['6021', '手续费及佣金收入', 'pnl', 'credit'],
  ['6051', '其他业务收入', 'pnl', 'credit'],
  ['6402', '其他业务成本', 'pnl', 'debit'],
  ['6421', '手续费及佣金支出', 'pnl', 'debit'],
  ['6702', '信用减值损失', 'pnl', 'debit'],
] as const;

/**
 * 原生4-2-2企业基表 + 典当增补；合成完再统一映射级次。
 * 独立核对入口，调用方传入只读的已注册基表；不复制基表、不跨模块读取文件。
 * 正式接入使用supplement，由templates既有preset机制合成。
 */
export function buildPawnTemplate(
  baseInput: unknown,
  scheme: PawnCodeScheme = '4-2-2',
): AccountingTemplate {
  const base = parseTemplate(baseInput);
  if (
    base.id !== PAWN_BASE_TEMPLATE_ID ||
    base.version !== PAWN_BASE_VERSION ||
    base.codeScheme !== '4-2-2'
  )
    throw new Error(
      '典当预设需要企业基表 books-enterprise-cas-2006@2006.18+2026.2（原生4-2-2），请先复核基表版本',
    );
  if (!PAWN_CODE_SCHEMES.includes(scheme)) throw new Error('典当预设仅支持4-2-2或4-3-3');
  const byCode = new Map(base.accounts.map((account) => [account.code, account]));
  for (const account of pawnPreset.additionalAccounts) {
    if (byCode.has(account.code)) throw new Error(`典当预设追加科目 ${account.code} 与基表重复`);
  }
  for (const [code, name, category, direction] of requiredParents) {
    const account = byCode.get(code);
    if (
      !account ||
      account.name !== name ||
      account.category !== category ||
      (account.direction ?? base.categories.find((c) => c.id === account.category)?.direction) !==
        direction
    )
      throw new Error(`典当预设基表父科目 ${code} 的名称、类别或方向不一致，请先复核`);
  }
  if (base.accounts.length !== 248)
    throw new Error('典当预设需要完整248项企业基表，请先复核基表版本');
  if (!base.categories.find((c) => c.id === 'pnl')?.isPnl)
    throw new Error('典当预设基表类别及损益性质不一致，请先复核');
  const overrides = new Map(pawnPreset.accountOverrides.map((account) => [account.code, account]));
  for (const code of overrides.keys()) {
    if (!byCode.has(code)) throw new Error(`典当预设覆盖科目 ${code} 在基表不存在`);
  }
  const accounts = base.accounts.map((account) => {
    const override = overrides.get(account.code);
    return override
      ? {
          ...account,
          ...override,
          source: `${account.source ?? ''}；行业设置：${override.source}`,
          sourceVersion: `${base.id}@${base.version}；${pawnPreset.id}@${pawnPreset.version}`,
        }
      : account;
  });
  const merged = parseTemplate({
    ...base,
    id: PAWN_TEMPLATE_ID,
    version: PAWN_TEMPLATE_VERSION,
    name: pawnPreset.name,
    regime: 'enterprise',
    order: 23,
    status: 'current',
    devOnly: false,
    description: pawnPreset.description,
    accounts: [...accounts, ...pawnPreset.additionalAccounts].sort((a, b) =>
      a.code.localeCompare(b.code),
    ),
    reports: [],
    sources: [
      ...base.sources,
      {
        title: `基础制度：${base.name}`,
        note: `${base.id}@${base.version}；行业方案在此版本上应用，不改写已有账套。`,
      },
      ...pawnPreset.sources,
    ],
  });
  return mapTemplateScheme(merged, parseCodeScheme(scheme));
}

/** 只由集成owner加入supplement-catalog一次；生产路径不提供基表副本。 */
export const supplement: TemplateSupplement = { presets: [pawnPreset] };
