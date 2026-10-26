import {
  balanceSide,
  BusinessError,
  centsToYuan,
  DIMENSION_TYPES,
  formatPeriod,
  nextPeriod,
  VOUCHER_STATUS_LABELS,
  type BalanceRow,
  type EntryRow,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  MULTI_MODES,
  MultiQuerySchema,
  type MultiQuery,
  type MultiReport,
  type MultiRow,
} from '../multicolumn';
import { assertComplete, ENTRY_LIMIT } from './service';
import { resolveMultiColumns } from './multicolumn-format';

/** 先使用 bigint 完整相加/相减，再检查能否以安全整数分返回。 */
function exact(values: number[]): number {
  let sum = 0n;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw amountError();
    sum += BigInt(v);
  }
  const n = Number(sum);
  if (!Number.isSafeInteger(n)) throw amountError();
  return n;
}
function amountError() {
  return new BusinessError({
    code: 'LEDGERS_AMOUNT_RANGE',
    message: '多栏账金额超出安全整数范围',
    hint: '请缩小科目或期间范围后重试。',
  });
}
export function assertMultiExportColumns(count: number) {
  if (count > 248)
    throw new BusinessError({
      code: 'LEDGERS_MULTI_COLUMNS',
      message: '多栏账的科目分栏超过248列，不能导出',
      hint: '请选择下一级上级科目，或取消包含无数据科目后重试。',
    });
}
const valueOf = (debit: number, credit: number, mode: MultiQuery['mode']) =>
  mode === 'debit' ? exact([debit]) : mode === 'credit' ? exact([credit]) : exact([debit, -credit]);

