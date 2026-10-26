import { createHash } from 'node:crypto';
import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { AuditSchema, type AuditInput } from '../shared';
import { sumCents } from './amounts';

/** 即使再导入表格软件，外部文字也不能成为公式。数值金额始终保留整数分。 */
export function safeText(value: string): string {
  return /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
}
function safeValues(value: unknown): unknown {
  if (typeof value === 'string') return safeText(value);
  if (Array.isArray(value)) return value.map(safeValues);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeValues(v)]));
  return value;
}
export function textFile(filename: string, data: unknown) {
  try {
    return {
      filename,
      mime: 'application/json;charset=utf-8',
      content: JSON.stringify(safeValues(data), null, 2),
    };
  } catch {
    throw new BusinessError({
      code: 'EXPORT_FAILED',
      message: '生成文件失败，未完成导出',
      hint: '缩小数据范围后重试；仍失败请联系管理员',
    });
  }
}

/** 每一项均为显式白名单，禁止导出数据库、凭据、会话或自由配置。 */
export async function collectAudit(svc: CoreServices, raw: AuditInput) {
  const input = AuditSchema.parse(raw);
  const book = await svc.book.info();
  if (input.year < Math.floor(book.startPeriod / 100))
    throw new BusinessError({
      code: 'AUDIT_BEFORE_START',
      message: '导出年度早于账套启用年度',
      hint: `请选择 ${Math.floor(book.startPeriod / 100)} 年或之后`,
    });
  const from = input.year * 100 + 1,
    to = input.year * 100 + 12;
  const scopes = new Set(input.scopes);
  const accounts = scopes.has('accounts')
    ? await svc.db
        .selectFrom('account')
        .select([
          'id',
          'code',
          'name',
          'full_name',
          'parent_id',
          'level',
          'category_id',
          'direction',
          'is_leaf',
          'disabled',
          'currency_code',
          'quantity_unit',
        ])
        .orderBy('code')
        .execute()
    : [];
  const opening = scopes.has('opening')
    ? await svc.db
        .selectFrom('opening_balance')
        .select([
          'year',
          'account_id',
          'dim_project',
          'dim_partner',
          'dim_department',
          'dim_person',
          'currency_code',
          'balance',
          'ytd_debit',
          'ytd_credit',
          'fc_balance',
          'quantity_e6',
        ])
        .where('year', '=', input.year)
        .orderBy('id')
        .execute()
    : [];
  const vouchers = scopes.has('vouchers')
    ? await svc.db
        .selectFrom('voucher')
        .select([
          'id',
          'period',
          'voucher_type_id',
          'number',
          'date',
          'attachments',
          'status',
          'voided',
          'debit_total',
          'credit_total',
          'created_by',
          'audited_by',
          'posted_by',
        ])
        .where('period', '>=', from)
        .where('period', '<=', to)
        .orderBy('period')
        .orderBy('id')
        .execute()
    : [];
  const lines = scopes.has('vouchers')
    ? await svc.db
        .selectFrom('voucher_line as l')
        .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
        .select([
          'l.id',
          'l.voucher_id',
          'l.line_no',
          'l.period',
          'l.summary',
          'l.account_id',
          'l.dim_project',
          'l.dim_partner',
          'l.dim_department',
          'l.dim_person',
          'l.dim_cashflow',
          'l.currency_code',
          'l.exchange_rate',
          'l.fc_amount',
          'l.quantity_e6',
          'l.unit_price',
          'l.debit',
          'l.credit',
          'l.ref_no',
          'l.biz_date',
        ])
        .where('v.period', '>=', from)
        .where('v.period', '<=', to)
        .orderBy('l.voucher_id')
        .orderBy('l.line_no')
        .execute()
    : [];
  const voucherTypes = scopes.has('vouchers')
    ? await svc.db
        .selectFrom('voucher_type')
        .select(['id', 'code', 'name', 'disabled'])
        .orderBy('id')
        .execute()
    : [];
  const currencies = scopes.has('currencies') ? await svc.reference.currencies() : [];
  const exchangeRates = scopes.has('currencies')
    ? await svc.db
        .selectFrom('exchange_rate')
        .select(['currency_code', 'period', 'rate'])
        .where('period', '>=', from)
        .where('period', '<=', to)
        .orderBy('currency_code')
        .orderBy('period')
        .execute()
    : [];
  const periods = scopes.has('periods')
    ? (await svc.periods.list()).filter((p) => p.year === input.year)
    : [];
  const dimensions = scopes.has('dimensions')
    ? await svc.db
        .selectFrom('dimension_item')
        .select(['id', 'type_id', 'code', 'name', 'parent_id', 'is_leaf', 'disabled'])
        .orderBy('id')
        .execute()
    : [];
  const counts = {
    accounts: accounts.length,
    opening: opening.length,
    vouchers: vouchers.length,
    lines: lines.length,
    voucherTypes: voucherTypes.length,
    currencies: currencies.length,
    exchangeRates: exchangeRates.length,
    periods: periods.length,
    dimensions: dimensions.length,
  };
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total > 200000)
    throw new BusinessError({
      code: 'EXPORT_TOO_LARGE',
      message: '资料超过单次 200000 条上限',
      hint: '分范围导出，或联系管理员安排大账套导出',
    });
  const data = {
    format: '通用审计资料 v1',
    notice:
      '金额单位为整数分，余额借正贷负；数量为 quantity_e6（百万分之一），汇率及单价为十进制字符串。包含所选年度全部状态及作废凭证。未按 GB/T 24589.1-2024 官方字段全文核对，不作标准合规声明。以单引号转义可能被表格软件当作公式的文字。',
    book: {
      id: book.id,
      name: book.name,
      orgName: book.orgName,
      startPeriod: book.startPeriod,
      templateName: book.templateName,
      baseCurrency: book.baseCurrency,
      codeScheme: book.codeScheme,
    },
    year: input.year,
    scopes: [...scopes].sort(),
    counts,
    totals: {
      debit: sumCents(lines.map((l) => l.debit)),
      credit: sumCents(lines.map((l) => l.credit)),
      openingBalance: sumCents(opening.map((l) => l.balance)),
    },
    accounts,
    opening,
    vouchers,
    lines,
    voucherTypes,
    currencies,
    exchangeRates,
    periods,
    dimensions,
  };
  return { data, digest: createHash('sha256').update(JSON.stringify(data)).digest('hex'), total };
}
