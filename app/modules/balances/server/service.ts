import { BusinessError, Decimal, type Account, type BalanceRow } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  QuerySchema,
  SettingsSchema,
  defaultSettings,
  parseDimensions,
  quantityKeys,
  type QueryInput,
  type Report,
  type ReportGroup,
  type QuantityTotals,
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

/** 先按单位分组，再汇总同单位末级。不能使用 core 跨单位的数量父行。 */
function quantityTree(leaves: BalanceRow[], accounts: Account[], selectedIds: Set<number>) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows = new Map<number, BalanceRow>();
  for (const leaf of leaves) {
    rows.set(leaf.accountId, { ...leaf });
    let parent = byId.get(leaf.accountId)?.parentId;
    while (parent != null) {
      const account = byId.get(parent)!;
      if (selectedIds.has(parent)) {
        const old = rows.get(parent);
        if (!old)
          rows.set(parent, {
            ...leaf,
            accountId: account.id,
            accountCode: account.code,
            accountName: account.name,
            direction: account.direction,
            level: account.level,
            isLeaf: false,
          });
        else {
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
            old[key] += leaf[key];
            if (!Number.isSafeInteger(old[key]))
              problem('BALANCES_AMOUNT_OVERFLOW', '余额超出安全整数范围', '请缩小查询范围');
          }
          for (const key of quantityKeys) old[key] = new Decimal(old[key]).add(leaf[key]).toFixed();
        }
      }
      parent = account.parentId;
    }
  }
  return [...rows.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

function sumQuantities(rows: BalanceRow[]): QuantityTotals {
  return Object.fromEntries(
    quantityKeys.map((key) => [
      key,
      rows
        .filter((r) => r.isLeaf)
        .reduce((n, row) => n.add(row[key]), new Decimal(0))
        .toFixed(),
    ]),
  ) as QuantityTotals;
}

export function balancesService(svc: CoreServices) {
  const settings = () => svc.settings.get<Settings>('display', defaultSettings);
  return {
    async metadata() {
      return {
        current: (await svc.periods.current())?.period,
        currencies: await svc.reference.currencies(),
        accounts: await svc.accounts.list(),
        dimensions: {
          project: await svc.dimensions.items('project'),
          partner: await svc.dimensions.items('partner'),
          department: await svc.dimensions.items('department'),
          person: await svc.dimensions.items('person'),
        },
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
      // 一份报表的元数据、期初、本期、YTD 及所有币种必须来自同一 SQLite 快照。
      // 回调内只使用绑定事务的 svc；query/export 共用此入口。
      return svc.tx(async (svc) => {
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
        const dimensionItems = q.dimension ? await svc.dimensions.items(q.dimension) : [];
        if (!q.dimension && (q.dimensionFrom || q.dimensionTo))
          problem(
            'BALANCES_DIMENSION_TYPE_REQUIRED',
            '辅助项范围缺少核算类型',
            '请先选择项目、客供、部门或个人',
          );
        for (const code of [q.dimensionFrom, q.dimensionTo])
          if (code && !dimensionItems.some((item) => item.code === code))
            problem(
              'BALANCES_DIMENSION_RANGE_NOT_FOUND',
              `辅助项 ${code} 不存在`,
              '请从当前核算类型的辅助项中选择，或清空范围',
            );
        if (q.dimensionFrom && q.dimensionTo && q.dimensionFrom > q.dimensionTo)
          problem(
            'BALANCES_DIMENSION_RANGE',
            '开始辅助项编码大于结束辅助项编码',
            '交换辅助项范围后重新查询',
          );
        const selectedDimensionIds = new Set(
          dimensionItems
            .filter(
              (item) =>
                (!q.dimensionFrom || item.code >= q.dimensionFrom) &&
                (!q.dimensionTo || item.code <= q.dimensionTo),
            )
            .map((item) => item.id),
        );
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
        const groups: ReportGroup[] = [];
        for (const currency of codes) {
          const coreRows = await svc.ledger.balances({
            periodFrom,
            periodTo,
            currency: currency || undefined,
            dimensions: dims,
            groupBy: q.dimension ? [q.dimension] : [],
            includeUnposted: q.includeUnposted,
            rollup: q.mode !== 'quantity',
            // 汇总表保留零科目；外币的非零原币行由已修复的 core 零行判断保留。
            includeZero: q.mode !== 'foreign',
          });
          // 外币表只展示本位币或原币有金额的行；数量字段不属于该表的显示口径。
          const selected = coreRows.filter(
            (r) =>
              selectedIds.has(r.accountId) &&
              (q.mode !== 'quantity' || byId.get(r.accountId)?.quantityUnit != null) &&
              (!q.dimension ||
                (r.dimensions[q.dimension] == null
                  ? !q.dimensionFrom && !q.dimensionTo
                  : selectedDimensionIds.has(r.dimensions[q.dimension]!))) &&
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
          const partitions = new Map<
            string,
            { rows: BalanceRow[]; unit?: string; dimension?: ReportGroup['dimension'] }
          >();
          for (const row of selected) {
            const unit = q.mode === 'quantity' ? byId.get(row.accountId)!.quantityUnit! : undefined;
            const dimensionId = q.dimension ? (row.dimensions[q.dimension] ?? null) : null;
            const key = JSON.stringify([unit, dimensionId]);
            let part = partitions.get(key);
            if (!part) {
              const item = dimensionItems.find((item) => item.id === dimensionId);
              part = {
                rows: [],
                ...(unit != null ? { unit } : {}),
                ...(q.dimension
                  ? {
                      dimension: {
                        type: q.dimension,
                        id: dimensionId,
                        code: item?.code ?? '',
                        name: item?.name ?? '未指定辅助项',
                      },
                    }
                  : {}),
              };
              partitions.set(key, part);
            }
            part.rows.push(row);
          }
          // 普通汇总/外币表的空查询仍返回空分组和零合计。
          if (!partitions.size && !q.dimension && q.mode !== 'quantity')
            partitions.set('', { rows: [] });
          for (const part of [...partitions.values()].sort(
            (a, b) =>
              (a.dimension?.code ?? '').localeCompare(b.dimension?.code ?? '') ||
              (a.unit ?? '').localeCompare(b.unit ?? ''),
          )) {
            const rows =
              q.mode === 'quantity' ? quantityTree(part.rows, accounts, selectedIds) : part.rows;
            groups.push({
              currency,
              ...part,
              ...(q.mode === 'quantity' ? { quantityTotals: sumQuantities(rows) } : {}),
              totals: sumLeaves(rows),
              rows: rows
                .filter(
                  (r) =>
                    !q.onlyActivity ||
                    r.debit !== 0 ||
                    r.credit !== 0 ||
                    (q.mode === 'foreign' && (r.fcDebit !== 0 || r.fcCredit !== 0)) ||
                    (q.mode === 'quantity' &&
                      (new Decimal(r.qtyDebit).isZero() === false ||
                        new Decimal(r.qtyCredit).isZero() === false)),
                )
                .map((r) => ({ ...r, parentId: byId.get(r.accountId)!.parentId })),
            });
          }
        }
        return {
          periodFrom,
          periodTo,
          orgName: info.orgName,
          baseCurrency: info.baseCurrency,
          dimensions: dims,
          includeUnposted: q.includeUnposted,
          mode: q.mode,
          auxiliary: !!q.dimension,
          scope: `科目范围：${q.codeFrom || '最前'}—${q.codeTo || '最后'}（结束科目含其实际下级）；合计取范围内末级科目${q.dimension ? `；辅助范围：${q.dimensionFrom || '最前'}—${q.dimensionTo || '最后'}（按编码含两端）` : ''}`,
          groups,
        };
      });
    },
  };
}
