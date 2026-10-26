import type { AccountCategoryDef, BalanceDirection } from '@caiwu/core';

// 独立抄录正式原文一级表，不读取被测 JSON 或旧 rules/packages：
// 民非 PDF 47–49；农合 PDF 23–25（另列第25页可增设项）；
// 农村集体 PDF 24–26；工会 PDF 27–29；基层主要表 PDF 25–26。
// 方向依据各科目说明的余额/主要账务处理；借贷两向科目仅断言应用默认方向。
interface ExpectedTemplate {
  id: string;
  regime: string;
  width: number;
  groups: Record<string, string>;
  creditAssets: string[];
  creditPnl?: string[];
  reviewCodes: string[];
  categories: AccountCategoryDef[];
  partnerCodes?: string[];
}
const category = (
  id: string,
  name: string,
  direction: BalanceDirection,
  isPnl = false,
): AccountCategoryDef => ({ id, name, direction, isPnl });
const nonprofitCategories = [
  category('asset', '资产', 'debit'),
  category('liability', '负债', 'credit'),
  category('net-assets', '净资产', 'credit'),
  category('revenue', '收入', 'credit', true),
  category('expense', '费用', 'debit', true),
];
const agriculturalCategories = [
  category('asset', '资产', 'debit'),
  category('liability', '负债', 'credit'),
  category('equity', '所有者权益', 'credit'),
  category('cost', '成本', 'debit'),
  category('pnl', '损益', 'debit', true),
];
const unionCategories = [
  category('asset', '资产', 'debit'),
  category('liability', '负债', 'credit'),
  category('net-assets', '净资产', 'credit'),
  category('revenue', '收入', 'credit', true),
  category('expense', '支出', 'debit', true),
];

