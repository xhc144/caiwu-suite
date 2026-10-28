import type { AccountingTemplateInput } from '@caiwu/core';
import type { TemplatePresetInput, TemplateSupplement } from '../../preset';
import { guaranteeSources as s } from './sources';

export const baseTemplateId = 'books-enterprise-cas-2006';
export const baseVersion = '2006.18+2026.2';
export type GuaranteePresetId =
  | 'financing-guarantee-cas22-2026'
  | 'financing-guarantee-cas25-2026'
  | 'microloan-enterprise-cas22-2026';
type AccountInput = AccountingTemplateInput['accounts'][number];

export const guaranteeApplicability: Record<
  GuaranteePresetId,
  {
    originalTemplate: 'a16' | 'a32';
    effectiveFrom: string;
    applicableTo: string;
  }
> = {
  'financing-guarantee-cas22-2026': {
    originalTemplate: 'a16',
    effectiveFrom: '2026-01-01',
    applicableTo: '财务担保合同按金融工具准则核算；不含指定为公允价值计量且其变动计入损益的合同。',
  },
  'financing-guarantee-cas25-2026': {
    originalTemplate: 'a16',
    effectiveFrom: '2026-01-01',
    applicableTo:
      '仅限已明确视作保险合同并已按保险合同准则核算、按单项合同不可撤销地选择保险合同准则的相关合同。',
  },
  'microloan-enterprise-cas22-2026': {
    originalTemplate: 'a32',
    effectiveFrom: '2026-01-01',
    applicableTo: '执行企业会计准则的小额贷款企业；预设贷款按满足摊余成本分类条件的普通贷款配置。',
  },
};

const byContract = [
  { type: 'project' as const, required: true },
  { type: 'partner' as const, required: true },
];
const partner = [{ type: 'partner' as const, required: true }];
const group = [{ type: 'project' as const, required: true }];
const financeCost = {
  code: '6601',
  name: '业务及管理费',
  source: `${s.financeCosts.title}引用2006附录6601企业（金融）核算范围；${s.financeCosts.file}`,
};

// 当前口径停用被后续准则替代的旧账户，保留基表来源，不删除或重编共享基表。
const legacyInsurance = [
  '1201',
  '1211',
  '1212',
  '2261',
  '2601',
  '2602',
  '6031',
  '6201',
  '6202',
  '6203',
  '6501',
  '6502',
  '6511',
  '6541',
  '6542',
];
const insurance2026 = [
  '1213',
  '1214',
  '1215',
  '2603',
  '2604',
  '5404',
  '6032',
  '6503',
  '6504',
  '6505',
  '6506',
  '6507',
  '6508',
];
const disableOld = [
  ...['1501', '1502', '1503'].map((code) => ({
    code,
    disabled: true,
    source: `${s.cas22.title}金融资产分类及后续计量规定；当前预设不使用2006旧金融工具分类；${s.cas22.file}`,
  })),
  ...legacyInsurance.map((code) => ({
    code,
    disabled: true,
    source: `${s.cas25.title}及施行通知替代旧原保险/再保险合同口径；${s.cas25.file}`,
  })),
];
const disableNewInsurance = insurance2026.map((code) => ({
  code,
  disabled: true,
  source: `${s.cas25.title}第四条（六）；本预设只选金融工具口径，不用保险合同科目；${s.cas25.file}`,
}));
const noDeposits = (source: string) => ({ code: '2011', disabled: true, source });

