import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BusinessError, periodOfDate, sumCents } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { isInDatabaseTransaction } from '@caiwu/db';
import {
  InvoiceIssueInputSchema,
  InvoiceIssueReferencesSchema,
  SaveInvoiceIssueSchema,
  type InvoiceIssueInput,
  type InvoiceIssueReferencesInput,
  type InvoiceIssuePlan,
  type SaveInvoiceIssueInput,
} from '../invoice-issue';
import type { DocumentInput } from '../shared';
import { priceLine } from '../math';
import type { InventoryTables } from './migrations';
import { e6, fail, inventoryService, quantity } from './service';

const secret = randomBytes(32);
const lifetime = 5 * 60 * 1000;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function authorize(svc: CoreServices) {
  if (svc.moduleId !== 'invoice')
    fail('INVOICE_OWNER', '发票出库只能从发票业务办理', '请返回发票处理页面重新操作');
  svc.permissions.require('invoice.voucher');
}
async function assertInventoryProduct(svc: CoreServices) {
  if ((await svc.book.info()).product !== 'chengben')
    fail(
      'INVOICE_PRODUCT',
      '本账套未启用仓库进销存，不能生成出库单',
      '请在启用仓库进销存的成本会计账套中办理',
    );
}

export async function invoiceIssueReferences(
  svc: CoreServices,
  raw: InvoiceIssueReferencesInput = {},
) {
  authorize(svc);
  const parsed = InvoiceIssueReferencesSchema.safeParse(raw);
  if (!parsed.success)
    fail('INVOICE_INPUT', '发票目录查询参数不正确', '请重新选择发票后刷新出库目录');
  return svc.tx(async (t) => {
    await assertInventoryProduct(t);
    const s = inventoryService(t),
      db = t.db.withTables<InventoryTables>();
    const warehouses = (await s.warehouses())
      .filter((w) => !w.disabled)
      .map(({ id, code, name }) => ({ id, code, name }));
    const products = (await s.products()).map(
      ({ id, code, name, specification, unit, inventoryAccountId, salesAccountId, disabled }) => ({
        id,
        code,
        name,
        specification,
        unit,
        inventoryAccountId,
        salesAccountId,
        disabled,
      }),
    );
    let originalDocument: { id: number; revision: number; number: string; date: string } | null =
      null;
    if (parsed.data.invoiceId !== undefined) {
      const source = await db
        .selectFrom('inventory_invoice_source')
        .select('document_id')
        .where('invoice_id', '=', parsed.data.invoiceId)
        .executeTakeFirst();
      if (source) {
        const d = await s.getDocument(source.document_id);
        if (
          d.kind !== 'issue' ||
          d.source_type !== 'invoice' ||
          d.source_id !== parsed.data.invoiceId
        )
          fail('INVOICE_SOURCE', '发票与原出库单的来源关联不一致', '请核对当前发票的出库记录');
        originalDocument = { id: d.id, revision: d.revision, number: d.number, date: d.date };
      }
    }
    return { warehouses, products, originalDocument };
  });
}
function parseInput(raw: InvoiceIssueInput) {
  if (
    raw?.redLetter ||
    (raw &&
      Array.isArray(raw.lines) &&
      raw.lines.some(
        (l) =>
          l &&
          (String(l.quantity).startsWith('-') ||
            String(l.unitPrice).startsWith('-') ||
            l.netCents < 0 ||
            l.taxCents < 0 ||
            l.totalCents < 0),
      ))
  )
    fail(
      'INVOICE_RED',
      '红字发票或退货不能转成正向出库单',
      '红字退货出入库尚未提供，请保留原发票并使用相应退货处理',
    );
  const parsed = InvoiceIssueInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new BusinessError({
      code: 'INVENTORY_INVOICE_INPUT',
      message: /[\u4e00-\u9fff]/.test(parsed.error.issues[0]?.message ?? '')
        ? parsed.error.issues[0]!.message
        : '发票出库的字段、日期、数量或金额格式不正确',
      hint: '请核对每行产品、正数量、非负单价、税率和金额后重新预览',
    });
  return parsed.data;
}
function safe(n: number) {
  if (!Number.isSafeInteger(n)) fail('INVOICE_RANGE', '发票出库的数量或金额合计超出允许范围');
  return n;
}
const result = (d: { id: number; revision: number }) => ({
  id: d.id,
  revision: d.revision,
});

