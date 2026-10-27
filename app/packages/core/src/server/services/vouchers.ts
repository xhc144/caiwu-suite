import { confirmationFingerprint } from '../confirmation';
import { voucherPolicyService } from './voucher-policy';
import { withTransaction, type Selectable, type Updateable } from '@caiwu/db';
import { BusinessError, notFound } from '../../errors';
import {
  DIMENSION_TYPES,
  dimensionName,
  type DimensionTypeId,
  type DimensionValues,
} from '../../dimensions';
import { normalizeRows } from '../../rows';
import { Decimal } from '../../decimal';
import { qtyFromE6, qtyToE6 } from '../../decimal';
import { formatMoney } from '../../money';
import { formatPeriod, periodOfDate, type Period } from '../../period';
import { sourceRoute } from '../../manifest';
import {
  VOUCHER_STATUS_LABELS,
  VoucherFilterSchema,
  VoucherInputSchema,
  formatVoucherNo,
  type Voucher,
  type VoucherFilter,
  type VoucherHeader,
  type VoucherInput,
  type VoucherLine,
  type VoucherStatus,
} from '../../voucher';
import type { Account, DimensionItem } from '../../account';
import type { CoreDB } from '../schema';
import { nowIso, type ServiceContext } from '../context';
import { accountService } from './accounts';
import { logService, periodService } from './basic';

type VoucherRow = Selectable<CoreDB['voucher']>;
type LineInsert = Omit<Selectable<CoreDB['voucher_line']>, 'id' | 'voucher_id'>;

export interface VoucherProblem {
  /** 第几行（从 1 开始）；凭证整体的问题为 0 */
  line: number;
  message: string;
}

/** 状态变更里 core 允许的方向（草稿 ↔ 待审核走 update）。 */
const STATUS_CHANGES: Partial<Record<VoucherStatus, readonly VoucherStatus[]>> = {
  pending: ['audited'],
  audited: ['pending', 'posted'],
  posted: ['audited'],
};

function invalid(problems: VoucherProblem[]): BusinessError {
  const first = problems[0]!;
  const prefix = first.line > 0 ? `第${first.line}行：` : '';
  const more = problems.length > 1 ? `（另有 ${problems.length - 1} 处问题）` : '';
  return new BusinessError({
    code: 'VOUCHER_INVALID',
    message: `${prefix}${first.message}${more}`,
    hint: '改正后再保存；如果只是暂时没填完，可以先存为草稿',
    details: { problems },
  });
}

