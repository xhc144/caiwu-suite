import { BusinessError, type EntryRow } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  CashflowQuerySchema,
  CashflowSettingsSchema,
  defaultCashflowSettings,
  type CashflowQuery,
  type CashflowSettings,
  type CashflowReport,
  type CashflowDetail,
  type CashflowTotals,
} from '../cashflow';

function problem(code: string, message: string, hint: string): never {
  throw new BusinessError({ code, message, hint });
}
function money(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    problem('BALANCES_CASHFLOW_OVERFLOW', '现金流量合计超出安全范围', '请缩小期间或科目范围');
  return n;
}
function total(rows: CashflowDetail[]): CashflowTotals {
  const net = (filter: (r: CashflowDetail) => boolean) =>
    money(rows.filter(filter).reduce((n, r) => n + BigInt(r.debit) - BigInt(r.credit), 0n));
  return {
    cashNet: net(() => true),
    inflow: net((r) => r.allocated && r.cashflowDirection === 'inflow'),
    outflow: -net((r) => r.allocated && r.cashflowDirection === 'outflow') || 0,
    internalNet: net((r) => r.allocated && r.cashflowDirection === 'internal'),
    unallocatedNet: net((r) => !r.allocated),
    unallocatedCount: rows.filter((r) => !r.allocated).length,
  };
}

