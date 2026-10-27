import {
  exactSum,
  expenseIds,
  incomeIds,
  lineIdentity,
  mappedRow,
  sameLine,
  type Configuration,
  type Sources,
} from './model';

/** 同一期间可按科目分张结转；核对批次最终余额及真实两类净资产归属。 */
export function validatePnlClosings(s: Sources, c: Configuration) {
  const vouchers = [
    ...new Set(s.entries.filter((e) => e.closingKind === 'pnl').map((e) => e.voucherId)),
  ]
    .map((id) => s.entries.filter((e) => e.voucherId === id))
    .sort((a, b) => a[0]!.date.localeCompare(b[0]!.date) || a[0]!.voucherId - b[0]!.voucherId);
  const batches = new Map<number, typeof s.entries>();
  for (const rows of vouchers) {
    const period = rows[0]!.period;
    batches.set(period, [...(batches.get(period) ?? []), ...rows]);
  }
  const pnlRows = new Set<string>([...incomeIds, ...expenseIds]);
  const closed = new Map<string, number>();
  const recognized = new Map<string, { unrestricted: number; restricted: number }>();
  for (const rows of batches.values()) {
    const last = rows.at(-1)!;
    const accounts = new Set<string>();
    for (const e of rows) {
      const row = mappedRow(e.accountCode, c.mappings);
      if (!row || (!pnlRows.has(row) && !['unrestricted', 'restricted'].includes(row)))
        throw new Error('损益结转包含其他业务分录，须先修正结转来源');
      if (pnlRows.has(row)) {
        accounts.add(e.accountCode);
        closed.set(e.accountCode, exactSum([closed.get(e.accountCode) ?? 0, e.credit, -e.debit]));
      }
    }
    const before = (e: Sources['entries'][number]) =>
      e.date < last.date || (e.date === last.date && e.voucherId <= last.voucherId);
    const expected = { unrestricted: 0, restricted: 0 };
    for (const account of accounts) {
      const business = s.entries.filter(
        (e) => e.accountCode === account && e.closingKind !== 'pnl' && before(e),
      );
      const residual = exactSum([
        ...business.map((e) => exactSum([e.credit, -e.debit])),
        closed.get(account) ?? 0,
      ]);
      if (residual !== 0)
        throw new Error(
          `${last.period}期间损益结转后科目${account}仍有余额，差额${(residual / 100).toFixed(2)}元，请核对结转凭证`,
        );
      const previous = recognized.get(account) ?? { unrestricted: 0, restricted: 0 };
      const cumulative = { unrestricted: 0, restricted: 0 };
      for (const r of c.recognitions) {
        const actual = business.find((e) => e.lineId === r.line.lineId);
        if (!actual || !sameLine(lineIdentity(actual), r.line)) continue;
        for (const a of r.allocations)
          cumulative[a.classification] = exactSum([
            cumulative[a.classification],
            a.credit,
            -a.debit,
          ]);
      }
      for (const kind of ['unrestricted', 'restricted'] as const)
        expected[kind] = exactSum([expected[kind], cumulative[kind], -previous[kind]]);
      recognized.set(account, cumulative);
    }
    for (const kind of ['unrestricted', 'restricted'] as const) {
      const current = exactSum(
        rows
          .filter((e) => mappedRow(e.accountCode, c.mappings) === kind)
          .map((e) => exactSum([e.credit, -e.debit])),
      );
      if (current !== expected[kind])
        throw new Error(
          `凭证${last.displayNo}损益结转的${kind === 'restricted' ? '限定性' : '非限定性'}净资产与逐笔资源分类不一致`,
        );
    }
  }
}

/** 以前年度调整原业务与3201结转分开识别，结转不得改变资源类别。 */
export function validateAdjustmentClosings(s: Sources, c: Configuration) {
  const vouchers = [
    ...new Set(
      s.entries
        .filter((e) => mappedRow(e.accountCode, c.mappings) === 'priorAdjustment')
        .map((e) => e.voucherId),
    ),
  ]
    .map((id) => s.entries.filter((e) => e.voucherId === id))
    .filter((rows) =>
      rows.every((e) =>
        ['unrestricted', 'restricted', 'priorAdjustment'].includes(
          mappedRow(e.accountCode, c.mappings) ?? '',
        ),
      ),
    )
    .sort((a, b) => a[0]!.date.localeCompare(b[0]!.date) || a[0]!.voucherId - b[0]!.voucherId);
  const transferred = { unrestricted: 0, restricted: 0 };
  for (const rows of vouchers) {
    const last = rows[0]!;
    for (const kind of ['unrestricted', 'restricted'] as const) {
      const expected = exactSum(
        c.events
          .filter(
            (e) =>
              e.kind === 'priorAdjustment' &&
              (e.date < last.date ||
                (e.date === last.date &&
                  Math.min(...e.lines.map((l) => l.line.voucherId)) < last.voucherId)) &&
              c.resources.find((r) => r.id === e.resourceId)?.classification === kind,
          )
          .map((e) => e.amount),
      );
      const current = exactSum(
        rows
          .filter((e) => mappedRow(e.accountCode, c.mappings) === kind)
          .map((e) => exactSum([e.credit, -e.debit])),
      );
      if (exactSum([transferred[kind], current]) !== expected)
        throw new Error(
          `凭证${last.displayNo}以前年度调整结转的${kind === 'restricted' ? '限定性' : '非限定性'}与原调整资源不一致`,
        );
      transferred[kind] = exactSum([transferred[kind], current]);
    }
  }
  return transferred;
}
