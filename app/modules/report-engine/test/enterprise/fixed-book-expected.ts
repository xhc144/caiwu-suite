// 独立手算台账。没有引用被测报表项目、合计函数、科目建议或总账读数。
// 每月 n=月份×年度系数（2025为1，2026为2）：净利润12935+900n，税后OCI75，
// 经营现金9415+900n、投资现金-2400、常规筹资现金3800。
// 资产另增加6270、负债增加4075；一月投入12000×系数，十二月分红6000×系数。
type Expected = Record<string, number | string>;
export const amounts = (values: Expected): Record<string, string> =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));

export function expectedBalance(year: 2025 | 2026, month: number) {
  const elapsed = (year === 2026 ? 12 : 0) + month;
  const weighted = (year === 2026 ? 78 : 0) + ((year === 2026 ? 2 : 1) * month * (month + 1)) / 2;
  const capital = year === 2026 ? 30000 : 10000;
  const reserve = year === 2026 ? 6000 : 2000;
  const distributions =
    (year === 2026 ? 6000 : 0) + (month === 12 ? (year === 2026 ? 12000 : 6000) : 0);
  const appropriations = distributions / 2;
  const ownerCash = capital + reserve - distributions;
  return amounts({
    cash: 1010000 + 10815 * elapsed + 900 * weighted + ownerCash,
    tradingAssets: 1000 + 70 * elapsed,
    derivativeAssets: 0,
    notesReceivable: 0,
    accountsReceivable: 49000 + 900 * elapsed,
    receivablesFinancing: 0,
    prepayments: 15000,
    otherReceivables: 4700,
    inventory: 72000 + 2850 * elapsed,
    contractAssets: 0,
    heldForSaleAssets: 0,
    currentNoncurrentAssets: 0,
    otherCurrentAssets: 1500,
    currentAssetsTotal: 1153200 + 14635 * elapsed + 900 * weighted + ownerCash,
    debtInvestments: 0,
    otherDebtInvestments: 0,
    longTermReceivables: 0,
    equityInvestments: 90000 + 850 * elapsed,
    otherEquityInvestments: 1000 + 100 * elapsed,
    otherFinancialAssets: 0,
    investmentProperty: 0,
    fixedAssets: 232000 + 1500 * elapsed,
    construction: 19000,
    biologicalAssets: 0,
    oilGasAssets: 0,
    rightOfUseAssets: 0,
    intangibleAssets: 29000,
    development: 0,
    goodwill: 0,
    longTermPrepaid: 12000,
    deferredTaxAssets: 5000,
    otherNoncurrentAssets: 0,
    noncurrentAssetsTotal: 388000 + 2450 * elapsed,
    assetsTotal: 1541200 + 17085 * elapsed + 900 * weighted + ownerCash,
    shortTermLoans: 100000 + 4000 * elapsed,
    tradingLiabilities: 0,
    derivativeLiabilities: 0,
    notesPayable: 0,
    accountsPayable: 52000,
    advances: 15000,
    contractLiabilities: 0,
    employeePayable: 6000,
    taxesPayable: 4500 + 50 * elapsed,
    otherPayables: 5000,
    heldForSaleLiabilities: 0,
    currentNoncurrentLiabilities: 20000,
    otherCurrentLiabilities: 0,
    currentLiabilitiesTotal: 202500 + 4050 * elapsed,
    longTermLoans: 60000,
    bondsPayable: 0,
    bondPreferred: 0,
    bondPerpetual: 0,
    leaseLiabilities: 0,
    longTermPayables: 26000,
    provisions: 4000,
    deferredIncome: 0,
    deferredTaxLiabilities: 7000 + 25 * elapsed,
    otherNoncurrentLiabilities: 0,
    noncurrentLiabilitiesTotal: 97000 + 25 * elapsed,
    liabilitiesTotal: 299500 + 4075 * elapsed,
    capital: 1162700 + capital,
    otherEquity: 0,
    equityPreferred: 0,
    equityPerpetual: 0,
    capitalReserve: 50000 + reserve,
    treasuryStock: 1000,
    otherComprehensive: 75 * elapsed,
    specialReserve: 0,
    surplusReserve: 10000 + appropriations,
    retainedEarnings: 20000 + 12935 * elapsed + 900 * weighted - distributions - appropriations,
    equityTotal: 1241700 + 13010 * elapsed + 900 * weighted + ownerCash,
    liabilitiesEquityTotal: 1541200 + 17085 * elapsed + 900 * weighted + ownerCash,
    equityOther: 0,
  });
}

