import { createHash } from 'node:crypto';
import {
  BusinessError,
  Decimal,
  DIMENSION_TYPES,
  notFound,
  periodOfDate,
  qtyToE6,
  qtyFromE6,
  normalizeDecimal,
  VOUCHER_STATUS_LABELS,
  type VoucherLineInput,
  type DimensionValues,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  InvoiceSchema,
  SettingsSchema,
  type Direction,
  type ImportFile,
  type Invoice,
  type InvoiceData,
  type InvoiceFilter,
  type InvoiceInput,
  type PlanInput,
  type Settings,
} from '../shared';
import type { InvoiceTables } from './migrations';
import { parseWorkbook } from './import';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function problem(
  code: string,
  message: string,
  hint = '刷新页面，核对发票和参数后再操作',
  to = '/m/invoice/input',
): never {
  throw new BusinessError({
    code: `INVOICE_${code}`,
    message,
    hint,
    actions: [{ label: '前往处理', to }],
  });
}
export function safeSum(values: number[]) {
  const n = values.reduce((a, b) => a.add(b), new Decimal(0)).toNumber();
  if (!Number.isSafeInteger(n)) problem('RANGE', '汇总金额超出安全整数范围', '缩小所选范围');
  return n;
}
export function validateInvoice(raw: InvoiceInput): InvoiceData {
  const result = InvoiceSchema.safeParse(raw);
  if (!result.success)
    problem(
      'INVALID',
      result.error.issues.map((i) => i.message).join('；'),
      '核对日期、号码及金额格式',
    );
  const d = result.data;
  if (d.direction === 'input' && !d.confirmDate)
    problem('CONFIRM_DATE', '进项发票必须填写确认日期', '填写用于归属月份的确认日期');
  if (d.confirmDate && d.confirmDate < d.date)
    problem('CONFIRM_DATE', '确认日期早于开票日期', '核对开票日期和确认日期');
  if (safeSum([d.amount, d.tax]) !== d.total)
    problem('TOTAL', '不含税金额加税额不等于价税合计', '核对票面三个金额');
  if (d.amount !== 0 && d.tax !== 0 && Math.sign(d.amount) !== Math.sign(d.tax))
    problem('SIGN', '金额和税额符号不一致', '红字金额与税额须保留负号，核对原始票面');
  for (const [i, l] of d.lines.entries()) {
    if (safeSum([l.amount, l.tax]) !== l.total)
      problem('TOTAL', `第 ${i + 1} 行金额加税额不等于合计`);
    if ((l.quantity == null) !== (l.unitPrice == null))
      problem('PRODUCT', `第 ${i + 1} 行数量和单价必须同时填写或同时留空`);
    if (l.quantity != null) {
      const q = new Decimal(l.quantity);
      if (q.decimalPlaces() > 6 || !Number.isSafeInteger(q.mul(1_000_000).toNumber()))
        problem('QUANTITY', '数量最多六位小数且必须在安全范围内');
      if (new Decimal(l.unitPrice!).isNegative())
        problem('PRICE', '单价不能为负数', '红字发票使用负数量及负金额，单价保留正数');
      // Compare exact decimal differences in cents; equality at 1/2 cents is blocked.
      if (d.direction === 'output' && q.mul(l.unitPrice!).mul(100).sub(l.amount).abs().gte(1))
        problem('PRODUCT', `第 ${i + 1} 行金额与数量乘单价相差至少 0.01 元`);
    }
    if (l.quantity != null) l.quantity = qtyFromE6(qtyToE6(l.quantity));
    if (l.unitPrice != null) l.unitPrice = normalizeDecimal(l.unitPrice);
    if (l.taxRate != null) l.taxRate = normalizeDecimal(l.taxRate);
    if (l.taxMark === 'rate') {
      if (l.taxRate == null || new Decimal(l.taxRate).lt(0) || new Decimal(l.taxRate).gt(1))
        problem('RATE', '税率须显式填写为 0 到 1 的小数字符串');
      if (d.direction === 'output' && new Decimal(l.amount).mul(l.taxRate).sub(l.tax).abs().gte(2))
        problem('TAX', `第 ${i + 1} 行税额与金额乘税率相差至少 0.02 元`);
    } else if (l.taxRate != null) problem('RATE', '免税/未注明税率的明细不能同时填写税率');
    if (l.taxMark === 'exempt' && l.tax !== 0) problem('TAX', '标记免税的明细税额必须为零');
  }
  if (d.lines.length)
    for (const f of ['amount', 'tax', 'total'] as const)
      if (safeSum(d.lines.map((l) => l[f])) !== d[f])
        problem(
          'LINES',
          '明细金额合计与票头不一致',
          '核对明细和票头；只有汇总字段时请使用汇总票，不伪造商品行',
        );
  return d;
}

