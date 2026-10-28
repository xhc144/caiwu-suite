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
import {
  MultiFormatSchema,
  TITLES,
  type LedgerQuery,
  type LedgerReport,
  type LedgerRow,
  type MultiColumn,
} from '../shared';
import { assertComplete, ENTRY_LIMIT, safeSum } from './service';

type ResolvedColumn = MultiColumn & { leaves: Set<number> };
type Totals = {
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  ytdDebit: number;
  ytdCredit: number;
};
const FIELDS = ['opening', 'debit', 'credit', 'closing', 'ytdDebit', 'ytdCredit'] as const;

function fail(code: string, message: string, hint: string): never {
  throw new BusinessError({ code, message, hint });
}

function parentAccount(accounts: Account[], code: string): Account {
  if (!code)
    fail(
      'LEDGERS_MULTI_ACCOUNT_REQUIRED',
      '多栏账需要选择一个上级科目',
      '请选择有下级的科目后查询。',
    );
  const account = accounts.find((a) => a.code === code);
  if (!account) fail('LEDGERS_ACCOUNT_NOT_FOUND', `科目 ${code} 不存在`, '请重新选择已有科目。');
  // 原版 w_zc_dlz / w_zc_fhdlz 明确禁止末级科目生成多栏账。
  if (account.isLeaf)
    fail(
      'LEDGERS_MULTI_LEAF',
      '所选科目为明细科目，不能生成多栏账',
      '请选择有下级的科目；明细科目请使用三栏明细账。',
    );
  return account;
}

/** 只按实际父链取后代，不靠相近编码或栏目顺序推测从属关系。 */
function leafDescendants(accounts: Account[], parentId: number): Account[] {
  const byParent = new Map<number, Account[]>();
  for (const a of accounts) {
    if (a.parentId == null) continue;
    const siblings = byParent.get(a.parentId) ?? [];
    siblings.push(a);
    byParent.set(a.parentId, siblings);
  }
  const result: Account[] = [];
  const visit = (id: number) => {
    for (const child of byParent.get(id) ?? []) {
      if (child.isLeaf) result.push(child);
      else visit(child.id);
    }
  };
  visit(parentId);
  return result;
}

function resolveColumns(accounts: Account[], parent: Account, columns: MultiColumn[]) {
  const permitted = new Set(leafDescendants(accounts, parent.id).map((a) => a.id));
  const occupied = new Map<number, Set<'debit' | 'credit'>>();
  const ids = new Set<string>();
  return columns.map((column): ResolvedColumn => {
    if (ids.has(column.id))
      fail('LEDGERS_MULTI_COLUMN_DUPLICATE', '栏目编号不能重复', '请为每个栏目设置不同的编号。');
    ids.add(column.id);
    const leaves = new Set<number>();
    for (const code of column.accountCodes) {
      const selected = accounts.find((a) => a.code === code);
      if (!selected || selected.id === parent.id)
        fail(
          'LEDGERS_MULTI_COLUMN_ACCOUNT',
          `栏目“${column.label}”的科目 ${code} 不是所选科目的下级`,
          '请只选择所选上级科目之下的科目。',
        );
      const children = selected.isLeaf ? [selected] : leafDescendants(accounts, selected.id);
      if (!children.length || children.some((a) => !permitted.has(a.id)))
        fail(
          'LEDGERS_MULTI_COLUMN_ACCOUNT',
          `栏目“${column.label}”含有范围外科目 ${code}`,
          '请只选择所选上级科目之下的科目。',
        );
      for (const a of children) {
        if (leaves.has(a.id))
          fail(
            'LEDGERS_MULTI_COLUMN_OVERLAP',
            `栏目“${column.label}”重复覆盖科目 ${a.code}`,
            '请删除重复的科目；上级已包含其全部下级。',
          );
        leaves.add(a.id);
      }
    }
    const sides = column.side === 'net' ? (['debit', 'credit'] as const) : [column.side];
    for (const id of leaves) {
      const previous = occupied.get(id) ?? new Set<'debit' | 'credit'>();
      if (sides.some((s) => previous.has(s)))
        fail(
          'LEDGERS_MULTI_COLUMN_OVERLAP',
          `栏目“${column.label}”与其他栏目重复计算同一科目的发生额`,
          '同一科目可分别设置借方、贷方栏；净额栏不能再与这两栏重叠。',
        );
      sides.forEach((s) => previous.add(s));
      occupied.set(id, previous);
    }
    return { ...column, leaves };
  });
}

