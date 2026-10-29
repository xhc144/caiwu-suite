import { BusinessError, Decimal, qtyToE6, formatMoney, type BusinessErrorData } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  RowSchema,
  openingKey,
  openingDimensions,
  rowVersion,
  rowsVersion,
  yearStart,
  exactSum,
  type RowInput,
  type SavedRow,
  type Change,
} from '../shared';

const closeAction = [{ label: '去期末处理', to: '/m/period-close' }];
export function fail(
  code: string,
  message: string,
  hint = '修正后重试',
  actions?: BusinessErrorData['actions'],
): never {
  throw new BusinessError({ code, message, hint, actions });
}
export async function requireYear(svc: CoreServices, year: number) {
  const book = await svc.book.info();
  if (year < Math.trunc(book.startPeriod / 100))
    fail(
      'OPENING_BEFORE_START',
      `${year} 年早于开账年度`,
      `请选择 ${Math.trunc(book.startPeriod / 100)} 年或之后已建立的年度`,
    );
  const fiscal = (await svc.periods.years()).find((y) => y.year === year);
  if (!fiscal)
    fail(
      'OPENING_YEAR_MISSING',
      `${year} 年期初尚未建立`,
      '请完成上一年度年结后再录入；本页不会自动创建年度',
      closeAction,
    );
  if (fiscal.opening_stored !== 1)
    fail(
      'OPENING_SOURCE_MISSING',
      `${year} 年尚未形成独立年度期初`,
      '请先在期末处理完成年结，避免录入的数据未参与核心余额计算',
      closeAction,
    );
  await svc.periods.require(fiscal.opening_period);
  return { book, fiscal };
}
export async function writable(svc: CoreServices, year: number, permission: string) {
  svc.permissions.require(permission);
  const context = await requireYear(svc, year);
  if (await svc.settings.get(`lock.${year}`, false))
    fail(
      'OPENING_LOCKED',
      `${year} 年期初已被本模块手工锁定`,
      '请有锁定权限的操作员先解锁年度期初',
    );
  const posted = await svc.db
    .selectFrom('voucher')
    .select('id')
    .where('period', '>=', year * 100 + 1)
    .where('period', '<=', year * 100 + 12)
    .where('status', '=', 'posted')
    .executeTakeFirst();
  if (posted)
    fail(
      'OPENING_POSTED',
      '本年已经有过账，不能增加、修改或删除期初数',
      '请先在期末处理对本年度凭证反过账，再修改期初',
      closeAction,
    );
  if (
    context.fiscal.status === 'closed' ||
    (await svc.periods.list()).some((p) => p.year === year && p.status === 'closed')
  )
    fail(
      'OPENING_CLOSED',
      `${year} 年存在已结账期间，不能修改期初`,
      '先反结账，再检查并修改期初',
      closeAction,
    );
  return context;
}
export async function validateRow(svc: CoreServices, raw: RowInput, view?: Change['view']) {
  const row = RowSchema.parse(raw);
  const { fiscal } = await requireYear(svc, row.year);
  const a = await svc.accounts.require(row.accountId);
  if (!a.isLeaf)
    fail(
      'OPENING_NOT_LEAF',
      `${a.code} ${a.name} 不是末级科目`,
      '请选择真实末级科目；上级自动汇总',
    );
  if (a.disabled)
    fail('OPENING_ACCOUNT_DISABLED', `科目 ${a.code} 已停用`, '先在科目维护中启用科目', [
      { label: '去科目维护', to: '/m/masterdata/accounts' },
    ]);
  if (view && !row.dimensions?.[view])
    fail(
      'OPENING_SELECT_ITEM',
      `请先选择要增加的${openingDimensions.find((d) => d.id === view)!.name}`,
      '请选择具体档案，不能使用“全部”',
    );
  for (const d of openingDimensions) {
    const id = row.dimensions?.[d.id];
    const config = a.dimensions.find((c) => c.type === d.id);
    if (id != null) {
      if (!config)
        fail(
          'OPENING_DIMENSION_CONFIG',
          `科目 ${a.code} 未启用${d.name}核算`,
          '选择匹配的科目，或在科目维护中配置辅助核算',
        );
      const item = await svc.dimensions.get(id);
      if (!item || item.typeId !== d.id || item.disabled || !item.isLeaf || item.code === '全部')
        fail(
          'OPENING_DIMENSION_INVALID',
          `${d.name}档案不存在、类型错误、停用或非末级`,
          '请选择可用的具体档案',
          [{ label: '去辅助档案维护', to: `/m/masterdata/dimensions?type=${d.id}` }],
        );
    } else if (config?.required)
      fail(
        'OPENING_DIMENSION_REQUIRED',
        `请先选择${d.name}，科目 ${a.code} 必填`,
        '请选择具体档案后再新增',
      );
  }
  if (row.currency) {
    const currency = (await svc.reference.currencies()).find((c) => c.code === row.currency);
    if (
      !a.currency ||
      a.currency !== row.currency ||
      !currency ||
      currency.disabled ||
      currency.isBase
    )
      fail(
        'OPENING_CURRENCY',
        `科目 ${a.code} 不是该币种的可用复币科目`,
        '只能选择科目配置的有效外币；本位币请选择“本位币”',
      );
  } else if (row.fcBalance !== 0)
    fail(
      'OPENING_CURRENCY',
      '外币余额必须指定科目配置的外币',
      '请选择有效外币；不要把外币额写成本位币额',
    );
  if (!a.quantityUnit && new Decimal(row.quantity).isZero() === false)
    fail('OPENING_QUANTITY', `科目 ${a.code} 非数量科目`, '选择配置了计量单位的数量科目');
  try {
    qtyToE6(row.quantity);
    yearStart(row);
  } catch {
    fail('OPENING_RANGE', '余额或数量超出可精确存储范围');
  }
  if (fiscal.opening_period % 100 === 1 && (row.ytdDebit !== 0 || row.ytdCredit !== 0))
    fail(
      'OPENING_JANUARY_YTD',
      '1 月启用不允许录入启用前累计发生额',
      '请将账前累计借贷置零；本月发生额通过凭证录入',
    );
  return row;
}
function existingRow(rows: SavedRow[], change: Change) {
  if (change.id == null) {
    if (rows.some((r) => openingKey(r) === openingKey(change.data)))
      fail(
        'OPENING_DUPLICATE',
        '已有此项目：年度、科目、辅助组合和币种重复',
        '请找到原记录，明确选择“修改”',
      );
    return;
  }
  const old = rows.find((r) => r.id === change.id);
  if (!old)
    fail('OPENING_ROW_MISSING', '该条期初不属于请求年度或已经删除', '刷新列表后重试；输入仍保留');
  if (openingKey(old) !== openingKey(change.data))
    fail(
      'OPENING_KEY_CHANGE',
      '修改不能改变年度、科目、辅助组合或币种',
      '需要更换组合时，请确认删除原记录，再新增',
    );
  if (rowVersion(old) !== change.expected)
    fail('OPENING_STALE', '该条期初已被其他操作修改', '保留当前输入，刷新并核对后重试');
}
/** 校验最终集合，阻止汇总/明细双计并确保核心整数累计仍在安全范围。 */
export function validateSet(rows: RowInput[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = openingKey(row);
    if (keys.has(key)) fail('OPENING_DUPLICATE', '年度、科目、辅助组合及币种存在重复键');
    keys.add(key);
    const blank = !Object.values(row.dimensions ?? {}).some((v) => v != null);
    if (
      blank &&
      rows.some(
        (r) =>
          r.accountId === row.accountId &&
          (r.currency ?? null) === (row.currency ?? null) &&
          Object.values(r.dimensions ?? {}).some((v) => v != null),
      )
    )
      fail(
        'OPENING_SUMMARY_DUPLICATE',
        '无辅助汇总行不能与辅助明细同时存储',
        '删除原汇总行后录入辅助明细，汇总由页面自动计算',
      );
  }
  try {
    for (const field of ['balance', 'ytdDebit', 'ytdCredit', 'fcBalance'] as const)
      exactSum(rows.map((r) => Math.abs(r[field] ?? 0)));
    exactSum(rows.map((r) => Math.abs(yearStart(RowSchema.parse(r)))));
    exactSum(rows.map((r) => Math.abs(qtyToE6(r.quantity ?? '0'))));
  } catch {
    fail(
      'OPENING_RANGE',
      '期初金额或数量合计超出可精确存储范围',
      '减少单次及全年度金额范围后再保存',
    );
  }
}
export async function applyChanges(
  svc: CoreServices,
  year: number,
  changes: Change[],
  permission = 'opening.edit',
) {
  await writable(svc, year, permission);
  const rows = await svc.opening.list(year);
  const keys = new Set<string>();
  for (const change of changes) {
    if (change.data.year !== year) fail('OPENING_YEAR_MISMATCH', '批次中出现不同年度');
    const key = openingKey(change.data);
    if (keys.has(key)) fail('OPENING_DUPLICATE', '批次中有重复的科目及辅助组合');
    keys.add(key);
    existingRow(rows, change);
    await validateRow(svc, change.data, change.view);
  }
  const prospective = [
    ...rows.filter((r) => !changes.some((c) => c.id === r.id)),
    ...changes.map((c) => c.data),
  ];
  validateSet(prospective);
  // 所有校验完成后才开始写；外部调用者必须包在同一 svc.tx 中。
  for (const change of changes) await svc.opening.upsert(RowSchema.parse(change.data));
  await svc.log.write({
    action: permission === 'opening.import' ? 'opening.import' : 'opening.save',
    summary: `${year} 年保存 ${changes.length} 条期初`,
    detail: changes,
  });
}
export async function trial(svc: CoreServices, year: number) {
  const { fiscal } = await requireYear(svc, year);
  const rows = await svc.opening.list(year);
  const accounts = await svc.accounts.list();
  const leaves = rows.filter((r) => accounts.some((a) => a.id === r.accountId && a.isLeaf));
  const sum = (get: (r: SavedRow) => number) => exactSum(leaves.map(get));
  const yearDebit = sum((r) => Math.max(yearStart(r), 0));
  const yearCredit = sum((r) => Math.max(-yearStart(r), 0));
  const ytdDebit = sum((r) => r.ytdDebit),
    ytdCredit = sum((r) => r.ytdCredit);
  const activationDebit = sum((r) => Math.max(r.balance, 0)),
    activationCredit = sum((r) => Math.max(-r.balance, 0));
  let core: Awaited<ReturnType<CoreServices['ledger']['trialBalance']>> | null = null;
  let coreError: string | null = null;
  try {
    core = await svc.ledger.trialBalance(fiscal.opening_period, year * 100 + 12);
  } catch (e) {
    coreError = e instanceof Error ? e.message : '期间试算读取失败';
  }
  const validationErrors: string[] = [];
  try {
    validateSet(rows);
  } catch (e) {
    validationErrors.push(e instanceof Error ? e.message : '期初集合无效');
  }
  for (const row of rows) {
    try {
      await validateRow(svc, row);
    } catch (e) {
      validationErrors.push(
        `${accounts.find((a) => a.id === row.accountId)?.code ?? row.accountId}：${e instanceof Error ? e.message : '数据无效'}`,
      );
    }
  }
  return {
    established: rows.length > 0,
    yearDebit,
    yearCredit,
    ytdDebit,
    ytdCredit,
    activationDebit,
    activationCredit,
    yearDifference: exactSum([yearDebit, -yearCredit]),
    ytdDifference: exactSum([ytdDebit, -ytdCredit]),
    difference: exactSum([activationDebit, -activationCredit]),
    core,
    coreError,
    validationErrors,
    balanced:
      rows.length > 0 &&
      yearDebit === yearCredit &&
      ytdDebit === ytdCredit &&
      activationDebit === activationCredit &&
      core?.balanced === true &&
      validationErrors.length === 0,
    accounts: accounts
      .filter((a) => leaves.some((r) => r.accountId === a.id))
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        balance: exactSum(leaves.filter((r) => r.accountId === a.id).map((r) => r.balance)),
      })),
  };
}
export function openingService(svc: CoreServices) {
  return {
    async list(year: number) {
      svc.permissions.require('opening.view');
      const { book, fiscal } = await requireYear(svc, year);
      return {
        book,
        fiscal,
        rows: await svc.opening.list(year),
        accounts: await svc.accounts.list(),
        items: await svc.dimensions.items(),
        currencies: await svc.reference.currencies(),
        locked: await svc.settings.get(`lock.${year}`, false),
        posted: !!(await svc.db
          .selectFrom('voucher')
          .select('id')
          .where('period', '>=', year * 100 + 1)
          .where('period', '<=', year * 100 + 12)
          .where('status', '=', 'posted')
          .executeTakeFirst()),
        rates: await Promise.all(
          (await svc.reference.currencies())
            .filter((c) => !c.isBase)
            .map(async (c) => ({
              code: c.code,
              rate: await svc.reference.exchangeRate(c.code, fiscal.opening_period),
            })),
        ),
      };
    },
    save(year: number, changes: Change[]) {
      return svc.tx(async (tsvc) => {
        await applyChanges(tsvc, year, changes);
        const keys = new Set(changes.map((change) => openingKey(change.data)));
        return (await tsvc.opening.list(year)).filter((row) => keys.has(openingKey(row)));
      });
    },
    async remove(input: { year: number; id: number; confirmed: boolean; expected: string }) {
      return svc.tx(async (tsvc) => {
        await writable(tsvc, input.year, 'opening.edit');
        if (!input.confirmed)
          fail(
            'OPENING_CONFIRM_DELETE',
            '删除已取消，期初没有改变',
            '请确认具体科目、辅助项及金额后再删除',
          );
        const row = (await tsvc.opening.list(input.year)).find((r) => r.id === input.id);
        if (!row) fail('OPENING_ROW_MISSING', '不允许删除：该记录不属于请求年度或已不存在');
        if (rowVersion(row) !== input.expected)
          fail('OPENING_STALE', '记录已修改，请重新核对后删除');
        await tsvc.opening.remove(input.id);
        await tsvc.log.write({
          action: 'opening.remove',
          summary: `${input.year} 年删除期初 ${input.id}`,
          detail: row,
        });
      });
    },
    async setLock(year: number, locked: boolean) {
      return svc.tx(async (tsvc) => {
        tsvc.permissions.require('opening.lock');
        await requireYear(tsvc, year);
        if (locked) {
          const result = await trial(tsvc, year);
          if (!result.balanced)
            fail(
              'OPENING_UNBALANCED',
              '期初尚未建立、数据无效或试算不平，不能锁定',
              `年初差额 ${formatMoney(result.yearDifference)}，账前累计差额 ${formatMoney(result.ytdDifference)}，启用余额差额 ${formatMoney(result.difference)}；检查当前科目明细`,
            );
        }
        await tsvc.settings.set(`lock.${year}`, locked);
        await tsvc.log.write({
          action: locked ? 'opening.lock' : 'opening.unlock',
          summary: `${year} 年${locked ? '锁定' : '解锁'}本模块手工期初锁`,
        });
      });
    },
    async cleanupPreview(year: number) {
      svc.permissions.require('opening.edit');
      await requireYear(svc, year);
      const cats = (await svc.accounts.categories()).filter((c) => c.isPnl).map((c) => c.id);
      const accounts = (await svc.accounts.list()).filter((a) => cats.includes(a.categoryId));
      const rows = (await svc.opening.list(year)).filter(
        (r) => accounts.some((a) => a.id === r.accountId) && yearStart(r) !== 0,
      );
      return {
        rows: rows.map((r) => ({
          ...r,
          accountCode: accounts.find((a) => a.id === r.accountId)!.code,
          accountName: accounts.find((a) => a.id === r.accountId)!.name,
          yearStart: yearStart(r),
        })),
        expected: rowsVersion(rows),
      };
    },
    async cleanup(year: number, expected: string, confirmation: string) {
      return svc.tx(async (tsvc) => {
        await writable(tsvc, year, 'opening.edit');
        if (confirmation !== '清理损益年初数')
          fail(
            'OPENING_CONFIRM_CLEANUP',
            '尚未二次确认清理，数据没有改变',
            '核对科目和金额后输入“清理损益年初数”',
          );
        const preview = await openingService(tsvc).cleanupPreview(year);
        if (preview.expected !== expected) fail('OPENING_STALE', '损益期初已改变，请重新预览');
        const cleaned: { id: number; data: RowInput }[] = [];
        for (const row of preview.rows) {
          const data = await validateRow(tsvc, {
            ...row,
            balance: exactSum([row.ytdDebit, -row.ytdCredit]),
          });
          cleaned.push({ id: row.id, data });
        }
        validateSet(
          (await tsvc.opening.list(year)).map(
            (row) => cleaned.find((c) => c.id === row.id)?.data ?? row,
          ),
        );
        for (const row of cleaned) await tsvc.opening.upsert(row.data);
        await tsvc.log.write({
          action: 'opening.cleanup',
          summary: `${year} 年清理 ${preview.rows.length} 条损益年初余额，保留账前累计及辅助项`,
          detail: preview.rows,
        });
      });
    },
  };
}