const loanAdditions: AccountInput[] = [
  {
    code: '130303',
    name: '应计利息',
    category: 'asset',
    direction: 'debit',
    balanceNature: 'debit',
    isContra: false,
    closingRule: 'none',
    partner: true,
    dimensions: byContract,
    source: `${s.interestPresentation.title}物理第4页第5项：按实际利率法计提的利息计入相应金融工具账面余额；130303及明细名称为本软件设置，不作为官方统一二级编码/名称；project=贷款合同、partner=客户；${s.interestPresentation.file}`,
    sourceVersion: '财会〔2019〕6号利息列报要求；本应用2026.1',
  },
  {
    code: '130301',
    name: '本金',
    category: 'asset',
    direction: 'debit',
    balanceNature: 'debit',
    isContra: false,
    closingRule: 'none',
    partner: true,
    dimensions: byContract,
    source: `${s.smallLoan2009.title}物理第14页1303第二项“本金”；${s.cas22.title}第三十八至三十九条；130301为软件自定二级编码；project=贷款合同，partner=贷款客户（含个人客户），均为应用辅助映射，非原文固定编码；${s.smallLoan2009.file}`,
    sourceVersion: '辽宁2009范本明细名称；财会〔2017〕7号计量口径；本应用2026.1',
  },
  {
    code: '130302',
    name: '利息调整',
    category: 'asset',
    direction: 'debit',
    balanceNature: 'both',
    isContra: false,
    closingRule: 'none',
    partner: true,
    dimensions: byContract,
    source: `${s.smallLoan2009.title}物理第14至15页1303第二及三项“利息调整”（可借可贷）；${s.cas22.title}第三十八至三十九条；130302为软件自定二级编码；合同及客户沿用本金的应用辅助映射；${s.smallLoan2009.file}`,
    sourceVersion: '辽宁2009范本明细名称；财会〔2017〕7号计量口径；本应用2026.1',
  },
];

const guaranteeAdditions: AccountInput[] = [
  {
    code: '280101',
    name: '财务担保合同',
    category: 'liability',
    direction: 'credit',
    balanceNature: 'credit',
    isContra: false,
    closingRule: 'none',
    partner: true,
    dimensions: byContract,
    source: `${s.cas22.title}第二十一条（三）及第四十六条；${s.guaranteeLossPresentation.title}第27项列报关系；2801编号继承2006附录，280101为软件按交易事项自定明细；project=单项财务担保合同，partner=被担保客户，非独立法定科目或固定编码；${s.cas22.file}`,
    sourceVersion: '财会〔2017〕7号；本应用2026.1',
  },
];

const detail = (id: GuaranteePresetId, description: string) =>
  `${description} 适用日期：2026-01-01起。${guaranteeApplicability[id].applicableTo} 基表：${baseTemplateId}@${baseVersion}。仅新建账套使用，不修改已有账套；未自动判断适用性或强制校验建账年份。`;