const eps = (net: number) => `${Math.floor(net / 10000)}.${String(net % 10000).padStart(4, '0')}`;
export function expectedProfit(year: 2025 | 2026, month: number, cumulative: boolean) {
  const count = cumulative ? month : 1;
  const n = (year === 2026 ? 2 : 1) * (cumulative ? (month * (month + 1)) / 2 : month);
  const net = 12935 * count + 900 * n;
  return amounts({
    revenue: 23000 * count + 1000 * n,
    cost: 6000 * count + 100 * n,
    taxes: 300 * count,
    selling: 1000 * count,
    administration: 700 * count,
    research: 400 * count,
    finance: 175 * count,
    interestExpense: 200 * count,
    interestIncome: 50 * count,
    otherIncome: 200 * count,
    investmentIncome: 350 * count,
    associateIncome: 50 * count,
    derecognitionIncome: 0,
    hedgeIncome: 0,
    fairValueIncome: 70 * count,
    creditImpairment: -100 * count,
    assetImpairment: -150 * count,
    disposalIncome: 100 * count,
    operatingProfit: 14895 * count + 900 * n,
    nonoperatingIncome: 80 * count,
    nonoperatingExpense: 40 * count,
    profitTotal: 14935 * count + 900 * n,
    incomeTax: 2000 * count,
    netProfit: net,
    continuingProfit: net + 40 * count,
    discontinuedProfit: -40 * count,
    oci: 75 * count,
    ociNonreclass: 75 * count,
    remeasurement: 0,
    equityNonreclass: 0,
    otherEquityFairValue: 75 * count,
    ownCreditRisk: 0,
    otherNonreclass: 0,
    ociReclass: 0,
    equityReclass: 0,
    debtFairValue: 0,
    financialReclassification: 0,
    debtImpairment: 0,
    cashflowHedge: 0,
    translation: 0,
    otherReclass: 0,
    comprehensiveIncome: net + 75 * count,
    basicEps: eps(net),
    dilutedEps: eps(net),
  });
}

export function expectedCashflow(year: 2025 | 2026, month: number, cumulative: boolean) {
  const count = cumulative ? month : 1,
    factor = year === 2026 ? 2 : 1;
  const n = factor * (cumulative ? (month * (month + 1)) / 2 : month);
  const capital = cumulative || month === 1 ? 12000 * factor : 0;
  const dividend = month === 12 ? 6000 * factor : 0;
  const opening =
    cumulative || month === 1
      ? year === 2026
        ? 1215980
        : 1010000
      : Number(expectedBalance(year, month - 1).cash);
  return amounts({
    salesReceipts: 22000 * count + 1000 * n,
    taxRefunds: 0,
    otherOperatingReceipts: 330 * count,
    operatingReceipts: 22330 * count + 1000 * n,
    purchases: 9000 * count + 100 * n,
    employees: 1000 * count,
    taxPayments: 2250 * count,
    otherOperatingPayments: 665 * count,
    operatingPayments: 12915 * count + 100 * n,
    operatingNet: 9415 * count + 900 * n,
    investmentRecovery: 200 * count,
    investmentReturns: 300 * count,
    assetDisposals: 100 * count,
    businessDisposals: 0,
    otherInvestingReceipts: 0,
    investingReceipts: 600 * count,
    assetPurchases: 2000 * count,
    investmentPayments: 1000 * count,
    businessPurchases: 0,
    otherInvestingPayments: 0,
    investingPayments: 3000 * count,
    investingNet: -2400 * count,
    capitalReceipts: capital,
    loanReceipts: 5000 * count,
    otherFinancingReceipts: 0,
    financingReceipts: 5000 * count + capital,
    debtPayments: 1000 * count,
    dividendInterestPayments: 200 * count + dividend,
    otherFinancingPayments: 0,
    financingPayments: 1200 * count + dividend,
    financingNet: 3800 * count + capital - dividend,
    exchangeEffect: 0,
    cashIncrease: 10815 * count + 900 * n + capital - dividend,
    cashOpening: opening,
    cashClosing: Number(expectedBalance(year, month).cash),
    cashScopeChange: 0,
    actualCashClosing: Number(expectedBalance(year, month).cash),
  });
}

