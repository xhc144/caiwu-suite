import { z } from 'zod';
import { zCents, zDate, zId, zPeriod } from '@caiwu/core';
const name = z.string().trim().min(1, '名称不能为空').max(60);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, '变量须为小写字母开头的字母、数字、下划线');
export const FieldSchema = z.object({
  key,
  name,
  kind: z.enum(['money', 'calculated']),
  role: z.enum(['earning', 'deduction', 'memo']),
  visible: z.boolean().default(true),
  print: z.boolean().default(true),
  carry: z.boolean().default(false),
  disabled: z.boolean().default(false),
});
export const FormulaSchema = z.object({
  name,
  target: key,
  expression: z.string().trim().min(1, '来源公式不能为空').max(300),
  condition: z.string().trim().max(300).default(''),
  enabled: z.boolean().default(true),
  tax: z.boolean().default(false),
});
export const CategorySchema = z.object({
  id: zId.optional(),
  revision: z.number().int().nonnegative().default(0),
  name,
  disabled: z.boolean().default(false),
  fields: z.array(FieldSchema).min(1).max(40),
  formulas: z.array(FormulaSchema).max(40).default([]),
});
export type Category = z.output<typeof CategorySchema> & { id: number };
export type Field = z.output<typeof FieldSchema>;
export type Formula = z.output<typeof FormulaSchema>;
export const EmployeeSchema = z.object({
  id: zId.optional(),
  revision: z.number().int().nonnegative().default(0),
  code: z.string().trim().min(1, '人员编号不能为空').max(30),
  name,
  departmentId: zId,
  startDate: zDate,
  endDate: zDate.nullable().default(null),
  disabled: z.boolean().default(false),
  taxKind: z.enum(['resident', 'nonresident', 'labor', 'bonus']).default('resident'),
  policy: z.enum(['employment', 'annual60000', 'firstIncome']).default('employment'),
  qualificationYear: z.number().int().min(2019).max(2100).nullable().default(null),
  qualificationConfirmed: z.boolean().default(false),
});
export type Employee = z.output<typeof EmployeeSchema> & { id: number; departmentName: string };
const positiveMoney = zCents.refine((v) => v >= 0, '扣除、历史收入和已扣税不能为负数');
export const TaxInputSchema = z.object({
  exempt: positiveMoney.default(0),
  special: positiveMoney.default(0),
  additional: positiveMoney.default(0),
  other: positiveMoney.default(0),
  relief: positiveMoney.default(0),
  openingIncome: positiveMoney.default(0),
  openingTax: positiveMoney.default(0),
  confirmed: z.boolean().default(false),
});
export type TaxInput = z.output<typeof TaxInputSchema>;
export const RowInputSchema = z.object({
  employeeId: zId,
  values: z.record(key, zCents),
  tax: TaxInputSchema.default({
    exempt: 0,
    special: 0,
    additional: 0,
    other: 0,
    relief: 0,
    openingIncome: 0,
    openingTax: 0,
    confirmed: false,
  }),
});
export type RowInput = z.output<typeof RowInputSchema>;
export const BatchSaveSchema = z.object({
  id: zId.optional(),
  revision: z.number().int().nonnegative().default(0),
  period: zPeriod,
  categoryId: zId,
  categoryRevision: z.number().int().nonnegative(),
  rows: z.array(RowInputSchema).min(1).max(500),
});
export const FilterSchema = z
  .object({ period: zPeriod.optional(), categoryId: zId.optional(), id: zId.optional() })
  .default({});
