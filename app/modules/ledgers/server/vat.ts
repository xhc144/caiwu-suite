import {
  balanceSide,
  BusinessError,
  DIMENSION_TYPES,
  formatPeriod,
  moduleRoute,
  nextPeriod,
  VOUCHER_STATUS_LABELS,
  type Account,
  type BalanceRow,
  type EntryRow,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { LedgerQuery, LedgerReport, LedgerRow } from '../shared';
import { VatMappingChangeSchema, VatMappingSchema, type VatColumn } from '../vat-shared';
import { assertComplete, ENTRY_LIMIT, safeSum } from './service';

type ResolvedColumn = VatColumn & { leaves: Set<number> };
const CONFIG_KEY = 'vat.mapping';
const FIELDS = ['opening', 'debit', 'credit', 'closing', 'ytdDebit', 'ytdCredit'] as const;
type Totals = Record<(typeof FIELDS)[number], number>;
const zero = (): Totals => ({
  opening: 0,
  debit: 0,
  credit: 0,
  closing: 0,
  ytdDebit: 0,
  ytdCredit: 0,
});

function resolveMapping(accounts: Account[], columns: VatColumn[]): ResolvedColumn[] {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const byParent = new Map<number, Account[]>();
  for (const a of accounts) {
    if (a.parentId == null) continue;
    const siblings = byParent.get(a.parentId) ?? [];
    siblings.push(a);
    byParent.set(a.parentId, siblings);
  }
  const leavesOf = (account: Account): Account[] =>
    account.isLeaf ? [account] : (byParent.get(account.id) ?? []).flatMap(leavesOf);
  const occupied = new Map<string, string>();
  return columns.map((column) => {
    const leaves = new Set<number>();
    for (const code of column.accountCodes) {
      const account = byCode.get(code);
      if (!account)
        throw new BusinessError({
          code: 'LEDGERS_VAT_ACCOUNT',
          message: `栏目“${column.label}”对应的科目 ${code} 不存在`,
          hint: '请重新选择现有科目后保存。',
        });
      for (const leaf of leavesOf(account)) {
        const key = `${column.side}|${leaf.id}`;
        if (leaves.has(leaf.id) || occupied.has(key))
          throw new BusinessError({
            code: 'LEDGERS_VAT_OVERLAP',
            message: `科目 ${leaf.code} 在${column.side === 'debit' ? '借方' : '贷方'}栏目中被重复计算`,
            hint: '上级科目已包含全部下级，请删除父子重叠或重复的对应关系。',
          });
        leaves.add(leaf.id);
        occupied.set(key, column.label);
      }
    }
    return { ...column, leaves };
  });
}

export function vatService(svc: CoreServices) {
  return {
    async mapping() {
      return VatMappingSchema.parse(
        await svc.settings.get(CONFIG_KEY, { columns: [], revision: 0 }),
      );
    },
    async saveMapping(raw: unknown) {
      const input = VatMappingChangeSchema.parse(raw);
      await svc.permissions.require('ledgers.config.edit');
      return svc.tx(async (tsvc) => {
        const current = await vatService(tsvc).mapping();
        if (!input.confirmed) return current;
        if (current.revision !== input.expectedRevision)
          throw new BusinessError({
            code: 'LEDGERS_VAT_STALE',
            message: '增值税明细账设置已被其他窗口修改',
            hint: '请重新读取已保存设置后再保存；当前编辑内容尚未写入。',
          });
        resolveMapping(await tsvc.accounts.list(), input.columns);
        const next = VatMappingSchema.parse({
          columns: input.columns,
          revision: current.revision + 1,
        });
        await tsvc.settings.set(CONFIG_KEY, next);
        await tsvc.log.write({
          action: 'ledgers.vat-mapping',
          summary: `保存增值税明细账科目对应关系（${next.columns.length}栏）`,
        });
        return next;
      });
    },
  };
}

function total(rows: BalanceRow[]): Totals {
  return Object.fromEntries(FIELDS.map((f) => [f, safeSum(rows.map((r) => r[f]))])) as Totals;
}

/** 原版 w_zc_zzs；调用方须持有账套事务，所有分类与合计共用同一快照。 */
export async function buildVatReport(
  svc: CoreServices,
  input: LedgerQuery,
  accounts: Account[],
): Promise<LedgerReport> {
  const mapping = await vatService(svc).mapping();
  if (!mapping.columns.length)
    throw new BusinessError({
      code: 'LEDGERS_VAT_MAPPING_REQUIRED',
      message: '尚未设置增值税明细账的对应科目',
      hint: '请打开“增值税明细账设置”，设置分类栏目名称与对应科目后查询。',
      actions: [{ label: '设置增值税明细账', to: '/m/ledgers/vat' }],
    });
  const definitions = resolveMapping(accounts, mapping.columns);
  const mapped = new Set(definitions.flatMap((c) => [...c.leaves]));
  const selected = accounts.filter(
    (a) =>
      mapped.has(a.id) &&
      (!input.account ||
        (input.accountTo ? a.code >= input.account : a.code.startsWith(input.account))) &&
      (!input.accountTo || a.code <= input.accountTo || a.code.startsWith(input.accountTo)),
  );
  const ids = new Set(selected.map((a) => a.id));
  const columns = definitions.map((c) => ({
    ...c,
    leaves: new Set([...c.leaves].filter((id) => ids.has(id))),
  }));
  const book = await svc.book.info();
  if (input.periodFrom < book.startPeriod)
    throw new BusinessError({
      code: 'LEDGERS_VAT_BEFORE_START',
      message: '查询开始期间早于账套启用期间，不能生成完整增值税明细账',
      hint: `请选择 ${formatPeriod(book.startPeriod)} 或之后的期间。`,
    });
  const periods: number[] = [];
  for (let p = input.periodFrom; p <= input.periodTo; p = nextPeriod(p)) {
    periods.push(p);
    if (periods.length > 120)
      throw new BusinessError({
        code: 'LEDGERS_PERIOD_LIMIT',
        message: '查询范围超过 120 个月',
        hint: '请按年度或更短期间分次查询。',
      });
  }
  const report: LedgerReport = {
    query: input,
    title: '增值税明细账',
    orgName: book.orgName,
    rows: [],
    entryCount: 0,
    dynamicColumns: columns.map((c) => ({
      id: `vat_${c.id}`,
      label: `${c.side === 'debit' ? '借方' : '贷方'}·${c.label}`,
      money: true,
    })),
    scope: `${input.includeUnposted ? '包含未过账（待审核、已审核、已过账）' : '仅已过账'}；草稿和作废凭证始终排除；按已保存对应科目生成，各末级科目余额只计一次；分类栏仅计所设借贷方向，未分类的反向发生额另列；${input.currency || '全部币种'}，金额为本位币`,
  };
  if (!selected.length) return report;
  const entries = await svc.ledger.entries({
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    accountIds: [...ids],
    dimensions: input.dimensions,
    currency: input.currency || undefined,
    includeUnposted: input.includeUnposted,
    limit: ENTRY_LIMIT,
  });
  assertComplete(entries.length);
  report.entryCount = entries.length;
  const monthly = new Map<number, BalanceRow[]>();
  for (const p of periods)
    monthly.set(
      p,
      await svc.ledger.balances({
        periodFrom: p,
        periodTo: p,
        accountCodes: selected.map((a) => a.code),
        dimensions: input.dimensions,
        currency: input.currency || undefined,
        includeUnposted: input.includeUnposted,
        rollup: false,
        includeZero: input.includeZero,
      }),
    );
  const monthlyTotals = new Map([...monthly].map(([p, rows]) => [p, total(rows)]));
  if (
    !input.includeZero &&
    !entries.length &&
    ![...monthlyTotals.values()].some((t) => FIELDS.some((f) => t[f] !== 0))
  )
    return report;
  const byId = new Map(selected.map((a) => [a.id, a]));
  const items = await svc.dimensions.items();
  const names = new Map(items.map((d) => [d.id, `${d.code} ${d.name}`]));
  const grouped = new Map<number, EntryRow[]>();
  for (const entry of entries) {
    const rows = grouped.get(entry.period) ?? [];
    rows.push(entry);
    grouped.set(entry.period, rows);
  }
  let running = monthlyTotals.get(input.periodFrom)?.opening ?? 0;
  let serial = 0;
  const extraSides = new Set<'debit' | 'credit'>();
  const add = (
    kind: LedgerRow['kind'],
    summary: string,
    date: string,
    debit: number | null,
    credit: number | null,
    values: Record<string, number | null>,
    entry?: EntryRow,
  ) => {
    const side = balanceSide(running, 'debit');
    report.rows.push({
      id: `vat-${serial++}`,
      sectionKey: 'vat',
      kind,
      date,
      account: entry
        ? `${entry.accountCode} ${byId.get(entry.accountId)?.fullName ?? ''}`
        : '增值税映射科目合计',
      summary,
      debit,
      credit,
      signedBalance: running,
      balance: side.amount,
      side: side.side,
      voucherId: entry?.voucherId ?? null,
      href: entry ? moduleRoute('voucher-entry', `/edit?id=${entry.voucherId}`) : null,
      voucherNo: entry?.displayNo ?? '',
      status: entry ? VOUCHER_STATUS_LABELS[entry.status] : '',
      dimensions: entry
        ? DIMENSION_TYPES.filter((d) => entry.dimensions[d.id] != null)
            .map(
              (d) => `${d.name}：${names.get(entry.dimensions[d.id]!) ?? entry.dimensions[d.id]}`,
            )
            .join('；')
        : '',
      currency: entry?.currency ?? input.currency,
      refNo: entry?.refNo ?? '',
      values,
    });
  };
  const categoryValues = (rows: BalanceRow[], mode: 'month' | 'ytd') => {
    const values: Record<string, number | null> = {};
    for (const side of ['debit', 'credit'] as const) {
      const field = mode === 'month' ? side : side === 'debit' ? 'ytdDebit' : 'ytdCredit';
      const matching = columns.filter((c) => c.side === side);
      for (const c of matching)
        values[`vat_${c.id}`] = safeSum(
          rows.filter((r) => c.leaves.has(r.accountId)).map((r) => r[field]),
        );
      const covered = new Set(matching.flatMap((c) => [...c.leaves]));
      const remainder = safeSum(rows.filter((r) => !covered.has(r.accountId)).map((r) => r[field]));
      values[`vat_unclassified_${side}`] = remainder;
      if (remainder !== 0) extraSides.add(side);
    }
    return values;
  };
  add('opening', '期初余额', String(input.periodFrom), null, null, {});
  for (const p of periods) {
    const rows = monthly.get(p) ?? [];
    const t = monthlyTotals.get(p) ?? zero();
    let debit = 0,
      credit = 0;
    for (const entry of grouped.get(p) ?? []) {
      running = safeSum([running, entry.debit, -entry.credit]);
      debit = safeSum([debit, entry.debit]);
      credit = safeSum([credit, entry.credit]);
      const values: Record<string, number | null> = {};
      for (const c of columns)
        values[`vat_${c.id}`] = c.leaves.has(entry.accountId) ? entry[c.side] : 0;
      for (const side of ['debit', 'credit'] as const) {
        const remainder = columns.some((c) => c.side === side && c.leaves.has(entry.accountId))
          ? 0
          : entry[side];
        values[`vat_unclassified_${side}`] = remainder;
        if (remainder !== 0) extraSides.add(side);
      }
      add('entry', entry.summary, entry.date, entry.debit, entry.credit, values, entry);
    }
    if (running !== t.closing || debit !== t.debit || credit !== t.credit)
      throw new BusinessError({
        code: 'LEDGERS_VAT_BALANCE_MISMATCH',
        message: '增值税明细与核心余额不一致',
        hint: '请缩小期间后重新查询，并联系维护人员检查账套。',
      });
    add('month', '本月小计', formatPeriod(p), t.debit, t.credit, categoryValues(rows, 'month'));
    add('ytd', '本年累计', formatPeriod(p), t.ytdDebit, t.ytdCredit, categoryValues(rows, 'ytd'));
  }
  add('closing', '期末余额', String(input.periodTo), null, null, {});
  report.dynamicColumns!.push(
    ...(['debit', 'credit'] as const)
      .filter((side) => extraSides.has(side))
      .map((side) => ({
        id: `vat_unclassified_${side}`,
        label: `未分类${side === 'debit' ? '借方' : '贷方'}`,
        money: true,
      })),
  );
  return report;
}