async function prepare(svc: CoreServices, raw: InvoiceIssueInput) {
  await assertInventoryProduct(svc);
  const input = parseInput(raw),
    s = inventoryService(svc);
  const db = svc.db.withTables<InventoryTables>();
  const payloadHash = digest(input);
  const done = await db
    .selectFrom('inventory_invoice_request')
    .selectAll()
    .where('request_key', '=', input.requestKey)
    .executeTakeFirst();
  if (done) {
    if (
      done.payload_hash !== payloadHash ||
      done.created_by !== svc.user.id ||
      done.invoice_id !== input.invoiceId
    )
      fail(
        'INVOICE_REQUEST',
        '同一发票出库请求编号被用于其他内容或操作员',
        '重新发起预览，不要复用其他保存的请求编号',
      );
    const current = await db
      .selectFrom('inventory_invoice_source')
      .selectAll()
      .where('invoice_id', '=', input.invoiceId)
      .executeTakeFirst();
    if (
      !current ||
      current.request_key !== input.requestKey ||
      current.document_id !== done.document_id
    )
      fail(
        'INVOICE_REQUEST_OLD',
        '这次发票出库请求对应的单据已经后续更新',
        '重新打开当前出库单并重新预览，不能用旧请求覆盖后续处理',
      );
    const d = await s.getDocument(done.document_id);
    if (d.source_type !== 'invoice' || d.source_id !== input.invoiceId)
      fail('INVOICE_SOURCE', '既有发票出库来源关联不一致，请核对原单');
    return { input, payloadHash, done: d } as const;
  }
  const existing = await db
    .selectFrom('inventory_invoice_source')
    .selectAll()
    .where('invoice_id', '=', input.invoiceId)
    .executeTakeFirst();
  let old = null;
  if (existing) {
    if (!input.originalDocument || input.originalDocument.id !== existing.document_id)
      fail(
        'INVOICE_SOURCE',
        '这张发票已经转出库，不能再生成另一张出库单',
        '选择已有出库单并核对版本后，明确确认替换',
      );
    old = await s.getDocument(existing.document_id);
    if (old.revision !== input.originalDocument.revision)
      fail('REVISION', '原发票出库单已被修改', '重新打开原单并重新预览');
    if (old.source_type !== 'invoice' || old.source_id !== input.invoiceId || old.kind !== 'issue')
      fail('INVOICE_SOURCE', '原出库单不属于这张发票，不能替换');
    await s.sourceUnlocked(old);
  } else if (input.originalDocument) fail('INVOICE_SOURCE', '当前发票没有这张来源出库单，不能替换');
  await s.warehouse(input.warehouseId);
  await s.unlocked(input.date);
  await svc.periods.assertWritable({
    period: periodOfDate(input.date),
    oldPeriod: old?.period,
    mode: 'business',
    action: '发票转出库',
  });
  for (const [id, label] of [
    [input.settlementAccountId, '结算科目'],
    [input.costAccountId, '成本科目'],
  ] as const) {
    const account = await svc.accounts.require(id);
    if (!account.isLeaf || account.disabled)
      fail('INVOICE_ACCOUNT', `${label}必须为启用的末级科目`, '请在发票出库参数中重新选择科目');
  }
  const duplicate = await db
    .selectFrom('inventory_document')
    .select('id')
    .where('kind', '=', 'issue')
    .where('warehouse_id', '=', input.warehouseId)
    .where('number', '=', input.number)
    .executeTakeFirst();
  if (duplicate && duplicate.id !== old?.id)
    fail('NUMBER', `出库单号 ${input.number} 重复`, '请填写新的单号后重新预览');
  const products = await s.products();
  const byCode = new Map(products.map((p) => [p.code, p]));
  const newByCode = new Map<string, (typeof input.newProducts)[number]>();
  const used = new Set(input.lines.map((l) => l.productCode));
  for (const p of input.newProducts) {
    if (newByCode.has(p.code)) fail('INVOICE_PRODUCT', `待新增产品编号 ${p.code} 重复`);
    if (byCode.has(p.code))
      fail(
        'INVOICE_PRODUCT',
        `产品 ${p.code} 已存在，不能按新增产品处理`,
        '刷新产品档案并重新选择已有产品',
      );
    if (!used.has(p.code))
      fail('INVOICE_PRODUCT', `新产品 ${p.code} 没有用于本次发票出库`, '移除无关产品后重新预览');
    await s.checkProduct({ ...p, salesAccountId: p.salesAccountId ?? null });
    newByCode.set(p.code, p);
  }
  const lineValues = input.lines.map((line, i) => {
    const product = byCode.get(line.productCode);
    if (!product && !newByCode.has(line.productCode))
      fail(
        'INVOICE_PRODUCT',
        `第 ${i + 1} 行产品 ${line.productCode} 不存在`,
        '选择已有产品，或填写完整新产品档案并确认新增',
      );
    if (product?.disabled) fail('DISABLED', `第 ${i + 1} 行产品 ${line.productCode} 已停用`);
    const value = priceLine(line.quantity, line.unitPrice, line.taxRate, false);
    if (
      line.netCents !== value.net_cents ||
      line.taxCents !== value.tax_cents ||
      line.totalCents !== value.gross_cents ||
      safe(line.netCents + line.taxCents) !== line.totalCents
    )
      fail(
        'INVOICE_AMOUNT',
        `第 ${i + 1} 行发票净额、税额、合计与数量、单价和税率不一致`,
        '核对原发票明细，不能改用零税率或虚构金额',
      );
    return { ...value, tax_rate: line.taxRate };
  });
  const available = await s.balances(input.warehouseId);
  if (old?.warehouse_id === input.warehouseId)
    for (const line of old.lines)
      available.set(
        line.product_id,
        safe((available.get(line.product_id) ?? 0) + line.quantity_e6),
      );
  const totals = new Map<string, number>();
  for (const line of input.lines)
    totals.set(line.productCode, safe((totals.get(line.productCode) ?? 0) + e6(line.quantity)));
  const shortages = [];
  for (const [code, requested] of totals) {
    const product = byCode.get(code),
      current = product ? (available.get(product.id) ?? 0) : 0;
    if (current < requested)
      shortages.push({
        warehouseId: input.warehouseId,
        productCode: code,
        availableQuantity: quantity(current),
        requiredQuantity: quantity(requested),
        shortageQuantity: quantity(safe(requested - current)),
      });
  }
  const document: DocumentInput = {
    ...(old ? { id: old.id, revision: old.revision } : {}),
    requestKey: `invoice:${input.requestKey}`,
    kind: 'issue',
    warehouseId: input.warehouseId,
    number: input.number,
    date: input.date,
    category: '销售',
    operator: svc.user.name,
    summary: `发票 ${input.invoiceId} 转出库`,
    accountId: input.settlementAccountId,
    costAccountId: input.costAccountId,
    taxRate: input.lines[0]!.taxRate,
    lines: input.lines.map((l) => ({
      productCode: l.productCode,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      priceIncludesTax: false,
    })),
  };
  const context = await s.context();
  return {
    input,
    payloadHash,
    done: null,
    existing,
    old,
    document,
    lineValues,
    shortages,
    newProducts: input.newProducts,
    stockRevision: context.control.stock_revision,
    snapshot: {
      bookId: context.book.id,
      user: svc.user.id,
      module: svc.moduleId,
      control: context.control,
      products,
      warehouses: await s.warehouses(),
      accounts: await svc.accounts.list(),
      periods: await svc.periods.list(),
      existing,
    },
    totals: {
      netCents: sumCents(input.lines.map((l) => l.netCents)),
      taxCents: sumCents(input.lines.map((l) => l.taxCents)),
      grossCents: sumCents(input.lines.map((l) => l.totalCents)),
    },
  } as const;
}
function fingerprint(
  input: unknown,
  snapshot: unknown,
  plan: Omit<InvoiceIssuePlan, 'fingerprint'>,
) {
  return createHmac('sha256', secret)
    .update(JSON.stringify({ input, snapshot, ...plan }))
    .digest('hex');
}

