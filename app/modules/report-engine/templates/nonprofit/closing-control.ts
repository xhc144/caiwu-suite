import {
  exactSum,
  incomeIds,
  lineIdentity,
  mappedRow,
  sameLine,
  type Configuration,
  type Sources,
} from './model';

/** 核验真实结转的两类净资产归属，不能利用未结转额把错分结转倒挤抵销。 */
export function validatePnlClosings(s: Sources, c: Configuration) {
  const vouchers = [
    ...new Set(s.entries.filter((e) => e.closingKind === 'pnl').map((e) => e.voucherId)),
  ]
    .map((id) => s.entries.filter((e) => e.voucherId === id))
    .sort((a, b) => a[0]!.date.localeCompare(b[0]!.date) || a[0]!.voucherId - b[0]!.voucherId);
  const transferred = { unrestricted: 0, restricted: 0 };
  for (const rows of vouchers) {
    const last = rows[0]!;
    for (const e of rows) {
      const row = mappedRow(e.accountCode, c.mappings);
      if (
        !row ||
        ![
          ...incomeIds,
          'activityCost',
          'taxExpense',
          'administration',
          'fundraising',
          'impairment',
          'incomeTax',
          'otherExpense',
          'unrestricted',
          'restricted',
        ].includes(row)
      )
        throw new Error('损益结转包含其他业务分录，须先修正结转来源');
    }
    for (const kind of ['unrestricted', 'restricted'] as const) {
      const business = exactSum(
        c.recognitions.flatMap((r) => {
          const actual = s.entries.find((e) => e.lineId === r.line.lineId);
          if (
            !actual ||
            !sameLine(lineIdentity(actual), r.line) ||
            actual.date > last.date ||
            (actual.date === last.date && actual.voucherId > last.voucherId)
          )
            return [];
          return r.allocations
            .filter((a) => a.classification === kind)
            .map((a) => exactSum([a.credit, -a.debit]));
        }),
      );
      const current = exactSum(
        rows
          .filter((e) => mappedRow(e.accountCode, c.mappings) === kind)
          .map((e) => exactSum([e.credit, -e.debit])),
      );
      if (exactSum([current, transferred[kind]]) !== business)
        throw new Error(
          `凭证${last.displayNo}损益结转的${kind === 'restricted' ? '限定性' : '非限定性'}净资产与逐笔资源分类不一致`,
        );
      transferred[kind] = exactSum([transferred[kind], current]);
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
