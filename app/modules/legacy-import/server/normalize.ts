import {
  BusinessError,
  Decimal,
  DIMENSION_TYPES,
  isDecimalString,
  qtyToE6,
  zDate,
  type DimensionTypeId,
} from '@caiwu/core';
import type { ImportIssue, ImportKind, ImportLocation } from '../shared';
import type { ParsedImportFile } from './files';

export type SourceRow = {
  kind: ImportKind;
  location: ImportLocation;
  values: Record<string, string>;
  original: Record<string, string>;
};
export type ImportPayload = {
  rows: SourceRow[];
  issues: ImportIssue[];
  files: {
    name: string;
    sheets: {
      name: string;
      kind: ImportKind;
      headers: string[];
      rowCount: number;
      headerRow?: number;
    }[];
  }[];
};

// 只翻译静态资料中已明确的列名；含义不明的原版代码由用户显式映射。
const aliases: Record<string, string[]> = {
  code: ['科目编码', '科目代码', 'kmbm', 'code'],
  name: ['科目名称', 'km_mc', 'name'],
  category: ['科目类别', '类别', 'category'],
  direction: ['余额方向', '期初方向', '方向', 'qcfx', 'yefx', 'direction'],
  currency: ['币种', '币种编码', 'bz', 'currency'],
  quantityUnit: ['数量单位', '计量单位', 'dw', 'quantityUnit'],
  projectEnabled: ['项目核算', 'xms'],
  partnerEnabled: ['客供核算', '客户核算', 'dws'],
  departmentEnabled: ['部门核算', 'bms'],
  personEnabled: ['个人核算', 'grs'],
  cashflowEnabled: ['现金流量核算'],
  isCash: ['现金科目'],
  isBank: ['银行科目'],
  isPartner: ['往来科目'],
  disabled: ['停用', 'disabled'],
  mnemonic: ['助记码'],
  isContra: ['备抵科目'],
  balanceNature: ['余额性质'],
  closingRule: ['结转用途'],
  type: ['辅助类型', '档案类型', 'type'],
  dimCode: ['档案编码', '辅助编码', '编号'],
  dimName: ['档案名称', '辅助名称', '名称'],
  parentCode: ['上级编码', 'parentCode'],
  attrs: ['扩展资料', 'attrs'],
  contact: ['联系人', 'lxr'],
  phone: ['电话', '联系电话', 'lxdh'],
  address: ['地址', '通讯地址', '通信地址', 'txdz'],
  postalCode: ['邮编', '邮政编码', 'yzbm'],
  bank: ['开户银行', '开户行', 'khyh'],
  bankAccount: ['银行账号', '银行帐号', '帐号', 'yhzh'],
  taxNumber: ['税号', '纳税登记号', 'nsh'],
  shortName: ['简称'],
  role: ['客供角色', '角色'],
  dimCategory: ['分类名称'],
  year: ['年度', '会计年度', 'nf', 'year'],
  month: ['月份', '会计月份', 'yf', 'month'],
  balance: ['期初余额', '年初余额', 'qcye', 'balance'],
  ytdDebit: ['累计借方', '本年累计借方', 'lj_jf', 'ytdDebit'],
  ytdCredit: ['累计贷方', '本年累计贷方', 'lj_df', 'ytdCredit'],
  fcBalance: ['外币余额', '期初外币', 'qcwbye', 'fcBalance'],
  quantity: ['数量', '期初数量', 'pz_sl', 'quantity'],
  project: ['项目编码', 'xmbm', 'project'],
  partner: ['客供编码', '客户编码', '供应商编码', 'dwbm', 'partner'],
  department: ['部门编码', 'bmbm', 'department'],
  person: ['个人编码', 'grbm', 'person'],
  cashflow: ['现金流量编码', '现金流量项目编码', 'cashflow'],
  date: ['凭证日期', '日期', 'pzdj_pzdj_rq', 'date'],
  voucherType: ['凭证字', '凭证类型', 'pzlx', 'voucherType'],
  number: ['凭证号', '凭证编号', 'pzbh', 'number'],
  attachments: ['附件数', '附件张数', 'pzdj_pzdj_fds', 'attachments'],
  summary: ['摘要', 'pz_zy', 'summary'],
  debit: ['借方金额', '借方', 'pz_jf', 'debit'],
  credit: ['贷方金额', '贷方', 'pz_df', 'credit'],
  cashflowDirection: ['现金流量方向', 'cashflowDirection'],
  exchangeRate: ['汇率', 'pz_hl', 'exchangeRate'],
  fcAmount: ['外币金额', '原币金额', 'pz_wb', 'fcAmount'],
  unitPrice: ['单价', 'pz_dj', 'unitPrice'],
  entrySide: ['借贷方向', 'entrySide'],
  settlement: ['结算方式编码', 'jslb', 'settlement'],
  refNo: ['票号', 'pz_ph', 'refNo'],
  bizDate: ['业务日期', 'bizDate'],
  note: ['备注', 'pzdj_pzdj_bz', 'note'],
  originalStatus: ['原状态', '凭证状态', 'jzbz', '状态'],
  originalMaker: ['原制单人', '制单人', 'pzdj_pzdj_zdr'],
  originalAuditor: ['原审核人', '审核人', 'pzdj_pzdj_shr'],
  originalPoster: ['原记账人', '原过账人', '记账人', 'pzdj_pzdj_jzr'],
  originalAuditDate: ['原审核日期', '审核日期', 'pzdj_pzdj_shrq'],
  originalPostDate: ['原记账日期', '记账日期', 'pzdj_pzdj_jzrq'],
  sourceLine: ['原分录号', '分录序号', 'pz_xh'],
};
const allowed: Record<ImportKind, string[]> = {
  accounts: [
    'code',
    'name',
    'category',
    'direction',
    'currency',
    'quantityUnit',
    'projectEnabled',
    'partnerEnabled',
    'departmentEnabled',
    'personEnabled',
    'cashflowEnabled',
    'isCash',
    'isBank',
    'isPartner',
    'disabled',
    'mnemonic',
    'isContra',
    'balanceNature',
    'closingRule',
  ],
  dimensions: [
    'type',
    'dimCode',
    'dimName',
    'parentCode',
    'disabled',
    'attrs',
    'contact',
    'phone',
    'address',
    'postalCode',
    'bank',
    'bankAccount',
    'taxNumber',
    'shortName',
    'role',
    'dimCategory',
    'cashflowDirection',
  ],
  opening: [
    'year',
    'code',
    'project',
    'partner',
    'department',
    'person',
    'currency',
    'balance',
    'direction',
    'ytdDebit',
    'ytdCredit',
    'fcBalance',
    'quantity',
  ],
  vouchers: [
    'year',
    'month',
    'date',
    'voucherType',
    'number',
    'attachments',
    'summary',
    'code',
    'debit',
    'credit',
    'project',
    'partner',
    'department',
    'person',
    'cashflow',
    'cashflowDirection',
    'currency',
    'exchangeRate',
    'fcAmount',
    'quantity',
    'unitPrice',
    'entrySide',
    'settlement',
    'refNo',
    'bizDate',
    'note',
    'originalStatus',
    'originalMaker',
    'originalAuditor',
    'originalPoster',
    'originalAuditDate',
    'originalPostDate',
    'sourceLine',
  ],
};
const required: Record<ImportKind, string[]> = {
  accounts: ['code', 'name'],
  dimensions: ['type', 'dimCode', 'dimName'],
  opening: ['code', 'balance'],
  vouchers: ['date', 'voucherType', 'number', 'summary', 'code', 'debit', 'credit'],
};
export function fieldLabel(key: string): string {
  if (key === 'categoryId') return '科目类别';
  if (key === 'cashflowRequired') return '现金流量核算';
  return aliases[key]?.[0] ?? key;
}
const headerKey = (v: string) =>
  v
    .replace(/\s+/g, '')
    .replace(/[（(]元[）)]/g, '')
    .toLowerCase();