export const guaranteePresets: readonly TemplatePresetInput[] = [
  {
    id: 'financing-guarantee-cas22-2026',
    version: '2026.1.0',
    name: '融资担保企业（金融工具口径，2026）',
    order: 160,
    baseTemplateId,
    baseTemplateVersion: baseVersion,
    description: detail(
      'financing-guarantee-cas22-2026',
      '对应原版a16。企业准则行业预设；财务担保合同按客户及单项合同辅助，金融工具口径损失准备列入预计负债。旧2005担保办法不作为当前制度。仅生成科目，不自动确认收入或估计损失。',
    ),
    additionalAccounts: guaranteeAdditions,
    accountOverrides: [
      financeCost,
      ...disableOld,
      ...disableNewInsurance,
      noDeposits(
        `${s.guaranteeRegulation.title}第二十三条不得吸收存款；${s.guaranteeRegulation.file}`,
      ),
      ...['1303', '1304'].map((code) => ({
        code,
        disabled: true,
        source: `${s.guaranteeRegulation.title}第二十三条禁止自营贷款及受托贷款，本预设不启用该业务；${s.guaranteeRegulation.file}`,
      })),
      {
        code: '2002',
        partner: true,
        dimensions: partner,
        source:
          '财会〔2006〕18号附录2002：客户存入担保保证金按客户核算；partner为客户应用映射，不创建实际客户。',
      },
      {
        code: '1031',
        partner: true,
        dimensions: partner,
        source: '财会〔2006〕18号附录1031第二项：按存放单位明细核算；partner为存放单位应用映射。',
      },
    ],
    sources: [
      s.cas22,
      s.cas25,
      s.guaranteeChoice,
      s.ecl,
      s.guaranteeLossPresentation,
      s.financeCosts,
      s.guarantee2005,
      s.guaranteeRegulation,
    ],
  },
  {
    id: 'financing-guarantee-cas25-2026',
    version: '2026.1.0',
    name: '融资担保企业（保险合同口径，2026）',
    order: 161,
    baseTemplateId,
    baseTemplateVersion: baseVersion,
    description: detail(
      'financing-guarantee-cas25-2026',
      '对应原版a16的保险合同口径。仅适用于已满足准则选择条件的合同；2026年执行新保险合同准则。项目辅助记录合同组，不能用单个客户代替合同组。仅生成科目；分组、计量、首次转换及法定报表仍需业务处理。',
    ),
    accountOverrides: [
      financeCost,
      ...disableOld,
      noDeposits(
        `${s.guaranteeRegulation.title}第二十三条不得吸收存款；${s.guaranteeRegulation.file}`,
      ),
      ...['1303', '1304'].map((code) => ({
        code,
        disabled: true,
        source: `${s.guaranteeRegulation.title}第二十三条禁止自营贷款及受托贷款，本预设不启用该业务；${s.guaranteeRegulation.file}`,
      })),
      {
        code: '2002',
        partner: true,
        dimensions: partner,
        source: '财会〔2006〕18号附录2002：客户存入担保保证金按客户核算；partner为客户应用映射。',
      },
      {
        code: '1031',
        partner: true,
        dimensions: partner,
        source: '财会〔2006〕18号附录1031第二项：按存放单位明细核算；partner为存放单位应用映射。',
      },
      ...insurance2026.map((code) => ({
        code,
        dimensions: group,
        source: `${s.cas25.title}第十一至十五条及第二十条，以合同组为计量单元；project辅助映射为合同组，组别由用户维护，非自动分组；${s.cas25.file}`,
      })),
    ],
    sources: [
      s.cas25,
      s.cas25Implementation,
      s.guaranteeChoice,
      s.financeCosts,
      s.guarantee2005,
      s.guaranteeRegulation,
    ],
  },
  {
    id: 'microloan-enterprise-cas22-2026',
    version: '2026.1.0',
    name: '小额贷款企业（企业准则，2026）',
    order: 220,
    baseTemplateId,
    baseTemplateVersion: baseVersion,
    description: detail(
      'microloan-enterprise-cas22-2026',
      '对应原版a32。贷款本金、利息调整、应计利息按客户及合同辅助；1132仅核算已到期可收但尚未收到的利息。贷款损失准备为贷方备抵，利息收入为贷方损益；6601为业务及管理费。辽宁2009范本仅作注明年代的科目来源，不是全国现行独立制度；减值按现行预期信用损失口径。',
    ),
    additionalAccounts: loanAdditions,
    accountOverrides: [
      financeCost,
      ...disableOld,
      ...disableNewInsurance,
      noDeposits(
        `${s.smallLoanRegulation.title}第二十一条不得吸收或变相吸收公众存款；${s.smallLoanRegulation.file}`,
      ),
      {
        code: '1304',
        partner: true,
        dimensions: byContract,
        source: `${s.smallLoan2009.title}物理第15至16页1304及期末贷方余额；减值改按${s.cas22.title}第四十六至六十三条，客户及合同为应用辅助映射；${s.smallLoan2009.file}`,
      },
      {
        code: '6011',
        partner: true,
        dimensions: byContract,
        source: `财会〔2006〕18号附录6011及${s.cas22.title}第三十八至三十九条；客户及合同为本应用辅助映射，未自动计算实际利率；${s.cas22.file}`,
      },
      {
        code: '1132',
        partner: true,
        dimensions: byContract,
        source: `${s.interestPresentation.title}物理第4页第5项，仅反映已到期可收但尚未收到的利息；未到期实际利率计提利息使用130303；客户及合同为本应用辅助映射；${s.interestPresentation.file}`,
      },
    ],
    sources: [
      s.cas22,
      s.ecl,
      s.financeCosts,
      s.interestPresentation,
      s.smallLoan2009,
      s.smallLoanFinanceRules,
      s.smallBusinessExclusion,
      s.smallLoanRegulation,
    ],
  },
];

/** 唯一集成出口；由templates owner的supplement-catalog解析并注册，不复制企业基表。 */
export const supplement: TemplateSupplement = { presets: guaranteePresets };