export function voucherService(ctx: ServiceContext) {
  const periods = periodService(ctx);
  const accounts = accountService(ctx);
  const log = logService(ctx);

  const moduleName = (id: string) => ctx.modules.manifest(id)?.name ?? id;

  /** 由其它模块生成的凭证，只能由该模块修改、删除、作废。 */
  const assertCanModify = async (row: VoucherRow, action: string) => {
    if (
      row.created_by !== ctx.user.id &&
      !(await voucherPolicyService(ctx).get()).allowModifyOthers
    )
      throw new BusinessError({
        code: 'VOUCHER_OTHER_AUTHOR',
        message: `凭证 ${await displayNo(row)} 由其他操作员编制，当前账套禁止互相修改`,
        hint: '请原制单人处理，或由管理员在账套信息修改策略',
      });
    if (row.source_module && row.source_module !== ctx.moduleId) {
      const manifest = ctx.modules.manifest(row.source_module);
      const to =
        manifest && row.source_type && row.source_id
          ? sourceRoute(manifest, row.source_type, row.source_id)
          : null;
      throw new BusinessError({
        code: 'VOUCHER_FROM_SOURCE',
        message: `这张凭证由「${moduleName(row.source_module)}」生成，不能在这里${action}`,
        hint: `请到「${moduleName(row.source_module)}」中修改或删除对应单据，凭证会跟着变化`,
        actions: to ? [{ label: '查看来源单据', to }] : [],
      });
    }
  };

  const loadRow = async (id: number): Promise<VoucherRow> => {
    const row = (await ctx.db
      .selectFrom('voucher')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()) as VoucherRow | undefined;
    if (!row) throw notFound('凭证', id);
    return row;
  };

  const displayNo = async (row: VoucherRow) => {
    const t = await ctx.db
      .selectFrom('voucher_type')
      .select('code')
      .where('id', '=', row.voucher_type_id)
      .executeTakeFirst();
    return formatVoucherNo(t?.code ?? '?', row.number);
  };

  const checkRevision = (row: VoucherRow, expected: number | undefined, action: string) => {
    if (expected != null && row.revision !== expected) {
      throw new BusinessError({
        code: 'VOUCHER_STALE',
        message: `这张凭证已经被别人（或另一个窗口）改过了，不能${action}`,
        hint: '刷新后重新打开凭证，确认内容后再操作',
      });
    }
  };

  /** 校验并规范化分录。草稿只做最基本的检查。 */
  const prepareLines = async (
    input: ReturnType<typeof VoucherInputSchema.parse>,
    period: Period,
    historicalLines?: VoucherLine[],
  ) => {
    const draft = input.draft;
    const problems: VoucherProblem[] = [];
    const reversal = input.reversalOfId != null ? await self.get(input.reversalOfId) : null;
    if (input.reversalOfId != null && !reversal) throw notFound('被冲销凭证', input.reversalOfId);
    const normalized = normalizeRows(input.lines);
    const lines = draft ? normalized.rows.filter((l) => l.accountId != null) : normalized.rows;

    if (!draft && lines.length < 2) problems.push({ line: 0, message: '凭证至少要有两行分录' });
    if (reversal && reversal.lines.length !== lines.length)
      problems.push({ line: 0, message: '冲销凭证必须完整保留原凭证的全部分录' });

    const accountIds = [
      ...new Set(lines.map((l) => l.accountId).filter((x): x is number => x != null)),
    ];
    const accountList = await Promise.all(accountIds.map((id) => accounts.get(id)));
    const accountMap = new Map(
      accountList.filter((a): a is Account => a != null).map((a) => [a.id, a]),
    );

    const itemIds = new Set<number>();
    for (const l of lines)
      for (const v of Object.values(l.dimensions)) if (v != null) itemIds.add(v);
    // 默认项也走下面的类型、停用和末级检查，不能只预加载显式输入。
    for (const account of accountMap.values())
      for (const d of account.dimensions) if (d.defaultItemId != null) itemIds.add(d.defaultItemId);
    const itemRows = itemIds.size
      ? await ctx.db
          .selectFrom('dimension_item')
          .selectAll()
          .where('id', 'in', [...itemIds])
          .execute()
      : [];
    const itemMap = new Map(itemRows.map((r) => [r.id, r]));

    // 只在保存入口核验当前可用性；历史 get/账簿和原有状态流程仍保留已存引用。
    const currencyCodes = [
      ...new Set([...accountMap.values()].flatMap((a) => (a.currency ? [a.currency] : []))),
    ];
    const currencyRows = currencyCodes.length
      ? await ctx.db
          .selectFrom('currency')
          .select(['code', 'name', 'disabled'])
          .where('code', 'in', currencyCodes)
          .execute()
      : [];
    const currencyMap = new Map(currencyRows.map((r) => [r.code, r]));
    const methodIds = [
      ...new Set(
        lines.flatMap((l) => (l.settlementMethodId != null ? [l.settlementMethodId] : [])),
      ),
    ];
    const methodRows = methodIds.length
      ? await ctx.db
          .selectFrom('settlement_method')
          .select(['id', 'code', 'name', 'disabled'])
          .where('id', 'in', methodIds)
          .execute()
      : [];
    const methodMap = new Map(methodRows.map((r) => [r.id, r]));

    const prepared: LineInsert[] = [];
    let debitSum = 0n;
    let creditSum = 0n;

    lines.forEach((l, idx) => {
      const n = normalized.rowNumbers[normalized.rows.indexOf(l)] ?? idx + 1;
      const add = (message: string) => problems.push({ line: n, message });
      const account = l.accountId != null ? accountMap.get(l.accountId) : undefined;
      if (l.accountId == null) {
        add('没有选择科目');
        return;
      }
      if (!account) {
        add(`科目（id ${l.accountId}）不存在`);
        return;
      }
      const label = `科目 ${account.code} ${account.name}`;
      if (!account.isLeaf) add(`${label} 不是末级科目，请选择它的下级科目`);
      if (account.disabled) add(`${label} 已停用`);
      if (!draft && !l.summary) add('摘要不能为空');

      const debit = l.debit ?? 0;
      const credit = l.credit ?? 0;
      if (debit !== 0 && credit !== 0) add('同一行不能同时有借方和贷方金额');
      const entrySide = debit !== 0 ? 'debit' : credit !== 0 ? 'credit' : (l.entrySide ?? null);
      if (l.entrySide && entrySide !== l.entrySide) add('借贷方向与金额栏不一致');
      const hasDimensionAmount =
        (l.fcAmount != null && l.fcAmount !== 0) ||
        (l.quantity != null && !new Decimal(l.quantity).isZero());
      if (!draft && debit === 0 && credit === 0 && !hasDimensionAmount)
        add('本币、外币和数量均为 0');
      if (!draft && !entrySide) add('零本币分录必须明确选择借方或贷方');
      if (l.exchangeRate != null && !new Decimal(l.exchangeRate).isPositive())
        add('汇率必须大于 0');
      debitSum += BigInt(debit);
      creditSum += BigInt(credit);

      // 辅助核算
      const dims: DimensionValues = {};
      for (const dt of DIMENSION_TYPES) {
        const type = dt.id as DimensionTypeId;
        let value = l.dimensions[type] ?? null;
        const config = account.dimensions.find((d) => d.type === type);
        if (type !== 'cashflow') {
          if (!config && value != null) {
            add(`${label} 没有启用${dimensionName(type)}核算，不能填写${dimensionName(type)}`);
            value = null;
          }
          if (config && value == null && config.defaultItemId != null) value = config.defaultItemId;
          if (!draft && config?.required && value == null)
            add(`${label} 需要填写${dimensionName(type)}`);
        }
        if (value != null) {
          const item = itemMap.get(value);
          if (!item || item.type_id !== type) add(`${dimensionName(type)}（id ${value}）不存在`);
          else if (item.disabled) add(`${dimensionName(type)} ${item.code} ${item.name} 已停用`);
          else if (!item.is_leaf)
            add(`${dimensionName(type)} ${item.code} ${item.name} 不是末级，请选择它的下级`);
        }
        dims[type] = value;
      }

      const previousLine = historicalLines?.[idx];
      let cashflowDirection =
        l.cashflowDirection === undefined && previousLine
          ? (previousLine.cashflowDirection ?? null)
          : (l.cashflowDirection ?? null);
      const cashflowItem = dims.cashflow != null ? itemMap.get(dims.cashflow) : undefined;
      const configuredDirection = cashflowItem
        ? (JSON.parse(cashflowItem.attrs) as Record<string, unknown>).cashflowDirection
        : null;
      if (
        configuredDirection != null &&
        !['inflow', 'outflow', 'internal'].includes(String(configuredDirection))
      )
        add('现金流量项目方向无效，请先维护项目');
      const cashAccount = account.isCash || account.isBank || account.cashflowRequired;
      if (!cashAccount && l.cashflowDirection != null)
        add('非现金银行科目没有启用现金流量核算，不能填写现金流量项目或方向');
      if (cashflowDirection && !dims.cashflow) add('选择现金流量方向前需要选择项目');
      if (cashflowDirection && configuredDirection && cashflowDirection !== configuredDirection)
        add('现金流量方向与项目设置不一致');
      if (
        l.cashflowDirection === undefined &&
        !previousLine &&
        cashAccount &&
        !cashflowDirection &&
        ['inflow', 'outflow', 'internal'].includes(String(configuredDirection))
      )
        cashflowDirection = configuredDirection as typeof cashflowDirection;
      const reversalLine = reversal?.lines[idx];
      if (
        reversal &&
        (!reversalLine ||
          reversalLine.accountId !== l.accountId ||
          (reversalLine.currency ?? null) !== (l.currency ?? null) ||
          (reversalLine.exchangeRate ?? null) !== (l.exchangeRate ?? null) ||
          (reversalLine.unitPrice ?? null) !== (l.unitPrice ?? null) ||
          DIMENSION_TYPES.some(
            (type) => (reversalLine.dimensions[type.id] ?? null) !== (dims[type.id] ?? null),
          ) ||
          reversalLine.debit !== -debit ||
          reversalLine.credit !== -credit ||
          (reversalLine.fcAmount == null
            ? l.fcAmount != null
            : l.fcAmount !== -reversalLine.fcAmount) ||
          (reversalLine.quantity == null
            ? l.quantity != null
            : l.quantity == null ||
              !new Decimal(l.quantity).eq(new Decimal(reversalLine.quantity).negated())))
      )
        add('冲销分录必须逐行保留原凭证的科目、借贷、原币和数量并反号');
      const flowNet = (debit - credit) * (reversal ? -1 : 1);
      if (cashflowDirection === 'inflow' && flowNet < 0) add('现金流入项目不能填写现金减少额');
      if (cashflowDirection === 'outflow' && flowNet > 0) add('现金流出项目不能填写现金增加额');
      // 外币
      let currency = l.currency ?? null;
      if (account.currency) {
        if (currency && currency !== account.currency)
          add(`${label} 只核算 ${account.currency}，不能用 ${currency}`);
        currency = account.currency;
        if (!draft && (l.exchangeRate == null || l.fcAmount == null))
          add(`${label} 是外币科目，需要填写汇率和外币金额`);
      } else {
        if (currency && currency !== 'CNY') add(`${label} 没有启用外币核算`);
        if (l.fcAmount != null || l.exchangeRate != null) {
          if (currency == null || currency === 'CNY') {
            if (l.fcAmount != null && l.fcAmount !== 0)
              add(`${label} 没有启用外币核算，不能填外币金额`);
          }
        }
        currency = null;
      }
      if (currency) {
        const item = currencyMap.get(currency);
        if (!item) add(`币种 ${currency} 不存在，请先维护币种或改用有效科目`);
        else if (item.disabled)
          add(`币种 ${item.code} ${item.name} 已停用，请先重新启用币种或改用有效科目`);
      }
      if (l.settlementMethodId != null) {
        const method = methodMap.get(l.settlementMethodId);
        if (!method) add(`结算方式（id ${l.settlementMethodId}）不存在，请改选有效结算方式`);
        else if (method.disabled)
          add(`结算方式 ${method.code} ${method.name} 已停用，请改选可用方式或重新启用`);
      }

      // 数量
      if (account.quantityUnit) {
        if (!draft && (l.quantity == null || l.quantity === ''))
          add(`${label} 是数量核算科目，需要填写数量`);
      } else if (l.quantity != null && Number(l.quantity) !== 0) {
        add(`${label} 没有启用数量核算，不能填数量`);
      }

      prepared.push({
        cashflow_direction: cashflowDirection,
        entry_side: entrySide,
        line_no: n,
        period,
        summary: l.summary ?? '',
        account_id: account.id,
        dim_project: dims.project ?? null,
        dim_partner: dims.partner ?? null,
        dim_department: dims.department ?? null,
        dim_person: dims.person ?? null,
        dim_cashflow: dims.cashflow ?? null,
        currency_code: currency,
        exchange_rate: currency ? (l.exchangeRate ?? null) : null,
        fc_amount: currency ? (l.fcAmount ?? null) : null,
        quantity_e6: account.quantityUnit && l.quantity ? qtyToE6(l.quantity) : null,
        unit_price: account.quantityUnit ? (l.unitPrice ?? null) : null,
        debit,
        credit,
        settlement_method_id: l.settlementMethodId ?? null,
        ref_no: l.refNo ?? null,
        biz_date: l.bizDate ?? null,
      });
    });

    const debitTotal = Number(debitSum);
    const creditTotal = Number(creditSum);
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal))
      problems.push({ line: 0, message: '凭证借方或贷方合计超出安全整数范围' });

    if (!draft && problems.length === 0) {
      if (debitTotal !== creditTotal) {
        const delta = Number(debitSum - creditSum);
        const difference = Number.isSafeInteger(delta) ? formatMoney(delta) : '超出安全整数范围';
        problems.push({
          line: 0,
          message: `借贷不平衡：借方合计 ${formatMoney(debitTotal)}，贷方合计 ${formatMoney(creditTotal)}，差额 ${difference}`,
        });
      }
    }
    const internalNet = prepared
      .filter((l) => {
        const account = accountMap.get(l.account_id);
        return (
          l.cashflow_direction === 'internal' &&
          (account?.isCash || account?.isBank || account?.cashflowRequired)
        );
      })
      .reduce((total, l) => total + BigInt(l.debit) - BigInt(l.credit), 0n);
    if (!draft && internalNet !== 0n)
      problems.push({ line: 0, message: '本张凭证内部现金转移未配平' });
    if (problems.length) throw invalid(problems);
    return { lines: prepared, debitTotal, creditTotal };
  };

  const checkType = async (voucherTypeId: number) => {
    const t = await ctx.db
      .selectFrom('voucher_type')
      .selectAll()
      .where('id', '=', voucherTypeId)
      .executeTakeFirst();
    if (!t) throw notFound('凭证类型', voucherTypeId);
    if (t.disabled)
      throw new BusinessError({
        code: 'VOUCHER_TYPE_DISABLED',
        message: `凭证类型「${t.name}」已停用`,
      });
    return t;
  };

  const assignNumber = async (
    period: Period,
    voucherTypeId: number,
    wanted: number | null | undefined,
    selfId?: number,
  ) => {
    const policy = await voucherPolicyService(ctx).get();
    if (policy.numbering === 'manual' && wanted == null)
      throw new BusinessError({
        code: 'VOUCHER_NUMBER_REQUIRED',
        message: `${formatPeriod(period)}采用手工编号，请输入正整数凭证号`,
      });
    if (wanted != null && (!Number.isSafeInteger(wanted) || wanted <= 0))
      throw new BusinessError({ code: 'VOUCHER_NUMBER_INVALID', message: '凭证编号必须是正整数' });
    if (policy.numbering === 'automatic' && wanted != null) {
      const current = selfId == null ? null : await loadRow(selfId);
      const unchanged =
        current?.period === period &&
        current.voucher_type_id === voucherTypeId &&
        current.number === wanted;
      const next = await self.nextNumber(period, voucherTypeId);
      const existingNumber =
        current?.period === period &&
        current.voucher_type_id === voucherTypeId &&
        current.number != null;
      if (!unchanged && (existingNumber || wanted !== next))
        throw new BusinessError({
          code: 'VOUCHER_NUMBER_AUTOMATIC',
          message: existingNumber
            ? `${formatPeriod(period)}凭证 ${await displayNo(current!)} 采用自动编号，普通保存不能改号`
            : `${formatPeriod(period)}采用自动编号，当前下一个编号为 ${next}，不能指定 ${wanted}`,
          hint: existingNumber
            ? '请保留原编号；确需改号时先预览编号整理并明确确认'
            : '清空凭证号后重新保存；需要沿用历史编号时，请管理员明确改为手工编号',
        });
    }
    if (wanted != null) {
      let q = ctx.db
        .selectFrom('voucher')
        .select('id')
        .where('period', '=', period)
        .where('voucher_type_id', '=', voucherTypeId)
        .where('number', '=', wanted);
      if (selfId != null) q = q.where('id', '!=', selfId);
      if (await q.executeTakeFirst()) {
        throw new BusinessError({
          code: 'VOUCHER_NUMBER_TAKEN',
          message: `${formatPeriod(period)}已经有编号为 ${wanted} 的凭证`,
          hint: '不填编号会自动取下一个可用编号',
        });
      }
      return wanted;
    }
    return self.nextNumber(period, voucherTypeId);
  };

  const self = {
    /** 某期间某类型的下一个凭证编号（当前最大编号 + 1）。 */
    async nextNumber(period: Period, voucherTypeId: number): Promise<number> {
      const r = await ctx.db
        .selectFrom('voucher')
        .select((eb) => eb.fn.max('number').as('max'))
        .where('period', '=', period)
        .where('voucher_type_id', '=', voucherTypeId)
        .executeTakeFirst();
      return (Number(r?.max) || 0) + 1;
    },

    /**
     * 新增凭证。正式保存（draft=false）时完整校验并分配编号，状态为"待审核"；草稿不校验平衡、不分配编号。
     * 业务模块生成凭证时填 source，凭证就归该模块管理。
     */
    async create(raw: VoucherInput): Promise<Voucher> {
      const input = VoucherInputSchema.parse(raw);
      if (input.source && !ctx.moduleId) {
        throw new Error('只有业务模块可以生成带来源单据的凭证（ServiceContext.moduleId 为空）');
      }
      if (!ctx.db.isTransaction) {
        return withTransaction(ctx.db, (db) => voucherService({ ...ctx, db }).create(input));
      }
      const period = periodOfDate(input.date);
      await periods.assertOpen(period, '保存凭证');
      await checkType(input.voucherTypeId);
      if (input.reversalOfId != null) await loadRow(input.reversalOfId);
      const { lines, debitTotal, creditTotal } = await prepareLines(input, period);
      const number = input.draft
        ? null
        : await assignNumber(period, input.voucherTypeId, input.number);
      const now = nowIso(ctx);
      const { id } = await ctx.db
        .insertInto('voucher')
        .values({
          period,
          voucher_type_id: input.voucherTypeId,
          number,
          date: input.date,
          attachments: input.attachments,
          status: input.draft ? 'draft' : 'pending',
          voided: 0,
          reversal_of_id: input.reversalOfId ?? null,
          source_module: input.source ? ctx.moduleId : null,
          source_type: input.source?.type ?? null,
          source_id: input.source?.id ?? null,
          closing_kind: input.closingKind ?? null,
          note: input.note ?? null,
          debit_total: debitTotal,
          credit_total: creditTotal,
          created_by: ctx.user.id,
          created_at: now,
          updated_by: ctx.user.id,
          updated_at: now,
          audited_by: null,
          audited_at: null,
          posted_by: null,
          posted_at: null,
          revision: 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (lines.length) {
        await ctx.db
          .insertInto('voucher_line')
          .values(lines.map((l) => ({ ...l, voucher_id: id })))
          .execute();
      }
      const v = (await self.get(id))!;
      await log.write({
        action: 'voucher.create',
        summary: `新增${input.draft ? '草稿' : ''}凭证 ${v.displayNo}（${formatPeriod(period)}）`,
        targetType: 'voucher',
        targetId: id,
      });
      return v;
    },

    /**
     * 修改凭证。只有草稿和待审核的凭证能改；必须带上打开时的 revision（防止覆盖别人的修改）。
     * 草稿改成正式（draft=false）时分配编号。
     */
    async update(
      id: number,
      raw: VoucherInput,
      opts: { expectedRevision: number },
    ): Promise<Voucher> {
      const input = VoucherInputSchema.parse(raw);
      if (!ctx.db.isTransaction) {
        return withTransaction(ctx.db, (db) =>
          voucherService({ ...ctx, db }).update(id, input, opts),
        );
      }
      {
        const db = ctx.db;
        const tsvc = self;
        const tperiods = periods;
        const row = await loadRow(id);
        await assertCanModify(row, '修改');
        checkRevision(row, opts.expectedRevision, '保存');
        if (row.voided)
          throw new BusinessError({ code: 'VOUCHER_VOIDED', message: '已作废的凭证不能修改' });
        if (row.status !== 'draft' && row.status !== 'pending') {
          throw new BusinessError({
            code: 'VOUCHER_LOCKED',
            message: `${VOUCHER_STATUS_LABELS[row.status]}的凭证不能修改`,
            hint: row.status === 'audited' ? '先取消审核再修改' : '先反过账、取消审核再修改',
          });
        }
        const period = periodOfDate(input.date);
        await tperiods.assertOpen(row.period, '修改凭证');
        await tperiods.assertOpen(period, '保存凭证');
        await checkType(input.voucherTypeId);
        const { lines, debitTotal, creditTotal } = await prepareLines(
          { ...input, reversalOfId: input.reversalOfId ?? row.reversal_of_id },
          period,
          (await tsvc.get(id))!.lines,
        );
        let number: number | null = null;
        if (!input.draft) {
          const sameGroup = row.period === period && row.voucher_type_id === input.voucherTypeId;
          number =
            input.number != null
              ? await assignNumber(period, input.voucherTypeId, input.number, id)
              : sameGroup && row.number != null
                ? row.number
                : await assignNumber(period, input.voucherTypeId, input.number, id);
        }
        await db
          .updateTable('voucher')
          .set({
            period,
            voucher_type_id: input.voucherTypeId,
            number,
            date: input.date,
            attachments: input.attachments,
            status: input.draft ? 'draft' : 'pending',
            note: input.note ?? null,
            closing_kind: input.closingKind ?? row.closing_kind,
            reversal_of_id: input.reversalOfId ?? row.reversal_of_id,
            debit_total: debitTotal,
            credit_total: creditTotal,
            updated_by: ctx.user.id,
            updated_at: nowIso(ctx),
            revision: row.revision + 1,
          })
          .where('id', '=', id)
          .execute();
        await db.deleteFrom('voucher_line').where('voucher_id', '=', id).execute();
        if (lines.length) {
          await db
            .insertInto('voucher_line')
            .values(lines.map((l) => ({ ...l, voucher_id: id })))
            .execute();
        }
        const v = (await tsvc.get(id))!;
        await log.write({
          action: 'voucher.update',
          summary: `修改凭证 ${v.displayNo}（${formatPeriod(period)}）`,
          targetType: 'voucher',
          targetId: id,
        });
        return v;
      }
    },

    async previewDelete(ids: number[], expiresAt = ctx.now().getTime() + 300_000) {
      if (expiresAt <= ctx.now().getTime() || expiresAt > ctx.now().getTime() + 300_000)
        throw new BusinessError({
          code: 'VOUCHER_STALE',
          message: '删除预览已过期或期限无效，请重新预览',
        });
      const unique = [...new Set(ids)].sort((a, b) => a - b);
      if (unique.length !== ids.length || !ids.length)
        throw new BusinessError({
          code: 'VOUCHER_SELECTION_INVALID',
          message: '请选择不重复的凭证',
        });
      const policy = await voucherPolicyService(ctx).get();
      const targets = await Promise.all(unique.map(loadRow));
      for (const row of targets) {
        await assertCanModify(row, '删除');
        await periods.assertOpen(row.period, '删除凭证');
        if (row.status !== 'draft' && row.status !== 'pending')
          throw new BusinessError({
            code: 'VOUCHER_LOCKED',
            message: `凭证 ${await displayNo(row)} 已审核或过账，不能删除`,
          });
      }
      const affected: VoucherRow[] = [];
      if (policy.renumberAfterDelete)
        for (const group of new Map(
          targets.map((r) => [`${r.period}:${r.voucher_type_id}`, r]),
        ).values()) {
          const rows = await ctx.db
            .selectFrom('voucher')
            .selectAll()
            .where('period', '=', group.period)
            .where('voucher_type_id', '=', group.voucher_type_id)
            .where('number', 'is not', null)
            .orderBy('number')
            .execute();
          for (const row of rows) {
            await assertCanModify(row, '删除后重排');
            affected.push(row);
          }
        }
      const fingerprint = await confirmationFingerprint(ctx, 'voucher.delete', {
        targets,
        affected,
        policy,
        expiresAt,
      });
      return {
        ids: unique,
        expiresAt,
        fingerprint,
        renumber: policy.renumberAfterDelete,
        impacts: affected
          .filter((r) => !unique.includes(r.id))
          .map((row, _i, rows) => ({
            id: row.id,
            oldNumber: row.number,
            number: rows.filter(
              (r) =>
                r.period === row.period &&
                r.voucher_type_id === row.voucher_type_id &&
                (r.number! < row.number! || (r.number === row.number && r.id <= row.id)),
            ).length,
          })),
      };
    },
    async deleteBatch(
      plan: { ids: number[]; expiresAt: number; fingerprint: string },
      confirmed: boolean,
    ): Promise<void> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) =>
          voucherService({ ...ctx, db }).deleteBatch(plan, confirmed),
        );
      if (!confirmed)
        throw new BusinessError({
          code: 'CONFIRM_REQUIRED',
          message: '请先确认凭证删除及编号影响',
        });
      const current = await self.previewDelete(plan.ids, plan.expiresAt);
      if (ctx.now().getTime() >= plan.expiresAt || current.fingerprint !== plan.fingerprint)
        throw new BusinessError({ code: 'VOUCHER_STALE', message: '凭证或编号已变化，请重新预览' });
      for (const id of plan.ids) {
        const row = await loadRow(id);
        await ctx.db.deleteFrom('voucher').where('id', '=', id).execute();
        await log.write({
          action: 'voucher.delete',
          summary: `删除凭证 ${await displayNo(row)}`,
          targetId: id,
        });
      }
      if (current.impacts.length) {
        const numbers = await self.previewNumbers(current.impacts);
        await self.setNumbers(current.impacts, { plan: numbers, confirmed: true });
      }
    },

    /** 删除凭证。只能删草稿和待审核的凭证。删除后编号会空出来（断号由凭证整理功能处理）。 */
    async delete(id: number, opts: { expectedRevision?: number } = {}): Promise<void> {
      if (!ctx.db.isTransaction) {
        return withTransaction(ctx.db, (db) => voucherService({ ...ctx, db }).delete(id, opts));
      }
      {
        const db = ctx.db;
        if ((await voucherPolicyService(ctx).get()).renumberAfterDelete)
          throw new BusinessError({
            code: 'VOUCHER_DELETE_CONFIRM',
            message: '删除后将重排编号，请先预览并明确确认',
            hint: '使用凭证删除预览后再执行整批删除',
          });
        const row = await loadRow(id);
        await assertCanModify(row, '删除');
        checkRevision(row, opts.expectedRevision, '删除');
        if (row.status !== 'draft' && row.status !== 'pending') {
          throw new BusinessError({
            code: 'VOUCHER_LOCKED',
            message: `${VOUCHER_STATUS_LABELS[row.status]}的凭证不能删除`,
            hint: row.status === 'audited' ? '先取消审核再删除' : '先反过账、取消审核再删除',
          });
        }
        await periods.assertOpen(row.period, '删除凭证');
        const no = await displayNo(row);
        await db.deleteFrom('voucher').where('id', '=', id).execute();
        await log.write({
          action: 'voucher.delete',
          summary: `删除凭证 ${no}（${formatPeriod(row.period)}）`,
          targetType: 'voucher',
          targetId: id,
        });
      }
    },

    /**
     * 统一的状态变更入口：审核（pending→audited）、取消审核（audited→pending）、
     * 过账（audited→posted）、反过账（posted→audited）。
     * 全部成功或全部不变。审核人不能是制单人等业务规则由凭证管理、期末处理模块在调用前检查。
     */
    async changeStatus(input: {
      ids: number[];
      to: 'pending' | 'audited' | 'posted';
    }): Promise<number> {
      if (input.ids.length === 0) return 0;
      if (!ctx.db.isTransaction) {
        return withTransaction(ctx.db, (db) => voucherService({ ...ctx, db }).changeStatus(input));
      }
      {
        const db = ctx.db;
        const tperiods = periods;
        const rows = (await db
          .selectFrom('voucher')
          .selectAll()
          .where('id', 'in', input.ids)
          .execute()) as VoucherRow[];
        const found = new Set(rows.map((r) => r.id));
        const missing = input.ids.filter((id) => !found.has(id));
        if (missing.length) throw notFound('凭证', missing.join(','));
        const now = nowIso(ctx);
        for (const row of rows) {
          const no = await displayNo(row);
          if (row.voided) {
            throw new BusinessError({
              code: 'VOUCHER_VOIDED',
              message: `凭证 ${no} 已作废，不能改变状态`,
            });
          }
          if (!(STATUS_CHANGES[row.status] ?? []).includes(input.to)) {
            throw new BusinessError({
              code: 'VOUCHER_STATUS_INVALID',
              message: `凭证 ${no} 是${VOUCHER_STATUS_LABELS[row.status]}，不能改成${VOUCHER_STATUS_LABELS[input.to]}`,
            });
          }
          await tperiods.assertOpen(row.period, '改变凭证状态');
          const set: Updateable<CoreDB['voucher']> = {
            status: input.to,
            revision: row.revision + 1,
            updated_at: now,
          };
          if (input.to === 'audited' && row.status === 'pending')
            Object.assign(set, { audited_by: ctx.user.id, audited_at: now });
          if (input.to === 'pending') Object.assign(set, { audited_by: null, audited_at: null });
          if (input.to === 'posted') Object.assign(set, { posted_by: ctx.user.id, posted_at: now });
          if (input.to === 'audited' && row.status === 'posted')
            Object.assign(set, { posted_by: null, posted_at: null });
          await db.updateTable('voucher').set(set).where('id', '=', row.id).execute();
        }
        await log.write({
          action: `voucher.status.${input.to}`,
          summary: `${rows.length} 张凭证改为${VOUCHER_STATUS_LABELS[input.to]}`,
          targetType: 'voucher',
          targetId: rows.length === 1 ? rows[0]!.id : undefined,
          detail: { ids: input.ids },
        });
        return rows.length;
      }
    },

    /** 作废 / 取消作废。已过账的凭证不能作废。作废凭证保留编号但不进账表。 */
    async setVoided(
      id: number,
      voided: boolean,
      opts: { expectedRevision?: number } = {},
    ): Promise<Voucher> {
      if (!ctx.db.isTransaction) {
        return withTransaction(ctx.db, (db) =>
          voucherService({ ...ctx, db }).setVoided(id, voided, opts),
        );
      }
      {
        const db = ctx.db;
        const row = await loadRow(id);
        await assertCanModify(row, voided ? '作废' : '取消作废');
        checkRevision(row, opts.expectedRevision, voided ? '作废' : '取消作废');
        if (row.status === 'posted') {
          throw new BusinessError({
            code: 'VOUCHER_LOCKED',
            message: '已过账的凭证不能作废',
            hint: '先反过账',
          });
        }
        if (row.status === 'draft') {
          throw new BusinessError({
            code: 'VOUCHER_DRAFT',
            message: '草稿不需要作废，直接删除即可',
          });
        }
        await periods.assertOpen(row.period, voided ? '作废凭证' : '取消作废');
        await db
          .updateTable('voucher')
          .set({
            voided: voided ? 1 : 0,
            revision: row.revision + 1,
            updated_at: nowIso(ctx),
            updated_by: ctx.user.id,
          })
          .where('id', '=', id)
          .execute();
        await log.write({
          action: voided ? 'voucher.void' : 'voucher.unvoid',
          summary: `${voided ? '作废' : '取消作废'}凭证 ${await displayNo(row)}`,
          targetType: 'voucher',
          targetId: id,
        });
        return (await self.get(id))!;
      }
    },

    /**
     * 批量改凭证编号（断号整理用）。同一期间同一类型内编号必须唯一。
     */
    async previewNumbers(
      updates: { id: number; number: number }[],
      expiresAt = ctx.now().getTime() + 300_000,
    ) {
      if (expiresAt <= ctx.now().getTime() || expiresAt > ctx.now().getTime() + 300_000)
        throw new BusinessError({
          code: 'VOUCHER_STALE',
          message: '编号预览已过期或期限无效，请重新预览',
        });
      if (!updates.length || new Set(updates.map((u) => u.id)).size !== updates.length)
        throw new BusinessError({
          code: 'VOUCHER_SELECTION_INVALID',
          message: '请选择不重复的凭证并填写目标编号',
        });
      const rows = await Promise.all(updates.map((u) => loadRow(u.id)));
      for (const row of rows) {
        await assertCanModify(row, '调整凭证编号');
        await periods.assertOpen(row.period, '调整凭证编号');
        if (row.status !== 'pending')
          throw new BusinessError({
            code: 'VOUCHER_LOCKED',
            message: `凭证 ${await displayNo(row)} 不是待审核状态，不能调整编号`,
          });
      }
      const groups = new Map(rows.map((r) => [`${r.period}:${r.voucher_type_id}`, r]));
      const all: VoucherRow[] = [];
      for (const row of groups.values())
        all.push(
          ...(await ctx.db
            .selectFrom('voucher')
            .selectAll()
            .where('period', '=', row.period)
            .where('voucher_type_id', '=', row.voucher_type_id)
            .orderBy('id')
            .execute()),
        );
      for (const row of rows) {
        const wanted = updates.find((u) => u.id === row.id)!.number;
        if (!Number.isSafeInteger(wanted) || wanted <= 0)
          throw new BusinessError({
            code: 'VOUCHER_NUMBER_INVALID',
            message: '凭证编号必须是正整数',
          });
        if (
          all.some(
            (other) =>
              other.id !== row.id &&
              other.period === row.period &&
              other.voucher_type_id === row.voucher_type_id &&
              (updates.find((u) => u.id === other.id)?.number ?? other.number) === wanted,
          )
        )
          throw new BusinessError({
            code: 'VOUCHER_NUMBER_TAKEN',
            message: `${formatPeriod(row.period)}目标凭证编号 ${wanted} 重复，请重新预览`,
          });
      }
      const fingerprint = await confirmationFingerprint(ctx, 'voucher.renumber', {
        updates,
        all,
        policy: await voucherPolicyService(ctx).get(),
        expiresAt,
      });
      return {
        updates,
        fingerprint,
        expiresAt,
        impacts: rows.map((row) => ({
          id: row.id,
          oldNumber: row.number,
          number: updates.find((u) => u.id === row.id)!.number,
        })),
      };
    },
    async setNumbers(
      updates: { id: number; number: number }[],
      confirmation?: { confirmed: boolean; plan: { fingerprint: string; expiresAt: number } },
    ): Promise<void> {
      if (!updates.length) return;
      if (!ctx.db.isTransaction) {
        return withTransaction(ctx.db, (db) =>
          voucherService({ ...ctx, db }).setNumbers(updates, confirmation),
        );
      }
      {
        const db = ctx.db;
        const rows = (await db
          .selectFrom('voucher')
          .selectAll()
          .where(
            'id',
            'in',
            updates.map((u) => u.id),
          )
          .execute()) as VoucherRow[];
        if (rows.length !== updates.length)
          throw notFound('凭证', updates.map((u) => u.id).join(','));
        for (const r of rows) {
          await assertCanModify(r, '调整凭证编号');
          if (r.status === 'draft')
            throw new BusinessError({ code: 'VOUCHER_DRAFT', message: '草稿没有编号' });
          if (
            !Number.isSafeInteger(updates.find((u) => u.id === r.id)!.number) ||
            updates.find((u) => u.id === r.id)!.number <= 0
          )
            throw new BusinessError({
              code: 'VOUCHER_NUMBER_INVALID',
              message: '凭证编号必须是正整数',
            });
          await periods.assertOpen(r.period, '调整凭证编号');
        }
        const current = await self.previewNumbers(updates, confirmation?.plan.expiresAt);
        if (!confirmation?.confirmed)
          throw new BusinessError({
            code: 'VOUCHER_NUMBER_CONFIRM',
            message: '请先预览编号影响，并明确确认已打印凭证及账册可能失配',
          });
        if (
          ctx.now().getTime() >= confirmation.plan.expiresAt ||
          current.fingerprint !== confirmation.plan.fingerprint
        )
          throw new BusinessError({
            code: 'VOUCHER_STALE',
            message: '凭证、编号或策略已变化，请重新预览并确认',
          });
        // 先改成负数避开唯一索引冲突，再改成目标编号
        for (const u of updates)
          await db
            .updateTable('voucher')
            .set({ number: -u.number })
            .where('id', '=', u.id)
            .execute();
        for (const u of updates) {
          const row = rows.find((r) => r.id === u.id)!;
          await db
            .updateTable('voucher')
            .set({ number: u.number, revision: row.revision + 1, updated_at: nowIso(ctx) })
            .where('id', '=', u.id)
            .execute();
        }
        await log.write({
          action: 'voucher.renumber',
          summary: `调整 ${updates.length} 张凭证的编号`,
          targetType: 'voucher',
          detail: { updates },
        });
      }
    },

    async get(id: number): Promise<Voucher | null> {
      const [header] = await self._headers([id]);
      if (!header) return null;
      const lineRows = await ctx.db
        .selectFrom('voucher_line as l')
        .innerJoin('account as a', 'a.id', 'l.account_id')
        .selectAll('l')
        .select(['a.code as account_code', 'a.full_name as account_name'])
        .where('l.voucher_id', '=', id)
        .orderBy('l.line_no')
        .execute();
      const lines: VoucherLine[] = lineRows.map((l) => ({
        id: l.id,
        cashflowDirection: l.cashflow_direction,
        entrySide: l.entry_side,
        lineNo: l.line_no,
        summary: l.summary,
        accountId: l.account_id,
        accountCode: l.account_code,
        accountName: l.account_name,
        dimensions: {
          project: l.dim_project,
          partner: l.dim_partner,
          department: l.dim_department,
          person: l.dim_person,
          cashflow: l.dim_cashflow,
        },
        currency: l.currency_code,
        exchangeRate: l.exchange_rate,
        fcAmount: l.fc_amount,
        quantity: l.quantity_e6 == null ? null : qtyFromE6(l.quantity_e6),
        unitPrice: l.unit_price,
        debit: l.debit,
        credit: l.credit,
        settlementMethodId: l.settlement_method_id,
        refNo: l.ref_no,
        bizDate: l.biz_date,
      }));
      return { ...header, lines };
    },

    /** @internal 批量取凭证头 */
    async _headers(ids: number[]): Promise<VoucherHeader[]> {
      if (!ids.length) return [];
      const rows = await ctx.db
        .selectFrom('voucher as v')
        .innerJoin('voucher_type as t', 't.id', 'v.voucher_type_id')
        .innerJoin('app_user as cu', 'cu.id', 'v.created_by')
        .leftJoin('app_user as au', 'au.id', 'v.audited_by')
        .leftJoin('app_user as pu', 'pu.id', 'v.posted_by')
        .selectAll('v')
        .select([
          't.code as type_code',
          'cu.name as created_by_name',
          'au.name as audited_by_name',
          'pu.name as posted_by_name',
          (eb) =>
            eb
              .selectFrom('voucher_line as fl')
              .select('fl.summary')
              .whereRef('fl.voucher_id', '=', 'v.id')
              .orderBy('fl.line_no')
              .limit(1)
              .as('first_summary'),
        ])
        .where('v.id', 'in', ids)
        .execute();
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map((r) => ({
          id: r.id,
          period: r.period,
          voucherTypeId: r.voucher_type_id,
          voucherTypeCode: r.type_code,
          number: r.number,
          displayNo: formatVoucherNo(r.type_code, r.number),
          date: r.date,
          attachments: r.attachments,
          status: r.status,
          voided: r.voided === 1,
          reversalOfId: r.reversal_of_id,
          source:
            r.source_module && r.source_type && r.source_id
              ? { module: r.source_module, type: r.source_type, id: r.source_id }
              : null,
          closingKind: r.closing_kind,
          note: r.note,
          debitTotal: r.debit_total,
          creditTotal: r.credit_total,
          summary: r.first_summary ?? '',
          createdBy: { id: r.created_by, name: r.created_by_name },
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          auditedBy:
            r.audited_by != null ? { id: r.audited_by, name: r.audited_by_name ?? '' } : null,
          auditedAt: r.audited_at,
          postedBy: r.posted_by != null ? { id: r.posted_by, name: r.posted_by_name ?? '' } : null,
          postedAt: r.posted_at,
          revision: r.revision,
        }));
    },

    /** 凭证列表（只有凭证头）。按期间、凭证类型、编号排序；草稿排在最后。 */
    async list(raw: VoucherFilter = {}): Promise<{ items: VoucherHeader[]; total: number }> {
      const f = VoucherFilterSchema.parse(raw);
      let q = ctx.db
        .selectFrom('voucher as v')
        .innerJoin('voucher_type as t', 't.id', 'v.voucher_type_id');
      if (f.periodFrom != null) q = q.where('v.period', '>=', f.periodFrom);
      if (f.periodTo != null) q = q.where('v.period', '<=', f.periodTo);
      if (f.dateFrom) q = q.where('v.date', '>=', f.dateFrom);
      if (f.dateTo) q = q.where('v.date', '<=', f.dateTo);
      if (f.statuses?.length) q = q.where('v.status', 'in', f.statuses);
      if (f.voucherTypeId != null) q = q.where('v.voucher_type_id', '=', f.voucherTypeId);
      if (f.numberFrom != null) q = q.where('v.number', '>=', f.numberFrom);
      if (f.numberTo != null) q = q.where('v.number', '<=', f.numberTo);
      if (f.createdBy != null) q = q.where('v.created_by', '=', f.createdBy);
      if (f.sourceModule) q = q.where('v.source_module', '=', f.sourceModule);
      if (f.sourceType) q = q.where('v.source_type', '=', f.sourceType);
      if (f.sourceId) q = q.where('v.source_id', '=', f.sourceId);
      if (!f.includeVoided) q = q.where('v.voided', '=', 0);
      if (f.accountCode) {
        const code = f.accountCode;
        q = q.where(({ exists, selectFrom }) =>
          exists(
            selectFrom('voucher_line as l')
              .innerJoin('account as a', 'a.id', 'l.account_id')
              .select('l.id')
              .whereRef('l.voucher_id', '=', 'v.id')
              .where('a.code', 'like', `${code}%`),
          ),
        );
      }
      if (f.summaryContains) {
        const text = f.summaryContains;
        q = q.where(({ exists, selectFrom }) =>
          exists(
            selectFrom('voucher_line as l')
              .select('l.id')
              .whereRef('l.voucher_id', '=', 'v.id')
              .where('l.summary', 'like', `%${text}%`),
          ),
        );
      }
      const totalRow = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
      const idRows = await q
        .select('v.id')
        .orderBy('v.period')
        .orderBy('t.sort')
        .orderBy('t.id')
        .orderBy((eb) => eb.case().when('v.number', 'is', null).then(1).else(0).end())
        .orderBy('v.number')
        .orderBy('v.id')
        .limit(f.limit)
        .offset(f.offset)
        .execute();
      return {
        items: await self._headers(idRows.map((r) => r.id)),
        total: Number(totalRow?.n ?? 0),
      };
    },
  };
  return self;
}

export type VoucherService = ReturnType<typeof voucherService>;
export type { DimensionItem };
