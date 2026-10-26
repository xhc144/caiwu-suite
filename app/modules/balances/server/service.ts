import { BusinessError, type Account, type BalanceRow } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  QuerySchema,
  SettingsSchema,
  defaultSettings,
  parseDimensions,
  type QueryInput,
  type Report,
  type Settings,
  type Totals,
} from '../shared';

function problem(code: string, message: string, hint: string): never {
  throw new BusinessError({
    code,
    message,
    hint,
    actions: [{ label: '重新选择条件', to: '/m/balances' }],
  });
}

/** 只对 core 提供的末级余额做一次合计，不重新计算账务发生额。 */
export function sumLeaves(rows: BalanceRow[]): Totals {
  const t: Totals = {
    openingDebit: 0,
    openingCredit: 0,
    closingDebit: 0,
    closingCredit: 0,
    debit: 0,
    credit: 0,
    ytdDebit: 0,
    ytdCredit: 0,
    fcOpening: 0,
    fcDebit: 0,
    fcCredit: 0,
    fcClosing: 0,
  };
  for (const r of rows.filter((r) => r.isLeaf)) {
    t.openingDebit += Math.max(r.opening, 0);
    t.openingCredit += Math.max(-r.opening, 0);
    t.closingDebit += Math.max(r.closing, 0);
    t.closingCredit += Math.max(-r.closing, 0);
    for (const k of [
      'debit',
      'credit',
      'ytdDebit',
      'ytdCredit',
      'fcOpening',
      'fcDebit',
      'fcCredit',
      'fcClosing',
    ] as const)
      t[k] += r[k];
    for (const value of Object.values(t))
      if (!Number.isSafeInteger(value))
        problem(
          'BALANCES_AMOUNT_OVERFLOW',
          '余额合计超出安全整数范围',
          '请缩小科目或期间范围后重试',
        );
  }
  return t;
}