export function multiService(svc: CoreServices) {
  return {
    async report(raw: MultiQuery): Promise<MultiReport> {
      const q = MultiQuerySchema.parse(raw);
      return svc.tx(async (t) => {
        const accounts = await t.accounts.list();
        const root = accounts.find((a) => a.code === q.account);
        if (!root)
          throw new BusinessError({
            code: 'LEDGERS_ACCOUNT_NOT_FOUND',
            message: `科目 ${q.account} 不存在`,
            hint: '请从科目选择器重新选择。',
          });
        if (root.isLeaf)
          throw new BusinessError({
            code: 'LEDGERS_MULTI_LEAF',
            message: '所选科目是末级科目，不能生成多栏账',
            hint: '请选择含下级科目的上级科目；末级科目请查看三栏明细账。',
            actions: [
              {
                label: '查看三栏明细账',
                to: `/m/ledgers/detail?account=${encodeURIComponent(root.code)}&from=${q.periodFrom}&to=${q.periodTo}`,
              },
            ],
          });
        const children = accounts.filter((a) => a.parentId === root.id);
        const byId = new Map(accounts.map((a) => [a.id, a]));
        const branchOf = new Map<number, number>();
        for (const leaf of accounts.filter((a) => a.isLeaf)) {
          let a = leaf;
          while (a.parentId != null && a.parentId !== root.id) {
            const parent = byId.get(a.parentId);
            if (!parent) break;
            a = parent;
          }
          if (a.parentId === root.id) branchOf.set(leaf.id, a.id);
        }
        if (!children.length || !branchOf.size)
          throw new BusinessError({
            code: 'LEDGERS_MULTI_CHILDREN',
            message: '所选上级科目没有可分栏的下级科目',
            hint: '请选择另一个上级科目，或检查科目档案。',
          });
        const configured = q.columns ? resolveMultiColumns(accounts, root, q.columns) : null;
        const dimensionLabels: string[] = [];
        for (const dt of DIMENSION_TYPES) {
          const id = q.dimensions?.[dt.id];
          if (id == null) continue;
          const item = (await t.dimensions.items(dt.id)).find((d) => d.id === id);
          if (!item)
            throw new BusinessError({
              code: 'LEDGERS_DIMENSION',
              message: `${dt.name}中不存在 ID 为 ${id} 的项目`,
              hint: '请重新选择辅助核算项。',
            });
          dimensionLabels.push(`${dt.name}：${item.code} ${item.name}`);
        }
        const book = await t.book.info();
        const periods: number[] = [];
        for (let p = q.periodFrom; p <= q.periodTo; p = nextPeriod(p)) {
          periods.push(p);
          if (periods.length > 120)
            throw new BusinessError({
              code: 'LEDGERS_PERIOD_LIMIT',
              message: '查询范围超过120个月',
              hint: '请按年度或更短期间分次查询。',
            });
        }
        const entries =
          q.periodTo < book.startPeriod
            ? []
            : await t.ledger.entries({
                periodFrom: Math.max(q.periodFrom, book.startPeriod),
                periodTo: q.periodTo,
                accountIds: [...branchOf.keys()],
                dimensions: q.dimensions,
                includeUnposted: q.includeUnposted,
                limit: ENTRY_LIMIT,
              });
        assertComplete(entries.length);
        const monthly = new Map<number, Map<number, BalanceRow>>();
        for (const p of periods) {
          if (p < book.startPeriod) continue;
          const rows = await t.ledger.balances({
            periodFrom: p,
            periodTo: p,
            accountCodes: [root.code],
            dimensions: q.dimensions,
            rollup: true,
            includeZero: true,
            includeUnposted: q.includeUnposted,
          });
          monthly.set(p, new Map(rows.map((r) => [r.accountId, r])));
        }
        const active = new Set(entries.map((e) => branchOf.get(e.accountId)!));
        for (const balances of monthly.values()) {
          for (const child of children) {
            const b = balances.get(child.id);
            if (
              b &&
              [b.opening, b.debit, b.credit, b.closing, b.ytdDebit, b.ytdCredit].some(Boolean)
            )
              active.add(child.id);
          }
        }
        const columns =
          configured?.map(({ leaves: _leaves, ...column }) => column) ??
          children
            .filter((a) => q.includeEmpty || q.periodFrom < book.startPeriod || active.has(a.id))
            .map((a) => ({
              id: a.id,
              code: a.code,
              name: a.fullName,
              mode: q.mode,
              accountCodes: [a.code],
            }));
        const columnLeaves = new Map(configured?.map((c) => [c.id, c.leaves]));
        const report: MultiReport = {
          query: q,
          columns,
          rows: [],
          entryCount: entries.length,
          accountName: `${root.code} ${root.fullName}`,
          orgName: book.orgName,
          startPeriod: book.startPeriod,
          scope: `${q.includeUnposted ? '包含未过账（待审核、已审核、已过账）' : '仅已过账'}；草稿和作废始终排除；全部币种折合本位币；${configured ? '自定义科目集合展开到末级，同栏父子不重计' : '直属下级各占一栏并汇总其完整下级，父子不重计'}；${configured ? '自定义栏目独立取数，不同栏目可能重叠，不能相加作为主账合计' : `分栏为${MULTI_MODES[q.mode]}`}；${dimensionLabels.length ? dimensionLabels.join('；') : '全部辅助项'}；启用期间${formatPeriod(book.startPeriod)}，启用前月额和余额未知，本年累计含账前累计一次；分栏只表示发生额，期初及期末分栏留空`,
        };
        if (!active.size && !q.includeEmpty && !configured && q.periodFrom >= book.startPeriod)
          return report;
        const byPeriod = new Map<number, EntryRow[]>();
        for (const e of entries) {
          const group = byPeriod.get(e.period) ?? [];
          group.push(e);
          byPeriod.set(e.period, group);
        }
        let serial = 0;
        const add = (
          p: number,
          kind: MultiRow['kind'],
          summary: string,
          signed: number | null,
          debit: number | null,
          credit: number | null,
          values: Record<string, number | null>,
          entry?: EntryRow,
        ) => {
          const side = signed == null ? null : balanceSide(exact([signed]), root.direction);
          report.rows.push({
            id: `multi-${serial++}`,
            kind,
            date: entry?.date ?? formatPeriod(p),
            period: p,
            summary,
            debit,
            credit,
            values,
            signedBalance: signed,
            side: side?.side ?? '未知',
            balance: side?.amount ?? null,
            voucherNo: entry?.displayNo ?? '',
            href: entry ? `/m/voucher-entry/edit?id=${entry.voucherId}` : null,
            status: entry ? VOUCHER_STATUS_LABELS[entry.status] : '',
          });
        };
        const blank = () => Object.fromEntries(columns.map((c) => [c.id, null]));
        for (const [i, p] of periods.entries()) {
          if (p < book.startPeriod) {
            add(p, 'unknown', '启用前（月额及余额未知）', null, null, null, blank());
            continue;
          }
          const map = monthly.get(p)!;
          const b = map.get(root.id)!;
          if (!b)
            throw new BusinessError({
              code: 'LEDGERS_BALANCE_MISSING',
              message: '核心服务未返回所选上级科目的余额',
              hint: '请联系维护人员检查科目档案。',
            });
          if (i === 0 || p === book.startPeriod)
            add(
              p,
              'opening',
              p === book.startPeriod ? '启用期初余额' : '期初余额',
              b.opening,
              null,
              null,
              blank(),
            );
          for (const c of children) {
            if (!map.has(c.id))
              throw new BusinessError({
                code: 'LEDGERS_BALANCE_MISSING',
                message: `核心服务未返回分栏科目 ${c.code} 的余额`,
                hint: '请联系维护人员检查科目档案。',
              });
          }
          const month = byPeriod.get(p) ?? [];
          let running = b.opening;
          for (const e of month) {
            running = exact([running, e.debit, -e.credit]);
            const childId = branchOf.get(e.accountId)!;
            add(
              p,
              'entry',
              e.summary,
              running,
              e.debit,
              e.credit,
              Object.fromEntries(
                columns.map((c) => [
                  c.id,
                  (configured ? columnLeaves.get(c.id)?.has(e.accountId) : c.id === childId)
                    ? valueOf(e.debit, e.credit, c.mode ?? q.mode)
                    : 0,
                ]),
              ),
              e,
            );
          }
          const debit = exact(month.map((e) => e.debit)),
            credit = exact(month.map((e) => e.credit));
          if (running !== b.closing || debit !== b.debit || credit !== b.credit)
            throw new BusinessError({
              code: 'LEDGERS_BALANCE_MISMATCH',
              message: '多栏账逐笔发生额与核心月度余额不一致',
              hint: '请缩小范围重试，并联系维护人员检查账套。',
            });
          for (const field of ['debit', 'credit', 'ytdDebit', 'ytdCredit'] as const) {
            if (exact(children.map((c) => map.get(c.id)?.[field] ?? 0)) !== b[field])
              throw new BusinessError({
                code: 'LEDGERS_BALANCE_MISMATCH',
                message: '多栏账下级分栏与上级合计不一致',
                hint: '请检查科目档案后重试。',
              });
          }
          const subValues = (ytd: boolean) =>
            Object.fromEntries(
              columns.map((c) => {
                const sources = configured
                  ? [...(columnLeaves.get(c.id) ?? [])].map((id) => map.get(id))
                  : [map.get(c.id)];
                return [
                  c.id,
                  valueOf(
                    exact(sources.map((s) => s?.[ytd ? 'ytdDebit' : 'debit'] ?? 0)),
                    exact(sources.map((s) => s?.[ytd ? 'ytdCredit' : 'credit'] ?? 0)),
                    c.mode ?? q.mode,
                  ),
                ];
              }),
            );
          add(p, 'month', '本月小计', b.closing, b.debit, b.credit, subValues(false));
          add(p, 'ytd', '本年累计', b.closing, b.ytdDebit, b.ytdCredit, subValues(true));
          if (p === q.periodTo) add(p, 'closing', '期末余额', b.closing, null, null, blank());
        }
        return report;
      });
    },
  };
}

