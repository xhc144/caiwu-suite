import { z } from 'zod';
import { zCents, zId, zPeriod } from '@caiwu/core';
import { RowInputSchema } from './shared';

export const HISTORICAL_TAX_RULES = [
  {
    version: 'cn-salary-monthly-2008-03',
    name: '2008年3月至2011年8月工资薪金',
    from: 200803,
    to: 201108,
    monthlyExpense: 200000,
    sourceName: '2007年修正个人所得税法第六条、税率表一（2008年3月施行）',
    sourceUrl: 'https://shanghai.chinatax.gov.cn/zcfw/zcfgk/grsds/200903/t288931.html',
    brackets: [
      [50000, '0.05', 0],
      [200000, '0.10', 2500],
      [500000, '0.15', 12500],
      [2000000, '0.20', 37500],
      [4000000, '0.25', 137500],
      [6000000, '0.30', 337500],
      [8000000, '0.35', 637500],
      [10000000, '0.40', 1037500],
      [Number.MAX_SAFE_INTEGER, '0.45', 1537500],
    ],
  },
  {
    version: 'cn-salary-monthly-2011-09',
    name: '2011年9月至2018年9月工资薪金',
    from: 201109,
    to: 201809,
    monthlyExpense: 350000,
    sourceName: '2011年修正个人所得税法第六条、税率表一',
    sourceUrl: 'https://www.court.gov.cn/zixun/xiangqing/2887.html',
    brackets: [
      [150000, '0.03', 0],
      [450000, '0.10', 10500],
      [900000, '0.20', 55500],
      [3500000, '0.25', 100500],
      [5500000, '0.30', 275500],
      [8000000, '0.35', 550500],
      [Number.MAX_SAFE_INTEGER, '0.45', 1350500],
    ],
  },
  {
    version: 'cn-salary-monthly-2018-10',
    name: '2018年10月至12月工资薪金',
    from: 201810,
    to: 201812,
    monthlyExpense: 500000,
    sourceName: '财税〔2018〕98号第一条、附件一',
    sourceUrl: 'https://guangxi.chinatax.gov.cn/zcwj/zxwj/201809/t20180913_254765.html',
    brackets: [
      [300000, '0.03', 0],
      [1200000, '0.10', 21000],
      [2500000, '0.20', 141000],
      [3500000, '0.25', 266000],
      [5500000, '0.30', 441000],
      [8000000, '0.35', 716000],
      [Number.MAX_SAFE_INTEGER, '0.45', 1516000],
    ],
  },
] as const;
export const HistoricalTaxConfirmSchema = z.object({
  period: zPeriod,
  monthlyExpense: zCents,
  confirmed: z.boolean(),
});
export const CorrectionInputSchema = z.object({
  id: zId,
  revision: z.number().int().nonnegative(),
  reason: z.string().trim().min(2, '请填写至少两字的更正原因').max(200),
  rows: z.array(RowInputSchema).min(1).max(500),
});
export const CorrectionApplySchema = CorrectionInputSchema.extend({
  hash: z.string().length(64),
  expiresAt: z.string().datetime(),
  confirmed: z.boolean(),
});
export type CorrectionInput = z.output<typeof CorrectionInputSchema>;