const zero = {
  capital: '0',
  equityPreferred: '0',
  equityPerpetual: '0',
  equityOther: '0',
  capitalReserve: '0',
  treasuryStock: '0',
  otherComprehensive: '0',
  specialReserve: '0',
  surplusReserve: '0',
  retainedEarnings: '0',
  total: '0',
};
export function expectedEquity(year: 2025 | 2026) {
  const factor = year === 2026 ? 2 : 1,
    net = year === 2026 ? 295620 : 225420;
  const opening =
    year === 2026
      ? {
          ...zero,
          capital: '1172700',
          capitalReserve: '52000',
          treasuryStock: '1000',
          otherComprehensive: '900',
          surplusReserve: '13000',
          retainedEarnings: '236420',
          total: '1474020',
        }
      : {
          ...zero,
          capital: '1162700',
          capitalReserve: '50000',
          treasuryStock: '1000',
          surplusReserve: '10000',
          retainedEarnings: '20000',
          total: '1241700',
        };
  const changes = {
    ...zero,
    ...amounts({
      capital: 10000 * factor,
      capitalReserve: 2000 * factor,
      otherComprehensive: 900,
      surplusReserve: 3000 * factor,
      retainedEarnings: net - 9000 * factor,
      total: net + 900 + 6000 * factor,
    }),
  };
  const contributions = {
    ...zero,
    ...amounts({ capital: 10000 * factor, capitalReserve: 2000 * factor, total: 12000 * factor }),
  };
  const distribution = {
    ...zero,
    ...amounts({
      surplusReserve: 3000 * factor,
      retainedEarnings: -9000 * factor,
      total: -6000 * factor,
    }),
  };
  const closing =
    year === 2026
      ? {
          ...zero,
          capital: '1192700',
          capitalReserve: '56000',
          treasuryStock: '1000',
          otherComprehensive: '1800',
          surplusReserve: '19000',
          retainedEarnings: '514040',
          total: '1782540',
        }
      : {
          ...zero,
          capital: '1172700',
          capitalReserve: '52000',
          treasuryStock: '1000',
          otherComprehensive: '900',
          surplusReserve: '13000',
          retainedEarnings: '236420',
          total: '1474020',
        };
  return {
    previousClosing: opening,
    policy: zero,
    error: zero,
    otherAdjustment: zero,
    opening,
    changes,
    comprehensive: {
      ...zero,
      ...amounts({ otherComprehensive: 900, retainedEarnings: net, total: net + 900 }),
    },
    contributions,
    ordinaryContributions: contributions,
    instrumentContributions: zero,
    sharePayments: zero,
    otherContributions: zero,
    distribution,
    surplusAppropriation: {
      ...zero,
      ...amounts({ surplusReserve: 3000 * factor, retainedEarnings: -3000 * factor }),
    },
    distributions: {
      ...zero,
      ...amounts({ retainedEarnings: -6000 * factor, total: -6000 * factor }),
    },
    otherDistribution: zero,
    transfers: zero,
    capitalizationReserve: zero,
    capitalizationSurplus: zero,
    lossRecovery: zero,
    benefitTransfer: zero,
    ociTransfer: zero,
    otherTransfer: zero,
    closing,
  };
}
