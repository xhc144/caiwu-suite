import { createHash } from 'node:crypto';
import {
  BusinessError,
  DIMENSION_TYPES,
  notFound,
  periodOfDate,
  periodStartDate,
  periodYear,
  type Account,
  type DimensionValues,
  type VoucherLineInput,
  type EntryRow,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  CashAccountSchema,
  DocumentSchema,
  GenerateSchema,
  safeSum,
  signedAmount,
  type DocumentFilter,
  type DocumentInput,
  type GenerateInput,
  type MatchInput,
} from '../shared';
import type { CashierTables } from './migrations';

type Selection = { id: number; revision: number }[];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(
  code: string,
  message: string,
  hint = '请检查当前筛选条件，修正后重新预览',
  to = '/m/cashier/documents',
): never {
  throw new BusinessError({
    code: `CASHIER_${code}`,
    message,
    hint,
    actions: [{ label: '去处理', to }],
  });
}
const tables = (svc: CoreServices) => svc.db.withTables<CashierTables>();
async function config(svc: CoreServices) {
  const period = await svc.settings.get<number | null>('enabledPeriod', null);
  if (period == null)
    fail('NOT_ENABLED', '尚未启用出纳', '先选择出纳启用期间并保存账户期初', '/m/cashier/accounts');
  return { period };
}
async function assertOpen(svc: CoreServices, period: number) {
  const enabled = await config(svc);
  if (period < enabled.period)
    fail(
      'BEFORE_START',
      '日期早于出纳启用期间',
      '启用前余额请在账户期初核对',
      '/m/cashier/accounts',
    );
  const own = await tables(svc)
    .selectFrom('cashier_period')
    .selectAll()
    .where('period', '=', period)
    .executeTakeFirst();
  if (own?.closed)
    fail(
      'PERIOD_CLOSED',
      '该出纳月份已经结账，不能修改业务',
      '请保留该月份历史；当前检查点尚未提供出纳反结账，可先核对账户及启用期间',
      '/m/cashier/accounts',
    );
  await svc.periods.assertOpen(period, '修改出纳业务');
}
async function account(svc: CoreServices, id: number) {
  const row = await tables(svc)
    .selectFrom('cashier_account')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('出纳账户', id);
  return row;
}
async function document(svc: CoreServices, id: number) {
  const row = await tables(svc)
    .selectFrom('cashier_document')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row || row.deleted) throw notFound('出纳单据（账务引用只能查看）', id);
  return row;
}
async function selected(svc: CoreServices, selection: Selection) {
  const rows = [];
  for (const item of selection) {
    const row = await document(svc, item.id);
    if (row.revision !== item.revision)
      fail('STALE', `单据 CN-${row.id} 已发生变化`, '刷新列表并重新选择后再提交');
    rows.push(row);
  }
  return rows;
}
async function protection(svc: CoreServices, id: number) {
  const db = tables(svc);
  const match = await db
    .selectFrom('cashier_match_document')
    .selectAll()
    .where('document_id', '=', id)
    .executeTakeFirst();
  if (match)
    fail(
      'MATCHED',
      `单据 CN-${id} 已勾账，不能改删或撤销凭证`,
      '先确认并取消对应勾账组',
      '/m/cashier/reconcile',
    );
  const mapping = await db
    .selectFrom('cashier_batch_document')
    .selectAll()
    .where('document_id', '=', id)
    .where('voucher_id', 'is not', null)
    .executeTakeFirst();
  if (mapping) {
    const v = await svc.vouchers.get(mapping.voucher_id!);
    fail(
      'VOUCHERED',
      `单据 CN-${id} 已生成${v?.status === 'posted' ? '已过账' : v?.status === 'audited' ? '已审核' : ''}凭证，不能直接改删`,
      '先在出纳合法撤销未审核来源凭证，再修改原单',
      `/m/voucher-entry/edit?id=${mapping.voucher_id}`,
    );
  }
}
function lineDimensions(a: Account, dims: DimensionValues): DimensionValues {
  const out: DimensionValues = {};
  for (const dt of DIMENSION_TYPES) {
    if (dt.id === 'cashflow' || a.dimensions.some((d) => d.type === dt.id))
      out[dt.id] = dims[dt.id] ?? null;
  }
  return out;
}
async function validate(svc: CoreServices, raw: DocumentInput) {
  const input = DocumentSchema.parse(raw);
  if (periodOfDate(input.date) !== input.period)
    fail('DATE_PERIOD', '单据日期超出选择期间', '请将日期改为所选月份，或先切换期间');
  await assertOpen(svc, input.period);
  const cash = await account(svc, input.accountId);
  if (cash.disabled)
    fail('DISABLED', '出纳账户已停用', '请在账户页启用账户后再录入', '/m/cashier/accounts');
  const core = await svc.accounts.require(cash.core_account_id);
  if (!core.isCash && !core.isBank)
    fail(
      'CASH_ACCOUNT',
      '关联科目已经不再是现金或银行科目',
      '请检查基础科目设置并保留历史关联',
      '/m/cashier/accounts',
    );
  const accs = [core];
  if (input.oppositeAccountId != null)
    accs.push(await svc.accounts.require(input.oppositeAccountId));
  if (input.oppositeAccountId === core.id)
    fail('SAME_ACCOUNT', '对方科目不能与出纳账户科目相同', '请选择实际业务的对方科目');
  for (const a of accs) {
    if (!a.isLeaf || a.disabled)
      fail('ACCOUNT_LEAF', `科目 ${a.code} ${a.name} 不是可用的末级科目`, '请选择未停用的末级科目');
    if (a.currency || a.quantityUnit)
      fail(
        'UNSUPPORTED_ACCOUNT',
        `科目 ${a.code} 需要外币或数量核算`,
        '当前检查点支持本位币、无数量核算科目',
      );
    for (const dt of DIMENSION_TYPES) {
      const c = a.dimensions.find((d) => d.type === dt.id);
      const value = input.dimensions[dt.id] ?? c?.defaultItemId;
      if ((c?.required || (dt.id === 'cashflow' && a.cashflowRequired)) && value == null)
        fail('DIMENSION', `科目 ${a.code} ${a.name} 需要${dt.name}`, `请在单据中补充${dt.name}`);
    }
  }
  for (const dt of DIMENSION_TYPES) {
    const value = input.dimensions[dt.id];
    if (value == null) continue;
    const item = await svc.dimensions.get(value);
    if (!item || item.typeId !== dt.id || item.disabled || !item.isLeaf)
      fail('DIMENSION', `${dt.name}不存在、已停用或不是末级`, '重新选择有效的辅助核算项');
  }
  return { input, cash, core, opposite: accs[1] };
}
async function buildPreview(svc: CoreServices, raw: GenerateInput) {
  const input = GenerateSchema.parse(raw);
  const rows = await selected(svc, input.documents);
  const p = periodOfDate(input.date);
  await assertOpen(svc, p);
  const type = (await svc.reference.voucherTypes()).find(
    (t) => t.id === input.voucherTypeId && !t.disabled,
  );
  if (!type) fail('VOUCHER_TYPE', '请选择有效的凭证字', '重新选择未停用的凭证字');
  const missing = rows.filter((r) => r.opposite_account_id == null);
  if (missing.length)
    fail(
      'MAPPING',
      `以下单据没有唯一的对方科目：${missing.map((r) => `CN-${r.id}`).join('、')}`,
      '逐张填写对方末级科目后重新生成；当前未启用自动科目匹配',
    );
  const groups: { documentIds: number[]; lines: VoucherLineInput[] }[] = [];
  for (const r of rows) {
    await protection(svc, r.id);
    if (r.period !== p)
      fail(
        'BATCH_PERIOD',
        '所选单据与凭证日期必须属于同一个出纳月份',
        '重新选择同月单据和凭证日期',
      );
    const {
      core,
      opposite,
      input: data,
    } = await validate(svc, {
      accountId: r.account_id,
      period: r.period,
      date: r.date,
      summary: r.summary,
      direction: r.direction,
      amount: r.amount,
      oppositeAccountId: r.opposite_account_id,
      dimensions: JSON.parse(r.dimensions_json) as DimensionValues,
      refNo: r.ref_no,
      note: r.note,
    });
    const receipt = r.direction === 'receipt';
    const lines: VoucherLineInput[] = [
      {
        accountId: core.id,
        summary: r.summary,
        debit: receipt ? r.amount : 0,
        credit: receipt ? 0 : r.amount,
        dimensions: lineDimensions(core, data.dimensions),
        refNo: r.ref_no,
        bizDate: r.date,
      },
      {
        accountId: opposite!.id,
        summary: r.summary,
        debit: receipt ? 0 : r.amount,
        credit: receipt ? r.amount : 0,
        dimensions: lineDimensions(opposite!, data.dimensions),
        bizDate: r.date,
      },
    ];
    if (input.mode === 'summary' && groups[0]) {
      groups[0].documentIds.push(r.id);
      groups[0].lines.push(...lines);
    } else groups.push({ documentIds: [r.id], lines });
  }
  const total = safeSum(rows.map((r) => r.amount));
  for (const g of groups) {
    if (safeSum(g.lines.map((l) => l.debit ?? 0)) !== safeSum(g.lines.map((l) => l.credit ?? 0)))
      fail('UNBALANCED', '预览分录借贷不平', '检查单据金额和方向后重新预览');
  }
  const allAccounts = await svc.accounts.list();
  return {
    total,
    groups: groups.map((g) => ({
      ...g,
      lines: g.lines.map((l) => ({
        ...l,
        accountName: allAccounts.find((a) => a.id === l.accountId)?.fullName ?? '',
      })),
    })),
  };
}