export async function previewInvoiceIssue(svc: CoreServices, input: InvoiceIssueInput) {
  authorize(svc);
  return svc.tx(async (t) => {
    const prepared = await prepare(t, input);
    const expiresAt = t.ctx.now().getTime() + lifetime;
    const stockRevision = prepared.done
      ? (await inventoryService(t).control()).stock_revision
      : prepared.stockRevision;
    const shortages = prepared.done ? [] : prepared.shortages;
    return {
      expiresAt,
      stockRevision,
      shortages,
      fingerprint: fingerprint(
        prepared.input,
        prepared.done ? { done: prepared.done.id } : prepared.snapshot,
        { expiresAt, stockRevision, shortages },
      ),
    };
  });
}

export async function saveInvoiceIssue(svc: CoreServices, raw: SaveInvoiceIssueInput) {
  authorize(svc);
  if (!svc.db.isTransaction || !isInDatabaseTransaction())
    fail(
      'TRANSACTION_REQUIRED',
      '发票转出库必须与发票状态在同一事务中保存',
      '请从当前发票处理事务调用专用库存能力',
    );
  // tx also checks that this exact service still belongs to the active transaction.
  return svc.tx(async (t) => {
    parseInput(raw.input);
    const parsed = SaveInvoiceIssueSchema.safeParse(raw);
    if (!parsed.success)
      fail('INVOICE_INPUT', '发票出库预览计划或确认参数不正确', '重新预览后明确确认');
    const { input, plan } = parsed.data;
    const p = await prepare(t, input);
    if (p.done) return result(p.done);
    if (plan.expiresAt <= t.ctx.now().getTime() || plan.stockRevision !== p.stockRevision)
      fail('INVOICE_PREVIEW', '发票出库预览已过期或库存已变化', '重新预览并核对库存差额后再保存');
    if (JSON.stringify(plan.shortages) !== JSON.stringify(p.shortages))
      fail('INVOICE_PREVIEW', '发票出库预览的库存差额与当前数据不一致', '重新预览并核对后保存');
    const expected = fingerprint(input, p.snapshot, {
      expiresAt: plan.expiresAt,
      stockRevision: plan.stockRevision,
      shortages: p.shortages,
    });
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(plan.fingerprint)))
      fail('INVOICE_PREVIEW', '发票出库内容、账套、操作员或档案已变化', '重新预览后再确认保存');
    if (p.newProducts.length && !parsed.data.newProductsConfirmed)
      fail(
        'INVOICE_CONFIRM',
        '尚未确认新增产品，未保存任何出库数据',
        '核对待新增产品的编号、名称和科目后明确确认',
      );
    if (p.old && !parsed.data.replacementConfirmed)
      fail('INVOICE_CONFIRM', '替换原发票出库单需要明确确认', '核对原单号及其库存影响后再次确认');
    if (p.shortages.length) {
      t.permissions.require('inventory.negative-stock');
      if (!parsed.data.negativeStockConfirmed)
        fail(
          'INVOICE_NEGATIVE',
          '发票出库数量超过可用库存，尚未明确确认',
          '核对预览中的当前量、申请量和差额，默认取消',
        );
    }
    const s = inventoryService(t),
      db = t.db.withTables<InventoryTables>();
    for (const product of p.newProducts)
      await s.saveProduct({ ...product, salesAccountId: product.salesAccountId ?? null });
    const saved = await s.saveDocument(p.document, {
      invoiceId: input.invoiceId,
      lineValues: p.lineValues,
      negativeConfirmed: parsed.data.negativeStockConfirmed,
    });
    const source = {
      invoice_id: input.invoiceId,
      document_id: saved.id,
      request_key: input.requestKey,
      payload_hash: p.payloadHash,
      created_by: t.user.id,
    };
    await db
      .insertInto('inventory_invoice_source')
      .values(source)
      .onConflict((oc) => oc.column('invoice_id').doUpdateSet(source))
      .execute();
    await db.insertInto('inventory_invoice_request').values(source).execute();
    await t.log.write({
      action: 'inventory.invoice.issue',
      summary: `${p.old ? '替换' : '生成'}发票出库单 ${saved.number}`,
      targetId: saved.id,
      detail: {
        invoiceId: input.invoiceId,
        newProducts: p.newProducts.map((v) => v.code),
        negativeStockConfirmed: parsed.data.negativeStockConfirmed,
      },
    });
    return result(saved);
  });
}