export function balancesService(svc: CoreServices) {
  const settings = () => svc.settings.get<Settings>('display', defaultSettings);
  return {
    async metadata() {
      return {
        current: (await svc.periods.current())?.period,
        currencies: await svc.reference.currencies(),
        accounts: await svc.accounts.list(),
        settings: await settings(),
      };
    },
    async saveSettings(raw: Settings): Promise<Settings> {
      const input = SettingsSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const previous = await tsvc.settings.get<Settings>('display', defaultSettings);
        if (input.revision !== previous.revision)
          problem(
            'BALANCES_SETTINGS_STALE',
            '展示设置已被其他窗口保存，本次没有覆盖',
            '保留当前编辑内容，关闭后重新打开设置，核对后再保存',
          );
        const next = { display: input.display, revision: previous.revision + 1 };
        await tsvc.settings.set('display', next);
        return next;
      });
    },
    async query(raw: QueryInput): Promise<Report> {
      const q = QuerySchema.parse(raw);
      const current = await svc.periods.current();
      const periodFrom = q.periodFrom ?? current?.period;
      const periodTo = q.periodTo ?? current?.period;
      if (!periodFrom || !periodTo)
        problem('BALANCES_NO_PERIOD', '账套没有可查询的期间', '请先建立会计期间');
      if (periodFrom > periodTo)
        problem('BALANCES_PERIOD_RANGE', '开始期间晚于结束期间', '交换开始和结束期间后重新查询');
      await svc.periods.require(periodFrom);
      await svc.periods.require(periodTo);
      const accounts = await svc.accounts.list();
      for (const code of [q.codeFrom, q.codeTo]) {
        if (code && !accounts.some((a) => a.code === code))
          problem(
            'BALANCES_ACCOUNT_NOT_FOUND',
            `科目 ${code} 不存在，无法查询余额`,
            '请选择现有的科目编码，或清空范围查询全部科目',
          );
      }
      if (q.codeFrom && q.codeTo && q.codeFrom > q.codeTo)
        problem(
          'BALANCES_ACCOUNT_RANGE',
          '开始科目编码大于结束科目编码',
          '交换科目范围或清空范围查询全部科目',
        );
      const dims = parseDimensions(q.dims);
      for (const type of ['project', 'partner', 'department', 'person'] as const) {
        if (
          dims[type] != null &&
          !(await svc.dimensions.items(type)).some((d) => d.id === dims[type])
        )
          problem(
            'BALANCES_DIMENSION_NOT_FOUND',
            '辅助项不存在或不属于指定核算类型',
            '清除 dims 条件，重新选择有效的辅助项',
          );
      }
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const isUnder = (a: Account, code: string) => {
        let cursor: Account | undefined = a;
        while (cursor) {
          if (cursor.code === code) return true;
          cursor = cursor.parentId == null ? undefined : byId.get(cursor.parentId);
        }
        return false;
      };
      const selectedLeaves = accounts.filter(
        (a) =>
          a.isLeaf &&
          (!q.codeFrom || a.code >= q.codeFrom) &&
          (!q.codeTo || a.code <= q.codeTo || isUnder(a, q.codeTo)),
      );
      const selectedIds = new Set(selectedLeaves.map((a) => a.id));
      // 只有整个子树都在范围内才显示其父级汇总，防止父行带入范围外数据。
      for (const a of accounts.filter((a) => !a.isLeaf)) {
        const leaves = accounts.filter((leaf) => leaf.isLeaf && isUnder(leaf, a.code));
        if (
          (!q.codeFrom || a.code >= q.codeFrom) &&
          (!q.codeTo || a.code <= q.codeTo || isUnder(a, q.codeTo)) &&
          leaves.length &&
          leaves.every((leaf) => selectedIds.has(leaf.id))
        )
          selectedIds.add(a.id);
      }
      const currencies = await svc.reference.currencies();
      if (
        q.currency &&
        !currencies.some((c) => c.code === q.currency && (q.mode !== 'foreign' || !c.isBase))
      )
        problem(
          'BALANCES_CURRENCY_INVALID',
          '所选币种不存在或不是外币',
          '清空币种条件，或选择列表中的外币',
        );
      const codes =
        q.mode === 'foreign'
          ? q.currency
            ? [q.currency]
            : currencies.filter((c) => !c.isBase).map((c) => c.code)
          : [q.currency];
      const info = await svc.book.info();
      const groups = [];
      for (const currency of codes) {
        const coreRows = await svc.ledger.balances({
          periodFrom,
          periodTo,
          currency: currency || undefined,
          dimensions: dims,
          includeUnposted: q.includeUnposted,
          rollup: true,
          // 汇总表保留零科目；外币的非零原币行由已修复的 core 零行判断保留。
          includeZero: q.mode === 'summary',
        });
        // 外币表只展示本位币或原币有金额的行；数量字段不属于该表的显示口径。
        const selected = coreRows.filter(
          (r) =>
            selectedIds.has(r.accountId) &&
            (q.mode !== 'foreign' ||
              [
                r.opening,
                r.debit,
                r.credit,
                r.closing,
                r.ytdDebit,
                r.ytdCredit,
                r.fcOpening,
                r.fcDebit,
                r.fcCredit,
                r.fcClosing,
              ].some((value) => value !== 0)),
        );
        for (const row of selected)
          for (const key of [
            'opening',
            'debit',
            'credit',
            'closing',
            'ytdDebit',
            'ytdCredit',
            'fcOpening',
            'fcDebit',
            'fcCredit',
            'fcClosing',
          ] as const) {
            if (!Number.isSafeInteger(row[key]))
              problem(
                'BALANCES_AMOUNT_OVERFLOW',
                '余额超出安全整数范围',
                '请缩小科目或期间范围后重试',
              );
          }
        groups.push({
          currency,
          totals: sumLeaves(selected),
          rows: selected
            .filter(
              (r) =>
                !q.onlyActivity ||
                r.debit !== 0 ||
                r.credit !== 0 ||
                (q.mode === 'foreign' && (r.fcDebit !== 0 || r.fcCredit !== 0)),
            )
            .map((r) => ({ ...r, parentId: byId.get(r.accountId)!.parentId })),
        });
      }
      return {
        periodFrom,
        periodTo,
        orgName: info.orgName,
        baseCurrency: info.baseCurrency,
        dimensions: dims,
        includeUnposted: q.includeUnposted,
        mode: q.mode,
        scope: `科目范围：${q.codeFrom || '最前'}—${q.codeTo || '最后'}（结束科目含其实际下级）；合计取范围内末级科目`,
        groups,
      };
    },
  };
}
