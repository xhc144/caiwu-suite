import {
  balanceSide,
  BusinessError,
  Decimal,
  DIMENSION_TYPES,
  formatPeriod,
  moduleRoute,
  nextPeriod,
  periodYear,
  VOUCHER_STATUS_LABELS,
  type Account,
  type BalanceRow,
  type EntryRow,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  TITLES,
  type LedgerDataColumn,
  type LedgerQuery,
  type LedgerReport,
  type LedgerRow,
} from '../shared';
import { assertComplete, ENTRY_LIMIT, safeSum } from './service';

/** 原版 w_zc_slz_fb/_sl/_slfb 和 w_zc_fhslz 的账页，数值以核心账簿快照为准。 */
export async function buildSpecialtyReport(
  svc: CoreServices,
  input: LedgerQuery,
  accounts: Account[],
): Promise<LedgerReport> {
  const journal = input.kind === 'cash' || input.kind === 'bank';
  const mode = input.kind === 'auxiliary' || journal ? input.valueMode : input.kind;
  const quantity = mode === 'quantity' || mode === 'quantity-foreign';
  const foreign = mode === 'foreign' || mode === 'quantity-foreign';
  const auxiliary = input.kind === 'auxiliary' || input.groupAuxiliary;
  const book = await svc.book.info();
  const dimension = DIMENSION_TYPES.find((d) => d.id === input.dimensionType)!;
  if (foreign && (!input.currency || input.currency === book.baseCurrency)) {
    throw new BusinessError({
      code: 'LEDGERS_FOREIGN_CURRENCY_REQUIRED',
      message: '复币账须选择一个外币币种',
      hint: '请选择美元等已设置的外币；本位币账请使用三栏或数量金额明细账。',
    });
  }
  const inRange = accounts.filter(
    (a) =>
      a.isLeaf &&
      (!input.account ||
        (input.accountTo ? a.code >= input.account : a.code.startsWith(input.account))) &&
      (!input.accountTo || a.code <= input.accountTo || a.code.startsWith(input.accountTo)),
  );
  const selected = inRange.filter(
    (a) =>
      (!quantity || !!a.quantityUnit) &&
      (!foreign || a.currency === input.currency) &&
      (!journal || (input.kind === 'cash' ? a.isCash : a.isBank)) &&
      (!auxiliary ||
        a.dimensions.some((d) => d.type === input.dimensionType) ||
        (input.dimensionType === 'cashflow' && a.cashflowRequired) ||
        (input.dimensionType === 'partner' && a.isPartner)),
  );
  if (input.account && !selected.length) {
    throw new BusinessError({
      code: 'LEDGERS_ACCOUNT_ATTRIBUTE',
      message: `所选科目不具有${[quantity ? '数量核算' : '', foreign ? `${input.currency}外币核算` : '', auxiliary ? `${dimension.name}辅助核算` : '', journal ? (input.kind === 'cash' ? '现金标志' : '银行标志') : ''].filter(Boolean).join('、')}属性`,
      hint: '请选择具有相应核算属性的科目，或清空科目范围查询。',
    });
  }
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
  const columns: LedgerDataColumn[] = [];
  if (foreign)
    columns.push(
      { id: 'fcDebit', label: journal ? '收入原币' : '借方原币', money: true },
      { id: 'fcCredit', label: journal ? '付出原币' : '贷方原币', money: true },
      { id: 'fcSide', label: '原币方向', money: false },
      { id: 'fcBalance', label: '原币余额', money: true },
      { id: 'exchangeRate', label: '汇率', money: false },
    );
  if (quantity)
    columns.push(
      { id: 'quantityUnit', label: '计量单位', money: false },
      { id: 'qtyDebit', label: journal ? '收入数量' : '借方数量', money: false },
      { id: 'qtyCredit', label: journal ? '付出数量' : '贷方数量', money: false },
      { id: 'qtySide', label: '数量方向', money: false },
      { id: 'qtyBalance', label: '结余数量', money: false },
      { id: 'unitPrice', label: '发生单价', money: false },
      { id: 'balanceUnitPrice', label: '结余单价', money: false },
    );
  if (quantity || foreign)
    columns.push({ id: 'dimensionYtdMissing', label: '累计说明', money: false });
  const report: LedgerReport = {
    query: input,
    title:
      journal && (quantity || foreign)
        ? `${input.kind === 'cash' ? '现金' : '银行'}${foreign ? (quantity ? '数量复币' : '复币') : '数量金额'}日记账`
        : input.kind === 'auxiliary' && (quantity || foreign)
          ? `辅助${foreign ? (quantity ? '数量复币' : '复币') : '数量金额'}明细账`
          : TITLES[input.kind],
    orgName: book.orgName,
    rows: [],
    entryCount: 0,
    dynamicColumns: columns,
    scope: `${input.includeUnposted ? '包含未过账（待审核、已审核、已过账）' : '仅已过账'}；草稿和作废凭证始终排除；${input.currency || '全部币种'}，金额为本位币${foreign ? '及所选原币' : ''}；各末级科目${auxiliary ? `及${dimension.name}对象` : ''}独立成账${quantity ? '，不同单位不混加；数量保留六位小数，结余单价按本位币金额除以结余数量计算并四舍五入至六位小数' : ''}`,
  };
  if (!selected.length) return report;
  const entries = await svc.ledger.entries({
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    accountIds: selected.map((a) => a.id),
    dimensions: input.dimensions,
    currency: input.currency || undefined,
    includeUnposted: input.includeUnposted,
    limit: ENTRY_LIMIT,
  });
  assertComplete(entries.length);
  report.entryCount = entries.length;
  const keyOf = (accountId: number, dimensionId: number | null | undefined) =>
    `${accountId}|${auxiliary ? (dimensionId ?? 0) : 0}`;
  const sectionKeys = new Set<string>();
  const entryGroups = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const key = keyOf(e.accountId, e.dimensions[input.dimensionType]);
    sectionKeys.add(key);
    const group = entryGroups.get(key) ?? [];
    group.push(e);
    entryGroups.set(key, group);
  }
  const monthly = new Map<number, Map<string, BalanceRow>>();
  for (const p of periods) {
    const balances = await svc.ledger.balances({
      periodFrom: p,
      periodTo: p,
      accountCodes: selected.map((a) => a.code),
      dimensions: input.dimensions,
      groupBy: auxiliary ? [input.dimensionType] : [],
      currency: input.currency || undefined,
      includeUnposted: input.includeUnposted,
      includeZero: input.includeZero,
      rollup: false,
    });
    const map = new Map<string, BalanceRow>();
    for (const b of balances) {
      const key = keyOf(b.accountId, b.dimensions[input.dimensionType]);
      sectionKeys.add(key);
      map.set(key, b);
    }
    monthly.set(p, map);
  }
  if (input.includeZero) {
    const coveredAccounts = new Set([...sectionKeys].map((key) => Number(key.split('|')[0])));
    for (const account of selected) {
      if (!coveredAccounts.has(account.id)) {
        sectionKeys.add(keyOf(account.id, input.dimensions[input.dimensionType]));
      }
    }
  }
  const items = await svc.dimensions.items();
  const itemNames = new Map(items.map((d) => [d.id, `${d.code} ${d.name}`]));
  const describeDimensions = (e: EntryRow) =>
    DIMENSION_TYPES.filter((d) => e.dimensions[d.id] != null)
      .map((d) => `${d.name}：${itemNames.get(e.dimensions[d.id]!) ?? e.dimensions[d.id]}`)
      .join('；');
  const accountOrder = new Map(selected.map((a, i) => [a.id, i]));
  const byId = new Map(selected.map((a) => [a.id, a]));
  const sortedKeys = [...sectionKeys].sort((a, b) => {
    const [aa, ad] = a.split('|').map(Number);
    const [ba, bd] = b.split('|').map(Number);
    return accountOrder.get(aa!)! - accountOrder.get(ba!)! || ad! - bd!;
  });
  for (const key of sortedKeys) {
    const [accountId, dimensionId] = key.split('|').map(Number);
    const account = byId.get(accountId!)!;
    const group = entryGroups.get(key) ?? [];
    const groupedMonths = new Map<number, EntryRow[]>();
    for (const entry of group) {
      const month = groupedMonths.get(entry.period) ?? [];
      month.push(entry);
      groupedMonths.set(entry.period, month);
    }
    const first = monthly.get(input.periodFrom)?.get(key);
    let running = safeSum([first?.opening ?? 0]);
    let fcRunning = safeSum([first?.fcOpening ?? 0]);
    let qtyRunning = new Decimal(first?.qtyOpening ?? '0');
    let serial = 0;
    const sectionLabel = auxiliary
      ? `${dimension.name}：${dimensionId ? (itemNames.get(dimensionId) ?? dimensionId) : '未指定'}`
      : '';
    const add = (
      kind: LedgerRow['kind'],
      summary: string,
      date: string,
      debit: number | null,
      credit: number | null,
      fcDebit: number | null,
      fcCredit: number | null,
      qtyDebit: string | null,
      qtyCredit: string | null,
      entry?: EntryRow,
      missing?: string | null,
    ) => {
      const moneySide = balanceSide(running, account.direction);
      const fcSide = balanceSide(fcRunning, account.direction);
      const qtySide = qtyRunning.isZero() ? '平' : qtyRunning.isNegative() ? '贷' : '借';
      const values: NonNullable<LedgerRow['values']> = {};
      if (foreign)
        Object.assign(values, {
          fcDebit,
          fcCredit,
          fcBalance: fcSide.amount,
          fcSide: fcSide.side,
          fcSignedBalance: fcRunning,
          exchangeRate: entry?.exchangeRate ?? null,
        });
      if (quantity)
        Object.assign(values, {
          qtyDebit,
          qtyCredit,
          qtyBalance: qtyRunning.abs().toFixed(),
          qtySide,
          qtySignedBalance: qtyRunning.toFixed(),
          quantityUnit: account.quantityUnit,
          unitPrice:
            entry?.unitPrice ??
            (entry?.quantity != null && !new Decimal(entry.quantity).isZero()
              ? new Decimal(safeSum([entry.debit, entry.credit]))
                  .div(100)
                  .div(entry.quantity)
                  .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
                  .toFixed()
              : null),
          balanceUnitPrice: qtyRunning.isZero()
            ? null
            : new Decimal(running)
                .div(100)
                .div(qtyRunning)
                .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
                .toFixed(),
        });
      if (quantity || foreign) values.dimensionYtdMissing = missing ?? null;
      report.rows.push({
        id: `special-${key}-${serial++}`,
        sectionKey: `${key}|${input.currency}`,
        kind,
        date,
        account: `${account.code} ${account.fullName}`,
        summary,
        debit,
        credit,
        signedBalance: running,
        side: moneySide.side,
        balance: moneySide.amount,
        voucherId: entry?.voucherId ?? null,
        href: entry ? moduleRoute('voucher-entry', `/edit?id=${entry.voucherId}`) : null,
        voucherNo: entry?.displayNo ?? '',
        status: entry ? VOUCHER_STATUS_LABELS[entry.status] : '',
        currency: input.currency || entry?.currency || '',
        dimensions: entry ? describeDimensions(entry) || sectionLabel : sectionLabel,
        refNo: entry?.refNo ?? '',
        values,
      });
    };
    add('opening', '期初余额', String(input.periodFrom), null, null, null, null, null, null);
    for (const p of periods) {
      const month = groupedMonths.get(p) ?? [];
      const b = monthly.get(p)?.get(key);
      let debit = 0,
        credit = 0,
        fcDebit = 0,
        fcCredit = 0;
      let qtyDebit = new Decimal(0),
        qtyCredit = new Decimal(0);
      let dayDebit = 0,
        dayCredit = 0,
        dayFcDebit = 0,
        dayFcCredit = 0;
      let dayQtyDebit = new Decimal(0),
        dayQtyCredit = new Decimal(0);
      for (const [index, entry] of month.entries()) {
        const side =
          entry.entrySide ?? (entry.debit !== 0 ? 'debit' : entry.credit !== 0 ? 'credit' : null);
        if (
          !side &&
          ((foreign && entry.fcAmount) ||
            (quantity && !new Decimal(entry.quantity ?? '0').isZero()))
        ) {
          throw new BusinessError({
            code: 'LEDGERS_ENTRY_SIDE_UNKNOWN',
            message: `凭证 ${entry.displayNo} 的零本币分录缺少借贷方向`,
            hint: '请联系维护人员补全分录的原始借贷方向后重新查询。',
          });
        }
        const fd = side === 'debit' ? (entry.fcAmount ?? 0) : 0;
        const fc = side === 'credit' ? (entry.fcAmount ?? 0) : 0;
        const qd = new Decimal(side === 'debit' ? (entry.quantity ?? '0') : '0');
        const qc = new Decimal(side === 'credit' ? (entry.quantity ?? '0') : '0');
        running = safeSum([running, entry.debit, -entry.credit]);
        fcRunning = safeSum([fcRunning, fd, -fc]);
        qtyRunning = qtyRunning.plus(qd).minus(qc);
        debit = safeSum([debit, entry.debit]);
        credit = safeSum([credit, entry.credit]);
        fcDebit = safeSum([fcDebit, fd]);
        fcCredit = safeSum([fcCredit, fc]);
        qtyDebit = qtyDebit.plus(qd);
        qtyCredit = qtyCredit.plus(qc);
        dayDebit = safeSum([dayDebit, entry.debit]);
        dayCredit = safeSum([dayCredit, entry.credit]);
        dayFcDebit = safeSum([dayFcDebit, fd]);
        dayFcCredit = safeSum([dayFcCredit, fc]);
        dayQtyDebit = dayQtyDebit.plus(qd);
        dayQtyCredit = dayQtyCredit.plus(qc);
        add(
          'entry',
          entry.summary,
          entry.date,
          entry.debit,
          entry.credit,
          fd,
          fc,
          qd.toFixed(),
          qc.toFixed(),
          entry,
        );
        if (journal && month[index + 1]?.date !== entry.date) {
          add(
            'day',
            '本日小计',
            entry.date,
            dayDebit,
            dayCredit,
            dayFcDebit,
            dayFcCredit,
            dayQtyDebit.toFixed(),
            dayQtyCredit.toFixed(),
          );
          dayDebit = dayCredit = dayFcDebit = dayFcCredit = 0;
          dayQtyDebit = new Decimal(0);
          dayQtyCredit = new Decimal(0);
        }
      }
      if (
        running !== (b?.closing ?? 0) ||
        debit !== (b?.debit ?? 0) ||
        credit !== (b?.credit ?? 0) ||
        (foreign &&
          (fcRunning !== (b?.fcClosing ?? 0) ||
            fcDebit !== (b?.fcDebit ?? 0) ||
            fcCredit !== (b?.fcCredit ?? 0))) ||
        (quantity &&
          (!qtyRunning.eq(b?.qtyClosing ?? '0') ||
            !qtyDebit.eq(b?.qtyDebit ?? '0') ||
            !qtyCredit.eq(b?.qtyCredit ?? '0')))
      ) {
        throw new BusinessError({
          code: 'LEDGERS_BALANCE_MISMATCH',
          message: `科目 ${account.code}${sectionLabel ? `（${sectionLabel}）` : ''} 的明细与余额不一致`,
          hint: '请缩小期间后重试，并联系维护人员检查账套。',
        });
      }
      add(
        'month',
        '本月小计',
        formatPeriod(p),
        debit,
        credit,
        fcDebit,
        fcCredit,
        qtyDebit.toFixed(),
        qtyCredit.toFixed(),
      );
      const missing =
        b?.dimensionYtdMissing ??
        (book.startPeriod % 100 !== 1 && periodYear(p) === periodYear(book.startPeriod)
          ? '启用前外币/数量累计尚无独立来源，不能按零计算'
          : null);
      add(
        'ytd',
        '本年累计',
        formatPeriod(p),
        b?.ytdDebit ?? 0,
        b?.ytdCredit ?? 0,
        missing ? null : (b?.fcYtdDebit ?? 0),
        missing ? null : (b?.fcYtdCredit ?? 0),
        missing ? null : (b?.qtyYtdDebit ?? '0'),
        missing ? null : (b?.qtyYtdCredit ?? '0'),
        undefined,
        missing,
      );
    }
    add('closing', '期末余额', String(input.periodTo), null, null, null, null, null, null);
  }
  return report;
}
