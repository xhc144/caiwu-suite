import {
  balanceSide,
  BusinessError,
  DIMENSION_TYPES,
  formatPeriod,
  moduleRoute,
  nextPeriod,
  VOUCHER_STATUS_LABELS,
  type EntryRow,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  DEFAULT_COLUMNS,
  FormatSchema,
  QuerySchema,
  TITLES,
  type LedgerFormat,
  type LedgerKind,
  type LedgerQuery,
  type LedgerReport,
  type LedgerRow,
} from '../shared';

type MoneyBalance = {
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  ytdDebit: number;
  ytdCredit: number;
};

export const ENTRY_LIMIT = 200_000;
export function safeSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) {
      throw new BusinessError({
        code: 'LEDGERS_AMOUNT_RANGE',
        message: '账簿金额超出安全整数范围',
        hint: '请缩小期间或科目范围后重新查询。',
      });
    }
    total += value;
  }
  return total;
}
export function assertComplete(count: number) {
  if (count >= ENTRY_LIMIT)
    throw new BusinessError({
      code: 'LEDGERS_TOO_MANY',
      message: '分录达到 200000 条查询上限，不能展示或导出可能被截断的账簿',
      hint: '请缩小期间、科目或辅助核算范围后重试。',
      actions: [{ label: '调整筛选', to: '/m/ledgers/detail' }],
    });
}

export function ledgersService(svc: CoreServices) {
  const formatKey = (kind: LedgerKind) => `format.${kind}`;
  const self = {
    async format(kind: LedgerKind): Promise<LedgerFormat> {
      return FormatSchema.parse(
        await svc.settings.get(formatKey(kind), { columns: DEFAULT_COLUMNS, revision: 0 }),
      );
    },
    async saveFormat(
      input: {
        kind: LedgerKind;
        columns: LedgerFormat['columns'];
        expectedRevision: number;
        confirmed: boolean;
      },
      restore = false,
    ) {
      return svc.tx(async (tsvc) => {
        const service = ledgersService(tsvc);
        const current = await service.format(input.kind);
        if (!input.confirmed) return current;
        if (current.revision !== input.expectedRevision)
          throw new BusinessError({
            code: 'LEDGERS_FORMAT_STALE',
            message: '账簿格式已被其他窗口修改',
            hint: '请刷新格式后重新保存。',
          });
        const next = FormatSchema.parse({
          columns: restore ? DEFAULT_COLUMNS : input.columns,
          revision: current.revision + 1,
        });
        await tsvc.settings.set(formatKey(input.kind), next);
        return next;
      });
    },
    async report(raw: LedgerQuery): Promise<LedgerReport> {
      const input = QuerySchema.parse(raw);
      return svc.tx((tsvc) => buildReport(tsvc, input));
    },
  };
  return self;
}

