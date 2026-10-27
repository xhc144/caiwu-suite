import { z } from 'zod';
import { zId, zPeriod } from '@caiwu/core';

export const CodeSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, '编码须为最多三位数字且小于1000')
  .transform((v) => String(Number(v)));
export const HeaderSchema = z
  .object({
    code: CodeSchema,
    name: z.string().trim().min(1, '报表名称不能为空').max(80),
    rows: z.number().int().min(1, '行数不能为零').max(999, '最大行数为999'),
    cols: z.number().int().min(1, '列数不能为零').max(250, '最大列数为250'),
  })
  .strict();
export const MetricSchema = z.enum([
  'opening',
  'closing',
  'debit',
  'credit',
  'ytdDebit',
  'ytdCredit',
]);
export const UnitSchema = z.enum(['number', 'cents', 'foreignCents', 'quantity']);
export const DimensionSchema = z.enum([
  'none',
  'project',
  'partner',
  'department',
  'person',
  'cashflow',
]);
export const METRIC_LABELS: Record<z.infer<typeof MetricSchema>, string> = {
  opening: '期初余额',
  closing: '期末余额',
  debit: '本期借方发生',
  credit: '本期贷方发生',
  ytdDebit: '本年累计借方',
  ytdCredit: '本年累计贷方',
};
export const UNIT_LABELS: Record<z.infer<typeof UnitSchema>, string> = {
  number: '普通数值',
  cents: '本币金额（分，显示元）',
  foreignCents: '外币金额（分，显示外币元）',
  quantity: '数量',
};
/** 唯一取数签名；向导与服务端使用同一输入约束。没有未核实的原版别名。 */
export const BalanceFunctionSchema = z
  .object({
    account: z.string().regex(/^\d{1,20}$/, '请选择科目编码'),
    metric: MetricSchema,
    unit: z.enum(['cents', 'foreignCents', 'quantity']),
    currency: z.string().regex(/^[A-Z]{3}$/, '币种须为三位大写代码'),
    direction: z.enum(['signed', 'normal']),
    dimension: DimensionSchema,
    item: z.string().max(40),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.dimension !== 'none' && !v.item)
      ctx.addIssue({ code: 'custom', message: '辅助取数必须选择辅助项', path: ['item'] });
    if (v.dimension === 'none' && v.item)
      ctx.addIssue({ code: 'custom', message: '未选择辅助类型时不能指定辅助项' });
    if (v.unit !== 'foreignCents' && v.currency !== 'CNY')
      ctx.addIssue({ code: 'custom', message: '本币与数量取数币种固定为CNY；外币请选外币金额' });
    if (v.unit !== 'cents' && ['ytdDebit', 'ytdCredit'].includes(v.metric))
      ctx.addIssue({ code: 'custom', message: 'core暂未提供外币/数量本年累计，不能使用此组合' });
    if (
      v.dimension === 'cashflow' &&
      !['debit', 'credit', 'ytdDebit', 'ytdCredit'].includes(v.metric)
    )
      ctx.addIssue({ code: 'custom', message: '现金流量项目仅支持发生额，不臆造期初项目分配' });
  });
export type BalanceFunction = z.infer<typeof BalanceFunctionSchema>;
export const BALANCE_ARGUMENTS = [
  'account',
  'metric',
  'unit',
  'currency',
  'direction',
  'dimension',
  'item',
] as const;
export function balanceFormula(raw: BalanceFunction) {
  const v = BalanceFunctionSchema.parse(raw);
  return `BALANCE(${BALANCE_ARGUMENTS.map((key) => JSON.stringify(v[key])).join(',')})`;
}
export function columnName(col: number): string {
  let out = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}
