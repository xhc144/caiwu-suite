import {
  balanceSide,
  BusinessError,
  formatPeriod,
  makePeriod,
  nextPeriod,
  periodYear,
  sumCents,
  type Account,
  type BalanceRow,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { LedgerQuery, LedgerReport, LedgerRow } from '../shared';

const MONEY_FIELDS = ['opening', 'debit', 'credit', 'closing', 'ytdDebit', 'ytdCredit'] as const;
type MoneyBalance = Pick<BalanceRow, (typeof MONEY_FIELDS)[number]>;

/** core 逐科目余额已计算期间与累计；这里只汇总本币整分，不读取、混加任何数量。 */
function amountsByRoot(
  rows: BalanceRow[],
  roots: Account[],
  owner: Map<number, number>,
): Map<number, MoneyBalance> {
  const grouped = new Map(roots.map((root) => [root.id, [] as BalanceRow[]]));
  for (const row of rows) {
    const root = owner.get(row.accountId);
    if (root != null) grouped.get(root)?.push(row);
  }
  return new Map(
    [...grouped].map(([id, children]) => {
      const result = {} as MoneyBalance;
      for (const field of MONEY_FIELDS) {
        try {
          result[field] = sumCents(children.map((child) => child[field]));
        } catch {
          throw amountRange();
        }
      }
      return [id, result];
    }),
  );
}

function amountRange() {
  return new BusinessError({
    code: 'LEDGERS_AMOUNT_RANGE',
    message: '总账金额超出安全整数范围',
    hint: '请缩小科目或期间范围后重新查询。',
  });
}

/** 范围边缘可能只覆盖父科目的一部分，只有完整覆盖的父科目才能代替下级。 */
function rootsInRange(all: Account[], q: LedgerQuery): Account[] {
  const byId = new Map(all.map((a) => [a.id, a]));
  const matches = (a: Account) =>
    (!q.account || (q.accountTo ? a.code >= q.account : a.code.startsWith(q.account))) &&
    (!q.accountTo || a.code <= q.accountTo || a.code.startsWith(q.accountTo));
  const counts = new Map<number, { total: number; selected: number }>();
  for (const leaf of all.filter((a) => a.isLeaf)) {
    let a: Account | undefined = leaf;
    while (a) {
      const count = counts.get(a.id) ?? { total: 0, selected: 0 };
      count.total++;
      if (matches(leaf)) count.selected++;
      counts.set(a.id, count);
      a = a.parentId == null ? undefined : byId.get(a.parentId);
    }
  }
  const candidates = new Set(
    all
      .filter((a) => {
        const c = counts.get(a.id);
        return matches(a) && c && c.total > 0 && c.total === c.selected;
      })
      .map((a) => a.id),
  );
  return all.filter((a) => {
    if (!candidates.has(a.id)) return false;
    let parent = a.parentId == null ? undefined : byId.get(a.parentId);
    while (parent) {
      if (candidates.has(parent.id)) return false;
      parent = parent.parentId == null ? undefined : byId.get(parent.parentId);
    }
    return true;
  });
}

/** 调用方已进入 svc.tx；所有元数据与逐月 core 余额使用同一事务快照。 */
export async function buildGeneralReport(
  svc: CoreServices,
  input: LedgerQuery,
  accounts: Account[],
): Promise<LedgerReport> {
  const book = await svc.book.info();
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
  const selected = rootsInRange(accounts, input);
  const report: LedgerReport = {
    query: input,
    title: '总分类账',
    orgName: book.orgName,
    entryCount: 0,
    rows: [],
    scope: `${input.includeUnposted ? '包含未过账（待审核、已审核、已过账）' : '仅已过账'}；草稿和作废凭证始终排除；${input.currency || '全部币种'}，金额均为本位币；各科目根含完整下级，父子不重复列计；启用期间 ${formatPeriod(book.startPeriod)}，启用前月额、余额未知，本年累计含启用前累计且只计一次；展开月份查看累计及期末，导出和打印包含全部展开行`,
  };
  if (!selected.length) return report;
  const selectedIds = new Set(selected.map((a) => a.id));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const owner = new Map<number, number>();
  for (const account of accounts) {
    let root: Account | undefined = account;
    while (root && !selectedIds.has(root.id)) {
      root = root.parentId == null ? undefined : byId.get(root.parentId);
    }
    if (root) owner.set(account.id, root.id);
  }
  const monthly = new Map<number, Map<number, MoneyBalance>>();
  for (const p of periods) {
    if (p < book.startPeriod) continue;
    const rows = await svc.ledger.balances({
      periodFrom: p,
      periodTo: p,
      accountCodes: selected.map((a) => a.code),
      dimensions: input.dimensions,
      currency: input.currency || undefined,
      includeUnposted: input.includeUnposted,
      rollup: false,
      includeZero: true,
    });
    monthly.set(p, amountsByRoot(rows, selected, owner));
  }
  for (const a of selected) {
    // 零本期、非零累计仍保留；未知历史不能据此判定为零。
    const active = [...monthly.values()].some((m) => {
      const b = m.get(a.id);
      return b && [b.opening, b.debit, b.credit, b.closing, b.ytdDebit, b.ytdCredit].some(Boolean);
    });
    if (!input.includeZero && !active && !(input.account && input.periodFrom < book.startPeriod))
      continue;
    const add = (
      p: number,
      kind: LedgerRow['kind'],
      summary: string,
      signed: number | null,
      debit: number | null = null,
      credit: number | null = null,
      detailFrom?: number,
    ) => {
      const values = [signed, debit, credit].filter((v) => v != null);
      if (!values.every(Number.isSafeInteger))
        throw new BusinessError({
          code: 'LEDGERS_AMOUNT_RANGE',
          message: '总账金额超出安全整数范围',
          hint: '请缩小科目或期间范围后重新查询。',
        });
      const side = signed == null ? null : balanceSide(signed, a.direction);
      const params = new URLSearchParams({
        account: a.code,
        from: String(detailFrom ?? p),
        to: String(p),
        dims: JSON.stringify(input.dimensions),
        currency: input.currency,
        includeUnposted: input.includeUnposted ? '1' : '0',
      });
      report.rows.push({
        id: `general-${a.id}-${p}-${kind}`,
        kind,
        date: formatPeriod(p),
        account: `${a.code} ${a.fullName}`,
        summary,
        debit,
        credit,
        side: side?.side ?? '未知',
        balance: side?.amount ?? null,
        signedBalance: signed,
        voucherNo: '',
        voucherId: null,
        href: null,
        ...(signed == null || kind === 'opening'
          ? {}
          : { detailHref: `/m/ledgers/detail?${params}` }),
        status: '',
        dimensions: '',
        currency: input.currency,
        refNo: '',
      });
    };
    for (const [index, p] of periods.entries()) {
      if (p < book.startPeriod) {
        add(p, 'month', '启用前（月额及余额未知）', null);
        continue;
      }
      const b = monthly.get(p)?.get(a.id);
      if (!b)
        throw new BusinessError({
          code: 'LEDGERS_BALANCE_MISSING',
          message: `科目 ${a.code} 缺少核心月度余额`,
          hint: '请联系维护人员检查账套。',
        });
      if (index === 0 || p === book.startPeriod)
        add(p, 'opening', p === book.startPeriod ? '启用期初余额' : '期初余额', b.opening);
      add(p, 'month', '本月发生', b.closing, b.debit, b.credit);
      const yearStart = makePeriod(periodYear(p), 1);
      // 不把期初 YTD 再累加；只使用 core 已合并的年度值。追溯仅含实际存在的历史。
      add(
        p,
        'ytd',
        '本年累计',
        b.closing,
        b.ytdDebit,
        b.ytdCredit,
        Math.max(yearStart, book.startPeriod),
      );
      add(p, 'closing', '期末余额', b.closing);
    }
  }
  return report;
}