export function cashierService(svc: CoreServices) {
  const db = tables(svc);
  return {
    async status() {
      return { period: await svc.settings.get<number | null>('enabledPeriod', null) };
    },
    async enable(period: number) {
      return svc.tx(async (t) => {
        const existing = await t.settings.get<number | null>('enabledPeriod', null);
        if (existing != null) {
          if (existing !== period)
            fail(
              'ENABLED',
              '出纳已经启用，不能重设启用期间',
              '保留现有单据和期初，在账户页补充配置',
              '/m/cashier/accounts',
            );
          return { period: existing };
        }
        await t.periods.assertOpen(period, '启用出纳');
        await t.settings.set('enabledPeriod', period);
        await t.log.write({ action: 'cashier.enable', summary: `启用出纳 ${period}` });
        return { period };
      });
    },
    async accounts(year?: number) {
      const enabled = await svc.settings.get<number | null>('enabledPeriod', null);
      if (enabled == null) return [];
      if (year != null && year < periodYear(enabled))
        fail(
          'OPENING_YEAR',
          '选择年份早于出纳启用年份',
          '请选择启用年份或已建立的年度',
          '/m/cashier/accounts',
        );
      if (year != null && year > periodYear(enabled))
        fail(
          'OPENING_YEAR',
          '该年度出纳年初数尚未通过年结建立',
          '当前检查点尚未实现出纳年结，请先查询启用年度',
          '/m/cashier/accounts',
        );
      const rows = await db
        .selectFrom('cashier_account')
        .innerJoin('account as a', 'a.id', 'cashier_account.core_account_id')
        .innerJoin('cashier_opening as o', 'o.account_id', 'cashier_account.id')
        .select([
          'cashier_account.id',
          'cashier_account.name',
          'cashier_account.core_account_id',
          'cashier_account.currency',
          'cashier_account.disabled',
          'cashier_account.revision',
          'a.code',
          'a.full_name',
          'o.balance',
          'o.period',
        ])
        .orderBy('cashier_account.id')
        .execute();
      const balances = await svc.ledger.balances({
        periodFrom: enabled,
        periodTo: enabled,
        includeZero: true,
        rollup: false,
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        coreAccountId: r.core_account_id,
        code: r.code,
        coreName: r.full_name,
        currency: r.currency,
        disabled: !!r.disabled,
        revision: r.revision,
        opening: r.balance,
        period: r.period,
        coreOpening: balances.find((b) => b.accountId === r.core_account_id)?.opening ?? 0,
      }));
    },
    async saveAccount(
      raw: { name: string; coreAccountId: number; currency: string; opening: number },
      edit?: { id: number; revision: number },
    ) {
      const input = CashAccountSchema.parse(raw);
      return svc.tx(async (t) => {
        const { period } = await config(t);
        const tdb = tables(t);
        const a = await t.accounts.require(input.coreAccountId);
        if (!a.isLeaf || a.disabled || (!a.isCash && !a.isBank))
          fail(
            'CASH_ACCOUNT',
            '出纳账户必须关联未停用的现金或银行末级科目',
            '请在已有现金/银行科目中选择末级科目',
            '/m/cashier/accounts',
          );
        const book = await t.book.info();
        if (a.currency || input.currency !== book.baseCurrency)
          fail(
            'CURRENCY',
            '当前检查点仅支持本位币出纳账户',
            `请选择 ${book.baseCurrency} 本位币科目`,
            '/m/cashier/accounts',
          );
        const duplicate = await tdb
          .selectFrom('cashier_account')
          .select('id')
          .where('core_account_id', '=', a.id)
          .where('currency', '=', input.currency)
          .executeTakeFirst();
        if (duplicate && duplicate.id !== edit?.id)
          fail(
            'ACCOUNT_DUPLICATE',
            '该科目和币种已有出纳账户',
            '请使用现有账户，避免重复核算',
            '/m/cashier/accounts',
          );
        let id: number;
        if (edit) {
          const old = await account(t, edit.id);
          if (old.revision !== edit.revision)
            fail(
              'STALE',
              '账户配置已被其他操作修改',
              '刷新账户列表后重新编辑',
              '/m/cashier/accounts',
            );
          const opening = await tdb
            .selectFrom('cashier_opening')
            .selectAll()
            .where('account_id', '=', old.id)
            .where('period', '=', period)
            .executeTakeFirstOrThrow();
          const changed =
            old.core_account_id !== a.id ||
            old.currency !== input.currency ||
            opening.balance !== input.opening;
          if (changed) {
            const used = await tdb
              .selectFrom('cashier_document')
              .select('id')
              .where('account_id', '=', old.id)
              .executeTakeFirst();
            const matched = await tdb
              .selectFrom('cashier_match')
              .select('id')
              .where('account_id', '=', old.id)
              .executeTakeFirst();
            const closed = await tdb
              .selectFrom('cashier_period')
              .select('period')
              .where('closed', '=', 1)
              .executeTakeFirst();
            const financialUse = await t.ledger.entries({
              periodFrom: period,
              periodTo: 999912,
              accountIds: [old.core_account_id],
              includeUnposted: true,
              limit: 1,
            });
            if (old.used || used || matched || closed || financialUse.length > 0)
              fail(
                'OPENING_LOCKED',
                '账户已使用或已有结账历史，不能更改关联科目、币种或期初',
                '保留历史；差错请通过有记录的业务调整处理',
                '/m/cashier/accounts',
              );
            await assertOpen(t, period);
          }
          await tdb
            .updateTable('cashier_account')
            .set({
              name: input.name,
              core_account_id: a.id,
              currency: input.currency,
              revision: old.revision + 1,
            })
            .where('id', '=', old.id)
            .execute();
          if (changed)
            await tdb
              .updateTable('cashier_opening')
              .set({ balance: input.opening })
              .where('account_id', '=', old.id)
              .where('period', '=', period)
              .execute();
          id = old.id;
        } else {
          await assertOpen(t, period);
          // 后增账户也不能回写已结月份的期初。
          const closed = await tdb
            .selectFrom('cashier_period')
            .select('period')
            .where('closed', '=', 1)
            .executeTakeFirst();
          if (closed)
            fail(
              'OPENING_LOCKED',
              '已有出纳结账历史，不能回填启用期初',
              '当前检查点暂不支持期中增加账户',
              '/m/cashier/accounts',
            );
          const row = await tdb
            .insertInto('cashier_account')
            .values({ name: input.name, core_account_id: a.id, currency: input.currency })
            .returning('id')
            .executeTakeFirstOrThrow();
          id = row.id;
          await tdb
            .insertInto('cashier_opening')
            .values({ account_id: id, period, balance: input.opening })
            .execute();
        }
        await t.log.write({
          action: 'cashier.account.save',
          summary: `保存出纳账户 ${input.name}`,
          targetId: id,
          detail: input,
        });
        return { id };
      });
    },
    async setDisabled(id: number, revision: number, disabled: boolean) {
      return svc.tx(async (t) => {
        const row = await account(t, id);
        if (row.revision !== revision)
          fail('STALE', '账户状态已变化', '刷新后重试', '/m/cashier/accounts');
        await tables(t)
          .updateTable('cashier_account')
          .set({ disabled: disabled ? 1 : 0, revision: revision + 1 })
          .where('id', '=', id)
          .execute();
        await t.log.write({
          action: 'cashier.account.disable',
          summary: `${disabled ? '停用' : '启用'}账户 ${row.name}`,
          targetId: id,
        });
      });
    },
    async documents(filter: DocumentFilter = {}) {
      let q = db
        .selectFrom('cashier_document as d')
        .innerJoin('cashier_account as a', 'a.id', 'd.account_id')
        .leftJoin('account as oa', 'oa.id', 'd.opposite_account_id')
        .leftJoin('cashier_match_document as md', 'md.document_id', 'd.id')
        .leftJoin('cashier_batch_document as bd', (j) =>
          j.onRef('bd.document_id', '=', 'd.id').on('bd.voucher_id', 'is not', null),
        )
        .select([
          'd.id',
          'd.request_key',
          'd.account_id',
          'd.date',
          'd.period',
          'd.summary',
          'd.direction',
          'd.amount',
          'd.opposite_account_id',
          'd.dimensions_json',
          'd.ref_no',
          'd.note',
          'd.revision',
          'a.name as account_name',
          'a.currency',
          'oa.code as opposite_code',
          'oa.full_name as opposite_name',
          'md.match_id',
          'bd.batch_id',
          'bd.voucher_id',
        ]);
      if (filter.id) q = q.where('d.id', '=', filter.id);
      if (filter.batch)
        q = q.where(
          'd.id',
          'in',
          db
            .selectFrom('cashier_batch_document')
            .select('document_id')
            .where('batch_id', '=', filter.batch),
        );
      if (filter.accountId) q = q.where('d.account_id', '=', filter.accountId);
      if (filter.from) q = q.where('d.date', '>=', filter.from);
      if (filter.to) q = q.where('d.date', '<=', filter.to);
      if (filter.keyword) q = q.where('d.summary', 'like', `%${filter.keyword}%`);
      if (filter.min != null) q = q.where('d.amount', '>=', filter.min);
      if (filter.max != null) q = q.where('d.amount', '<=', filter.max);
      if (filter.generated === 'yes') q = q.where('bd.voucher_id', 'is not', null);
      if (filter.generated === 'no') q = q.where('bd.voucher_id', 'is', null);
      if (filter.matched === 'yes') q = q.where('md.match_id', 'is not', null);
      if (filter.matched === 'no') q = q.where('md.match_id', 'is', null);
      q = q
        .orderBy(
          filter.sort === 'amount' ? 'd.amount' : filter.sort === 'number' ? 'd.id' : 'd.date',
        )
        .orderBy('d.id')
        .where('d.deleted', '=', 0);
      const rows = await q.execute();
      const result = [];
      for (const r of rows) {
        const dimensions = JSON.parse(r.dimensions_json) as DimensionValues;
        if (filter.partnerId && dimensions.partner !== filter.partnerId) continue;
        const voucher = r.voucher_id == null ? null : await svc.vouchers.get(r.voucher_id);
        result.push({
          id: r.id,
          number: `CN-${String(r.id).padStart(6, '0')}`,
          accountId: r.account_id,
          accountName: r.account_name,
          currency: r.currency,
          date: r.date,
          period: r.period,
          summary: r.summary,
          direction: r.direction,
          amount: r.amount,
          signed: signedAmount(r),
          oppositeAccountId: r.opposite_account_id,
          oppositeName: r.opposite_code ? `${r.opposite_code} ${r.opposite_name}` : '未填写',
          dimensions,
          refNo: r.ref_no,
          note: r.note,
          revision: r.revision,
          matchId: r.match_id,
          batchId: r.batch_id,
          voucherId: r.voucher_id,
          voucherNo: voucher?.displayNo ?? null,
          voucherStatus: voucher?.status ?? null,
        });
      }
      return result;
    },
    async createDocument(raw: DocumentInput & { requestKey: string }) {
      const input = DocumentSchema.parse(raw);
      const original = JSON.stringify(input);
      return svc.tx(async (t) => {
        const tdb = tables(t);
        const existing = await tdb
          .selectFrom('cashier_document')
          .selectAll()
          .where('request_key', '=', raw.requestKey)
          .executeTakeFirst();
        if (existing) {
          if (existing.deleted)
            fail(
              'DOCUMENT_REMOVED',
              '该新增请求对应的单据已经删除',
              '需要新单据时请重新打开新增抽屉',
            );
          if (existing.original_json !== original)
            fail('IDEMPOTENCY', '相同请求标识对应了不同单据内容', '重新打开新增抽屉后再提交');
          return { id: existing.id };
        }
        await validate(t, input);
        const row = await tdb
          .insertInto('cashier_document')
          .values({
            request_key: raw.requestKey,
            original_json: original,
            ...documentValues(input),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await tdb
          .updateTable('cashier_account')
          .set({ used: 1 })
          .where('id', '=', input.accountId)
          .execute();
        await t.log.write({
          action: 'cashier.document.create',
          summary: `新增出纳单 CN-${row.id}`,
          targetId: row.id,
          detail: input,
        });
        return row;
      });
    },
    async updateDocument(id: number, revision: number, raw: DocumentInput) {
      return svc.tx(async (t) => {
        const [old] = await selected(t, [{ id, revision }]);
        await protection(t, id);
        await assertOpen(t, old!.period);
        const { input } = await validate(t, raw);
        await tables(t)
          .updateTable('cashier_document')
          .set({ ...documentValues(input), revision: revision + 1 })
          .where('id', '=', id)
          .execute();
        await tables(t)
          .updateTable('cashier_account')
          .set({ used: 1 })
          .where('id', '=', input.accountId)
          .execute();
        await t.log.write({
          action: 'cashier.document.update',
          summary: `修改出纳单 CN-${id}`,
          targetId: id,
          detail: input,
        });
      });
    },
    async removeDocument(id: number, revision: number) {
      return svc.tx(async (t) => {
        const [old] = await selected(t, [{ id, revision }]);
        await protection(t, id);
        await assertOpen(t, old!.period);
        // 保留请求标识和批次历史，延迟重试不会复活已删除单据。
        await tables(t)
          .updateTable('cashier_document')
          .set({ deleted: 1, revision: revision + 1 })
          .where('id', '=', id)
          .execute();
        await t.log.write({
          action: 'cashier.document.remove',
          summary: `删除出纳单 CN-${id}`,
          targetId: id,
        });
      });
    },
    preview: (input: GenerateInput) => buildPreview(svc, input),
    async generate(raw: GenerateInput & { requestKey: string }) {
      const input = GenerateSchema.parse(raw);
      const inputJson = JSON.stringify(input);
      return svc.tx(async (t) => {
        const tdb = tables(t);
        const existing = await tdb
          .selectFrom('cashier_batch')
          .selectAll()
          .where('request_key', '=', raw.requestKey)
          .executeTakeFirst();
        if (existing) {
          if (existing.input_json !== inputJson || !existing.active)
            fail('IDEMPOTENCY', '该生成请求已经使用或撤销', '刷新单据并重新预览');
          return { batchId: existing.id };
        }
        const preview = await buildPreview(t, input);
        const batch = await tdb
          .insertInto('cashier_batch')
          .values({
            request_key: raw.requestKey,
            input_json: inputJson,
            mode: input.mode,
            date: input.date,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const group of preview.groups) {
          const voucher = await t.vouchers.create({
            date: input.date,
            voucherTypeId: input.voucherTypeId,
            lines: group.lines,
            source: { type: 'batch', id: String(batch.id) },
          });
          for (const documentId of group.documentIds) {
            await tdb
              .insertInto('cashier_batch_document')
              .values({ batch_id: batch.id, document_id: documentId, voucher_id: voucher.id })
              .execute();
            await tdb
              .updateTable('cashier_document')
              .set((eb) => ({ revision: eb('revision', '+', 1) }))
              .where('id', '=', documentId)
              .execute();
          }
        }
        await t.log.write({
          action: 'cashier.voucher.generate',
          summary: `出纳批次 ${batch.id} 生成 ${preview.groups.length} 张待审核凭证`,
          targetId: batch.id,
          detail: input,
        });
        return { batchId: batch.id };
      });
    },
    async revoke(batchId: number) {
      return svc.tx(async (t) => {
        const tdb = tables(t);
        const batch = await tdb
          .selectFrom('cashier_batch')
          .selectAll()
          .where('id', '=', batchId)
          .executeTakeFirst();
        if (!batch?.active) fail('NO_BATCH', '该批次不存在或已经撤销', '刷新单据列表');
        const mappings = await tdb
          .selectFrom('cashier_batch_document')
          .selectAll()
          .where('batch_id', '=', batchId)
          .execute();
        await assertOpen(t, periodOfDate(batch.date));
        const voucherIds = new Set<number>();
        for (const m of mappings) {
          const row = await document(t, m.document_id);
          await assertOpen(t, row.period);
          const match = await tdb
            .selectFrom('cashier_match_document')
            .selectAll()
            .where('document_id', '=', row.id)
            .executeTakeFirst();
          if (match)
            fail(
              'MATCHED',
              '批次内有已勾账单据，不能撤销',
              '先取消对应勾账组',
              '/m/cashier/reconcile',
            );
          if (m.voucher_id == null)
            fail('SOURCE', '批次凭证关联不完整', '请保留现场并检查账套数据');
          voucherIds.add(m.voucher_id);
        }
        for (const id of voucherIds) {
          const v = await t.vouchers.get(id);
          if (
            !v ||
            v.source?.module !== 'cashier' ||
            v.source.type !== 'batch' ||
            v.source.id !== String(batchId)
          )
            fail('SOURCE', '凭证不属于本出纳生成批次', '请检查来源关联');
          if (v.status !== 'pending' && v.status !== 'draft')
            fail(
              'VOUCHER_LOCKED',
              '来源凭证已审核或过账，不能撤销生成',
              '请先在账务处理中依法处理审核或过账状态',
              `/m/voucher-entry/edit?id=${id}`,
            );
          await t.vouchers.delete(id, { expectedRevision: v.revision });
        }
        await tdb
          .updateTable('cashier_batch_document')
          .set({ voucher_id: null })
          .where('batch_id', '=', batchId)
          .execute();
        await tdb
          .updateTable('cashier_batch')
          .set({ active: 0 })
          .where('id', '=', batchId)
          .execute();
        for (const m of mappings)
          await tdb
            .updateTable('cashier_document')
            .set((eb) => ({ revision: eb('revision', '+', 1) }))
            .where('id', '=', m.document_id)
            .execute();
        await t.log.write({
          action: 'cashier.voucher.revoke',
          summary: `撤销出纳生成批次 ${batchId}`,
          targetId: batchId,
        });
      });
    },
    reconcile: (input: { accountId: number; cutoff: string }) => reconciliation(svc, input),
    async match(raw: MatchInput) {
      return svc.tx(async (t) => {
        const snapshot = await reconciliation(t, raw);
        if (snapshot.snapshot !== raw.snapshot)
          fail(
            'STALE',
            '待勾项目或凭证状态已发生变化',
            '重新刷新两侧项目，再确认勾账',
            '/m/cashier/reconcile',
          );
        await selected(t, raw.documents);
        const docs = raw.documents.map((d) =>
          snapshot.documents.find((r) => r.id === d.id && r.matchId == null),
        );
        const lines = raw.lineIds.map((id) =>
          snapshot.entries.find((r) => r.lineId === id && r.matchId == null),
        );
        if (docs.some((d) => !d) || lines.some((l) => !l))
          fail(
            'MATCH_DUPLICATE',
            '所选项目不属于当前账户、截止范围，或已经勾账',
            '刷新后重新选择两侧未勾项目',
            '/m/cashier/reconcile',
          );
        for (const d of docs) await assertOpen(t, d!.period);
        for (const l of lines) await assertOpen(t, l!.period);
        const total = safeSum(docs.map((d) => d!.signed));
        if (total !== safeSum(lines.map((l) => l!.signed)))
          fail(
            'MATCH_AMOUNT',
            '出纳与财务所选金额不一致，差一分也不能勾账',
            '调整所选项目，确保同账户、同币种净额完全相等',
            '/m/cashier/reconcile',
          );
        const row = await tables(t)
          .insertInto('cashier_match')
          .values({
            account_id: raw.accountId,
            amount: total,
            created_at: t.ctx.now().toISOString(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const d of docs)
          await tables(t)
            .insertInto('cashier_match_document')
            .values({ match_id: row.id, document_id: d!.id })
            .execute();
        for (const l of lines)
          await tables(t)
            .insertInto('cashier_match_line')
            .values({ match_id: row.id, line_id: l!.lineId, voucher_revision: l!.revision })
            .execute();
        await t.log.write({
          action: 'cashier.reconcile.match',
          summary: `确认勾账组 ${row.id}`,
          targetId: row.id,
          detail: raw,
        });
        return row;
      });
    },
    async unmatch(id: number) {
      return svc.tx(async (t) => {
        const tdb = tables(t);
        const group = await tdb
          .selectFrom('cashier_match')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!group)
          fail(
            'MATCH_NOT_FOUND',
            '所选勾账组不存在或已取消',
            '刷新后选择有效勾账组',
            '/m/cashier/reconcile',
          );
        const snapshot = await reconciliation(t, {
          accountId: group.account_id,
          cutoff: '9999-12-31',
        });
        const current = snapshot.groups.find((g) => g.id === id);
        if (!current?.valid)
          fail(
            'MATCH_ABNORMAL',
            '勾账组金额、凭证状态或分录已变化，不能直接取消',
            '请先检查原凭证和组内项目；其他勾账组保持不变',
            '/m/cashier/reconcile',
          );
        for (const d of snapshot.documents.filter((r) => r.matchId === id))
          await assertOpen(t, d.period);
        for (const l of snapshot.entries.filter((r) => r.matchId === id))
          await assertOpen(t, l.period);
        await tdb.deleteFrom('cashier_match_document').where('match_id', '=', id).execute();
        await tdb.deleteFrom('cashier_match_line').where('match_id', '=', id).execute();
        await tdb.deleteFrom('cashier_match').where('id', '=', id).execute();
        await t.log.write({
          action: 'cashier.reconcile.unmatch',
          summary: `取消勾账组 ${id}`,
          targetId: id,
        });
      });
    },
  };
}
function documentValues(input: ReturnType<typeof DocumentSchema.parse>) {
  return {
    account_id: input.accountId,
    date: input.date,
    period: input.period,
    summary: input.summary,
    direction: input.direction,
    amount: input.amount,
    opposite_account_id: input.oppositeAccountId,
    dimensions_json: JSON.stringify(input.dimensions),
    ref_no: input.refNo,
    note: input.note,
  };
}

async function reconciliation(svc: CoreServices, input: { accountId: number; cutoff: string }) {
  const { period } = await config(svc);
  if (input.cutoff < periodStartDate(period))
    fail('CUTOFF', '截止日早于出纳启用日期', '请选择启用日期之后的截止日', '/m/cashier/reconcile');
  const a = await account(svc, input.accountId);
  const core = await svc.accounts.require(a.core_account_id);
  const book = await svc.book.info();
  if (core.currency || a.currency !== book.baseCurrency)
    fail(
      'CURRENCY',
      '账户币种配置与当前本位币核对范围不一致',
      '请检查账户历史配置，当前不支持混合币种核对',
      '/m/cashier/accounts',
    );
  const opening = await tables(svc)
    .selectFrom('cashier_opening')
    .selectAll()
    .where('account_id', '=', a.id)
    .where('period', '=', period)
    .executeTakeFirstOrThrow();
  const docs = await cashierService(svc).documents({ accountId: a.id });
  // 对账只读 core ledger；不复制分录，不向凭证/分录写勾账标志。
  const ledgerEntries = await svc.ledger.entries({
    periodFrom: period,
    periodTo: 999912,
    accountIds: [core.id],
    includeUnposted: false,
    limit: 200000,
  });
  if (ledgerEntries.length === 200000)
    fail('TOO_MANY', '分录数量达到查询上限，不能输出不完整对账表', '请先缩小期间范围');
  const lineMatches = await tables(svc)
    .selectFrom('cashier_match_line as ml')
    .innerJoin('cashier_match as m', 'm.id', 'ml.match_id')
    .select(['ml.line_id', 'ml.match_id', 'ml.voucher_revision'])
    .where('m.account_id', '=', a.id)
    .execute();
  const groups = await tables(svc)
    .selectFrom('cashier_match')
    .selectAll()
    .where('account_id', '=', a.id)
    .orderBy('id')
    .execute();
  const entries: (EntryRow & {
    signed: number;
    revision: number;
    matchId: number | null;
    sourceTo: string | null;
  })[] = [];
  for (const entry of ledgerEntries) {
    const v = await svc.vouchers.get(entry.voucherId);
    const m = lineMatches.find((m) => m.line_id === entry.lineId);
    entries.push({
      ...entry,
      signed: safeSum([entry.debit, -entry.credit]),
      revision: v!.revision,
      matchId: m?.match_id ?? null,
      sourceTo:
        v?.source?.module === 'cashier' && v.source.type === 'batch'
          ? `/m/cashier/documents?batch=${v.source.id}`
          : null,
    });
  }
  const groupDetails = groups.map((g) => {
    const ds = docs.filter((d) => d.matchId === g.id);
    const es = entries.filter((e) => e.matchId === g.id);
    const mappings = lineMatches.filter((l) => l.match_id === g.id);
    const valid =
      ds.length > 0 &&
      es.length > 0 &&
      es.length === mappings.length &&
      safeSum(ds.map((d) => d.signed)) === g.amount &&
      safeSum(es.map((e) => e.signed)) === g.amount &&
      es.every(
        (e) => mappings.find((m) => m.line_id === e.lineId)?.voucher_revision === e.revision,
      );
    const completeAtCutoff =
      valid && ds.every((d) => d.date <= input.cutoff) && es.every((e) => e.date <= input.cutoff);
    return {
      id: g.id,
      amount: g.amount,
      valid,
      completeAtCutoff,
      documents: ds.map((d) => d.number).join('、'),
      vouchers: es.map((e) => e.displayNo).join('、'),
    };
  });
  const effectiveGroups = new Set(groupDetails.filter((g) => g.completeAtCutoff).map((g) => g.id));
  const cutoffDocs = docs.filter((d) => d.date <= input.cutoff);
  const cutoffEntries = entries.filter((e) => e.date <= input.cutoff);
  const unmatchedDocs = cutoffDocs.filter(
    (d) => d.matchId == null || !effectiveGroups.has(d.matchId),
  );
  const unmatchedEntries = cutoffEntries.filter(
    (e) => e.matchId == null || !effectiveGroups.has(e.matchId),
  );
  const coreBalances = await svc.ledger.balances({
    periodFrom: period,
    periodTo: period,
    accountCodes: [core.code],
    rollup: false,
    includeZero: true,
  });
  const coreOpening = coreBalances.find((b) => b.accountId === core.id)?.opening ?? 0;
  const cashBalance = safeSum([opening.balance, ...cutoffDocs.map((d) => d.signed)]);
  const coreBalance = safeSum([coreOpening, ...cutoffEntries.map((e) => e.signed)]);
  const cashOutstanding = safeSum(unmatchedDocs.map((d) => d.signed));
  const coreOutstanding = safeSum(unmatchedEntries.map((e) => e.signed));
  const adjustedCash = safeSum([cashBalance, coreOutstanding]);
  const adjustedCore = safeSum([coreBalance, cashOutstanding]);
  return {
    account: { id: a.id, name: a.name, currency: a.currency },
    period,
    cutoff: input.cutoff,
    documents: cutoffDocs,
    entries: cutoffEntries,
    groups: groupDetails,
    snapshot: hash({
      docs: docs.map((d) => [d.id, d.revision, d.matchId]),
      entries: entries.map((e) => [e.lineId, e.revision, e.signed, e.matchId]),
      groups,
      cutoff: input.cutoff,
    }),
    adjustment: {
      cashOpening: opening.balance,
      coreOpening,
      openingDifference: safeSum([opening.balance, -coreOpening]),
      cashBalance,
      coreBalance,
      cashOutstanding,
      coreOutstanding,
      adjustedCash,
      adjustedCore,
      difference: safeSum([adjustedCash, -adjustedCore]),
      cashOutstandingIds: unmatchedDocs.map((d) => d.id),
      coreOutstandingIds: unmatchedEntries.map((e) => e.lineId),
    },
  };
}