export function coordinates(address: string) {
  const m = /^([A-Z]{1,2})([1-9]\d{0,2})$/.exec(address);
  if (!m) return { row: 0, col: 0 };
  return { row: Number(m[2]), col: [...m[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) };
}
const AddressSchema = z.string().regex(/^[A-Z]{1,2}[1-9]\d{0,2}$/, '单元格地址格式不正确');
export const CellSchema = z
  .object({
    address: AddressSchema,
    kind: z.enum(['text', 'number', 'money', 'formula']),
    source: z.string().max(2000, '单元格内容最多2000字'),
    unit: UnitSchema,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('CNY'),
  })
  .strict();
export const StyleSchema = z
  .object({
    address: AddressSchema,
    align: z.enum(['left', 'center', 'right']).default('left'),
    wrap: z.boolean().default(false),
    bold: z.boolean().default(false),
    format: z.enum(['general', 'decimal2', 'percent']).default('general'),
  })
  .strict();
export const MergeSchema = z
  .object({
    row: z.number().int().positive(),
    col: z.number().int().positive(),
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
  })
  .strict();
export const CheckSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    left: z.string().min(1).max(2000),
    right: z.string().min(1).max(2000),
    tolerance: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, '阈值使用非负十进制数（金额为分）'),
  })
  .strict();
/** Wave 2 可直接通过 importTemplate API 导入；所有层次拒绝未知字段。 */
export const ReportTemplateSchema = HeaderSchema.extend({
  schemaVersion: z.literal(1),
  readOnly: z.boolean(),
  cells: z.array(CellSchema).max(5000),
  merges: z.array(MergeSchema).max(1000),
  styles: z.array(StyleSchema).max(5000),
  rowHeights: z
    .array(
      z
        .object({ row: z.number().int().positive(), height: z.number().int().min(20).max(200) })
        .strict(),
    )
    .max(999),
  colWidths: z
    .array(
      z
        .object({ col: z.number().int().positive(), width: z.number().int().min(60).max(600) })
        .strict(),
    )
    .max(250),
  checks: z.array(CheckSchema).max(100),
  accounting: z
    .object({
      defaultScope: z.literal('posted'),
      sign: z.literal('debit-positive'),
      moneyUnit: z.literal('cents'),
      rounding: z.literal('half-up'),
    })
    .strict(),
})
  .strict()
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const inside = (a: string) => {
      const p = coordinates(a);
      return p.row >= 1 && p.row <= v.rows && p.col >= 1 && p.col <= v.cols;
    };
    for (const [name, list] of [
      ['单元格', v.cells],
      ['格式', v.styles],
    ] as const) {
      const seen = new Set<string>();
      for (const cell of list) {
        if (!inside(cell.address))
          issue(`${name} ${cell.address} 超出行列边界；请先扩大尺寸，不能静默删除内容`);
        if (seen.has(cell.address)) issue(`${name} ${cell.address} 重复`);
        seen.add(cell.address);
      }
    }
    for (const c of v.cells) {
      if (
        c.kind === 'money' &&
        (!/^-?\d+$/.test(c.source) || !Number.isSafeInteger(Number(c.source)))
      )
        issue(`${c.address} 金额必须是安全整数分`);
      if (c.kind === 'money' && !['cents', 'foreignCents'].includes(c.unit))
        issue(`${c.address} 金额单元格须使用金额单位`);
      if (
        c.kind === 'number' &&
        (!/^-?\d{1,20}(\.\d{1,10})?$/.test(c.source) || !['number', 'quantity'].includes(c.unit))
      )
        issue(`${c.address} 数值格式或单位不正确`);
    }
    for (let i = 0; i < v.merges.length; i++) {
      const a = v.merges[i]!;
      if (a.row + a.rows - 1 > v.rows || a.col + a.cols - 1 > v.cols) issue('合并范围超出报表边界');
      for (const b of v.merges.slice(0, i))
        if (
          a.row < b.row + b.rows &&
          b.row < a.row + a.rows &&
          a.col < b.col + b.cols &&
          b.col < a.col + a.cols
        )
          issue('合并范围不能相交');
      if (
        v.cells.some((c) => {
          const p = coordinates(c.address);
          return (
            p.row >= a.row &&
            p.row < a.row + a.rows &&
            p.col >= a.col &&
            p.col < a.col + a.cols &&
            (p.row !== a.row || p.col !== a.col) &&
            c.source !== ''
          );
        })
      )
        issue('合并范围含有其他非空单元格，请先移走内容');
    }
    if (v.rowHeights.some((r) => r.row > v.rows) || v.colWidths.some((c) => c.col > v.cols))
      issue('行高或列宽超出边界');
    if (
      new Set(v.rowHeights.map((r) => r.row)).size !== v.rowHeights.length ||
      new Set(v.colWidths.map((c) => c.col)).size !== v.colWidths.length
    )
      issue('行高或列宽不能重复');
  });
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;
export type Cell = z.infer<typeof CellSchema>;
export type CellStyle = z.infer<typeof StyleSchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type Report = { id: number; revision: number; template: ReportTemplate };
export type ResultCell = { address: string; value: string; unit: Unit | 'text'; currency: string };
export type ReportSnapshot = {
  id: number;
  reportId: number;
  revision: number;
  period: number;
  includeUnposted: boolean;
  unpostedCount: number;
  generatedAt: string;
  template: ReportTemplate;
  cells: ResultCell[];
  dependencies: { id: number; code: string; revision: number }[];
  checks: {
    name: string;
    status: 'pass' | 'fail' | 'error';
    difference: string | null;
    tolerance: string;
    reason?: string;
  }[];
};
export const IdentitySchema = z
  .object({ id: zId, expectedRevision: z.number().int().positive() })
  .strict();
