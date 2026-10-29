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
  type Account,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  InvoiceSchema,
  SettingsSchema,
  ProcessDraftSchema,
  type Direction,
  type ImportFile,
  type Invoice,
  type InvoiceData,
  type InvoiceFilter,
  type InvoiceInput,
  type PlanInput,
  type Settings,
  type VoucherRole,
  type ProcessDraft,
  type RevokeInput,
} from '../shared';
import type { InvoiceTables } from './migrations';
import { parseWorkbook } from './import';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const draftHash = (d: ProcessDraft) =>
  hash({
    direction: d.direction,
    period: d.period,
    selected: [...d.selected].sort((a, b) => a - b),
    values: {
      date: d.values.date,
      voucherTypeId: d.values.voucherTypeId,
      mode: d.values.mode,
      regenerate: d.values.regenerate ?? false,
      firstNumber: d.values.firstNumber,
      allocations: [...(d.values.allocations ?? [])].sort(
        (a, b) => a.invoiceId - b.invoiceId || a.role.localeCompare(b.role),
      ),
    },
  });
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
function assertSettlementRole(account: Pick<Account, 'id' | 'code' | 'name'>, cfg: Settings) {
  if (account.id === cfg.business.accountId || account.id === cfg.tax.accountId)
    problem(
      'ACCOUNT',
      `往来下级科目 ${account.code} ${account.name} 与业务或税额科目重复，不能生成凭证`,
      '分别配置业务、税额和往来结算科目后重新预览',
      '/m/invoice/settings',
    );
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
    const issue = await db
      .selectFrom('invoice_issue')
      .select('id')
      .where('invoice_id', '=', r.id)
      .executeTakeFirst();
    if (r.state !== 'draft' || r.group_id != null || issue)
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
  const validateMapping = async (map: Settings['business'], account?: Account) => {
    const a = account ?? (await svc.accounts.require(map.accountId));
    if (!a.isLeaf || a.disabled)
      problem(
        'ACCOUNT',
        `科目 ${a.code} ${a.name} 必须是可用的末级科目`,
        '重新选择统一末级科目',
        '/m/invoice/settings',
      );
    if (
      a.currency &&
      !(await svc.reference.currencies()).some((c) => c.code === a.currency && !c.disabled)
    )
      problem('FOREIGN', `科目 ${a.code} 的币种不存在或已停用`, '在基础资料中启用币种后重新预览');
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
      currency: a.currency,
      quantityUnit: a.quantityUnit,
      enabledDimensions: DIMENSION_TYPES.filter(
        (dt) =>
          a.dimensions.some((d) => d.type === dt.id) ||
          (dt.id === 'cashflow' && a.cashflowRequired),
      ).map((dt) => ({ id: dt.id, name: dt.name })),
    };
  };
  const settlementParent = async (cfg: Settings) => {
    const parent = await svc.accounts.require(cfg.settlement.accountId);
    if (parent.disabled || parent.isLeaf)
      problem(
        'PARTNER_PARENT',
        '按名称匹配时，结算科目必须是已有下级的可用非末级科目',
        '在科目维护中准备上级和下级科目，再到参数设置选择该上级',
        '/m/invoice/settings',
      );
    // Validate the dimensions a newly created direct child will inherit.
    await validateMapping(cfg.settlement, { ...parent, isLeaf: true });
    return parent;
  };
  const settlementPlan = async (cfg: Settings, docs: InvoiceData[]) => {
    const maps = new Map<string, Awaited<ReturnType<typeof validateMapping>>>();
    const newAccounts: Account[] = [];
    if (cfg.settlementMode === 'unified') {
      maps.set('', await validateMapping(cfg.settlement));
      return { maps, newAccounts };
    }
    const parent = await settlementParent(cfg);
    const accounts = await svc.accounts.list();
    const descendants = accounts.filter(
      (a) => a.code.startsWith(parent.code) && a.id !== parent.id,
    );
    const scheme = (await svc.book.info()).codeScheme;
    const width = scheme[parent.level];
    const used = new Set(accounts.map((a) => a.code));
    const names = [
      ...new Set(docs.map((d) => (cfg.direction === 'input' ? d.sellerName : d.buyerName))),
    ].sort();
    for (const name of names) {
      const matches = descendants.filter((a) => a.name === name);
      if (matches.length > 1)
        problem(
          'PARTNER_AMBIGUOUS',
          `往来名称“${name}”对应多个下级科目`,
          '在科目维护中消除同名歧义后重新预览',
        );
      let account = matches[0];
      if (!account) {
        if (width == null)
          problem(
            'PARTNER_SPACE',
            `科目 ${parent.code} 已到编码末级，不能增加下级`,
            '核对账套科目级次',
          );
        let code = '';
        // At most one probe per occupied slot, even when a level permits six digits.
        for (let n = 1; n <= Math.min(10 ** width - 1, used.size + 1); n++) {
          const candidate = parent.code + String(n).padStart(width, '0');
          if (!used.has(candidate)) {
            code = candidate;
            break;
          }
        }
        if (!code)
          problem(
            'PARTNER_SPACE',
            `科目 ${parent.code} 的下级编码空间已满`,
            '在套账信息核对科目级次，或在科目维护中整理后重新预览',
          );
        used.add(code);
        account = {
          ...parent,
          id: 0,
          code,
          name,
          fullName: `${parent.fullName}/${name}`,
          parentId: parent.id,
          level: parent.level + 1,
          isLeaf: true,
        };
        newAccounts.push(account);
      }
      assertSettlementRole(account, cfg);
      maps.set(name, await validateMapping(cfg.settlement, account));
    }
    return { maps, newAccounts };
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
  const revokeContext = async (
    input: { id: number; expectedRevision: number },
    expiresAt?: number,
  ) => {
    const group = await db
      .selectFrom('invoice_group')
      .selectAll()
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (!group || !group.voucher_id || group.revoked) problem('SOURCE', '来源批次已撤销或不存在');
    const voucher = await svc.vouchers.get(group.voucher_id);
    if (
      !voucher ||
      voucher.source?.module !== 'invoice' ||
      voucher.source.type !== 'generation' ||
      voucher.source.id !== String(group.id)
    )
      problem('SOURCE', '凭证来源与发票批次不一致');
    const docs = await db
      .selectFrom('invoice_document')
      .selectAll()
      .where('group_id', '=', group.id)
      .orderBy('id')
      .execute();
    const ids = (JSON.parse(group.data) as { ids: number[] }).ids;
    if (
      !docs.length ||
      docs.length !== ids.length ||
      docs.some((r) => r.state !== 'generated' || !ids.includes(r.id))
    )
      problem('SOURCE', '来源批次与发票关联不完整，不能整体撤销');
    for (const r of docs) await assertDates(JSON.parse(r.data) as InvoiceData);
    const deletionPlan = await svc.vouchers.previewDelete([voucher.id], expiresAt);
    if (voucher.revision !== input.expectedRevision)
      throw new BusinessError({ code: 'VOUCHER_STALE', message: '凭证版本已变化，请重新预览撤销' });
    const issues = await db
      .selectFrom('invoice_issue')
      .selectAll()
      .where('invoice_id', 'in', ids)
      .orderBy('id')
      .execute();
    const lines = await db
      .selectFrom('invoice_line')
      .selectAll()
      .where('document_id', 'in', ids)
      .orderBy('document_id')
      .orderBy('line_no')
      .execute();
    return {
      group,
      voucher,
      docs,
      issues,
      deletionPlan,
      fingerprint: hash({ group, docs, lines, issues, deletionPlan }),
    };
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
        const issue = await db
          .selectFrom('invoice_issue')
          .selectAll()
          .where('invoice_id', '=', r.id)
          .executeTakeFirst();
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
          issueId: issue?.id ?? null,
          inventoryDocumentId: issue?.inventory_document_id ?? null,
          issueNumber: issue?.number ?? null,
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
          const issue = await tsvc.db
            .withTables<InvoiceTables>()
            .selectFrom('invoice_issue')
            .select('id')
            .where('invoice_id', '=', r.id)
            .executeTakeFirst();
          if (r.group_id != null || r.state === 'generated' || r.state === 'issued' || issue)
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
    async voucherFields(selection: Selection) {
      const rows = await selected(selection);
      const cfg = await settings(rows[0]!.d.direction);
      if (!cfg) problem('SETTINGS', '尚未设置发票映射', '请先配置科目映射', '/m/invoice/settings');
      if (rows.some(({ d }) => d.direction !== cfg.direction))
        problem('PERIOD', '一次制证只能选择同方向发票');
      const settlements = await settlementPlan(
        cfg,
        rows.map(({ d }) => d),
      );
      const fields = [];
      for (const { r, d } of rows) {
        const roles = [
          ['business', d.amount],
          [
            cfg.direction === 'input' && cfg.inputTaxTreatment === 'cost' ? 'nonDeductible' : 'tax',
            d.tax,
          ],
          ['settlement', d.total],
        ] as [VoucherRole, number][];
        for (const [role, amount] of roles) {
          const map =
            role === 'settlement'
              ? settlements.maps.get(
                  cfg.settlementMode === 'unified'
                    ? ''
                    : cfg.direction === 'input'
                      ? d.sellerName
                      : d.buyerName,
                )!
              : await validateMapping(cfg[role]);
          if (!map.currency && !map.quantityUnit && !map.enabledDimensions.length) continue;
          const exchangeRate = map.currency
            ? await svc.reference.exchangeRate(map.currency, r.period)
            : null;
          const quantity =
            map.quantityUnit &&
            d.lines.length &&
            d.lines.every((l) => l.unit === map.quantityUnit && l.quantity != null)
              ? qtyFromE6(safeSum(d.lines.map((l) => qtyToE6(l.quantity!))))
              : null;
          fields.push({
            invoiceId: r.id,
            number: d.number,
            role,
            amount,
            ...map,
            exchangeRate,
            quantity,
          });
        }
      }
      return fields;
    },
    async saveSettings(raw: Settings) {
      return svc.tx(async (tsvc) => {
        const t = invoiceService(tsvc);
        const input = SettingsSchema.parse(raw);
        const old = await t.settings(input.direction);
        if ((old?.expectedRevision ?? 0) !== input.expectedRevision)
          problem('STALE', '映射已被更改，请刷新后重设');
        for (const map of [input.business, input.tax, input.nonDeductible])
          await t.validateMapping(map);
        if (input.settlementMode === 'partnerName') await t.settlementParent(input);
        else await t.validateMapping(input.settlement);
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
          ({ r, d }) =>
            (r.group_id != null
              ? !input.regenerate || r.state !== 'generated'
              : r.state !== 'audited' && r.state !== 'issued') || d.invoiceStatus !== 'normal',
        )
      )
        problem(
          'STATE',
          '只能对已审核、未制证的正常发票生成凭证',
          '先审核发票；已转出库的销项票可在此生成收入凭证，已制证发票请查看来源凭证',
          '/m/invoice/process',
        );
      for (const { r, d } of rows) {
        const issue = await db
          .selectFrom('invoice_issue')
          .select('id')
          .where('invoice_id', '=', r.id)
          .executeTakeFirst();
        if (
          (r.state === 'issued' && (!issue || d.direction !== 'output')) ||
          (issue && (d.direction !== 'output' || r.state === 'audited'))
        )
          problem(
            'SOURCE',
            '发票状态与出库来源关联不一致，不能生成收入凭证',
            '核对发票与原出库单，不能用制证覆盖不完整的来源关联',
            '/m/invoice/issue',
          );
      }
      const cfg = await settings(direction);
      if (!cfg)
        problem(
          'SETTINGS',
          '尚未设置发票映射',
          '先配置纳税人口径、税额处理和末级科目',
          '/m/invoice/settings',
        );
      await svc.periods.assertWritable({
        period: periodOfDate(input.date),
        mode: 'business',
        action: '生成发票凭证',
      });
      const replacements: {
        groupId: number;
        voucherId: number;
        displayNo: string;
        revision: number;
        members: { id: number; revision: number }[];
      }[] = [];
      for (const groupId of [
        ...new Set(rows.map(({ r }) => r.group_id).filter((id): id is number => id != null)),
      ].sort((a, b) => a - b)) {
        const group = await db
          .selectFrom('invoice_group')
          .selectAll()
          .where('id', '=', groupId)
          .executeTakeFirst();
        const members = await db
          .selectFrom('invoice_document')
          .select(['id', 'revision'])
          .where('group_id', '=', groupId)
          .orderBy('id')
          .execute();
        if (!group || group.revoked || group.voucher_id == null)
          problem('SOURCE', '原凭证批次已撤销或关联不完整，请刷新后核对');
        if (members.some((m) => !rows.some(({ r }) => r.id === m.id)))
          problem(
            'GROUP_SELECTION',
            '汇总凭证必须选择其全部来源发票才能重新生成',
            '补选同一来源凭证的全部发票后重新预览',
          );
        const voucher = await svc.vouchers.get(group.voucher_id);
        if (
          !voucher ||
          voucher.source?.module !== 'invoice' ||
          voucher.source.type !== 'generation' ||
          voucher.source.id !== String(groupId)
        )
          problem('SOURCE', '原凭证来源与发票批次不一致，不能重新生成');
        if (voucher.status !== 'pending' && voucher.status !== 'draft')
          problem(
            'LOCKED',
            `凭证 ${voucher.displayNo} 已审核或过账，不能重新生成`,
            '先反过账并取消审核，重新选择全部来源发票',
          );
        replacements.push({
          groupId,
          voucherId: voucher.id,
          displayNo: voucher.displayNo,
          revision: voucher.revision,
          members,
        });
      }
      const deletionPlan = replacements.length
        ? await svc.vouchers.previewDelete(
            replacements.map((r) => r.voucherId),
            input.deletionPlan?.expiresAt,
          )
        : null;
      const policy = await svc.voucherPolicy.get();
      if (policy.numbering === 'manual' && input.firstNumber == null)
        problem('NUMBER', '账套采用手工编号，请填写起始凭证号', '核对凭证字和已有编号后重新预览');
      if (policy.numbering === 'automatic' && input.firstNumber != null)
        problem('NUMBER', '账套采用自动编号，无需填写起始凭证号', '清空起始凭证号后重新预览');
      const type = (await svc.reference.voucherTypes()).find(
        (v) => v.id === input.voucherTypeId && !v.disabled,
      );
      if (!type) problem('TYPE', '凭证字不存在或已停用', '选择可用凭证字');
      const business = await validateMapping(cfg.business),
        tax = await validateMapping(cfg.tax),
        nonDeductible = await validateMapping(cfg.nonDeductible);
      const settlements = await settlementPlan(
        cfg,
        rows.map(({ d }) => d),
      );
      const allocations = input.allocations ?? [];
      const allocationKeys = allocations.map((a) => `${a.invoiceId}:${a.role}`);
      if (
        new Set(allocationKeys).size !== allocations.length ||
        allocations.some((a) => !rows.some(({ r }) => r.id === a.invoiceId))
      )
        problem('ALLOCATION', '逐票核算项重复或包含未选择发票', '重新选择发票并填写核算项');
      const usedAllocations = new Set<string>();
      const groups = [];
      for (const group of input.mode === 'monthly' ? [rows] : rows.map((r) => [r])) {
        const lines: (VoucherLineInput & {
          accountCode: string;
          accountName: string;
          dimensionText: string;
        })[] = [];
        for (const { r, d } of group) {
          const settlement = settlements.maps.get(
            cfg.settlementMode === 'unified'
              ? ''
              : direction === 'input'
                ? d.sellerName
                : d.buyerName,
          )!;
          const add = async (
            base: typeof business,
            amount: number,
            side: 'debit' | 'credit',
            role: VoucherRole,
          ) => {
            const allocation = allocations.find((a) => a.invoiceId === r.id && a.role === role);
            if (allocation) usedAllocations.add(`${r.id}:${role}`);
            const map = allocation?.dimensions
              ? await validateMapping(
                  { accountId: base.accountId, dimensions: allocation.dimensions },
                  base.accountId === 0
                    ? settlements.newAccounts.find((a) => a.code === base.accountCode)
                    : undefined,
                )
              : base;
            let exchangeRate: string | null = null,
              fcAmount: number | null = null,
              quantity: string | null = null,
              unitPrice: string | null = null;
            if (map.currency) {
              exchangeRate = allocation?.exchangeRate ?? null;
              fcAmount = allocation?.fcAmount ?? null;
              if (
                exchangeRate == null ||
                fcAmount == null ||
                !new Decimal(exchangeRate).isPositive()
              )
                problem(
                  'FOREIGN',
                  `发票 ${d.number} 科目 ${map.accountCode} 需要填写正汇率和外币金额`,
                  '在逐票核算项中填写后重新预览',
                );
              if (
                !new Decimal(fcAmount)
                  .mul(exchangeRate)
                  .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
                  .eq(amount)
              )
                problem(
                  'FOREIGN',
                  `发票 ${d.number} 科目 ${map.accountCode} 的外币金额乘汇率与本币金额不符`,
                  '核对票面原币金额与汇率；本币按四舍五入到分校验',
                );
              exchangeRate = normalizeDecimal(exchangeRate);
            } else if (allocation?.fcAmount != null || allocation?.exchangeRate != null)
              problem('FOREIGN', `科目 ${map.accountCode} 未启用外币核算，不能填写外币金额或汇率`);
            if (map.quantityUnit) {
              quantity =
                allocation?.quantity ??
                (d.lines.length &&
                d.lines.every((l) => l.unit === map.quantityUnit && l.quantity != null)
                  ? qtyFromE6(safeSum(d.lines.map((l) => qtyToE6(l.quantity!))))
                  : null);
              if (quantity == null)
                problem(
                  'QUANTITY',
                  `发票 ${d.number} 科目 ${map.accountCode} 需要填写数量（${map.quantityUnit}）`,
                  '核对单位后在逐票核算项中填写数量',
                );
              if (new Decimal(quantity).decimalPlaces() > 6)
                problem('QUANTITY', '制证数量最多六位小数');
              if (!Number.isSafeInteger(new Decimal(quantity).mul(1_000_000).toNumber()))
                problem('QUANTITY', '制证数量超出可保存范围', '缩小数量并核对小数点');
              quantity = qtyFromE6(qtyToE6(quantity));
              unitPrice =
                allocation?.unitPrice ??
                (new Decimal(quantity).isZero()
                  ? null
                  : new Decimal(amount).div(100).div(quantity).toDecimalPlaces(12).toString());
              if (unitPrice != null) unitPrice = normalizeDecimal(unitPrice);
              if (unitPrice != null && new Decimal(unitPrice).isNegative())
                problem('PRICE', '制证单价不能为负数');
              if (
                unitPrice != null &&
                !new Decimal(quantity)
                  .mul(unitPrice)
                  .mul(100)
                  .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
                  .eq(amount)
              )
                problem(
                  'PRICE',
                  `发票 ${d.number} 科目 ${map.accountCode} 的数量乘单价与本币金额不符`,
                  '核对金额、数量符号和本币单价',
                );
            } else if (allocation?.quantity != null || allocation?.unitPrice != null)
              problem('QUANTITY', `科目 ${map.accountCode} 未启用数量核算，不能填写数量或单价`);
            if (amount !== 0 || fcAmount || (quantity != null && qtyToE6(quantity) !== 0))
              lines.push({
                summary: `${direction === 'input' ? '购入' : '销售'} ${d.number}`.slice(0, 200),
                accountId: map.accountId,
                accountCode: map.accountCode,
                accountName: map.accountName,
                dimensionText: map.dimensionText,
                dimensions: map.dimensions,
                currency: map.currency,
                exchangeRate,
                fcAmount,
                quantity,
                unitPrice,
                entrySide: side,
                [side]: amount,
              });
          };
          if (direction === 'input') {
            await add(business, d.amount, 'debit', 'business');
            await add(
              cfg.inputTaxTreatment === 'separate' ? tax : nonDeductible,
              d.tax,
              'debit',
              cfg.inputTaxTreatment === 'separate' ? 'tax' : 'nonDeductible',
            );
            await add(settlement, d.total, 'credit', 'settlement');
          } else {
            await add(settlement, d.total, 'debit', 'settlement');
            await add(business, d.amount, 'credit', 'business');
            await add(tax, d.tax, 'credit', 'tax');
          }
        }
        const debit = safeSum(lines.map((l) => l.debit ?? 0)),
          credit = safeSum(lines.map((l) => l.credit ?? 0));
        if (lines.length < 2 || debit !== credit)
          problem('BALANCE', '制证分录为空或借贷不平', '核对金额、税额及科目映射');
        const number: number | undefined =
          input.firstNumber == null ? undefined : input.firstNumber + groups.length;
        if (number != null && !Number.isSafeInteger(number))
          problem('NUMBER', '本批凭证编号超出可保存范围', '减小起始号或缩小所选范围');
        groups.push({
          ids: group.map(({ r }) => r.id),
          lines,
          debit,
          credit,
          number,
        });
      }
      if (usedAllocations.size !== allocations.length)
        problem(
          'ALLOCATION',
          '逐票核算项包含本次未使用的科目用途',
          '清除未使用的税额处理用途后重新预览',
        );
      if (input.firstNumber != null) {
        const existing = await svc.vouchers.list({
          periodFrom: periodOfDate(input.date),
          periodTo: periodOfDate(input.date),
          voucherTypeId: input.voucherTypeId,
          includeVoided: true,
          limit: 10000,
        });
        if (existing.total > 10000) problem('NUMBER', '当前月份凭证过多，无法完整核对手工编号');
        if (
          groups.some((g) =>
            existing.items.some(
              (v) =>
                (deletionPlan?.impacts.find((i) => i.id === v.id)?.number ?? v.number) ===
                  g.number && !replacements.some((r) => r.voucherId === v.id),
            ),
          )
        )
          problem('NUMBER', '起始凭证号范围已有凭证，请换用未占用的编号');
      }
      const plan = {
        direction,
        period,
        date: input.date,
        voucherTypeId: input.voucherTypeId,
        mode: input.mode,
        settings: cfg,
        groups,
        selection: input.selection,
        newAccounts: settlements.newAccounts,
        allocations,
        regenerate: input.regenerate ?? false,
        firstNumber: input.firstNumber,
        replacements,
        deletionPlan,
      };
      return { ...plan, fingerprint: hash(plan) };
    },
    async generate(
      input: PlanInput & {
        fingerprint: string;
        requestId: string;
        newAccountsConfirmed?: boolean;
        regenerateConfirmed?: boolean;
      },
    ) {
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
        if (plan.replacements.length) {
          if (!input.regenerateConfirmed || !input.deletionPlan || !plan.deletionPlan)
            problem(
              'CONFIRM',
              '重新生成须明确确认删除原凭证及编号影响',
              '核对原凭证和编号变化后确认重新生成',
            );
          if (input.deletionPlan.fingerprint !== plan.deletionPlan.fingerprint)
            problem('STALE', '原凭证或编号影响已变化，请重新预览');
          await tsvc.vouchers.deleteBatch(plan.deletionPlan, true);
          for (const replacement of plan.replacements)
            await tdb
              .updateTable('invoice_group')
              .set({ revoked: 1, voucher_id: null })
              .where('id', '=', replacement.groupId)
              .execute();
        }
        const createdAccounts = new Map<string, number>();
        if (plan.newAccounts.length) {
          tsvc.permissions.require('invoice.account');
          if (!input.newAccountsConfirmed)
            problem(
              'ACCOUNT_CONFIRM',
              '本次将新增往来下级科目，必须逐项核对并确认',
              '核对预览中的编码、名称及辅助项后确认新增',
            );
          const scheme = (await tsvc.book.info()).codeScheme;
          for (const a of plan.newAccounts) {
            const created = await tsvc.accounts.create(
              {
                code: a.code,
                name: a.name,
                categoryId: a.categoryId,
                direction: a.direction,
                isCash: a.isCash,
                isBank: a.isBank,
                cashflowRequired: a.cashflowRequired,
                isPartner: a.isPartner,
                dimensions: a.dimensions,
                currency: a.currency,
                quantityUnit: a.quantityUnit,
              },
              scheme,
            );
            assertSettlementRole(created, plan.settings);
            createdAccounts.set(a.code, created.id);
            await tsvc.log.write({
              action: 'invoice.account.create',
              summary: `制证新增往来科目 ${a.code} ${a.name}`,
              targetType: 'account',
              targetId: created.id,
            });
          }
        }
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
              data: JSON.stringify({
                ids: g.ids,
                settings: plan.settings,
                allocations: plan.allocations.filter((a) => g.ids.includes(a.invoiceId)),
              }),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const v = await tsvc.vouchers.create({
            date: plan.date,
            voucherTypeId: plan.voucherTypeId,
            number: g.number,
            lines: g.lines.map((l) => ({
              ...l,
              accountId: createdAccounts.get(l.accountCode) ?? l.accountId,
            })),
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
          action: plan.replacements.length ? 'invoice.regenerate' : 'invoice.generate',
          summary: `${plan.groups.length} 张来源凭证，发票归属 ${plan.period}，凭证日期 ${plan.date}`,
          targetType: 'invoice_run',
          targetId: run.id,
        });
        const draftKey = `processDraft.${tsvc.user.id}`;
        const savedDraft = ProcessDraftSchema.safeParse(await tsvc.settings.get(draftKey, null));
        if (
          savedDraft.success &&
          draftHash(savedDraft.data) ===
            draftHash({
              direction: plan.direction,
              period: plan.period,
              selected: plan.selection.map((s) => s.id),
              values: {
                date: plan.date,
                voucherTypeId: plan.voucherTypeId,
                mode: plan.mode,
                regenerate: plan.regenerate,
                firstNumber: plan.firstNumber,
                allocations: plan.allocations,
              },
            })
        )
          await tsvc.settings.set(draftKey, null);
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
    async previewRevoke(input: { id: number; expectedRevision: number }) {
      const context = await revokeContext(input);
      const impacts = await Promise.all(
        context.deletionPlan.impacts.map(async (impact) => {
          const v = await svc.vouchers.get(impact.id);
          if (!v) problem('STALE', '编号影响中的凭证已变化，请重新预览撤销');
          return { ...impact, displayNo: v.displayNo, period: v.period };
        }),
      );
      return {
        ...input,
        fingerprint: context.fingerprint,
        deletionPlan: context.deletionPlan,
        voucherNo: context.voucher.displayNo,
        invoices: context.docs.map((r) => ({
          id: r.id,
          number: r.number,
          state: context.issues.some((i) => i.invoice_id === r.id) ? 'issued' : 'audited',
        })),
        impacts,
      };
    },
    async revoke(input: RevokeInput): Promise<void> {
      if (!input.confirmed) problem('CONFIRM', '撤销整张来源凭证前必须确认');
      if (!svc.db.isTransaction) return svc.tx((tsvc) => invoiceService(tsvc).revoke(input));
      const context = await revokeContext(input, input.deletionPlan?.expiresAt);
      if (!input.deletionPlan || !input.fingerprint)
        problem('CONFIRM', '请先预览撤销，核对来源发票及编号影响后明确确认');
      if (
        context.fingerprint !== input.fingerprint ||
        input.deletionPlan.fingerprint !== context.deletionPlan.fingerprint ||
        input.deletionPlan.ids.length !== 1 ||
        input.deletionPlan.ids[0] !== context.voucher.id
      )
        problem('STALE', '撤销预览后发票、来源或编号影响已变化，请重新预览');
      await svc.vouchers.deleteBatch(input.deletionPlan, true);
      const { group: g, voucher: v, docs } = context;
      await db
        .updateTable('invoice_group')
        .set({ voucher_id: null, revoked: 1 })
        .where('id', '=', g.id)
        .execute();
      for (const r of docs) {
        const issue = await db
          .selectFrom('invoice_issue')
          .select('id')
          .where('invoice_id', '=', r.id)
          .executeTakeFirst();
        await db
          .updateTable('invoice_document')
          .set({ group_id: null, state: issue ? 'issued' : 'audited', revision: r.revision + 1 })
          .where('id', '=', r.id)
          .execute();
      }
      await svc.log.write({
        action: 'invoice.revoke',
        summary: `整体撤销发票凭证 ${v.displayNo}`,
        targetType: 'invoice_group',
        targetId: g.id,
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
      const { startPeriod } = await svc.book.info();
      const out = [];
      for (const direction of ['input', 'output'] as const) {
        const cfg = await settings(direction);
        const map = cfg ? await validateMapping(cfg.tax) : null;
        for (let m = 1; m <= 12; m += input.groupBy === 'quarter' ? 3 : 1) {
          const from = input.year * 100 + m,
            to = from + (input.groupBy === 'quarter' ? 2 : 0);
          const active = to >= startPeriod;
          const effectiveFrom = active ? Math.max(from, startPeriod) : null;
          const docs = invoices.filter(
            (d) =>
              d.direction === direction &&
              effectiveFrom != null &&
              d.period >= effectiveFrom &&
              d.period <= to &&
              d.invoiceStatus === 'normal',
          );
          const entries =
            map && effectiveFrom != null
              ? await svc.ledger.entries({
                  periodFrom: effectiveFrom,
                  periodTo: to,
                  accountIds: [map.accountId],
                  includeChildren: false,
                  includeUnposted: input.includeUnposted,
                  limit: 200000,
                })
              : [];
          const balances =
            map && effectiveFrom != null
              ? await svc.ledger.balances({
                  periodFrom: effectiveFrom,
                  periodTo: to,
                  accountCodes: [map.accountCode],
                  rollup: false,
                  includeUnposted: input.includeUnposted,
                })
              : [];
          const book = !active
            ? null
            : safeSum(
                balances.map((r) =>
                  direction === 'input'
                    ? safeSum([r.debit, -r.credit])
                    : safeSum([r.credit, -r.debit]),
                ),
              );
          const face = !active ? null : safeSum(docs.map((d) => d.tax));
          out.push({
            key: `${direction}-${from}`,
            direction,
            from,
            to,
            configured: !!map,
            active,
            startPeriod,
            effectiveFrom,
            partial: effectiveFrom != null && effectiveFrom > from,
            accountCode: map?.accountCode ?? null,
            face,
            book,
            difference: book == null || face == null ? null : safeSum([book, -face]),
            count: active ? docs.length : null,
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
    settlementParent,
    selected,
  };
  return self;
}