type Selection = PlanInput['selection'];
export function invoiceService(svc: CoreServices) {
  const db = svc.db.withTables<InvoiceTables>();
  const load = async (id: number) => {
    const r = await db
      .selectFrom('invoice_document')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('发票', id);
    return r;
  };
  const dataOf = async (row: { id: number; data: string }): Promise<InvoiceData> => {
    const lines = await db
      .selectFrom('invoice_line')
      .selectAll()
      .where('document_id', '=', row.id)
      .orderBy('line_no')
      .execute();
    return {
      ...(JSON.parse(row.data) as InvoiceData),
      lines: lines.map((l) => ({
        ...(JSON.parse(l.data) as InvoiceData['lines'][number]),
        quantity: l.quantity_e6 == null ? null : qtyFromE6(l.quantity_e6),
      })),
    };
  };
  const assertPeriod = async (p: number) => {
    const info = await svc.book.info();
    if (p < info.startPeriod)
      problem(
        'START',
        `期间 ${p} 早于账套启用期间 ${info.startPeriod}`,
        '请选择启用期间或以后的月份',
        '/m/invoice/periods',
      );
    const row = await db
      .selectFrom('invoice_period')
      .selectAll()
      .where('period', '=', p)
      .executeTakeFirst();
    if (row?.closed)
      problem(
        'CLOSED',
        `发票期间 ${p} 已结账，不能更改`,
        '如需更改，先对该发票月反结账',
        '/m/invoice/periods',
      );
  };
  const assertDates = async (d: InvoiceData) => {
    await assertPeriod(periodOfDate(d.date));
    if (d.confirmDate) await assertPeriod(periodOfDate(d.confirmDate));
  };
  const checkRevision = (r: { revision: number }, revision: number) => {
    if (r.revision !== revision) problem('STALE', '发票已被其他操作更改，不能覆盖旧版本');
  };
  const checkEditable = async (r: Awaited<ReturnType<typeof load>>) => {
    if (r.state !== 'draft' || r.group_id != null)
      problem(
        'LOCKED',
        '发票已审核或已后续处理，不能直接修改或删除',
        '先撤销未审核的来源凭证，再取消发票审核',
      );
    await assertDates(await dataOf(r));
  };
  const duplicate = async (d: InvoiceData, exclude?: number) => {
    let q = db
      .selectFrom('invoice_document')
      .select(['id', 'data'])
      .where('direction', '=', d.direction)
      .where('seller_tax_id', '=', d.sellerTaxId)
      .where('code', '=', d.code)
      .where('number', '=', d.number);
    if (exclude) q = q.where('id', '!=', exclude);
    return q.executeTakeFirst();
  };
  const writeLines = async (id: number, d: InvoiceData) => {
    if (d.lines.length)
      await db
        .insertInto('invoice_line')
        .values(
          d.lines.map((l, i) => ({
            document_id: id,
            line_no: i + 1,
            quantity_e6: l.quantity == null ? null : qtyToE6(l.quantity),
            data: JSON.stringify({ ...l, quantity: null }),
          })),
        )
        .execute();
  };
  const insert = async (d: InvoiceData, batchId: number | null) => {
    await assertDates(d);
    if (await duplicate(d)) problem('DUPLICATE', `发票 ${d.number} 已存在，不会覆盖`);
    const row = await db
      .insertInto('invoice_document')
      .values({
        direction: d.direction,
        seller_tax_id: d.sellerTaxId,
        code: d.code,
        number: d.number,
        date: d.date,
        confirm_date: d.confirmDate,
        period: periodOfDate(d.direction === 'input' ? d.confirmDate! : d.date),
        data: JSON.stringify({ ...d, lines: [] }),
        state: 'draft',
        revision: 1,
        batch_id: batchId,
        group_id: null,
        created_at: svc.ctx.now().toISOString(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeLines(row.id, d);
    return row.id;
  };
  const validateMapping = async (map: Settings['business']) => {
    const a = await svc.accounts.require(map.accountId);
    if (!a.isLeaf || a.disabled)
      problem(
        'ACCOUNT',
        `科目 ${a.code} ${a.name} 必须是可用的末级科目`,
        '重新选择统一末级科目',
        '/m/invoice/settings',
      );
    if (a.currency || a.quantityUnit)
      problem(
        'ACCOUNT_MODE',
        `科目 ${a.code} 启用了外币或数量核算，本版映射暂不支持`,
        '选择本位币、无数量核算的科目，或等待逐行映射支持',
        '/m/invoice/settings',
      );
    const dimensions: DimensionValues = {};
    const dimensionNames: string[] = [];
    for (const dt of DIMENSION_TYPES) {
      const cfg = a.dimensions.find((d) => d.type === dt.id);
      const id = map.dimensions[dt.id] ?? cfg?.defaultItemId ?? null;
      if (id != null && !cfg && dt.id !== 'cashflow')
        problem(
          'DIMENSION',
          `科目 ${a.code} 未启用${dt.name}核算`,
          '清除多余辅助项',
          '/m/invoice/settings',
        );
      if (id == null && (cfg?.required || (dt.id === 'cashflow' && a.cashflowRequired)))
        problem(
          'DIMENSION',
          `科目 ${a.code} 缺少必需${dt.name}`,
          '填写辅助项后重新预览',
          '/m/invoice/settings',
        );
      if (id != null) {
        const item = await svc.dimensions.get(id);
        if (!item || item.typeId !== dt.id || !item.isLeaf || item.disabled)
          problem(
            'DIMENSION',
            `${dt.name}不存在、已停用或非末级`,
            '重新选择有效辅助项',
            '/m/invoice/settings',
          );
        dimensions[dt.id] = id;
        dimensionNames.push(`${dt.name}：${item.name}`);
      }
    }
    return {
      accountId: a.id,
      accountCode: a.code,
      accountName: a.fullName,
      dimensions,
      dimensionText: dimensionNames.join('；'),
    };
  };
  const settings = async (direction: Direction) => {
    const r = await db
      .selectFrom('invoice_mapping')
      .selectAll()
      .where('direction', '=', direction)
      .executeTakeFirst();
    return r ? { ...SettingsSchema.parse(JSON.parse(r.data)), expectedRevision: r.revision } : null;
  };
  const selected = async (selection: Selection) => {
    if (new Set(selection.map((s) => s.id)).size !== selection.length)
      problem('SELECTION', '所选发票重复');
    const result = [];
    for (const s of [...selection].sort((a, b) => a.id - b.id)) {
      const r = await load(s.id);
      checkRevision(r, s.revision);
      const d = validateInvoice(await dataOf(r));
      await assertDates(d);
      result.push({ r, d });
    }
    return result;
  };
  const self = {
    async list(filter: InvoiceFilter = {}): Promise<Invoice[]> {
      let q = db.selectFrom('invoice_document').selectAll().orderBy('date').orderBy('id');
      if (filter.direction) q = q.where('direction', '=', filter.direction);
      if (filter.id) q = q.where('id', '=', filter.id);
      if (filter.period) q = q.where('period', '=', filter.period);
      if (filter.dateFrom) q = q.where('date', '>=', filter.dateFrom);
      if (filter.dateTo) q = q.where('date', '<=', filter.dateTo);
      if (filter.unvouchered) q = q.where('group_id', 'is', null);
      const rows = await q.execute();
      const out: Invoice[] = [];
      for (const r of rows) {
        const d = await dataOf(r);
        if (
          filter.partner &&
          !(d.direction === 'input' ? d.sellerName : d.buyerName).includes(filter.partner)
        )
          continue;
        if (filter.kind && d.kind !== filter.kind) continue;
        const g =
          r.group_id == null
            ? null
            : await db
                .selectFrom('invoice_group')
                .selectAll()
                .where('id', '=', r.group_id)
                .executeTakeFirst();
        const v = g?.voucher_id == null ? null : await svc.vouchers.get(g.voucher_id);
        out.push({
          ...d,
          id: r.id,
          revision: r.revision,
          state: r.state as Invoice['state'],
          period: r.period,
          batchId: r.batch_id,
          groupId: r.group_id,
          voucherId: v?.id ?? null,
          voucherNo: v?.displayNo ?? null,
          voucherStatus: v ? VOUCHER_STATUS_LABELS[v.status] : null,
        });
      }
      return out;
    },
    async save(input: { id?: number; revision?: number; data: InvoiceInput }) {
      return svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const tdb = tsvc.db.withTables<InvoiceTables>();
        const d = validateInvoice(input.data);
        await t.assertDates(d);
        if (input.id == null) {
          const id = await t.insert(d, null);
          await tsvc.log.write({
            action: 'invoice.create',
            summary: `录入发票 ${d.number}`,
            targetType: 'invoice',
            targetId: id,
          });
          return id;
        }
        const r = await t.load(input.id);
        t.checkRevision(r, input.revision ?? 0);
        await t.checkEditable(r);
        if (await t.duplicate(d, input.id))
          problem('DUPLICATE', `发票 ${d.number} 已存在，不会覆盖`);
        await tdb
          .updateTable('invoice_document')
          .set({
            direction: d.direction,
            seller_tax_id: d.sellerTaxId,
            code: d.code,
            number: d.number,
            date: d.date,
            confirm_date: d.confirmDate,
            period: periodOfDate(d.direction === 'input' ? d.confirmDate! : d.date),
            data: JSON.stringify({ ...d, lines: [] }),
            revision: r.revision + 1,
          })
          .where('id', '=', r.id)
          .execute();
        await tdb.deleteFrom('invoice_line').where('document_id', '=', r.id).execute();
        await t.writeLines(r.id, d);
        await tsvc.log.write({
          action: 'invoice.update',
          summary: `修改发票 ${d.number}`,
          targetType: 'invoice',
          targetId: r.id,
        });
        return r.id;
      });
    },
    async previewImport(file: ImportFile) {
      const parsed = await parseWorkbook(file);
      const duplicates: { number: string; id: number; conflict: boolean; rows: number[] }[] = [];
      for (const g of parsed.invoices) {
        try {
          g.data = validateInvoice(g.data);
          await assertDates(g.data);
        } catch (e) {
          parsed.errors.push({
            row: g.rows[0]!,
            message: e instanceof Error ? e.message : '校验失败',
          });
        }
        const existing = await duplicate(g.data);
        if (existing)
          duplicates.push({
            number: g.data.number,
            id: existing.id,
            conflict: JSON.stringify(g.data) !== JSON.stringify(await dataOf(existing)),
            rows: g.rows,
          });
      }
      if (!parsed.invoices.length && !parsed.errors.length)
        parsed.errors.push({ row: 2, message: '没有可导入发票' });
      return { ...parsed, duplicates };
    },
    async commitImport(file: ImportFile) {
      return svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const preview = await t.previewImport(file);
        if (preview.errors.length || preview.duplicates.length)
          throw new BusinessError({
            code: 'INVOICE_IMPORT_BLOCKED',
            message: '本批存在错误或重复/冲突发票，整批未导入',
            hint: '修正错误行、移除重复票后重新预览',
            details: { errors: preview.errors, duplicates: preview.duplicates },
          });
        const batch = await tsvc.db
          .withTables<InvoiceTables>()
          .insertInto('invoice_batch')
          .values({ file_name: file.fileName, created_at: tsvc.ctx.now().toISOString() })
          .returning('id')
          .executeTakeFirstOrThrow();
        const ids: number[] = [];
        for (const g of preview.invoices) ids.push(await t.insert(g.data, batch.id));
        await tsvc.log.write({
          action: 'invoice.import',
          summary: `导入 ${ids.length} 张发票`,
          targetType: 'invoice_batch',
          targetId: batch.id,
        });
        return { batchId: batch.id, ids };
      });
    },
    async audit(selection: Selection, to: 'audited' | 'draft') {
      return svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const rows = await t.selected(selection);
        for (const { r } of rows) {
          if (r.group_id != null || r.state === 'generated')
            problem('LOCKED', '已后续处理，不能更改发票审核状态');
          if (r.state === to) problem('STATE', '审核状态已变化，请刷新');
          await tsvc.db
            .withTables<InvoiceTables>()
            .updateTable('invoice_document')
            .set({ state: to, revision: r.revision + 1 })
            .where('id', '=', r.id)
            .execute();
        }
        await tsvc.log.write({
          action: 'invoice.audit',
          summary: `${to === 'audited' ? '审核' : '取消审核'} ${rows.length} 张发票`,
        });
      });
    },
    async remove(input: { id: number; revision: number; confirmed: boolean }) {
      if (!input.confirmed) problem('CONFIRM', '删除前必须确认');
      await svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const r = await t.load(input.id);
        t.checkRevision(r, input.revision);
        await t.checkEditable(r);
        await tsvc.db
          .withTables<InvoiceTables>()
          .deleteFrom('invoice_document')
          .where('id', '=', r.id)
          .execute();
        await tsvc.log.write({
          action: 'invoice.delete',
          summary: `删除发票 ${r.number}`,
          targetType: 'invoice',
          targetId: r.id,
        });
      });
    },
    async previewDelete(filter: InvoiceFilter) {
      const rows = await self.list(filter);
      const items = [];
      for (const row of rows) {
        let reason: string | null = null;
        try {
          await checkEditable(await load(row.id));
        } catch (e) {
          if (e instanceof BusinessError) reason = e.message;
          else throw e;
        }
        items.push({ id: row.id, revision: row.revision, number: row.number, reason });
      }
      return { items, fingerprint: hash({ filter, items }) };
    },
    async deleteBatch(input: {
      filter: InvoiceFilter;
      fingerprint: string;
      confirmed: boolean;
      secondConfirmed: boolean;
    }) {
      if (!input.confirmed || !input.secondConfirmed)
        problem('CONFIRM', '批量删除需要先确认查询范围，再二次确认');
      return svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const preview = await t.previewDelete(input.filter);
        if (preview.fingerprint !== input.fingerprint)
          problem(
            'STALE',
            '当前查询结果或锁定状态已变化，原批量删除预览已过期',
            '重新预览并逐项检查跳过原因',
          );
        let deleted = 0;
        for (const row of preview.items) {
          if (row.reason) continue;
          await tsvc.db
            .withTables<InvoiceTables>()
            .deleteFrom('invoice_document')
            .where('id', '=', row.id)
            .execute();
          deleted++;
        }
        await tsvc.log.write({
          action: 'invoice.deleteBatch',
          summary: `删除当前查询 ${deleted} 张草稿发票，跳过 ${preview.items.length - deleted} 张`,
        });
        return { deleted, skipped: preview.items.filter((r) => r.reason) };
      });
    },
    async summary(input: {
      year: number;
      groupBy: 'month' | 'quarter' | 'partner';
      direction: Direction;
    }) {
      const docs = (await self.list({ direction: input.direction })).filter(
        (d) => Math.trunc(d.period / 100) === input.year && d.invoiceStatus === 'normal',
      );
      const map = new Map<
        string,
        {
          key: string;
          label: string;
          taxId: string;
          count: number;
          amount: number;
          tax: number;
          total: number;
          ids: number[];
        }
      >();
      for (const d of docs) {
        const taxId = input.direction === 'input' ? d.sellerTaxId : d.buyerTaxId;
        const name = input.direction === 'input' ? d.sellerName : d.buyerName;
        const month = d.period % 100;
        // Partner without a buyer tax ID uses its explicit name, never an inferred identity.
        const key =
          input.groupBy === 'partner'
            ? JSON.stringify([taxId, name])
            : input.groupBy === 'quarter'
              ? `${input.year}-Q${Math.ceil(month / 3)}`
              : String(d.period);
        const row = map.get(key) ?? {
          key,
          label: input.groupBy === 'partner' ? name : key,
          taxId: input.groupBy === 'partner' ? taxId : '',
          count: 0,
          amount: 0,
          tax: 0,
          total: 0,
          ids: [],
        };
        row.count++;
        row.amount = safeSum([row.amount, d.amount]);
        row.tax = safeSum([row.tax, d.tax]);
        row.total = safeSum([row.total, d.total]);
        row.ids.push(d.id);
        map.set(key, row);
      }
      return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
    },
    settings,
    async saveSettings(raw: Settings) {
      return svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const input = SettingsSchema.parse(raw);
        const old = await t.settings(input.direction);
        if ((old?.expectedRevision ?? 0) !== input.expectedRevision)
          problem('STALE', '映射已被更改，请刷新后重设');
        for (const map of [input.business, input.tax, input.settlement, input.nonDeductible])
          await t.validateMapping(map);
        if (
          new Set([input.business.accountId, input.tax.accountId, input.settlement.accountId])
            .size !== 3
        )
          problem(
            'ACCOUNT',
            '业务、税额与结算科目必须分别配置',
            '核对科目用途',
            '/m/invoice/settings',
          );
        const revision = input.expectedRevision + 1;
        await tsvc.db
          .withTables<InvoiceTables>()
          .insertInto('invoice_mapping')
          .values({ direction: input.direction, revision, data: JSON.stringify(input) })
          .onConflict((o) =>
            o.column('direction').doUpdateSet({ revision, data: JSON.stringify(input) }),
          )
          .execute();
        await tsvc.log.write({
          action: 'invoice.settings',
          summary: `修改${input.direction === 'input' ? '进项' : '销项'}发票映射`,
        });
        return revision;
      });
    },
    async previewVoucher(input: PlanInput) {
      const rows = await selected(input.selection);
      const direction = rows[0]!.d.direction;
      const period = rows[0]!.r.period;
      if (rows.some(({ r, d }) => d.direction !== direction || r.period !== period))
        problem('PERIOD', '一次制证只能选择同方向、同归属月份的发票');
      if (
        rows.some(
          ({ r, d }) => r.group_id != null || r.state !== 'audited' || d.invoiceStatus !== 'normal',
        )
      )
        problem(
          'STATE',
          '只能对已审核、未制证的正常发票生成凭证',
          '先审核发票；已制证发票请查看来源凭证',
          '/m/invoice/process',
        );
      const cfg = await settings(direction);
      if (!cfg)
        problem(
          'SETTINGS',
          '尚未设置发票映射',
          '先配置纳税人口径、税额处理和末级科目',
          '/m/invoice/settings',
        );
      await svc.periods.assertOpen(periodOfDate(input.date), '生成发票凭证');
      const type = (await svc.reference.voucherTypes()).find(
        (v) => v.id === input.voucherTypeId && !v.disabled,
      );
      if (!type) problem('TYPE', '凭证字不存在或已停用', '选择可用凭证字');
      const business = await validateMapping(cfg.business),
        tax = await validateMapping(cfg.tax),
        settlement = await validateMapping(cfg.settlement),
        nonDeductible = await validateMapping(cfg.nonDeductible);
      const groups = (input.mode === 'monthly' ? [rows] : rows.map((r) => [r])).map((group) => {
        const lines: (VoucherLineInput & {
          accountCode: string;
          accountName: string;
          dimensionText: string;
        })[] = [];
        for (const { d } of group) {
          const add = (map: typeof business, amount: number, side: 'debit' | 'credit') => {
            if (amount !== 0)
              lines.push({
                summary: `${direction === 'input' ? '购入' : '销售'} ${d.number}`.slice(0, 200),
                accountId: map.accountId,
                accountCode: map.accountCode,
                accountName: map.accountName,
                dimensionText: map.dimensionText,
                dimensions: map.dimensions,
                [side]: amount,
              });
          };
          if (direction === 'input') {
            add(business, d.amount, 'debit');
            add(cfg.inputTaxTreatment === 'separate' ? tax : nonDeductible, d.tax, 'debit');
            add(settlement, d.total, 'credit');
          } else {
            add(settlement, d.total, 'debit');
            add(business, d.amount, 'credit');
            add(tax, d.tax, 'credit');
          }
        }
        const debit = safeSum(lines.map((l) => l.debit ?? 0)),
          credit = safeSum(lines.map((l) => l.credit ?? 0));
        if (lines.length < 2 || debit !== credit)
          problem('BALANCE', '制证分录为空或借贷不平', '核对金额、税额及科目映射');
        return { ids: group.map(({ r }) => r.id), lines, debit, credit };
      });
      const plan = {
        direction,
        period,
        date: input.date,
        voucherTypeId: input.voucherTypeId,
        mode: input.mode,
        settings: cfg,
        groups,
        selection: input.selection,
      };
      return { ...plan, fingerprint: hash(plan) };
    },
    async generate(input: PlanInput & { fingerprint: string; requestId: string }) {
      return svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const tdb = tsvc.db.withTables<InvoiceTables>();
        const payload = hash(input);
        const old = await tdb
          .selectFrom('invoice_run')
          .selectAll()
          .where('request_id', '=', input.requestId)
          .executeTakeFirst();
        if (old) {
          if (old.payload_hash !== payload) problem('RETRY', '重试标识已用于不同请求');
          return tdb.selectFrom('invoice_group').selectAll().where('run_id', '=', old.id).execute();
        }
        const plan = await t.previewVoucher(input);
        if (plan.fingerprint !== input.fingerprint)
          problem('STALE', '预览后发票或映射已改变，不能使用旧预览', '重新预览分录并确认');
        const run = await tdb
          .insertInto('invoice_run')
          .values({
            request_id: input.requestId,
            payload_hash: payload,
            created_at: tsvc.ctx.now().toISOString(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const g of plan.groups) {
          const group = await tdb
            .insertInto('invoice_group')
            .values({
              run_id: run.id,
              voucher_id: null,
              revoked: 0,
              data: JSON.stringify({ ids: g.ids, settings: plan.settings }),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const v = await tsvc.vouchers.create({
            date: plan.date,
            voucherTypeId: plan.voucherTypeId,
            lines: g.lines,
            source: { type: 'generation', id: String(group.id) },
          });
          await tdb
            .updateTable('invoice_group')
            .set({ voucher_id: v.id })
            .where('id', '=', group.id)
            .execute();
          for (const id of g.ids)
            await tdb
              .updateTable('invoice_document')
              .set((eb) => ({
                state: 'generated',
                group_id: group.id,
                revision: eb('revision', '+', 1),
              }))
              .where('id', '=', id)
              .execute();
        }
        await tsvc.log.write({
          action: 'invoice.generate',
          summary: `${plan.groups.length} 张来源凭证，发票归属 ${plan.period}，凭证日期 ${plan.date}`,
          targetType: 'invoice_run',
          targetId: run.id,
        });
        return tdb.selectFrom('invoice_group').selectAll().where('run_id', '=', run.id).execute();
      });
    },
    async groups(id?: number) {
      let q = db.selectFrom('invoice_group').selectAll().orderBy('id', 'desc');
      if (id) q = q.where('id', '=', id);
      const out = [];
      for (const g of await q.execute())
        out.push({
          ...g,
          voucher: g.voucher_id ? await svc.vouchers.get(g.voucher_id) : null,
          detail: JSON.parse(g.data) as { ids: number[]; settings: Settings },
        });
      return out;
    },
    async revoke(input: { id: number; expectedRevision: number; confirmed: boolean }) {
      if (!input.confirmed) problem('CONFIRM', '撤销整张来源凭证前必须确认');
      await svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const tdb = tsvc.db.withTables<InvoiceTables>();
        const g = await tdb
          .selectFrom('invoice_group')
          .selectAll()
          .where('id', '=', input.id)
          .executeTakeFirst();
        if (!g || !g.voucher_id || g.revoked) problem('SOURCE', '来源批次已撤销或不存在');
        const v = await tsvc.vouchers.get(g.voucher_id);
        if (
          !v ||
          v.source?.module !== 'invoice' ||
          v.source.type !== 'generation' ||
          v.source.id !== String(g.id)
        )
          problem('SOURCE', '凭证来源与发票批次不一致');
        const docs = await tdb
          .selectFrom('invoice_document')
          .selectAll()
          .where('group_id', '=', g.id)
          .execute();
        for (const r of docs) await t.assertDates(JSON.parse(r.data) as InvoiceData);
        await tsvc.vouchers.delete(v.id, { expectedRevision: input.expectedRevision });
        await tdb
          .updateTable('invoice_group')
          .set({ voucher_id: null, revoked: 1 })
          .where('id', '=', g.id)
          .execute();
        await tdb
          .updateTable('invoice_document')
          .set((eb) => ({ group_id: null, state: 'audited', revision: eb('revision', '+', 1) }))
          .where('group_id', '=', g.id)
          .execute();
        await tsvc.log.write({
          action: 'invoice.revoke',
          summary: `整体撤销发票凭证 ${v.displayNo}`,
          targetType: 'invoice_group',
          targetId: g.id,
        });
      });
    },
    async periods() {
      const rows = await db.selectFrom('invoice_period').selectAll().orderBy('period').execute();
      return { startPeriod: (await svc.book.info()).startPeriod, rows };
    },
    async setPeriod(input: {
      period: number;
      closed: boolean;
      expectedRevision: number;
      confirmed: boolean;
    }) {
      if (!input.confirmed) problem('CONFIRM', '结账/反结账必须确认影响');
      await svc.tx(async (tsvc) => {
        const tdb = tsvc.db.withTables<InvoiceTables>();
        const info = await tsvc.book.info();
        if (input.period < info.startPeriod)
          problem(
            'START',
            `不能操作早于启用期间 ${info.startPeriod} 的月份`,
            '选择启用期间或以后的月份',
            '/m/invoice/periods',
          );
        const old = await tdb
          .selectFrom('invoice_period')
          .selectAll()
          .where('period', '=', input.period)
          .executeTakeFirst();
        if ((old?.revision ?? 0) !== input.expectedRevision)
          problem('STALE', '发票期间已被其他操作更改');
        await tdb
          .insertInto('invoice_period')
          .values({
            period: input.period,
            closed: input.closed ? 1 : 0,
            revision: input.expectedRevision + 1,
          })
          .onConflict((o) =>
            o
              .column('period')
              .doUpdateSet({ closed: input.closed ? 1 : 0, revision: input.expectedRevision + 1 }),
          )
          .execute();
        await tsvc.log.write({
          action: input.closed ? 'invoice.close' : 'invoice.reopen',
          summary: `发票月 ${input.period} ${input.closed ? '结账' : '反结账'}；仅影响发票模块`,
        });
      });
    },
    async vat(input: { year: number; groupBy: 'month' | 'quarter'; includeUnposted: boolean }) {
      const invoices = await self.list();
      const out = [];
      for (const direction of ['input', 'output'] as const) {
        const cfg = await settings(direction);
        const map = cfg ? await validateMapping(cfg.tax) : null;
        for (let m = 1; m <= 12; m += input.groupBy === 'quarter' ? 3 : 1) {
          const from = input.year * 100 + m,
            to = from + (input.groupBy === 'quarter' ? 2 : 0);
          const docs = invoices.filter(
            (d) =>
              d.direction === direction &&
              d.period >= from &&
              d.period <= to &&
              d.invoiceStatus === 'normal',
          );
          const entries = map
            ? await svc.ledger.entries({
                periodFrom: from,
                periodTo: to,
                accountIds: [map.accountId],
                includeChildren: false,
                includeUnposted: input.includeUnposted,
                limit: 200000,
              })
            : [];
          const balances = map
            ? await svc.ledger.balances({
                periodFrom: from,
                periodTo: to,
                accountCodes: [map.accountCode],
                rollup: false,
                includeUnposted: input.includeUnposted,
              })
            : [];
          const book = safeSum(
            balances.map((r) =>
              direction === 'input' ? safeSum([r.debit, -r.credit]) : safeSum([r.credit, -r.debit]),
            ),
          );
          const face = safeSum(docs.map((d) => d.tax));
          out.push({
            key: `${direction}-${from}`,
            direction,
            from,
            to,
            configured: !!map,
            accountCode: map?.accountCode ?? null,
            face,
            book,
            difference: safeSum([book, -face]),
            count: docs.length,
            invoiceIds: docs.map((d) => d.id),
            entries,
            entriesLimited: entries.length === 200000,
            explanations: await Promise.all(
              docs.map(async (d) => {
                const voucher = d.voucherId ? await svc.vouchers.get(d.voucherId) : null;
                return {
                  id: d.id,
                  number: d.number,
                  date: d.date,
                  confirmDate: d.confirmDate,
                  voucherId: d.voucherId,
                  voucherStatus: d.voucherStatus,
                  voucherDate: voucher?.date ?? null,
                  crossVoucherPeriod: voucher != null && voucher.period !== d.period,
                  crossPeriod: !!d.confirmDate && periodOfDate(d.date) !== d.period,
                  red: d.tax < 0,
                };
              }),
            ),
            basis: cfg?.inputTaxTreatment ?? null,
          });
        }
      }
      return out;
    },
    // Internal helpers are not registered as public procedures.
    dataOf,
    load,
    insert,
    writeLines,
    assertDates,
    checkEditable,
    checkRevision,
    duplicate,
    validateMapping,
    selected,
  };
  return self;
}