export const GenerateSchema = IdentitySchema.extend({
  period: zPeriod,
  includeUnposted: z.boolean().default(false),
  confirmUnposted: z.boolean().default(false),
  requestId: z.string().uuid(),
}).strict();
export function emptyTemplate(raw: z.input<typeof HeaderSchema>): ReportTemplate {
  return ReportTemplateSchema.parse({
    ...HeaderSchema.parse(raw),
    schemaVersion: 1,
    readOnly: false,
    cells: [],
    merges: [],
    styles: [],
    checks: [],
    rowHeights: [],
    colWidths: [],
    accounting: {
      defaultScope: 'posted',
      sign: 'debit-positive',
      moneyUnit: 'cents',
      rounding: 'half-up',
    },
  });
}

/** 法定定义和普通单元格模板有独立身份，复制和引入不得转换为普通模板。 */
export const StatutoryScopeSchema = z.enum(['month', 'yearToDate', 'annual']);
export const StatutoryDefinitionSchema = z
  .object({
    definitionId: z.string().min(1).max(100),
    definitionRevision: z.number().int().positive(),
    reportKey: z.string().min(1).max(80),
  })
  .strict();
export const StatutoryHeaderSchema = HeaderSchema.pick({ code: true, name: true });
export const StatutorySaveSchema = StatutoryDefinitionSchema.extend({
  ...StatutoryHeaderSchema.shape,
  id: zId.optional(),
  expectedRevision: z.number().int().positive().optional(),
  configuration: z.json(),
})
  .strict()
  .refine((v) => (v.id === undefined) === (v.expectedRevision === undefined), {
    message: '修改报表时必须提供当前版本',
  });
export const StatutoryGenerateSchema = IdentitySchema.extend({
  period: zPeriod,
  requestId: z.string().uuid(),
  confirmUnposted: z.boolean().default(false),
}).strict();
export const StatutoryOutputSchema = IdentitySchema.extend({
  snapshotId: zId,
  period: zPeriod,
  format: z.enum(['xlsx', 'print']),
}).strict();
export const StatutoryImportSchema = StatutoryDefinitionSchema.extend({
  schemaVersion: z.literal(1),
  kind: z.literal('statutory-report'),
  bookId: z.string().min(1),
  ...StatutoryHeaderSchema.shape,
  configuration: z.json(),
}).strict();
export type StatutoryProfile = z.infer<typeof StatutoryDefinitionSchema> & {
  id: number;
  revision: number;
  code: string;
  name: string;
  bookId: string;
  configuration: z.infer<ReturnType<typeof z.json>>;
  sourceDigest: string;
};
export type StatutorySnapshot = {
  id: number;
  profile: StatutoryProfile;
  period: number;
  generatedAt: string;
  unpostedCount: number;
  result: unknown;
};
export type StatutoryPrintJob = {
  title: string;
  html: string;
  css?: string;
  pageSize?: 'A4' | 'A5' | 'B5' | { widthMm: number; heightMm: number };
  orientation?: 'portrait' | 'landscape';
  marginMm?: number;
};