export const MappingSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  payableAccountId: zId,
  bankAccountId: zId,
  taxAccountId: zId,
  deductionAccountId: zId,
  expenseAccountId: zId,
  amountField: z.enum(['gross', 'net']),
  allocationField: z.literal('department'),
});
export type Mapping = z.output<typeof MappingSchema>;
export type TaxDetail = {
  version: string;
  income: number;
  exempt: number;
  months: number;
  expense: number;
  special: number;
  additional: number;
  other: number;
  taxable: number;
  rate: string;
  quick: number;
  relief: number;
  cumulativeTax: number;
  openingTax: number;
  allocatedTax: number;
  alreadyWithheld: number;
  currentTax: number;
  refundDeferred: number;
};
export type SalaryRow = RowInput & {
  employee: Employee;
  calculatedValues: Record<string, number>;
  formulaDetails: string[];
  gross: number;
  deductions: number;
  taxAmount: number;
  net: number;
  detail: TaxDetail;
};
export type Batch = {
  id: number;
  revision: number;
  period: number;
  categoryId: number;
  category: Category;
  calculated: boolean;
  closed: boolean;
  rows: RowInput[];
  snapshots: SalaryRow[];
  vouchers: { kind: string; id: number; number: string; status: string }[];
};
export const TAX_RULE = {
  version: 'cn-resident-salary-2026-10-26',
  effectiveFrom: '2019-01-01',
  checkedOn: '2026-10-26',
  scope:
    '中国内地居民个人普通工资薪金，同一账套视为同一扣缴单位；不支持非居民、劳务、年终奖及特殊行业。专项附加仅录入本单位已确认可在预扣环节享受的累计额，不含大病医疗。',
  sources: [
    {
      docNo: '国家税务总局公告2022年第7号（全文有效，替代2018年第60号）',
      effectiveFrom: '2022-01-01',
      sourceUrl: 'https://fgk.chinatax.gov.cn/zcfgk/c100012/c5196775/content.html',
    },
    {
      docNo: '国家税务总局公告2023年第14号（全文有效）',
      effectiveFrom: '2023-01-01',
      sourceUrl: 'https://shanghai.chinatax.gov.cn/zcfw/zcfgk/grsds/202309/t468512.html',
    },
    {
      docNo: '2018年第61号有效性与全文复核（全文有效）',
      effectiveFrom: '2019-01-01',
      sourceUrl: 'https://shanghai.chinatax.gov.cn/zcfw/zcfgk/grsds/201812/t443216.html',
    },
    {
      docNo: '国家税务总局公告2018年第61号 第六、七条',
      effectiveFrom: '2019-01-01',
      sourceUrl:
        'https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3963396/content.html',
    },
    {
      docNo: '个人所得税预扣率表一（居民工资薪金）第2页',
      effectiveFrom: '2019-01-01',
      sourceUrl: 'https://12366.chinatax.gov.cn/bzds/pdfview/pdf/068-3-1.pdf',
    },
    {
      docNo: '国家税务总局公告2020年第19号',
      effectiveFrom: '2021-01-01',
      sourceUrl:
        'https://tianjin.chinatax.gov.cn/11200000000/0300/030004/03000418/20201208154521999.shtml',
    },
    {
      docNo: '国家税务总局公告2020年第13号',
      effectiveFrom: '2020-07-01',
      sourceUrl: 'https://shanghai.chinatax.gov.cn/zcfw/zcfgk/grsds/202007/t454765.html',
    },
    {
      docNo: '国发〔2023〕13号',
      effectiveFrom: '2023-01-01',
      sourceUrl: 'https://app.www.gov.cn/govdata/gov/202308/31/506746/article.html',
    },
    {
      docNo: '国发〔2018〕41号（标准按2023年调整）',
      effectiveFrom: '2019-01-01',
      sourceUrl:
        'https://www.chinatax.gov.cn/chinatax/n810219/n810744/n3752930/n3752974/c3963375/content.html',
    },
  ],
};
export const DEFAULT_FIELDS: Field[] = [
  {
    key: 'base',
    name: '基本工资',
    kind: 'money',
    role: 'earning',
    visible: true,
    print: true,
    carry: true,
    disabled: false,
  },
  {
    key: 'bonus',
    name: '奖金',
    kind: 'money',
    role: 'earning',
    visible: true,
    print: true,
    carry: false,
    disabled: false,
  },
  {
    key: 'deduction',
    name: '个人扣款',
    kind: 'money',
    role: 'deduction',
    visible: true,
    print: true,
    carry: false,
    disabled: false,
  },
];
