import { z } from 'zod';

export const TABLES = ['accounts', 'opening', 'vouchers', 'balances'] as const;
export type TableKind = (typeof TABLES)[number];
export const TABLE_NAMES: Record<TableKind, string> = {
  accounts: '科目',
  opening: '期初',
  vouchers: '凭证',
  balances: '余额',
};
export const FIELDS: Record<TableKind, Record<string, string>> = {
  accounts: {
    code: '科目编码',
    name: '科目名称',
    category: '类别',
    direction: '余额方向',
    cash: '现金',
    bank: '银行',
    cashflow: '现金流量',
    partner: '往来',
    disabled: '停用',
  },
  opening: {
    code: '科目编码',
    balance: '期初余额',
    ytdDebit: '累计借方',
    ytdCredit: '累计贷方',
  },
  vouchers: {
    sourceId: '来源凭证号',
    date: '日期',
    type: '凭证类型',
    number: '凭证编号',
    status: '状态',
    attachments: '附单数',
    line: '分录序号',
    code: '科目编码',
    summary: '摘要',
    debit: '借方金额',
    credit: '贷方金额',
  },
  balances: {
    code: '科目编码',
    opening: '期初余额',
    debit: '借方发生',
    credit: '贷方发生',
    closing: '期末余额',
    ytdDebit: '累计借方',
    ytdCredit: '累计贷方',
  },
};
export const REQUIRED_FIELDS: Record<TableKind, string[]> = {
  accounts: Object.keys(FIELDS.accounts),
  opening: Object.keys(FIELDS.opening),
  vouchers: Object.keys(FIELDS.vouchers),
  balances: Object.keys(FIELDS.balances),
};

export const SourceFileSchema = z.strictObject({
  name: z.string().min(1).max(120),
  kind: z.enum(['workbook', ...TABLES]),
  encoding: z.enum(['utf-8', 'gb18030']).default('utf-8'),
  base64: z.string().min(1).max(350_000),
});
export type SourceFile = z.input<typeof SourceFileSchema>;
export const FilesSchema = z.strictObject({ files: z.array(SourceFileSchema).min(1).max(4) });
export const CountsSchema = z.strictObject({
  accounts: z.number().int().min(1).max(1000),
  opening: z.number().int().min(1).max(1000),
  vouchers: z.number().int().min(1).max(500),
  lines: z.number().int().min(2).max(5000),
  balances: z.number().int().min(1).max(1000),
});
export type SourceCounts = z.infer<typeof CountsSchema>;
export const PrepareSchema = FilesSchema.extend({
  mappings: z.record(z.enum(TABLES), z.record(z.string(), z.string())),
  expected: CountsSchema,
});
export type PrepareInput = z.input<typeof PrepareSchema>;
export type TablePreview = { headers: string[]; rows: number; sample: string[][] };
export type Inspection = {
  files: { name: string; sha256: string; bytes: number }[];
  tables: Record<TableKind, TablePreview>;
  mappings: Record<TableKind, Record<string, string>>;
};
export type ImportAccount = {
  code: string;
  name: string;
  category: string;
  direction: 'debit' | 'credit';
  cash: boolean;
  bank: boolean;
  cashflow: boolean;
  partner: boolean;
  disabled: boolean;
};
export type ImportOpening = { code: string; balance: number; ytdDebit: number; ytdCredit: number };
export type ImportBalance = {
  code: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  ytdDebit: number;
  ytdCredit: number;
};
export type ImportVoucher = {
  sourceId: string;
  date: string;
  type: string;
  number: number;
  attachments: number;
  lines: { line: number; code: string; summary: string; debit: number; credit: number }[];
};
export type ImportPlan = {
  accounts: ImportAccount[];
  opening: ImportOpening[];
  vouchers: ImportVoucher[];
  balances: ImportBalance[];
  counts: SourceCounts;
  periodFrom: number;
  periodTo: number;
};
export type Reconciliation = {
  counts: SourceCounts;
  templateAccounts: number;
  balances: ImportBalance[];
  voucherIds: number[];
  openingTotal: number;
  debitTotal: number;
  creditTotal: number;
};
export type BatchView = {
  id: string;
  status: 'prepared' | 'completed';
  createdAt: string;
  expiresAt: string;
  files: Inspection['files'];
  contentHash: string;
  counts: SourceCounts;
  reconciliation: Reconciliation | null;
};