export function cashflowService(svc: CoreServices) {
  return {
    async metadata() {
      return svc.tx(async (t) => ({
        current: (await t.periods.current())?.period,
        accounts: await t.accounts.list(),
        projects: await t.dimensions.items('cashflow'),
        settings: await t.settings.get('cashflowDisplay', defaultCashflowSettings),
      }));
    },
    async saveSettings(raw: CashflowSettings) {
      const input = CashflowSettingsSchema.parse(raw);
      return svc.tx(async (t) => {
        const old = await t.settings.get('cashflowDisplay', defaultCashflowSettings);
        if (old.revision !== input.revision)
          problem(
            'BALANCES_CASHFLOW_SETTINGS_STALE',
            '窗口格式已被其他窗口保存，本次没有覆盖',
            '当前格式仍保留，请重新读取已存格式，核对后保存',
          );
        const next = { revision: old.revision + 1, display: input.display };
        await t.settings.set('cashflowDisplay', next);
        return next;
      });
    },
    async query(raw: CashflowQuery): Promise<CashflowReport> {
      const q = CashflowQuerySchema.parse(raw);
      return svc.tx(async (t) => {
        const current = (await t.periods.current())?.period;
        const periodFrom = q.periodFrom ?? current;
        const periodTo = q.periodTo ?? current;
        if (!periodFrom || !periodTo)
          problem('BALANCES_NO_PERIOD', '账套没有可查询期间', '请先建立会计期间');
        if (periodFrom > periodTo)
          problem('BALANCES_PERIOD_RANGE', '开始期间晚于结束期间', '请重新选择期间');
        const accounts = await t.accounts.list();
        const byId = new Map(accounts.map((a) => [a.id, a]));
        for (const code of [q.codeFrom, q.codeTo])
          if (code && !accounts.some((a) => a.code === code))
            problem('BALANCES_ACCOUNT_NOT_FOUND', `科目 ${code} 不存在`, '请重新选择科目范围');
        if (q.codeFrom && q.codeTo && q.codeFrom > q.codeTo)
          problem('BALANCES_ACCOUNT_RANGE', '开始科目大于结束科目', '请交换科目范围');
        const underEnd = (id: number): boolean => {
          const a = byId.get(id);
          return !!a && (a.code === q.codeTo || (a.parentId != null && underEnd(a.parentId)));
        };
        const cashAccounts = accounts.filter(
          (a) =>
            a.isLeaf &&
            (a.isCash || a.isBank || a.cashflowRequired) &&
            (!q.codeFrom || a.code >= q.codeFrom) &&
            (!q.codeTo || a.code <= q.codeTo || underEnd(a.id)),
        );
        if (!cashAccounts.length)
          problem(
            'BALANCES_CASHFLOW_NO_ACCOUNTS',
            '无符合条件的现金或银行科目',
            '请扩大科目范围；其他现金等价物须在科目档案设置现金流量标志',
          );
        const projects = await t.dimensions.items('cashflow');
        const projectMap = new Map(projects.map((p) => [p.id, p]));
        if (
          q.project &&
          q.project !== 'unallocated' &&
          !projects.some((p) => String(p.id) === q.project)
        )
          problem(
            'BALANCES_CASHFLOW_PROJECT_NOT_FOUND',
            '所选现金流量项目不存在',
            '请选择现有项目或全部项目',
          );
        const info = await t.book.info();
        const ytdFrom = Math.max(Math.floor(periodTo / 100) * 100 + 1, info.startPeriod);
        const filter = {
          periodFrom,
          periodTo,
          accountIds: cashAccounts.map((a) => a.id),
          includeUnposted: q.includeUnposted,
        };
        const currentFlow = await t.ledger.cashflow(filter);
        const yearFlow =
          periodFrom === ytdFrom
            ? currentFlow
            : await t.ledger.cashflow({ ...filter, periodFrom: ytdFrom });
        if (!q.allowLarge && Math.max(currentFlow.rows.length, yearFlow.rows.length) > 5000)
          problem(
            'BALANCES_CASHFLOW_LARGE',
            '现金流量明细超过 5000 行，刷新可能需要较长时间',
            '可缩短期间或缩小科目范围；继续查询将读取全部明细，不截断合计',
          );
        const decorate = (rows: EntryRow[]): CashflowDetail[] => {
          let running = 0n;
          return rows.map((row, sequence) => {
            const p = projectMap.get(row.dimensions.cashflow ?? -1);
            const allocated = !!p && row.cashflowDirection != null;
            running += BigInt(row.debit) - BigInt(row.credit);
            return {
              ...row,
              sequence,
              allocated,
              accountName: byId.get(row.accountId)!.fullName,
              projectKey: allocated ? String(p.id) : 'unallocated',
              projectName: p ? `${p.code} ${p.name}` : '未指定项目',
              directionName:
                row.cashflowDirection === 'inflow'
                  ? '流入'
                  : row.cashflowDirection === 'outflow'
                    ? '流出'
                    : row.cashflowDirection === 'internal'
                      ? '内部互转'
                      : '未填流向',
              runningNet: money(running),
            };
          });
        };
        const allRows = decorate(currentFlow.rows);
        const yearRows = decorate(yearFlow.rows);
        const balances = (
          await t.ledger.balances({
            periodFrom,
            periodTo,
            includeUnposted: q.includeUnposted,
            accountCodes: cashAccounts.map((a) => a.code),
            rollup: false,
            includeZero: true,
          })
        ).filter((r) => cashAccounts.some((a) => a.id === r.accountId));
        const cashOpening = money(balances.reduce((n, r) => n + BigInt(r.opening), 0n));
        const cashClosing = money(balances.reduce((n, r) => n + BigInt(r.closing), 0n));
        const totals = total(allRows);
        const partitions = new Map<string, { current: CashflowDetail[]; year: CashflowDetail[] }>();
        for (const [name, rows] of [
          ['current', allRows],
          ['year', yearRows],
        ] as const)
          for (const row of rows) {
            let part = partitions.get(row.projectKey);
            if (!part) {
              part = { current: [], year: [] };
              partitions.set(row.projectKey, part);
            }
            part[name].push(row);
          }
        const projectRows = [...partitions]
          .map(([key, part]) => {
            const p = projectMap.get(Number(key));
            return {
              key,
              code: p?.code ?? '',
              name: p?.name ?? '未分配（项目或流向缺失）',
              ...total(part.current),
              ytd: total(part.year),
            };
          })
          .sort((a, b) => a.code.localeCompare(b.code));
        // 选项目只改变项目汇总和明细，顶部仍核对同范围全部现金银行净变动。
        const selected = allRows.filter((r) => !q.project || r.projectKey === q.project);
        let selectedRunning = 0n;
        return {
          periodFrom,
          periodTo,
          ytdFrom,
          ytdComplete: ytdFrom % 100 === 1,
          orgName: info.orgName,
          baseCurrency: info.baseCurrency,
          includeUnposted: q.includeUnposted,
          project: q.project,
          projectLabel: !q.project
            ? '全部项目'
            : q.project === 'unallocated'
              ? '未分配（项目或流向缺失）'
              : `${projectMap.get(Number(q.project))!.code} ${projectMap.get(Number(q.project))!.name}`,
          scope: `科目：${q.codeFrom || '最前'}—${q.codeTo || '最后'}（结束科目含下级）；现金银行及设置现金流量标志的末级科目`,
          cashOpening,
          cashClosing,
          totals,
          ytd: total(yearRows),
          balanceDifference: money(
            BigInt(cashClosing) - BigInt(cashOpening) - BigInt(totals.cashNet),
          ),
          projects: projectRows.filter((r) => !q.project || r.key === q.project),
          rows: selected.map((r) => {
            selectedRunning += BigInt(r.debit) - BigInt(r.credit);
            return { ...r, runningNet: money(selectedRunning) };
          }),
          internalUnbalancedVouchers: currentFlow.internalUnbalancedVouchers,
        };
      });
    },
  };
}
