import {
  BusinessError,
  Decimal,
  DIMENSION_TYPE_IDS,
  dimensionName,
  formatMoney,
  notFound,
  normalizeRows,
  periodOfDate,
  sourceRoute,
  sumCents,
  qtyToE6,
  today,
  VoucherLineInputSchema,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  CashflowDirectionSchema,
  EntrySchema,
  SaveSchema,
  TemplateSchema,
  monthDistance,
  parsePaste,
  quantityAmount,
  foreignAmount,
  type PasteField,
  type Problem,
  type SaveInput,
  type TemplateInput,
} from '../shared';
import type { EntryTables } from './migrations';

const fail = (code: string, message: string, hint = '修改后重试') =>
  new BusinessError({ code, message, hint });
const stale = () =>
  fail(
    'VOUCHER_STALE',
    '另一个窗口已经保存了新版本',
    '请刷新后重新打开，核对内容；当前窗口不会覆盖新版本',
  );

export function entryService(svc: CoreServices) {
  const db = svc.db.withTables<EntryTables>();
  const requireView = () => svc.permissions.require('voucher-entry.view');
  const load = async (id: number) => {
    const v = await svc.vouchers.get(id);
    if (!v) throw notFound('凭证', id);
    return v;
  };
  const assertEditable = async (id: number) => {
    const v = await load(id);
    if (v.source || v.voided || v.status === 'audited' || v.status === 'posted') {
      const manifest = v.source ? svc.ctx.modules.manifest(v.source.module) : null;
      const to = manifest && v.source ? sourceRoute(manifest, v.source.type, v.source.id) : null;
      throw new BusinessError({
        code: 'ENTRY_READONLY',
        message: '该凭证已审核、过账、作废或由来源模块生成，只能查看',
        hint: '请到凭证管理、期末处理或来源模块办理相应业务',
        actions: to
          ? [{ label: '查看来源', to }]
          : [
              { label: '凭证管理', to: `/m/voucher-book?period=${v.period}&status=pending` },
              { label: '期末处理', to: `/m/period-close?period=${v.period}` },
            ],
      });
    }
    return v;
  };

  const inspect = async (lines: readonly VoucherLineInput[], complete: boolean) => {
    const problems: Problem[] = [];
    const warnings: Problem[] = [];
    const editing = normalizeRows(lines);
    const normalized = editing.rows.map((l) => ({ ...l, dimensions: { ...l.dimensions } }));
    let internal = 0;
    let hasInternal = false;
    const [currencies, methods] = await Promise.all([
      svc.reference.currencies(),
      svc.reference.settlementMethods(),
    ]);
    for (const [index, l] of normalized.entries()) {
      const n = editing.rowNumbers[index]!;
      const add = (field: string, message: string) =>
        problems.push({ line: n, field, message: `第${n}行：${message}` });
      const a = l.accountId ? await svc.accounts.get(l.accountId) : null;
      if (!a) {
        if (complete || l.accountId) add('accountId', '请选择存在的末级科目');
        continue;
      }
      if (a.disabled || !a.isLeaf) add('accountId', `科目 ${a.code} 已停用或不是末级科目`);
      if (complete && !l.summary?.trim()) add('summary', '摘要不能为空');
      if ((l.debit ?? 0) !== 0 && (l.credit ?? 0) !== 0) add('debit', '同一行借贷不能同时有值');
      if (complete && !(l.debit || l.credit)) {
        const nonzero =
          (l.fcAmount ?? 0) !== 0 || (l.quantity != null && !new Decimal(l.quantity).isZero());
        if (!nonzero) add('debit', '本币、原币和数量不能同时为零');
        else if (!l.entrySide)
          add('entrySide', '借贷金额不能都为零；本币为零的原币或数量调整须明确选择借贷方向');
      }
      for (const type of DIMENSION_TYPE_IDS) {
        const cfg = a.dimensions.find((d) => d.type === type);
        if (type !== 'cashflow' && cfg && l.dimensions[type] == null && cfg.defaultItemId != null)
          l.dimensions[type] = cfg.defaultItemId;
        const id = l.dimensions[type];
        const required = type === 'cashflow' ? a.cashflowRequired : cfg?.required;
        const enabled = type === 'cashflow' ? a.cashflowRequired : !!cfg;
        if (complete && required && id == null) add(type, `需要选择${dimensionName(type)}`);
        if (!enabled && id != null) add(type, `该科目未启用${dimensionName(type)}，请清除`);
        if (id != null) {
          const item = await svc.dimensions.get(id);
          if (!item || item.typeId !== type || item.disabled || !item.isLeaf) {
            add(type, `${dimensionName(type)}不存在、已停用或不是末级`);
            continue;
          }
          if (type === 'cashflow' && a.cashflowRequired) {
            const direction = CashflowDirectionSchema.safeParse(item.attrs.cashflowDirection);
            const signed = (l.debit ?? 0) - (l.credit ?? 0);
            if (!direction.success)
              warnings.push({
                line: n,
                field: type,
                message: `第${n}行：现金流量 ${item.code} 方向未配置，无法核验`,
              });
            else if (direction.data === 'internal') {
              hasInternal = true;
              internal += signed;
            } else if (
              (direction.data === 'inflow' && signed < 0) ||
              (direction.data === 'outflow' && signed > 0)
            )
              add(type, `现金流量 ${item.code} 的方向与红字调整后的借贷方向冲突`);
          }
        }
      }
      if (a.currency) {
        if (!currencies.some((c) => c.code === a.currency && !c.disabled))
          add('currency', `币种 ${a.currency} 不存在或已停用，请维护外币档案`);
        if (l.currency && l.currency !== a.currency) add('currency', `此科目只核算 ${a.currency}`);
        l.currency = a.currency;
        if (complete && (l.fcAmount == null || l.fcAmount === 0))
          add('fcAmount', '外币金额必填且不能为零（红字可为负）');
        if (complete && (!l.exchangeRate || new Decimal(l.exchangeRate).lte(0)))
          add('exchangeRate', '请配置该期间汇率，汇率必须大于零');
        if (
          complete &&
          l.fcAmount != null &&
          l.fcAmount !== 0 &&
          l.exchangeRate &&
          new Decimal(l.exchangeRate).gt(0)
        ) {
          try {
            // 手工凭证没有汇兑差额豁免契约；借贷平衡不能替代本行折算一致性。
            const expected = foreignAmount(l.fcAmount, l.exchangeRate);
            const side = l.credit ? 'credit' : (l.entrySide ?? 'debit');
            const actual = l[side] ?? 0;
            if (actual !== expected) {
              const difference = new Decimal(actual).minus(expected).div(100).toFixed(2);
              add(
                side,
                `原币金额×汇率折算应为 ${formatMoney(expected)}，当前${side === 'debit' ? '借方' : '贷方'} ${formatMoney(actual)}，差额 ${difference}；请按 F6 核对原币与汇率并重新折算（四舍五入到分）`,
              );
            }
          } catch {
            add('exchangeRate', '原币金额×汇率超出安全整数分范围，请核对原币金额和汇率');
          }
        }
      } else if (
        (l.currency && l.currency !== 'CNY') ||
        (l.fcAmount ?? 0) !== 0 ||
        l.exchangeRate != null
      )
        add('currency', '非外币科目不能填写外币、汇率或原币金额');
      if (a.quantityUnit) {
        if (complete && (!l.quantity || new Decimal(l.quantity).isZero()))
          add('quantity', '数量必填且不能为零（红字可为负）');
        if (l.quantity) {
          try {
            if (complete && qtyToE6(l.quantity) === 0)
              add('quantity', '数量按六位小数舍入后为零，请核对');
          } catch {
            add('quantity', '数量超出六位小数整数存储范围，请核对');
          }
        }
        if (l.quantity && l.unitPrice && complete) {
          try {
            const amount = quantityAmount(l.quantity, l.unitPrice);
            const actual = l.credit ? l.credit : (l.debit ?? 0);
            if (amount !== actual)
              add('quantity', `数量×单价应四舍五入到分：${amount} 分，请重新计算金额`);
          } catch {
            add('quantity', '数量×单价超出安全金额范围，请核对');
          }
        }
      } else if (
        (l.quantity && !new Decimal(l.quantity).isZero()) ||
        (l.unitPrice && !new Decimal(l.unitPrice).isZero())
      )
        add('quantity', '非数量科目不能填写非零数量或单价');
      if (
        l.settlementMethodId != null &&
        !methods.some((m) => m.id === l.settlementMethodId && !m.disabled)
      )
        add('settlementMethodId', '结算类别不存在或已停用');
    }
    try {
      sumCents(normalized.map((l) => l.debit));
      sumCents(normalized.map((l) => l.credit));
    } catch {
      problems.push({
        line: 0,
        field: 'debit',
        message: '金额合计超出安全整数分范围，请拆分凭证并核对金额',
      });
    }
    if (complete && normalized.length < 2)
      problems.push({ line: 0, field: 'lines', message: '至少录入两条有效分录' });
    if (complete && hasInternal && internal !== 0)
      problems.push({
        line: 0,
        field: 'cashflow',
        message: `内部现金流入流出未配平，差额 ${internal} 分`,
      });
    return { lines: normalized, problems, warnings };
  };
  const assertInspection = (r: Awaited<ReturnType<typeof inspect>>, acknowledged: boolean) => {
    if (r.problems.length)
      throw new BusinessError({
        code: 'ENTRY_INVALID',
        message: r.problems[0]!.message,
        hint: '请按行号修正；未完成的内容可先保存在编辑缓冲',
        details: { problems: r.problems },
      });
    if (r.warnings.length && !acknowledged)
      throw new BusinessError({
        code: 'ENTRY_CASHFLOW_UNKNOWN',
        message: r.warnings[0]!.message,
        hint: '请到基础档案配置现金流量方向；如需保留待核验内容，请明确确认',
        details: { warnings: r.warnings },
      });
  };

  const self = {
    async bootstrap() {
      requireView();
      const [accounts, items, types, currencies, methods, summaries, current] = await Promise.all([
        svc.accounts.list(),
        svc.dimensions.items(),
        svc.reference.voucherTypes(),
        svc.reference.currencies(),
        svc.reference.settlementMethods(),
        svc.reference.summaries(),
        svc.periods.current(),
      ]);
      return {
        accounts,
        items,
        types,
        currencies,
        methods,
        summaries,
        current,
        today: today(svc.ctx.now()),
      };
    },
    async get(id: number) {
      requireView();
      const v = await load(id);
      const manifest = v.source ? svc.ctx.modules.manifest(v.source.module) : null;
      return {
        voucher: v,
        sourceUrl: manifest && v.source ? sourceRoute(manifest, v.source.type, v.source.id) : null,
      };
    },
    async neighbors(id: number) {
      requireView();
      const rows = await svc.db
        .selectFrom('voucher as v')
        .innerJoin('voucher_type as t', 't.id', 'v.voucher_type_id')
        .select(['v.id'])
        .orderBy('v.period')
        .orderBy('t.code')
        .orderBy('v.number')
        .orderBy('v.id')
        .execute();
      const index = rows.findIndex((v) => v.id === id);
      return {
        first: index > 0 ? rows[0]!.id : null,
        previous: index > 0 ? rows[index - 1]!.id : null,
        next: index >= 0 ? (rows[index + 1]?.id ?? null) : null,
        last: index >= 0 && index < rows.length - 1 ? rows.at(-1)!.id : null,
      };
    },
    async context(accountId: number, date: string) {
      requireView();
      const a = await svc.accounts.require(accountId);
      const period = periodOfDate(date);
      const [balances, rate] = await Promise.all([
        svc.ledger.balances({
          periodFrom: period,
          periodTo: period,
          accountCodes: [a.code],
          includeUnposted: true,
          includeZero: true,
          rollup: false,
        }),
        a.currency ? svc.reference.exchangeRate(a.currency, period) : Promise.resolve(null),
      ]);
      return {
        balance: balances.find((b) => b.accountId === accountId)?.closing ?? 0,
        period,
        includeUnposted: true,
        rate,
      };
    },
    async numberHint(date: string, type: number) {
      requireView();
      return svc.vouchers.nextNumber(periodOfDate(date), type);
    },
    async buffer(key: string) {
      requireView();
      let row = await db
        .selectFrom('voucher_entry_buffer')
        .selectAll()
        .where('user_id', '=', svc.user.id)
        .where('client_key', '=', key)
        .executeTakeFirst();
      // 新建时的 UUID 缓冲也能在日后 /edit?id=... 中找回，不依赖浏览器仍保留原新建标签。
      const voucherId = /^edit-(\d+)$/.exec(key)?.[1];
      if (!row && voucherId)
        row = await db
          .selectFrom('voucher_entry_buffer')
          .selectAll()
          .where('user_id', '=', svc.user.id)
          .where('voucher_id', '=', Number(voucherId))
          .orderBy('voucher_revision', 'desc')
          .orderBy('updated_at', 'desc')
          .orderBy('revision', 'desc')
          .orderBy('client_key')
          .executeTakeFirst();
      return row
        ? {
            data: EntrySchema.parse(JSON.parse(row.payload)),
            revision: row.client_key === key ? row.revision : 0,
            voucherId: row.voucher_id,
            voucherRevision: row.voucher_revision,
          }
        : null;
    },
    async save(raw: SaveInput) {
      svc.permissions.require('voucher-entry.edit');
      const input = SaveSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<EntryTables>();
        const service = entryService(tsvc);
        const row = await tdb
          .selectFrom('voucher_entry_buffer')
          .selectAll()
          .where('user_id', '=', tsvc.user.id)
          .where('client_key', '=', input.key)
          .executeTakeFirst();
        if (row && input.id != null && row.voucher_id != null && row.voucher_id !== input.id)
          throw stale();
        const id = input.id ?? row?.voucher_id ?? undefined;
        let current = id ? await service.editable(id) : null;
        if (current && input.id != null && input.expectedRevision !== current.revision)
          throw stale();
        if ((row?.revision ?? 0) !== input.bufferRevision) {
          if (row && row.payload === JSON.stringify(input.data) && current)
            return {
              voucher: current,
              bufferRevision: row.revision,
              coreError: null,
              warnings: [] as Problem[],
            };
          throw stale();
        }
        if (current && input.expectedRevision !== current.revision) throw stale();
        const data = input.data;
        const distance = monthDistance(data.date, today(tsvc.ctx.now()));
        if (distance > 12)
          throw fail('ENTRY_FUTURE_LIMIT', '日期超过当前月份 12 个自然月', '请核对年份和月份');
        const checked = await service.inspect(data.lines, !data.draft);
        if (!data.draft) {
          assertInspection(checked, input.acknowledgeCashflowUnknown);
          if (distance > 0 && !input.confirmFuture)
            throw fail(
              'ENTRY_FUTURE_CONFIRM',
              '凭证日期属于未来月份，需要确认',
              '核对日期后确认保存',
            );
          const changed =
            current?.number != null &&
            (current.period !== periodOfDate(data.date) ||
              current.voucherTypeId !== data.voucherTypeId ||
              (data.number != null && data.number !== current.number));
          if (changed && !input.confirmNumberChange)
            throw fail(
              'ENTRY_NUMBER_CONFIRM',
              `原凭证 ${current!.displayNo} 将改变编号组或编号，可能产生断号`,
              '确认预览的期间、类型和编号影响后再保存；取消不会改动数据库',
            );
        }
        let coreError: string | null = null;
        // 已正式保存的凭证自动保存到本模块缓冲，不能自动降为草稿、释放编号。
        if (!data.draft || !current || current.status === 'draft') {
          try {
            const coreData = { ...data, lines: checked.lines };
            current = current
              ? await tsvc.vouchers.update(current.id, coreData, {
                  expectedRevision: current.revision,
                })
              : await tsvc.vouchers.create(coreData);
          } catch (error) {
            if (!data.draft || !(error instanceof BusinessError)) throw error;
            coreError = error.data.message;
          }
        }
        const revision = (row?.revision ?? 0) + 1;
        await tdb
          .insertInto('voucher_entry_buffer')
          .values({
            user_id: tsvc.user.id,
            client_key: input.key,
            voucher_id: current?.id ?? null,
            voucher_revision: current?.revision ?? null,
            payload: JSON.stringify(data),
            revision,
            updated_at: tsvc.ctx.now().toISOString(),
          })
          .onConflict((oc) =>
            oc.columns(['user_id', 'client_key']).doUpdateSet({
              voucher_id: current?.id ?? null,
              voucher_revision: current?.revision ?? null,
              payload: JSON.stringify(data),
              revision,
              updated_at: tsvc.ctx.now().toISOString(),
            }),
          )
          .execute();
        return {
          voucher: current,
          bufferRevision: revision,
          coreError,
          warnings: checked.warnings,
        };
      });
    },
    async reviewCheck(id: number) {
      requireView();
      const voucher = await load(id);
      const result = await inspect(voucher.lines, true);
      if (result.problems.length) assertInspection(result, true);
      return { warnings: result.warnings };
    },
    editable: assertEditable,
    inspect,
    async templates(keyword = '') {
      requireView();
      return db
        .selectFrom('voucher_entry_template')
        .selectAll()
        .where((eb) =>
          eb.or([eb('code', 'like', `%${keyword}%`), eb('name', 'like', `%${keyword}%`)]),
        )
        .orderBy('code')
        .execute();
    },
    async template(id: number) {
      requireView();
      const head = await db
        .selectFrom('voucher_entry_template')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!head) throw notFound('凭证模版', id);
      const rows = await db
        .selectFrom('voucher_entry_template_line')
        .select('payload')
        .where('template_id', '=', id)
        .orderBy('line_no')
        .execute();
      const lines = rows.map((r) => VoucherLineInputSchema.parse(JSON.parse(r.payload)));
      return { ...head, lines, validation: await inspect(lines, true) };
    },
    async saveTemplate(raw: TemplateInput) {
      svc.permissions.require('voucher-entry.template');
      const input = TemplateSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<EntryTables>();
        const service = entryService(tsvc);
        const checked = await service.inspect(input.lines, true);
        assertInspection(checked, input.acknowledgeCashflowUnknown);
        if (
          !(await tsvc.reference.voucherTypes()).some(
            (t) => t.id === input.voucherTypeId && !t.disabled,
          )
        )
          throw fail('ENTRY_TEMPLATE_TYPE', '凭证类型不存在或已停用');
        const duplicate = await tdb
          .selectFrom('voucher_entry_template')
          .select('id')
          .where('code', '=', input.code)
          .executeTakeFirst();
        if (duplicate && duplicate.id !== input.id)
          throw fail('ENTRY_TEMPLATE_DUPLICATE', '模版编码重复', '请使用不同的编码');
        let id = input.id;
        if (id) {
          const old = await tdb
            .selectFrom('voucher_entry_template')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
          if (!old) throw notFound('凭证模版', id);
          if (old.revision !== input.revision) throw stale();
          await tdb
            .updateTable('voucher_entry_template')
            .set({
              code: input.code,
              name: input.name,
              voucher_type_id: input.voucherTypeId,
              revision: old.revision + 1,
            })
            .where('id', '=', id)
            .execute();
          await tdb
            .deleteFrom('voucher_entry_template_line')
            .where('template_id', '=', id)
            .execute();
        } else
          id = (
            await tdb
              .insertInto('voucher_entry_template')
              .values({
                code: input.code,
                name: input.name,
                voucher_type_id: input.voucherTypeId,
                revision: 1,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        await tdb
          .insertInto('voucher_entry_template_line')
          .values(
            checked.lines.map((line, n) => ({
              template_id: id,
              line_no: n + 1,
              payload: JSON.stringify(VoucherLineInputSchema.parse(line)),
            })),
          )
          .execute();
        await tsvc.log.write({
          action: 'voucher-entry.template.save',
          summary: `保存凭证模版 ${input.code} ${input.name}`,
          targetId: id,
        });
        return id;
      });
    },
    async removeTemplate(id: number, revision: number) {
      svc.permissions.require('voucher-entry.template');
      await svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<EntryTables>();
        const row = await tdb
          .selectFrom('voucher_entry_template')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw notFound('凭证模版', id);
        if (row.revision !== revision) throw stale();
        await tdb.deleteFrom('voucher_entry_template').where('id', '=', id).execute();
      });
    },
    async paste(text: string, mapping: (PasteField | '')[]) {
      requireView();
      const rows = parsePaste(text, mapping);
      const lines: VoucherLineInput[] = [];
      for (const row of rows) {
        const a = row.values.account ? await svc.accounts.getByCode(row.values.account) : null;
        if (!a || a.disabled || !a.isLeaf) row.errors.push('科目编码不存在、停用或非末级');
        const dimensions: NonNullable<VoucherLineInput['dimensions']> = {};
        for (const type of DIMENSION_TYPE_IDS) {
          const code = row.values[type];
          if (!code) continue;
          const item = await svc.dimensions.getByCode(type, code);
          if (!item || item.disabled || !item.isLeaf)
            row.errors.push(`${dimensionName(type)}编码无效`);
          else dimensions[type] = item.id;
        }
        lines.push({
          summary: row.values.summary ?? '',
          accountId: a?.id ?? null,
          dimensions,
          debit: row.amounts.debit ?? 0,
          credit: row.amounts.credit ?? 0,
          currency: row.values.currency || null,
          exchangeRate: row.values.exchangeRate || null,
          fcAmount: row.values.fcAmount ? (row.amounts.fcAmount ?? null) : null,
          quantity: row.values.quantity || null,
          unitPrice: row.values.unitPrice || null,
          refNo: row.values.refNo || null,
          bizDate: row.values.bizDate || null,
        });
      }
      const warnings: Problem[] = [];
      if (rows.length > 999) rows[0]?.errors.push('分录超过 999 行，请分批粘贴');
      if (lines.every((line) => VoucherLineInputSchema.safeParse(line).success)) {
        const checked = await inspect(lines, true);
        for (const problem of checked.problems)
          rows[Math.max(0, problem.line - 1)]?.errors.push(problem.message);
        warnings.push(...checked.warnings);
        return {
          rows: rows.map((row) => ({
            ...row,
            warnings: warnings.filter((p) => p.line === row.line).map((p) => p.message),
          })),
          lines: checked.lines,
        };
      }
      return { rows: rows.map((row) => ({ ...row, warnings: [] as string[] })), lines };
    },
  };
  return self;
}