export const expectedTemplates: ExpectedTemplate[] = [
  {
    id: 'nonprofit-2026',
    regime: 'nonprofit',
    // PDF第65页1121第四项、第69页1141第四项、第96页2202/2203第三项。
    partnerCodes: ['1121', '1141', '2202', '2203'],
    width: 4,
    categories: nonprofitCategories,
    creditAssets: ['1102', '1131', '1202', '1421', '1502', '1602'],
    reviewCodes: [],
    groups: {
      asset: `1001现金 1002银行存款 1009其他货币资金 1101短期投资
1102短期投资跌价准备 1111应收票据 1121应收账款 1122其他应收款
1131坏账准备 1141预付账款 1201存货 1202存货跌价准备 1301待摊费用
1401长期股权投资 1402长期债权投资 1403其他长期投资 1421长期投资减值准备
1501固定资产 1502累计折旧 1505在建工程 1506文物资源 1509固定资产清理
1601无形资产 1602累计摊销 1701长期待摊费用 1801受托代理资产`,
      liability: `2101短期借款 2201应付票据 2202应付账款 2203预收账款
2204应付职工薪酬 2206应交税费 2209其他应付款 2301预提费用
2501长期借款 2502长期应付款 2503预计负债 2601受托代理负债`,
      'net-assets': '3101非限定性净资产 3102限定性净资产 3201以前年度净资产调整',
      revenue: `4101捐赠收入 4201会费收入 4301提供服务收入 4401政府补助收入
4501商品销售收入 4601投资收益 4701总部拨款收入 4901其他收入`,
      expense: `5101业务活动成本 5201税金及附加 5301管理费用 5401筹资费用
5501资产减值损失 5601所得税费用 5901其他费用`,
    },
  },
  {
    id: 'farmer-cooperative-2023',
    regime: 'farmer-cooperative',
    width: 3,
    categories: agriculturalCategories,
    creditAssets: ['143', '152', '162'],
    creditPnl: ['501', '502', '511'],
    reviewCodes: ['109', '122'],
    groups: {
      asset: `101库存现金 102银行存款 109其他货币资金 113应收款 114成员往来
121产品物资 122包装物 124委托加工物资 125委托代销商品 127受托代购商品
128受托代销商品 131对外投资 141消耗性生物资产 142生产性生物资产
143生产性生物资产累计折旧 144公益性生物资产 151固定资产 152累计折旧
153在建工程 154固定资产清理 161无形资产 162累计摊销 171长期待摊费用
181待处理财产损溢`,
      liability: `201短期借款 211应付款 212应付工资 213应付劳务费 214应交税费
215应付利息 221应付盈余返还 222应付剩余盈余 231长期借款 235专项应付款`,
      equity: '301股金 311专项基金 321资本公积 322盈余公积 331本年盈余 332盈余分配',
      cost: '401生产成本',
      pnl: `501经营收入 502其他收入 511投资收益 521经营支出 522税金及附加
523管理费用 524财务费用 529其他支出 531所得税费用`,
    },
  },
  {
    id: 'rural-collective-2024',
    regime: 'rural-collective',
    width: 3,
    categories: agriculturalCategories,
    creditAssets: ['133', '152', '162'],
    creditPnl: ['501', '502', '503', '504'],
    reviewCodes: [],
    groups: {
      asset: `101库存现金 102银行存款 111短期投资 112应收款 113内部往来
121库存物资 131消耗性生物资产 132生产性生物资产 133生产性生物资产累计折旧
134公益性生物资产 141长期投资 151固定资产 152累计折旧 153在建工程
154固定资产清理 161无形资产 162累计摊销 171长期待摊费用 181待处理财产损溢`,
      liability: `201短期借款 211应付款 212应付工资 213应付劳务费 214应交税费
221长期借款及应付款 231一事一议资金 241专项应付款`,
      equity: '301资本 311公积公益金 321本年收益 322收益分配',
      cost: '401生产（劳务）成本',
      pnl: `501经营收入 502投资收益 503补助收入 504其他收入 511经营支出
512税金及附加 513管理费用 514公益支出 515其他支出 521所得税费用`,
    },
  },
  {
    id: 'trade-union-2022',
    regime: 'trade-union',
    width: 3,
    categories: unionCategories,
    creditAssets: ['163', '172'],
    reviewCodes: [],
    groups: {
      asset: `101库存现金 102银行存款 111零余额账户用款额度 121财政应返还额度
131应收上级经费 132应收下级经费 135其他应收款 141库存物品 151投资
161在建工程 162固定资产 163累计折旧 171无形资产 172累计摊销
181长期待摊费用 182待处理财产损溢`,
      liability: '201应付职工薪酬 211应付上级经费 212应付下级经费 215其他应付款 221代管经费',
      'net-assets': `301资产基金 311专用基金 321工会资金结转 322工会资金结余
331财政拨款结转 332财政拨款结余 341预算稳定调节基金`,
      revenue: `402拨缴经费收入 403上级补助收入 404政府补助收入 406附属单位上缴收入
407投资收益 408其他收入 411动用预算稳定调节基金`,
      expense: `502职工活动组织支出 503职工服务支出 504维权支出 505业务支出
506行政支出 507资本性支出 508补助下级支出 509对附属单位的支出
510其他支出 521安排预算稳定调节基金`,
    },
  },
  {
    id: 'grassroots-trade-union-2022',
    regime: 'grassroots-trade-union',
    width: 3,
    categories: unionCategories,
    creditAssets: ['163'],
    reviewCodes: [],
    groups: {
      asset: `101库存现金 102银行存款 131应收上级经费 135其他应收款
141库存物品 162固定资产 163累计折旧 182待处理财产损溢`,
      liability: '211应付上级经费 215其他应付款',
      'net-assets': '301资产基金 321工会资金结转 322工会资金结余',
      revenue: '401会费收入 402拨缴经费收入 403上级补助收入 405行政补助收入 408其他收入',
      expense: '501职工活动支出 503职工服务支出 504维权支出 505业务支出 507资本性支出 510其他支出',
    },
  },
];

export function expectedAccounts(t: ExpectedTemplate) {
  return Object.entries(t.groups)
    .flatMap(([categoryId, text]) =>
      text
        .trim()
        .split(/\s+/)
        .map((entry) => {
          const code = entry.slice(0, t.width);
          const categoryDirection = t.categories.find((c) => c.id === categoryId)!.direction;
          const direction: BalanceDirection =
            t.creditAssets.includes(code) || t.creditPnl?.includes(code)
              ? 'credit'
              : categoryDirection;
          return { code, name: entry.slice(t.width), categoryId, direction };
        }),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}