/** 保存及查询共用的领域检查；路由另负责格式和权限校验。 */
export function validateMultiColumns(accounts: Account[], account: string, columns: MultiColumn[]) {
  const parent = parentAccount(accounts, account);
  resolveColumns(accounts, parent, MultiFormatSchema.shape.columns.parse(columns));
}

function totals(rows: readonly BalanceRow[], leaves?: Set<number>): Totals {
  const included = leaves ? rows.filter((r) => leaves.has(r.accountId)) : rows;
  return Object.fromEntries(FIELDS.map((f) => [f, safeSum(included.map((r) => r[f]))])) as Totals;
}

function movement(column: ResolvedColumn, debit: number, credit: number): number {
  return column.side === 'debit'
    ? debit
    : column.side === 'credit'
      ? credit
      : safeSum([debit, -credit]);
}

/** 调用方持有当前账套读事务；所有分录和逐月余额取自同一快照。 */
export async function buildMultiReport(
  svc: CoreServices,
  input: LedgerQuery,
  accounts: Account[],
): Promise<LedgerReport> {
  const parent = parentAccount(accounts, input.account);
  if (input.accountTo)
    fail(
      'LEDGERS_MULTI_ACCOUNT_RANGE',
      '多栏账一次只能查询一个上级科目',
      '请清空“范围止”，再选择需要分栏的上级科目。',
    );
  const leaves = leafDescendants(accounts, parent.id);
  const leafIds = new Set(leaves.map((a) => a.id));
  const auxiliary = input.kind === 'auxiliary-multi';
  const dt = DIMENSION_TYPES.find((d) => d.id === input.dimensionType)!;
  if (
    auxiliary &&
    !leaves.some(
      (a) => a.dimensions.some((d) => d.type === dt.id) || (dt.id === 'partner' && a.isPartner),
    )
  )
    fail(
      'LEDGERS_MULTI_DIMENSION',
      `所选科目的下级没有启用${dt.name}核算`,
      '请选择科目已设置的辅助核算类型。',
    );
  const definitions =
    input.multiMode === 'custom'
      ? MultiFormatSchema.parse(
          await svc.settings.get(`multi.${input.kind}.${parent.code}`, {
            columns: [],
            revision: 0,
          }),
        ).columns
      : accounts
          .filter((a) => a.parentId === parent.id)
          .map((a): MultiColumn => ({
            id: String(a.id),
            label: `${a.code} ${a.name}`,
            accountCodes: [a.code],
            side: 'net',
          }));
  if (!definitions.length)
    fail(
      'LEDGERS_MULTI_NO_COLUMNS',
      '还没有设置自定义栏目',
      '请先打开“自定义栏目”添加并保存栏目，或选择“下级自动分栏”。',
    );
  const columns = resolveColumns(accounts, parent, definitions);
  const covered = new Set(columns.flatMap((c) => [...c.leaves]));
  const remainder = leaves.filter((a) => !covered.has(a.id));
  let remainderId = '_remainder';
  while (columns.some((c) => c.id === remainderId)) remainderId += '_';
  if (remainder.length)
    columns.push({
      id: remainderId,
      label: '其他未分栏科目',
      side: 'net',
      accountCodes: remainder.map((a) => a.code),
      leaves: new Set(remainder.map((a) => a.id)),
    });
  const periods: number[] = [];
  for (let p = input.periodFrom; p <= input.periodTo; p = nextPeriod(p)) {
    periods.push(p);
    if (periods.length > 120)
      fail('LEDGERS_PERIOD_LIMIT', '查询范围超过 120 个月', '请按年度或更短期间分次查询。');
  }
  const book = await svc.book.info();
  if (input.periodFrom < book.startPeriod)
    fail(
      'PERIOD_BEFORE_START',
      `${formatPeriod(input.periodFrom)}早于账套启用期间${formatPeriod(book.startPeriod)}，不能生成完整多栏账`,
      '请选择启用期间或之后的期间。',
    );
  const entries = await svc.ledger.entries({
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    accountIds: leaves.map((a) => a.id),
    dimensions: input.dimensions,
    currency: input.currency || undefined,
    includeUnposted: input.includeUnposted,
    limit: ENTRY_LIMIT,
  });
  assertComplete(entries.length);
  const groupOf = (dims: EntryRow['dimensions']) => (auxiliary ? (dims[dt.id] ?? 0) : 0);
  const entriesByGroup = new Map<number, EntryRow[]>();
  const monthly = new Map<number, Map<number, BalanceRow[]>>();
  const groups = new Set<number>();
  for (const e of entries) {
    const id = groupOf(e.dimensions);
    groups.add(id);
    const list = entriesByGroup.get(id) ?? [];
    list.push(e);
    entriesByGroup.set(id, list);
  }
  for (const p of periods) {
    const balances = await svc.ledger.balances({
      periodFrom: p,
      periodTo: p,
      accountCodes: [parent.code],
      dimensions: input.dimensions,
      groupBy: auxiliary ? [dt.id] : [],
      currency: input.currency || undefined,
      includeUnposted: input.includeUnposted,
      rollup: false,
      includeZero: input.includeZero,
    });
    const grouped = new Map<number, BalanceRow[]>();
    for (const b of balances) {
      if (!leafIds.has(b.accountId)) continue;
      const id = groupOf(b.dimensions);
      const list = grouped.get(id) ?? [];
      list.push(b);
      grouped.set(id, list);
      if (FIELDS.some((f) => b[f] !== 0)) groups.add(id);
    }
    monthly.set(p, grouped);
  }
  const items = await svc.dimensions.items();
  const byId = new Map(items.map((i) => [i.id, i]));
  const groupLabel = (id: number) => {
    const item = byId.get(id);
    return auxiliary
      ? `${dt.name}：${id === 0 ? '未指定' : item ? `${item.code} ${item.name}` : `已失效项目 ${id}`}`
      : '';
  };
  const dimensionText = (entry: EntryRow) =>
    DIMENSION_TYPES.filter((d) => entry.dimensions[d.id] != null && (!auxiliary || d.id !== dt.id))
      .map((d) => `${d.name}：${byId.get(entry.dimensions[d.id]!)?.name ?? entry.dimensions[d.id]}`)
      .join('；');
  const report: LedgerReport = {
    query: input,
    title: TITLES[input.kind],
    orgName: book.orgName,
    rows: [],
    entryCount: entries.length,
    dynamicColumns: columns.map((c) => ({
      id: `multi_${c.id}`,
      label: `${c.label}（${c.side === 'debit' ? '借方' : c.side === 'credit' ? '贷方' : '借减贷'}）`,
      money: true,
    })),
    scope: `${input.includeUnposted ? '包含未过账（待审核、已审核、已过账）' : '仅已过账'}；草稿和作废凭证始终排除；金额均为本位币；${input.currency || '全部币种'}；${auxiliary ? `按${dt.name}分别成账，未指定对象单独列示；` : ''}${input.multiMode === 'auto' ? '下级自动分栏' : '自定义分栏，未覆盖科目列入其他未分栏科目'}；净额栏按借减贷，期初及期末列示有符号余额；借方/贷方栏只列发生额，期初及期末留空`,
  };
  let serial = 0;
  if (input.includeZero && groups.size === 0)
    groups.add(auxiliary ? (input.dimensions[dt.id] ?? 0) : 0);
  for (const id of [...groups].sort((a, b) =>
    groupLabel(a).localeCompare(groupLabel(b), 'zh-CN'),
  )) {
    const sectionKey = `${input.kind}:${parent.id}:${id}`;
    const groupEntries = entriesByGroup.get(id) ?? [];
    const firstRows = monthly.get(input.periodFrom)?.get(id) ?? [];
    let running = totals(firstRows).opening;
    const add = (
      kind: LedgerRow['kind'],
      summary: string,
      date: string,
      debit: number | null,
      credit: number | null,
      values: Record<string, number | null>,
      entry?: EntryRow,
    ) => {
      const side = balanceSide(running, parent.direction);
      report.rows.push({
        id: `multi-${parent.id}-${id}-${serial++}`,
        sectionKey,
        kind,
        summary,
        date,
        account: `${parent.code} ${parent.fullName}`,
        debit,
        credit,
        signedBalance: running,
        balance: side.amount,
        side: side.side,
        values,
        voucherNo: entry?.displayNo ?? '',
        voucherId: entry?.voucherId ?? null,
        href: entry ? moduleRoute('voucher-entry', `/edit?id=${entry.voucherId}`) : null,
        status: entry ? VOUCHER_STATUS_LABELS[entry.status] : '',
        currency: entry?.currency ?? input.currency,
        refNo: entry?.refNo ?? '',
        dimensions: entry
          ? [groupLabel(id), dimensionText(entry)]
              .filter(Boolean)
              .filter((v, i, all) => all.indexOf(v) === i)
              .join('；')
          : groupLabel(id),
      });
    };
    const valuesFor = (rows: BalanceRow[], kind: 'opening' | 'month' | 'ytd' | 'closing') =>
      Object.fromEntries(
        columns.map((c) => {
          const b = totals(rows, c.leaves);
          return [
            `multi_${c.id}`,
            kind === 'opening' || kind === 'closing'
              ? c.side === 'net'
                ? b[kind]
                : null
              : movement(
                  c,
                  kind === 'month' ? b.debit : b.ytdDebit,
                  kind === 'month' ? b.credit : b.ytdCredit,
                ),
          ];
        }),
      );
    add(
      'opening',
      '期初余额',
      String(input.periodFrom),
      null,
      null,
      valuesFor(firstRows, 'opening'),
    );
    for (const p of periods) {
      const month = groupEntries.filter((e) => e.period === p);
      for (const e of month) {
        running = safeSum([running, e.debit, -e.credit]);
        const values = Object.fromEntries(
          columns.map((c) => [
            `multi_${c.id}`,
            c.leaves.has(e.accountId) ? movement(c, e.debit, e.credit) : 0,
          ]),
        );
        add('entry', e.summary, e.date, e.debit, e.credit, values, e);
      }
      const rows = monthly.get(p)?.get(id) ?? [];
      const b = totals(rows);
      if (
        running !== b.closing ||
        safeSum(month.map((e) => e.debit)) !== b.debit ||
        safeSum(month.map((e) => e.credit)) !== b.credit
      )
        fail(
          'LEDGERS_BALANCE_MISMATCH',
          `科目 ${parent.code}${auxiliary ? `（${groupLabel(id)}）` : ''}的明细与余额不一致`,
          '请缩小期间后重试，并联系维护人员检查账套。',
        );
      add('month', '本月小计', formatPeriod(p), b.debit, b.credit, valuesFor(rows, 'month'));
      add('ytd', '本年累计', formatPeriod(p), b.ytdDebit, b.ytdCredit, valuesFor(rows, 'ytd'));
    }
    const last = monthly.get(input.periodTo)?.get(id) ?? [];
    add('closing', '期末余额', String(input.periodTo), null, null, valuesFor(last, 'closing'));
  }
  return report;
}
