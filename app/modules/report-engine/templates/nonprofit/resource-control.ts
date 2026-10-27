import { exactSum, mappedRow, type Configuration, type Sources } from './model';

/** 资源沿逐笔业务和互转承接；允许同一批次跨期、同一科目多批次，不从科目或摘要猜分类。 */
export function validateResourceRollforward(s: Sources, c: Configuration) {
  if (c.resources.some((r) => r.classification === 'restricted' && r.openingBalance < 0))
    throw new Error('限定性资源年初余额不能为负，请核对真实资源分配');
  for (const kind of ['unrestricted', 'restricted'] as const) {
    const actual = exactSum(
      s.balances
        .filter((b) => mappedRow(b.accountCode, c.mappings) === kind)
        .map((b) => -b.opening),
    );
    const declared = exactSum(
      c.resources.filter((r) => r.classification === kind).map((r) => r.openingBalance),
    );
    if (actual !== declared)
      throw new Error(
        `${kind === 'restricted' ? '限定性' : '非限定性'}资源年初分配与真实净资产年初不一致`,
      );
  }
  const balances = new Map(
    c.resources.map((r) => [
      r.id,
      {
        unrestricted: r.classification === 'unrestricted' ? r.openingBalance : 0,
        restricted: r.classification === 'restricted' ? r.openingBalance : 0,
      },
    ]),
  );
  const changes: {
    date: string;
    voucher: number;
    line: number;
    resource: string;
    kind: 'unrestricted' | 'restricted';
    amount: number;
    transfer?: boolean;
  }[] = [];
  for (const r of c.recognitions) {
    const e = s.entries.find((e) => e.lineId === r.line.lineId);
    if (!e) continue;
    for (const a of r.allocations)
      changes.push({
        date: e.date,
        voucher: e.voucherId,
        line: e.lineId,
        resource: a.resourceId,
        kind: a.classification,
        amount: exactSum([a.credit, -a.debit]),
      });
  }
  for (const e of c.events.filter((e) => e.date >= s.openingDate && e.date <= s.closingDate)) {
    const voucher = Math.min(...e.lines.map((a) => a.line.voucherId));
    if (e.kind === 'release' || e.kind === 'restriction') {
      const from = e.kind === 'release' ? 'restricted' : 'unrestricted',
        to = from === 'restricted' ? 'unrestricted' : 'restricted';
      changes.push(
        {
          date: e.date,
          voucher,
          line: -1,
          resource: e.resourceId,
          kind: from,
          amount: -e.amount,
          transfer: true,
        },
        { date: e.date, voucher, line: 0, resource: e.resourceId, kind: to, amount: e.amount },
      );
    } else {
      const r = c.resources.find((r) => r.id === e.resourceId);
      if (r)
        changes.push({
          date: e.date,
          voucher,
          line: 0,
          resource: e.resourceId,
          kind: r.classification,
          amount: e.amount,
        });
    }
  }
  changes.sort((a, b) => a.date.localeCompare(b.date) || a.voucher - b.voucher || a.line - b.line);
  for (const e of changes) {
    const b = balances.get(e.resource);
    if (!b) throw new Error('资源批次不存在');
    b[e.kind] = exactSum([b[e.kind], e.amount]);
    const governed =
      c.resources.find((r) => r.id === e.resource)?.classification === 'restricted' ||
      c.events.some(
        (x) =>
          x.resourceId === e.resource &&
          ['restriction', 'release'].includes(x.kind) &&
          (x.date < e.date ||
            (x.date === e.date && Math.min(...x.lines.map((l) => l.line.voucherId)) <= e.voucher)),
      );
    if (b[e.kind] < 0 && (e.kind === 'restricted' || e.transfer || governed))
      throw new Error(
        `资源${c.resources.find((r) => r.id === e.resource)?.name}的限定性使用或互转超过可用资源，请核对取得、使用及解除金额`,
      );
  }
  return balances;
}