async function buildReport(svc: CoreServices, input: LedgerQuery): Promise<LedgerReport> {
  const all = await svc.accounts.list();
  for (const code of [input.account, input.accountTo].filter(Boolean)) {
    if (!all.some((a) => a.code === code))
      throw new BusinessError({
        code: 'LEDGERS_ACCOUNT_NOT_FOUND',
        message: `科目 ${code} 不存在`,
        hint: '请从科目选择器选择已有科目，或清空范围查询全部科目。',
        actions: [{ label: '重新选择科目', to: '/m/ledgers/detail' }],
      });
  }
  if (input.accountTo && input.account && input.account > input.accountTo)
    throw new BusinessError({
      code: 'LEDGERS_ACCOUNT_RANGE',
      message: '起始科目不能排在结束科目之后',
      hint: '请交换科目范围后重试。',
    });
  const currencies = await svc.reference.currencies();
  if (input.currency && !currencies.some((c) => c.code === input.currency))
    throw new BusinessError({
      code: 'LEDGERS_CURRENCY',
      message: `币种 ${input.currency} 不存在`,
      hint: '请选择账套已设置的币种，或清空币种按本位币金额查询。',
    });
  for (const dt of DIMENSION_TYPES) {
    const id = input.dimensions[dt.id];
    if (id != null && !(await svc.dimensions.items(dt.id)).some((i) => i.id === id))
      throw new BusinessError({
        code: 'LEDGERS_DIMENSION',
        message: `${dt.name}中不存在 ID 为 ${id} 的项目`,
        hint: '请重新选择辅助核算项。',
      });
  }
  // 每个末级科目独立成账，上级筛选展开下级，绝不把父级汇总再加一遍。
  const selected = all.filter(
    (a) =>
      a.isLeaf &&
      (!input.account ||
        (input.accountTo ? a.code >= input.account : a.code.startsWith(input.account))) &&
      (!input.accountTo || a.code <= input.accountTo || a.code.startsWith(input.accountTo)) &&
      (input.kind === 'detail' || (input.kind === 'cash' ? a.isCash : a.isBank)),
  );
  if (input.account && input.kind !== 'detail' && !selected.length)
    throw new BusinessError({
      code: 'LEDGERS_JOURNAL_ACCOUNT',
      message: `所选科目不具有${input.kind === 'cash' ? '现金' : '银行'}标志`,
      hint: '请选择具有对应标志的科目，或清空科目范围查询。',
    });
  const scope = `${input.includeUnposted ? '包含未过账（待审核、已审核、已过账）' : '仅已过账'}；草稿和作废凭证始终排除；${input.currency || '全部币种'}，金额均为本位币；各末级科目独立成账`;
  const report: LedgerReport = {
    query: input,
    title: TITLES[input.kind],
    scope,
    rows: [],
    entryCount: 0,
  };
  if (!selected.length) return report;
  const periods: number[] = [];
  for (let p = input.periodFrom; p <= input.periodTo; p = nextPeriod(p)) {
    periods.push(p);
    if (periods.length > 120)
      throw new BusinessError({
        code: 'LEDGERS_PERIOD_LIMIT',
        message: '查询范围超过 120 个月',
        hint: '请按年度或更短期间分次查询。',
      });
    if (p === input.periodTo) break;
  }
  const baseCurrency =
    currencies.find((c) => c.isBase)?.code ?? (await svc.book.info()).baseCurrency;
  const baseOnly = input.currency === baseCurrency;
  const rawEntries = await svc.ledger.entries({
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    accountIds: selected.map((a) => a.id),
    dimensions: input.dimensions,
    currency: baseOnly ? undefined : input.currency || undefined,
    includeUnposted: input.includeUnposted,
    limit: ENTRY_LIMIT,
  });
  assertComplete(rawEntries.length);
  const entries = baseOnly
    ? rawEntries.filter((e) => e.currency == null || e.currency === baseCurrency)
    : rawEntries;
  report.entryCount = entries.length;
  const monthly = new Map<number, Map<number, MoneyBalance>>();
  for (const p of periods) {
    const balanceQuery = {
      periodFrom: p,
      periodTo: p,
      dimensions: input.dimensions,
      includeUnposted: input.includeUnposted,
      rollup: false,
      accountCodes: selected.map((a) => a.code),
    };
    const balances = await svc.ledger.balances({
      ...balanceQuery,
      currency: baseOnly ? undefined : input.currency || undefined,
    });
    const map = new Map<number, MoneyBalance>(balances.map((b) => [b.accountId, b]));
    // core 的 currency 精确匹配不会包含本位币的 NULL 行；用同口径全部减外币，避免漏掉本位币期初与分录。
    if (baseOnly) {
      for (const currency of currencies.filter((c) => c.code !== baseCurrency)) {
        for (const foreign of await svc.ledger.balances({
          ...balanceQuery,
          currency: currency.code,
        })) {
          const previous = map.get(foreign.accountId);
          map.set(foreign.accountId, {
            opening: safeSum([previous?.opening ?? 0, -foreign.opening]),
            debit: safeSum([previous?.debit ?? 0, -foreign.debit]),
            credit: safeSum([previous?.credit ?? 0, -foreign.credit]),
            closing: safeSum([previous?.closing ?? 0, -foreign.closing]),
            ytdDebit: safeSum([previous?.ytdDebit ?? 0, -foreign.ytdDebit]),
            ytdCredit: safeSum([previous?.ytdCredit ?? 0, -foreign.ytdCredit]),
          });
        }
      }
    }
    monthly.set(p, map);
  }
  const dimItems = await svc.dimensions.items();
  const dimNames = new Map(dimItems.map((i) => [i.id, i.name]));
  const byAccount = new Map<number, EntryRow[]>();
  for (const e of entries) {
    const group = byAccount.get(e.accountId) ?? [];
    group.push(e);
    byAccount.set(e.accountId, group);
  }
  for (const a of selected) {
    const group = byAccount.get(a.id) ?? [];
    const first = monthly.get(input.periodFrom)?.get(a.id);
    if (
      !group.length &&
      !periods.some((p) => {
        const b = monthly.get(p)?.get(a.id);
        return b && (b.opening || b.debit || b.credit || b.closing);
      })
    )
      continue;
    let running = safeSum([first?.opening ?? 0]);
    let serial = 0;
    const add = (
      kind: LedgerRow['kind'],
      summary: string,
      debit: number | null = null,
      credit: number | null = null,
      date = '',
      entry?: EntryRow,
    ) => {
      const side = balanceSide(running, a.direction);
      report.rows.push({
        id: `${a.id}-${serial++}`,
        kind,
        date,
        account: `${a.code} ${a.fullName}`,
        summary,
        debit,
        credit,
        signedBalance: running,
        side: side.side,
        balance: side.amount,
        voucherId: entry?.voucherId ?? null,
        href: entry ? moduleRoute('voucher-entry', `/edit?id=${entry.voucherId}`) : null,
        voucherNo: entry?.displayNo ?? '',
        status: entry ? VOUCHER_STATUS_LABELS[entry.status] : '',
        currency: entry?.currency ?? input.currency,
        refNo: entry?.refNo ?? '',
        dimensions: entry
          ? DIMENSION_TYPES.filter((d) => entry.dimensions[d.id] != null)
              .map(
                (d) =>
                  `${d.name}：${dimNames.get(entry.dimensions[d.id]!) ?? entry.dimensions[d.id]}`,
              )
              .join('；')
          : '',
      });
    };
    add('opening', '期初余额', null, null, String(input.periodFrom));
    const groupedMonths = new Map<number, EntryRow[]>();
    for (const e of group) {
      const list = groupedMonths.get(e.period) ?? [];
      list.push(e);
      groupedMonths.set(e.period, list);
    }
    for (const p of periods) {
      const month = groupedMonths.get(p) ?? [];
      let dayDebit = 0,
        dayCredit = 0;
      for (let i = 0; i < month.length; i++) {
        const e = month[i]!;
        running = safeSum([running, e.debit, -e.credit]);
        add('entry', e.summary, e.debit, e.credit, e.date, e);
        dayDebit = safeSum([dayDebit, e.debit]);
        dayCredit = safeSum([dayCredit, e.credit]);
        if (input.kind !== 'detail' && month[i + 1]?.date !== e.date) {
          add('day', '本日小计', dayDebit, dayCredit, e.date);
          dayDebit = 0;
          dayCredit = 0;
        }
      }
      const b = monthly.get(p)?.get(a.id);
      const debit = safeSum(month.map((e) => e.debit)),
        credit = safeSum(month.map((e) => e.credit));
      if (running !== (b?.closing ?? 0) || debit !== (b?.debit ?? 0) || credit !== (b?.credit ?? 0))
        throw new BusinessError({
          code: 'LEDGERS_BALANCE_MISMATCH',
          message: `科目 ${a.code} 的明细与余额不一致`,
          hint: '请缩小期间后重试，并联系维护人员检查账套。',
        });
      add('month', '本月小计', debit, credit, formatPeriod(p));
      add(
        'ytd',
        '本年累计',
        safeSum([b?.ytdDebit ?? 0]),
        safeSum([b?.ytdCredit ?? 0]),
        formatPeriod(p),
      );
    }
    add('closing', '期末余额', null, null, String(input.periodTo));
  }
  return report;
}
