import { z } from 'zod';
import { parseTemplate, type TemplateSummary } from '@caiwu/core';
import enterprise from './templates/enterprise.json';
import updates from './templates/enterprise-updates.json';
import details from './templates/enterprise-details.json';
import small from './templates/small-business.json';
import { AccountMeaningSchema, closingLabels, nativeMeaning } from './chart-meaning';
import { mapChart } from './chart-scheme';

const RawAccountSchema = z
  .object({
    code: z.string().regex(/^\d+$/),
    name: z.string().min(1),
    category: z.string(),
    direction: z.enum(['debit', 'credit']),
    source: z.string().min(1),
    needsReview: z.literal(false),
    sourceVersion: z.string(),
  })
  .extend(AccountMeaningSchema.shape)
  .passthrough();

export const rawEnterpriseAccounts = RawAccountSchema.array().parse([
  ...enterprise.accounts.map((account) => ({ ...account, sourceVersion: '财会〔2006〕18号附录' })),
  ...updates.map((account) => ({ ...account, sourceVersion: '正式后续增补（截至2026年10月）' })),
  ...details.map((account) => ({ ...account, sourceVersion: '原版a01/a02常用明细' })),
]);

const scopeLabel = (scope: string) => (scope === 'general' ? '一般企业' : scope);
const nativeAccounts = rawEnterpriseAccounts.map((account) => ({
  ...account,
  ...nativeMeaning(account, account.direction),
  name: account.code === '6403' ? '税金及附加' : account.name,
  source: [
    account.source.replaceAll('适用：general', '适用：一般企业'),
    account.code === '6403'
      ? '财会〔2016〕22号第二（二）3后续更名段：营业税金及附加更名为税金及附加'
      : '',
    `适用：${scopeLabel(account.scope)}`,
    `余额性质：${account.balanceNature === 'two-sided' ? '借贷两向' : '通常单向余额'}`,
    closingLabels[account.closingRule],
  ]
    .filter(Boolean)
    .join('；'),
}));

export const enterpriseChart = parseTemplate({
  ...enterprise,
  version: '2006.18+2026.2',
  name: '企业会计准则',
  order: 10,
  description:
    '2006附录全部156项一级及正式后续增补，含金融、保险、共同类；薪酬、税费常用明细。新金融工具及保险合同业务使用相应新科目。仅新建账套加载，已有账套保持原科目。',
  sources: [
    ...enterprise.sources,
    {
      title: '企业会计准则解释第19号（财会〔2025〕32号，2026年施行）',
      file: 'https://kjs.mof.gov.cn/zhengcefabu/202512/t20251218_3979556.htm',
      note: '第一（三）要求设置补偿性资产科目；第一（二）及第六部分规定核算与生效日期；1485为软件自行分配编号。',
    },
    {
      title: '正式后续准则及应用指南（2018—2024）',
      note: '2018收入/金融工具/政府补助/持有待售指南、2019租赁指南、2021保险合同指南及汇编2024相关章节；新增编号由软件依2006附录授权设置，各行保留章节及科目条款。',
    },
    {
      title: '增值税会计处理规定（财会〔2016〕22号）',
      file: 'https://www.mof.gov.cn/gp/xxgkml/hjs/201612/t20161214_2512803.htm',
    },
    {
      title: '碳排放权交易有关会计处理暂行规定（财会〔2019〕22号）',
      file: 'https://kjs.mof.gov.cn/zhengcefabu/201912/P020191223369112189281.pdf',
    },
    {
      title: '企业会计准则解释第20号（财会〔2026〕7号）',
      file: 'https://kjs.mof.gov.cn/zhengcefabu/202606/t20260615_3991686.htm',
      note: '自公布之日起施行；涉及合同现金流量特征评估和货币缺乏可兑换性处理，未新增统一科目编号。科目模板不代替具体业务判断。',
    },
  ],
  accounts: nativeAccounts,
});
export const primaryCharts = [enterpriseChart, parseTemplate({ ...small, order: 11 })];
export const bookTemplates = primaryCharts;

export function offeredTemplates(templates: TemplateSummary[]) {
  const priority = (id: string) => {
    const index = primaryCharts.findIndex((chart) => chart.id === id);
    return index < 0 ? 2 : index;
  };
  return templates
    .filter((template) => template.status !== 'deprecated')
    .sort((a, b) => priority(a.id) - priority(b.id));
}

/** 级次按共享转换器映射；附加结转/适用范围也已写入持久化source。 */
export function meaningForTemplate(id: string, scheme: string) {
  if (id !== enterpriseChart.id) return [];
  const mapped = mapChart(enterpriseChart, scheme);
  return mapped.accounts.map((account, index) => ({
    ...AccountMeaningSchema.parse(rawEnterpriseAccounts[index]),
    code: account.code,
    name: account.name,
    category: account.category,
    direction: account.direction!,
    source: account.source!,
    sourceVersion: account.sourceVersion!,
    originalCode: rawEnterpriseAccounts[index]!.code,
    isContra: account.isContra!,
    nativeBalanceNature: account.balanceNature!,
  }));
}