export async function exportMulti(svc: CoreServices, input: MultiQuery) {
  svc.permissions.require('ledgers.view');
  const report = await multiService(svc).report(input);
  assertMultiExportColumns(report.columns.length);
  if (!report.rows.length)
    throw new BusinessError({
      code: 'LEDGERS_EMPTY',
      message: '当前条件没有多栏账记录，不能导出',
      hint: '请调整科目或期间后重试。',
    });
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('多栏账');
  sheet.addRow([
    `${report.orgName}；${report.accountName}；${input.periodFrom}—${input.periodTo}；${report.scope}`,
  ]);
  sheet.mergeCells(1, 1, 1, 8 + report.columns.length);
  sheet.addRow([
    '日期/期间',
    '摘要',
    '凭证号',
    '状态',
    '借方',
    '贷方',
    '方向',
    '余额',
    ...report.columns.map((c) => `${c.code} ${c.name}（${MULTI_MODES[c.mode ?? input.mode]}）`),
  ]).font = { bold: true };
  const money = (n: number | null) => (n == null ? '' : centsToYuan(n));
  for (const r of report.rows) {
    sheet.addRow([
      r.date,
      r.summary,
      r.voucherNo,
      r.status,
      money(r.debit),
      money(r.credit),
      r.side,
      money(r.balance),
      ...report.columns.map((c) => money(r.values[c.id] ?? null)),
    ]);
  }
  sheet.columns.forEach((c, i) => {
    c.width = i === 1 || i >= 8 ? 28 : 18;
  });
  sheet.views = [{ state: 'frozen', ySplit: 2, xSplit: 2 }];
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    fileName: `多栏账-${input.account}-${input.periodFrom}-${input.periodTo}.xlsx`,
    base64: Buffer.from(buffer).toString('base64'),
    report,
  };
}
