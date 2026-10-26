import { z } from 'zod';
import { zId, zPeriod } from '@caiwu/core';
const positive = (max: number) => z.number().int().min(1).max(max);
export const LayoutSchema = z
  .object({
    paper: z.enum(['A4', 'A5', 'B5', 'custom']).default('A4'),
    widthMm: z.number().min(80).max(600).default(210),
    heightMm: z.number().min(80).max(600).default(297),
    landscape: z.boolean().default(false),
    margins: z
      .object({
        top: z.number().min(0).max(100),
        right: z.number().min(0).max(100),
        bottom: z.number().min(0).max(100),
        left: z.number().min(0).max(100),
      })
      .default({ top: 10, right: 10, bottom: 10, left: 10 }),
    offsetX: z.number().min(-100).max(100).default(0),
    offsetY: z.number().min(-100).max(100).default(0),
    perPage: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    rows: positive(100).default(20),
    fontSize: z.number().min(6).max(24).default(10),
    font: z.enum(['serif', 'sans-serif']).default('serif'),
    scale: z.number().min(25).max(100).default(100),
    copies: positive(99).default(1),
    unitName: z.string().max(100).default(''),
    showUnit: z.boolean().default(true),
    supervisor: z.string().max(40).default(''),
    showAccountCode: z.boolean().default(true),
    showAuxiliary: z.boolean().default(true),
    deduplicateSummary: z.boolean().default(false),
    startPage: positive(999999).default(1),
    continuousPage: z.boolean().default(true),
    quantityDecimals: z.number().int().min(0).max(6).default(2),
    color: z.boolean().default(false),
    voucherGapMm: z.number().min(0).max(50).default(0),
  })
  .superRefine((s, ctx) => {
    const w = s.paper === 'A4' ? 210 : s.paper === 'A5' ? 148 : s.paper === 'B5' ? 176 : s.widthMm,
      h = s.paper === 'A4' ? 297 : s.paper === 'A5' ? 210 : s.paper === 'B5' ? 250 : s.heightMm;
    const width = s.landscape ? h : w,
      height = s.landscape ? w : h;
    if (
      width - s.margins.left - s.margins.right < 60 ||
      (height - s.margins.top - s.margins.bottom - 1 - s.voucherGapMm * (s.perPage - 1)) /
        s.perPage <
        45
    )
      ctx.addIssue({ code: 'custom', message: '可打印区域过小，请减少边距或每页张数' });
    if (
      s.offsetX < -s.margins.left ||
      s.offsetX > s.margins.right ||
      s.offsetY < -s.margins.top ||
      s.offsetY > s.margins.bottom
    )
      ctx.addIssue({ code: 'custom', message: '套打偏移超出纸张，会截断内容；请减小偏移' });
  });
export const SettingsSchema = z.object({ voucher: LayoutSchema, ledger: LayoutSchema });
export type Settings = z.output<typeof SettingsSchema>;
export const defaultSettings: Settings = {
  voucher: LayoutSchema.parse({}),
  ledger: LayoutSchema.parse({ rows: 30 }),
};
export const VoucherSelectionSchema = z
  .object({
    order: z.enum(['range', 'queried']).default('range'),
    ids: z.array(zId).max(1000).optional(),
    voucherId: zId.optional(),
    from: zPeriod,
    to: zPeriod,
    type: zId.optional(),
    numberFrom: positive(999999).optional(),
    numberTo: positive(999999).optional(),
  })
  .superRefine((v, c) => {
    if (v.from > v.to || (v.numberFrom != null && v.numberTo != null && v.numberFrom > v.numberTo))
      c.addIssue({ code: 'custom', message: '开始期间或编号不能大于结束值' });
    if (v.order === 'queried' && !v.ids?.length)
      c.addIssue({ code: 'custom', message: '按屏幕顺序打印前，请先查询并选择凭证' });
    if (v.ids && new Set(v.ids).size !== v.ids.length)
      c.addIssue({ code: 'custom', message: '已查询凭证 ID 不能重复' });
  });
export type VoucherSelection = z.input<typeof VoucherSelectionSchema>;
export const LedgerSelectionSchema = z
  .object({
    from: zPeriod,
    to: zPeriod,
    account: z.string().trim().max(400),
    accountScope: z.enum(['selected', 'all', 'first', 'leaf']).default('selected'),
    kind: z.enum(['general', 'detail', 'cash', 'bank']),
    includeUnposted: z.boolean().default(false),
    printEmpty: z.boolean().default(false),
    printNoActivity: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.from > v.to) ctx.addIssue({ code: 'custom', message: '开始期间不能晚于结束期间' });
    if (v.accountScope === 'selected' && !v.account)
      ctx.addIssue({ code: 'custom', path: ['account'], message: '请填写要打印的科目编码' });
  });
export type LedgerSelection = z.input<typeof LedgerSelectionSchema>;
export const TEMPLATE_FIELDS = [
  'unit',
  'period',
  'account',
  'title',
  'date',
  'voucherNo',
  'summary',
  'debit',
  'credit',
  'balance',
] as const;
export const TemplateSchema = z
  .object({
    code: z.number().int().min(0).max(99, '格式编码必须小于 100'),
    name: z.string().trim().min(1, '格式名称不能为空').max(80),
    rows: positive(999),
    cols: positive(250),
    rowHeight: z.number().min(3).max(30),
    colWidth: z.number().min(5).max(100),
    cells: z
      .array(
        z.object({
          row: positive(999),
          col: positive(250),
          text: z.string().max(500).default(''),
          field: z.enum(TEMPLATE_FIELDS).optional(),
          align: z.enum(['left', 'center', 'right']).default('left'),
        }),
      )
      .min(1, '格式数据缺失，不能创建空格式')
      .max(10000),
  })
  .superRefine((s, c) => {
    if (!s.cells.some((cell) => cell.field || cell.text.trim()))
      c.addIssue({ code: 'custom', message: '格式数据缺失，不能创建空格式' });
    const used = new Set<string>();
    for (const cell of s.cells) {
      const key = `${cell.row}:${cell.col}`;
      if (cell.row > s.rows || cell.col > s.cols || used.has(key))
        c.addIssue({ code: 'custom', message: '单元格越界或重复' });
      used.add(key);
    }
  });
export type PrintTemplate = z.output<typeof TemplateSchema>;