export function normalizeFile(
  name: string,
  parsed: ParsedImportFile,
  mapping: Record<string, string>,
  valueMap: Record<string, Record<string, string>> = {},
): ImportPayload {
  const result: ImportPayload = {
    rows: [],
    issues: parsed.issues.map((i) => ({ ...i, file: name })),
    files: [{ name, sheets: [] }],
  };
  for (const sheet of parsed.sheets) {
    result.files[0]!.sheets.push({
      name: sheet.name,
      kind: sheet.kind,
      headers: sheet.headers,
      rowCount: sheet.rows.length,
      headerRow: sheet.headerRow ?? 1,
    });
    const used = new Set<string>();
    const fields = sheet.headers.map((header) => {
      const target = mapping[header] ?? header;
      if (target === '-') return '';
      const key = allowed[sheet.kind].find(
        (k) => k === target || aliases[k]?.some((a) => headerKey(a) === headerKey(target)),
      );
      if (!key) {
        result.issues.push({
          file: name,
          sheet: sheet.name,
          row: sheet.headerRow ?? 1,
          column: header,
          message: `未识别列「${header}」；原值保留在迁移来源中，需导入时请设置列映射`,
          severity: 'warning',
        });
        return '';
      }
      if (used.has(key))
        result.issues.push({
          file: name,
          sheet: sheet.name,
          row: sheet.headerRow ?? 1,
          column: header,
          message: `多列映射到「${fieldLabel(key)}」，请调整列映射`,
          severity: 'error',
        });
      used.add(key);
      return key;
    });
    for (const key of required[sheet.kind])
      if (!used.has(key))
        result.issues.push({
          file: name,
          sheet: sheet.name,
          row: sheet.headerRow ?? 1,
          column: fieldLabel(key),
          message: `缺少「${fieldLabel(key)}」列`,
          severity: 'error',
        });
    for (const row of sheet.rows) {
      if (row.cells.every((c) => !c.trim())) continue;
      const values: Record<string, string> = {},
        original: Record<string, string> = {};
      sheet.headers.forEach((h, i) => {
        original[h] = row.cells[i] ?? '';
        const key = fields[i];
        if (key) {
          const originalValue = (row.cells[i] ?? '').trim();
          const replacements = valueMap[h] ?? valueMap[fieldLabel(key)] ?? valueMap[key];
          values[key] =
            replacements && Object.hasOwn(replacements, originalValue)
              ? replacements[originalValue]!
              : originalValue;
        }
      });
      result.rows.push({
        kind: sheet.kind,
        location: { file: name, sheet: sheet.name, row: row.row },
        values,
        original,
      });
    }
  }
  return result;
}

export class CellError extends Error {
  constructor(
    readonly column: string,
    message: string,
  ) {
    super(message);
  }
}
export function requiredText(row: SourceRow, key: string, max = 100): string {
  const v = row.values[key] ?? '';
  if (!v) throw new CellError(fieldLabel(key), `${fieldLabel(key)}不能为空`);
  if (v.length > max)
    throw new CellError(fieldLabel(key), `${fieldLabel(key)}不能超过${max}个字符`);
  return v;
}
export function money(row: SourceRow, key: string): number {
  let s = (row.values[key] ?? '').trim();
  if (!s) return 0;
  s = s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/[￥¥元\s]/g, '');
  if (/^[（(].*[）)]$/.test(s)) s = `-${s.slice(1, -1)}`;
  if (s.includes(',') && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d{0,2})?$/.test(s))
    throw new CellError(fieldLabel(key), '金额千分位格式有误，请核对原表');
  s = s.replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(s))
    throw new CellError(fieldLabel(key), '金额须为元，最多两位小数；请核对原表');
  const n = new Decimal(s).mul(100).toNumber();
  if (!Number.isSafeInteger(n)) throw new CellError(fieldLabel(key), '金额超出可处理范围');
  return n;
}
export function decimal(row: SourceRow, key: string, quantity = false): string | undefined {
  const s = row.values[key];
  if (!s) return undefined;
  if (!isDecimalString(s)) throw new CellError(fieldLabel(key), '请填写十进制数字');
  const d = new Decimal(s);
  if (quantity) {
    if (d.decimalPlaces() > 6)
      throw new CellError(fieldLabel(key), '数量最多六位小数，请先核对原表');
    try {
      qtyToE6(s);
    } catch {
      throw new CellError(fieldLabel(key), '数量超出可处理范围');
    }
  } else if (!d.isFinite() || d.abs().greaterThan('999999999999999'))
    throw new CellError(fieldLabel(key), '数值超出可处理范围');
  return d.toFixed();
}
export function integer(
  row: SourceRow,
  key: string,
  fallback?: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const s = row.values[key];
  if (!s && fallback != null) return fallback;
  if (!s || !/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s) > max)
    throw new CellError(fieldLabel(key), '请填写范围内的非负整数');
  return Number(s);
}
export function flag(row: SourceRow, key: string): boolean | undefined {
  const s = row.values[key];
  if (s == null || s === '') return undefined;
  if (['是', '1', 'true', '启用', '有'].includes(s.toLowerCase())) return true;
  if (['否', '0', 'false', '无'].includes(s.toLowerCase())) return false;
  throw new CellError(fieldLabel(key), '请填写是或否（也可填1或0）');
}
export function side(row: SourceRow, key: string): 'debit' | 'credit' | undefined {
  const s = row.values[key];
  if (!s || s === '平') return undefined;
  if (['借', '借方', 'debit'].includes(s)) return 'debit';
  if (['贷', '贷方', 'credit'].includes(s)) return 'credit';
  throw new CellError(fieldLabel(key), '请填写借或贷；原版数字方向请先确认含义后转换');
}
export function date(row: SourceRow, key: string): string {
  const s = requiredText(row, key, 30).replace(/[/.]/g, '-');
  const match =
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?: 00:00:00)?$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  const value = match
    ? `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`
    : s;
  const parsed = zDate.safeParse(value);
  if (!parsed.success || Number(value.slice(0, 4)) < 1900)
    throw new CellError(fieldLabel(key), '日期须为有效的年-月-日，年份须不早于1900年');
  return parsed.data;
}
export function dimensionType(row: SourceRow): DimensionTypeId {
  const s = requiredText(row, 'type');
  const synonyms: Record<string, DimensionTypeId> = {
    项目: 'project',
    客户: 'partner',
    供应商: 'partner',
    '客户/供应商': 'partner',
    客供: 'partner',
    部门: 'department',
    个人: 'person',
    人员: 'person',
    现金流量项目: 'cashflow',
    现金流量: 'cashflow',
  };
  const type = synonyms[s] ?? DIMENSION_TYPES.find((d) => d.id === s)?.id;
  if (!type) throw new CellError('辅助类型', '辅助类型应为项目、客供、部门、个人或现金流量项目');
  return type;
}
export function issueFor(row: SourceRow, error: unknown): ImportIssue[] {
  if (error instanceof CellError)
    return [{ ...row.location, column: error.column, message: error.message, severity: 'error' }];
  const data =
    error && typeof error === 'object' && 'data' in error
      ? (error.data as {
          problems?: unknown;
          details?: { problems?: { line: number; message: string }[] };
        })
      : undefined;
  if (data?.details?.problems)
    return data.details.problems.map((p) => ({
      ...row.location,
      column: '凭证',
      message: p.message,
      severity: 'error',
    }));
  return [
    {
      ...row.location,
      column: '',
      message:
        error instanceof BusinessError
          ? error.message
          : '该行读取或保存失败，请核对数据后重试；原文件仍保留',
      severity: 'error',
    },
  ];
}
