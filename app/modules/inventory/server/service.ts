import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  BusinessError,
  Decimal,
  multiplyToCents,
  periodEndDate,
  periodOfDate,
  periodStartDate,
  sumCents,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { sql } from '@caiwu/db';
import { pinyin } from 'pinyin-pro';
import {
  BulkSchema,
  ContractSchema,
  CountSchema,
  DocumentSchema,
  FilterSchema,
  OpeningSchema,
  ProductSchema,
  SettingsSchema,
  WarehouseSchema,
  type ContractInput,
  type DocumentInput,
  type Filter,
  type OpeningInput,
  type ProductInput,
} from '../shared';
import type { z } from 'zod';
import { priceLine } from '../math';
import { openingValue } from '../opening';
import type { InventoryTables } from './migrations';
import {
  assertContractHistoryWrite,
  assertContractReceipt,
  assertContractWithinPlan,
  contractFulfillment,
} from './contracts';
const secret = randomBytes(32);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function fail(code: string, message: string, hint = '请检查当前数据后重试'): never {
  throw new BusinessError({ code: `INVENTORY_${code}`, message, hint });
}
export function e6(v: string): number {
  const d = new Decimal(v).mul(1_000_000);
  const n = d.toNumber();
  if (!d.isInteger() || !Number.isSafeInteger(n))
    fail('QUANTITY', '数量超出允许范围或超过六位小数');
  return n;
}
export const quantity = (n: number) => new Decimal(n).div(1_000_000).toFixed();
function safe(n: number) {
  if (!Number.isSafeInteger(n)) fail('OVERFLOW', '数量或金额合计超出允许范围');
  return n;
}
type CostedMovement = {
  calculation_status: string;
  line_calculation_status: string;
  outbound_cost_cents: number | null;
  calculation_batch: string | null;
  line_calculation_batch: string | null;
  calculation_period: number | null;
  line_calculation_period: number | null;
};
function issueCost(line: CostedMovement): number | null {
  return line.calculation_status === 'calculated' &&
    line.line_calculation_status === 'calculated' &&
    line.calculation_batch === line.line_calculation_batch &&
    line.calculation_period === line.line_calculation_period &&
    line.outbound_cost_cents != null
    ? safe(line.outbound_cost_cents)
    : null;
}
function totalIssueCost(lines: CostedMovement[]): number | null {
  const costs = lines.map(issueCost);
  return costs.some((c) => c == null) ? null : sumCents(costs);
}
function countAmount(bookCents: number | null, bookE6: number, actualE6: number): number | null {
  if (bookCents == null) return null;
  if (!bookE6) return !actualE6 && bookCents === 0 ? 0 : null;
  return safe(
    new Decimal(bookCents)
      .mul(actualE6)
      .div(bookE6)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber(),
  );
}
export { priceLine } from '../math';
export type InvoiceDocumentOptions = {
  invoiceId: number;
  lineValues: {
    unit_price: string;
    tax_unit_price: string;
    net_cents: number;
    tax_cents: number;
    gross_cents: number;
    tax_rate: string;
  }[];
  negativeConfirmed: boolean;
};
export function inventoryService(svc: CoreServices) {
  const db = svc.db.withTables<InventoryTables>();
  const control = () =>
    db.selectFrom('inventory_control').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
  const bump = () =>
    db
      .updateTable('inventory_control')
      .set({ stock_revision: sql`stock_revision+1` })
      .where('id', '=', 1)
      .execute();
  const checkRevision = (actual: number, expected: number | undefined) => {
    if (actual !== expected)
      fail('REVISION', '数据已被其他操作修改', '请重新打开后再保存；未保存内容仍保留');
  };
  const warehouse = async (id: number, active = true) => {
    const w = await db
      .selectFrom('inventory_warehouse')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!w) fail('WAREHOUSE', '当前账套中没有这个仓库');
    if (active && w.disabled) fail('DISABLED', `仓库 ${w.code} 已停用`);
    return w;
  };
  const product = async (code: string, position?: number) => {
    const p = await db
      .selectFrom('inventory_product')
      .selectAll()
      .where('code', '=', code)
      .executeTakeFirst();
    if (!p)
      fail(
        'PRODUCT',
        `${position ? `第 ${position} 行：` : ''}产品 ${code} 不存在`,
        '先在本模块产品档案维护产品，再重新选择',
      );
    return p;
  };
  const account = async (id: number | null, label: string, required = false) => {
    if (id == null) {
      if (required) fail('ACCOUNT', `${label}不能为空`);
      return;
    }
    const a = await svc.accounts.require(id);
    if (!a.isLeaf || a.disabled) fail('ACCOUNT', `${label} ${a.code} 必须为启用的末级科目`);
  };
  const used = async (id: number) => {
    for (const t of [
      'inventory_opening',
      'inventory_line',
      'inventory_count_line',
      'inventory_contract_line',
    ] as const) {
      if (await db.selectFrom(t).select('id').where('product_id', '=', id).executeTakeFirst())
        return true;
    }
    return false;
  };
  const unlocked = async (date: string) => {
    await svc.periods.assertOpen(periodOfDate(date), '修改仓库业务');
    if (
      await db
        .selectFrom('inventory_costing_month_lock')
        .select('period')
        .where('period', '=', periodOfDate(date))
        .executeTakeFirst()
    )
      fail('CUTOFF', '本月库存已经正式核算，来源业务已锁定');
    const c = await control();
    if (
      (c.cost_cutoff_date && date <= c.cost_cutoff_date) ||
      (c.cost_period && periodOfDate(date) <= c.cost_period)
    )
      fail(
        'CUTOFF',
        `日期 ${date} 已在成本核算截止点 ${c.cost_cutoff_date ?? periodEndDate(c.cost_period!)} 内`,
        '请查询历史单据，成本核算撤销由后续成本模块处理',
      );
  };
  const document = async (id: number) => {
    const r = await db
      .selectFrom('inventory_document')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) fail('NOT_FOUND', `单据 ${id} 已不存在`, '请刷新列表，不要按行序号定位单据');
    return r;
  };
  const sourceUnlocked = async (r: Awaited<ReturnType<typeof document>>, audit = false) => {
    await unlocked(r.date);
    if (
      await db
        .selectFrom('inventory_voucher_source')
        .select('voucher_id')
        .where('document_id', '=', r.id)
        .executeTakeFirst()
    )
      fail(
        'VOUCHER',
        `单据 ${r.number} 已关联来源凭证，不能修改、删除或撤销审核`,
        '请在所属模块处理对应用途的凭证',
      );
    if (
      r.calculation_status !== 'uncalculated' ||
      r.calculation_batch ||
      r.calculation_period ||
      r.calculation_cutoff_date
    )
      fail('CALCULATED', `单据 ${r.number} 已核算，不能修改或撤销`);
    if (
      await db
        .selectFrom('inventory_line')
        .select('id')
        .where('document_id', '=', r.id)
        .where((eb) =>
          eb.or([
            eb('calculation_status', '!=', 'uncalculated'),
            eb('calculation_batch', 'is not', null),
            eb('calculation_period', 'is not', null),
          ]),
        )
        .executeTakeFirst()
    )
      fail('CALCULATED', `单据 ${r.number} 的明细已参与核算，不能修改或撤销`);
    if (r.voucher_id != null)
      fail(
        'VOUCHER',
        `单据 ${r.number} 已关联会计凭证，不能直接修改、删除或撤销审核`,
        '凭证处理由后续成本模块统一提供',
      );
    if (!audit && r.audited_by != null)
      fail(
        'AUDITED',
        `单据 ${r.number} 已审核，不能修改或删除`,
        '先由原审核人或获授权管理员取消审核',
      );
  };
  const pairedTransfer = (id: number) =>
    db
      .selectFrom('inventory_transfer')
      .select(['id', 'number'])
      .where((eb) => eb.or([eb('issue_document_id', '=', id), eb('receipt_document_id', '=', id)]))
      .executeTakeFirst();
  const protectedDocument = async (id: number, removing = false, invoiceId?: number) => {
    const source = await document(id);
    if (source.source_type === 'invoice' && source.source_id !== invoiceId)
      fail(
        'INVOICE_SOURCE',
        '这张出库单由发票生成，不能在普通库存入口修改或删除',
        '请从发票处理办理原发票的出库更新',
      );
    if (
      invoiceId !== undefined &&
      (source.source_type !== 'invoice' || source.source_id !== invoiceId)
    )
      fail('INVOICE_SOURCE', '只能更新当前发票已经关联的出库单');
    const transfer = await pairedTransfer(id);
    if (transfer)
      fail(
        'TRANSFER_PAIR',
        `单据属于调拨 ${transfer.number}，不能单独修改或删除`,
        '请进入仓库调拨成对处理',
      );
    const reversal = await db
      .selectFrom('inventory_reversal')
      .selectAll()
      .where((eb) =>
        eb.or([eb('original_document_id', '=', id), eb('reversal_document_id', '=', id)]),
      )
      .executeTakeFirst();
    if (reversal && (!removing || reversal.original_document_id === id))
      fail(
        'REVERSAL_LOCK',
        '单据已有反冲关联，不能修改或删除原单',
        '需要撤销反冲时，先删除尚未审核、尚未核算的反冲单',
      );
  };
  const openingUnlocked = async () => {
    if (await db.selectFrom('inventory_costing_month_lock').select('period').executeTakeFirst())
      fail('OPENING_LOCKED', '库存期初已被正式成本批次锁定');
    const b = await svc.book.info();
    const c = await control();
    const current = await svc.periods.current();
    await svc.periods.assertWritable({
      period: b.startPeriod,
      mode: 'opening',
      action: '修改库存期初',
    });
    if (
      c.opening_locked ||
      c.cost_cutoff_date ||
      c.cost_period ||
      current?.period !== b.startPeriod
    )
      fail(
        'OPENING_LOCKED',
        `库存期初已锁定，核算截止月：${c.cost_period ?? '尚未核算'}，当前期间：${current?.period ?? '无'}`,
        '库存期初只能在启用期间且尚未成本核算时修改',
      );
    if (
      await db
        .selectFrom('inventory_opening')
        .select('id')
        .where((eb) =>
          eb.or([
            eb('calculation_status', '!=', 'uncalculated'),
            eb('calculation_batch', 'is not', null),
            eb('calculation_period', 'is not', null),
          ]),
        )
        .executeTakeFirst()
    )
      fail('OPENING_LOCKED', '库存期初已参与成本核算');
  };
  const movements = async (filter: Filter = {}) => {
    const f = FilterSchema.parse(filter);
    let q = db
      .selectFrom('inventory_line as l')
      .innerJoin('inventory_document as d', 'd.id', 'l.document_id')
      .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
      .select([
        'l.id',
        'l.product_id',
        'l.quantity_e6',
        'l.unit_price',
        'l.tax_unit_price',
        'l.net_cents',
        'l.tax_cents',
        'l.gross_cents',
        'l.outbound_cost_cents',
        'l.unit_cost',
        'l.calculation_status as line_calculation_status',
        'l.calculation_batch as line_calculation_batch',
        'l.calculation_period as line_calculation_period',
        'l.note',
        'd.id as document_id',
        'd.warehouse_id',
        'd.kind',
        'd.date',
        'd.number',
        'd.category',
        'd.summary',
        'd.account_id',
        'd.cost_account_id',
        'd.calculation_status',
        'd.calculation_batch',
        'd.calculation_period',
        'p.code',
        'p.name',
        'p.unit',
      ])
      .orderBy('d.date')
      .orderBy('d.id')
      .orderBy('l.position');
    if (f.warehouseId) q = q.where('d.warehouse_id', '=', f.warehouseId);
    if (f.productCode) q = q.where('p.code', '=', f.productCode);
    if (f.productFrom) q = q.where('p.code', '>=', f.productFrom);
    if (f.productTo) q = q.where('p.code', '<=', f.productTo);
    if (f.to) q = q.where('d.date', '<=', f.to);
    return q.execute();
  };
  const balances = async (warehouseId: number, to?: string) => {
    const b = await svc.book.info();
    const rows = await db
      .selectFrom('inventory_opening')
      .select(['product_id', 'quantity_e6'])
      .where('warehouse_id', '=', warehouseId)
      .execute();
    const out = new Map<number, number>();
    if (!to || to >= periodStartDate(b.startPeriod))
      for (const r of rows) out.set(r.product_id, r.quantity_e6);
    for (const l of await movements({ warehouseId, to })) {
      out.set(
        l.product_id,
        safe(
          (out.get(l.product_id) ?? 0) + (l.kind === 'receipt' ? l.quantity_e6 : -l.quantity_e6),
        ),
      );
    }
    for (const a of await adjustments(warehouseId, to))
      out.set(a.product_id, safe((out.get(a.product_id) ?? 0) + a.quantity_e6));
    return out;
  };
  const adjustments = async (warehouseId: number, to?: string) => {
    const rows = await db
      .selectFrom('inventory_costing_adjustment as a')
      .innerJoin('inventory_costing_batch as b', 'b.id', 'a.batch_id')
      .selectAll('a')
      .select('b.period')
      .where('b.status', '=', 'calculated')
      .where('a.warehouse_id', '=', warehouseId)
      .orderBy('b.period')
      .orderBy('a.product_id')
      .execute();
    return rows
      .map((a) => ({ ...a, date: periodEndDate(a.period) }))
      .filter((a) => !to || a.date <= to);
  };
  const prepare = async (raw: DocumentInput, invoiceId?: number) => {
    if (invoiceId !== undefined) {
      if (svc.moduleId !== 'invoice') fail('INVOICE_OWNER', '发票来源出库只能由发票处理调用');
      svc.permissions.require('invoice.voucher');
    }
    const input = DocumentSchema.parse(raw);
    await warehouse(input.warehouseId);
    await unlocked(input.date);
    if (
      (input.kind === 'receipt' && !['采购', '其他入库'].includes(input.category)) ||
      (input.kind === 'issue' && !['销售', '领用', '其他出库'].includes(input.category))
    )
      fail('CATEGORY', '单据方向与类别不匹配');
    await account(
      input.accountId,
      input.kind === 'receipt' ? '付款科目' : '收款科目',
      input.kind === 'receipt' || input.category === '销售',
    );
    await account(input.costAccountId, '成本科目', input.kind === 'issue');
    if (!input.lines.length)
      fail('EMPTY', '单据没有明细，未删除原单', '返回编辑补充明细；确需删除请使用删除并确认');
    const old = input.id ? await document(input.id) : null;
    if (old) {
      checkRevision(old.revision, input.revision);
      await protectedDocument(old.id, false, invoiceId);
      await sourceUnlocked(old);
      if (input.sourceType === 'document' && input.sourceId === input.id)
        fail('SOURCE', '单据不能以自身作为来源');
      if (
        invoiceId === undefined &&
        (old.source_type !== input.sourceType || old.source_id !== input.sourceId)
      )
        fail(
          'SOURCE_CHANGE',
          '已保存单据的来源关联不能在编辑时改换或清除',
          '请保留来源关系；确需重办时先确认删除尚未审核、尚未核算的原单，再新增正确来源单据',
        );
      if (old.kind !== input.kind) fail('KIND', '不能改变单据的出入库方向');
    }
    const duplicate = await db
      .selectFrom('inventory_document')
      .select('id')
      .where('kind', '=', input.kind)
      .where('warehouse_id', '=', input.warehouseId)
      .where('number', '=', input.number)
      .executeTakeFirst();
    if (duplicate && duplicate.id !== input.id)
      fail(
        'NUMBER',
        `单号 ${input.number} 在当前仓库同方向中重复`,
        '修改单号；需要系统重算时请明确点击自动编号',
      );
    if ((input.sourceType == null) !== (input.sourceId == null))
      fail('SOURCE', '来源类型与来源ID必须同时填写或同时留空');
    if (input.sourceType === 'contract') {
      const c = await db
        .selectFrom('inventory_contract')
        .selectAll()
        .where('id', '=', input.sourceId ?? 0)
        .executeTakeFirst();
      if (
        !c ||
        c.warehouse_id !== input.warehouseId ||
        input.kind !== 'receipt' ||
        c.status !== 'open'
      )
        fail('SOURCE', '来源采购合同不存在、已结束或仓库不符');
      await assertContractReceipt(svc, input);
    } else if (input.sourceType === 'document') {
      if (!input.sourceId) fail('SOURCE', '缺少来源单据');
      if (input.sourceId === input.id) fail('SOURCE', '单据不能以自身作为来源');
      const from = await document(input.sourceId);
      if (from.source_type === 'invoice')
        fail('INVOICE_SOURCE', '发票来源单据不能作为普通库存单据的复制来源', '请从发票处理办理');
    }
    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const p = await product(l.productCode, i + 1);
      if (p.disabled) fail('DISABLED', `第 ${i + 1} 行产品 ${p.code} 已停用`);
      lines.push({
        product_id: p.id,
        position: i + 1,
        quantity_e6: e6(l.quantity),
        price_includes_tax: l.priceIncludesTax ? 1 : 0,
        tax_rate: null,
        ...priceLine(l.quantity, l.unitPrice, input.taxRate, l.priceIncludesTax),
        note: l.note,
        productCode: p.code,
        productName: p.name,
      });
    }
    const available = await balances(input.warehouseId);
    if (old && old.warehouse_id === input.warehouseId) {
      for (const l of await db
        .selectFrom('inventory_line')
        .selectAll()
        .where('document_id', '=', old.id)
        .execute())
        available.set(
          l.product_id,
          safe(
            (available.get(l.product_id) ?? 0) -
              (old.kind === 'receipt' ? l.quantity_e6 : -l.quantity_e6),
          ),
        );
    }
    const totals = new Map<number, number>();
    for (const l of lines)
      totals.set(l.product_id, safe((totals.get(l.product_id) ?? 0) + l.quantity_e6));
    const shortages = [];
    if (input.kind === 'issue')
      for (const [id, requested] of totals) {
        const current = available.get(id) ?? 0;
        if (current < requested) {
          const p = lines.find((l) => l.product_id === id)!;
          shortages.push({
            productCode: p.productCode,
            productName: p.productName,
            current: quantity(current),
            requested: quantity(requested),
            difference: quantity(requested - current),
          });
        }
      }
    // Reducing/moving an inbound document must not silently strand existing issues.
    if (old?.kind === 'receipt') {
      const oldBalance =
        old.warehouse_id === input.warehouseId ? available : await balances(old.warehouse_id);
      if (old.warehouse_id !== input.warehouseId)
        for (const l of await db
          .selectFrom('inventory_line')
          .selectAll()
          .where('document_id', '=', old.id)
          .execute())
          oldBalance.set(l.product_id, safe((oldBalance.get(l.product_id) ?? 0) - l.quantity_e6));
      for (const [id, n] of oldBalance) {
        const result = n + (old.warehouse_id === input.warehouseId ? (totals.get(id) ?? 0) : 0);
        if (result < 0)
          fail(
            'INBOUND_USED',
            '原入库数量已经被出库使用，修改后会造成负库存',
            '先调整关联出库，再修改入库',
          );
      }
    }
    const c = await control();
    const { negativeConfirmation: _nc, ...payload } = input;
    const token = createHmac('sha256', secret)
      .update(
        JSON.stringify({
          payload,
          stockRevision: c.stock_revision,
          user: svc.user.id,
          book: (await svc.book.info()).id,
        }),
      )
      .digest('hex');
    return { input, old, lines, shortages, token, payload };
  };
  const self = {
    async context() {
      const b = await svc.book.info();
      return {
        book: b,
        current: await svc.periods.current(),
        control: await control(),
        settings: SettingsSchema.parse(
          await svc.settings.get('preferences', { numberRule: 'monthly', autoRefresh: true }),
        ),
      };
    },
    async products(keyword = '') {
      const rows = await db.selectFrom('inventory_product').selectAll().orderBy('code').execute();
      const k = keyword.trim().toLowerCase();
      return rows
        .map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          specification: p.specification,
          unit: p.unit,
          receiptPrice: p.receipt_price,
          issuePrice: p.issue_price,
          planPrice: p.plan_price,
          inventoryAccountId: p.inventory_account_id,
          salesAccountId: p.sales_account_id,
          allocationFactor: p.allocation_factor,
          disabled: !!p.disabled,
          revision: p.revision,
          search:
            `${p.code} ${p.name} ${pinyin(p.name, { pattern: 'first', toneType: 'none', type: 'array' }).join('')}`.toLowerCase(),
        }))
        .filter((p) => !k || p.search.includes(k));
    },
    async saveProduct(raw: ProductInput) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        const v = ProductSchema.parse(raw);
        await s.checkProduct(v);
        const data = {
          code: v.code,
          name: v.name,
          specification: v.specification,
          unit: v.unit,
          receipt_price: v.receiptPrice,
          issue_price: v.issuePrice,
          plan_price: v.planPrice,
          inventory_account_id: v.inventoryAccountId,
          sales_account_id: v.salesAccountId,
          allocation_factor: new Decimal(v.allocationFactor).isZero() ? '1' : v.allocationFactor,
          disabled: v.disabled ? 1 : 0,
        };
        let id = v.id;
        if (id) {
          await tdb
            .updateTable('inventory_product')
            .set({ ...data, revision: sql`revision+1` })
            .where('id', '=', id)
            .execute();
        } else {
          id = (
            await tdb
              .insertInto('inventory_product')
              .values({ ...data, revision: 1 })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
        await t.log.write({
          action: 'inventory.product.save',
          summary: `维护产品 ${v.code}`,
          targetId: id,
        });
        await s.bump();
        return (await s.products()).find((p) => p.id === id)!;
      });
    },
    async checkProduct(raw: ProductInput) {
      const v = ProductSchema.parse(raw);
      await account(v.inventoryAccountId, '存货科目');
      await account(v.salesAccountId, '销售科目');
      if (new Decimal(v.allocationFactor).isZero() && !v.confirmZeroFactor)
        fail('ZERO_FACTOR', `产品 ${v.code} 的费用分摊系数为零`, '明确确认改用 1 后再次保存');
      const dup = await db
        .selectFrom('inventory_product')
        .select('id')
        .where('code', '=', v.code)
        .executeTakeFirst();
      if (dup && dup.id !== v.id) fail('PRODUCT_CODE', `产品编号 ${v.code} 重复`);
      if (v.id) {
        const old = await db
          .selectFrom('inventory_product')
          .selectAll()
          .where('id', '=', v.id)
          .executeTakeFirst();
        if (!old) fail('PRODUCT', '当前账套中产品不存在');
        checkRevision(old.revision, v.revision);
        if (old.inventory_account_id !== v.inventoryAccountId && (await used(old.id)))
          fail(
            'ACCOUNT_USED',
            `产品 ${old.code} 已用于库存业务，不能变更存货科目`,
            '保留原科目，后续需要通过受控调整处理',
          );
      }
      return v;
    },
    async removeProducts(input: {
      products: { id: number; revision: number }[];
      confirmSet: boolean;
      confirmDelete: boolean;
    }) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        if (!input.products.length || !input.confirmSet || !input.confirmDelete)
          fail('CONFIRM', '需要先核对明确产品集合，再次确认删除');
        for (const p of input.products) {
          const row = await tdb
            .selectFrom('inventory_product')
            .selectAll()
            .where('id', '=', p.id)
            .executeTakeFirst();
          if (!row) fail('PRODUCT', '所选产品已不存在');
          checkRevision(row.revision, p.revision);
          if (await s.used(p.id)) fail('USED', `产品 ${row.code} 已使用，不能删除`, '可以停用产品');
        }
        await tdb
          .deleteFrom('inventory_product')
          .where(
            'id',
            'in',
            input.products.map((p) => p.id),
          )
          .execute();
        await t.log.write({
          action: 'inventory.product.delete',
          summary: '批量删除产品',
          detail: input.products,
        });
        await s.bump();
      });
    },
    async warehouses() {
      return db.selectFrom('inventory_warehouse').selectAll().orderBy('code').execute();
    },
    async saveWarehouse(raw: z.input<typeof WarehouseSchema>) {
      return svc.tx(async (t) => {
        const v = WarehouseSchema.parse(raw),
          tdb = t.db.withTables<InventoryTables>();
        const dup = await tdb
          .selectFrom('inventory_warehouse')
          .selectAll()
          .where('code', '=', v.code)
          .executeTakeFirst();
        if (dup && dup.id !== v.id) fail('WAREHOUSE_CODE', `仓库编码 ${v.code} 重复`);
        const data = { code: v.code, name: v.name, kind: v.kind, disabled: v.disabled ? 1 : 0 };
        let id = v.id;
        if (id) {
          const w = await inventoryService(t).warehouse(id, false);
          checkRevision(w.revision, v.revision);
          await tdb
            .updateTable('inventory_warehouse')
            .set({ ...data, revision: w.revision + 1 })
            .where('id', '=', id)
            .execute();
        } else {
          id = (
            await tdb
              .insertInto('inventory_warehouse')
              .values({ ...data, revision: 1 })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
        await t.log.write({ action: 'inventory.warehouse.save', summary: `维护仓库 ${v.code}` });
        await inventoryService(t).bump();
        return id;
      });
    },
    async removeWarehouse(v: { id: number; revision: number; confirmed: boolean }) {
      return svc.tx(async (t) => {
        t.permissions.require('inventory.edit');
        if (!v.confirmed) fail('CONFIRM', '删除仓库需要明确确认');
        const s = inventoryService(t),
          w = await s.warehouse(v.id, false);
        checkRevision(w.revision, v.revision);
        const tdb = t.db.withTables<InventoryTables>();
        const tables = [
          'inventory_opening',
          'inventory_document',
          'inventory_count',
          'inventory_contract',
          'inventory_costing_balance',
          'inventory_costing_adjustment',
        ] as const;
        for (const table of tables)
          if (
            await tdb
              .selectFrom(table)
              .select('warehouse_id')
              .where('warehouse_id', '=', w.id)
              .executeTakeFirst()
          )
            fail(
              'WAREHOUSE_USED',
              `仓库 ${w.code} 已有期初、单据、盘点、合同或核算历史，不能删除`,
              '请保留仓库并改为停用，以便查询历史业务',
            );
        await tdb.deleteFrom('inventory_warehouse').where('id', '=', w.id).execute();
        await s.bump();
        await t.log.write({
          action: 'inventory.warehouse.delete',
          summary: `删除未使用仓库 ${w.code}`,
          targetId: w.id,
        });
      });
    },
    async opening(warehouseId: number) {
      await warehouse(warehouseId, false);
      const c = await control();
      return {
        revision: c.opening_revision,
        rows: (
          await db
            .selectFrom('inventory_opening as o')
            .innerJoin('inventory_product as p', 'p.id', 'o.product_id')
            .select([
              'p.code as productCode',
              'p.name as productName',
              'o.quantity_e6',
              'o.unit_price as unitPrice',
              'o.amount_cents as amountCents',
              'o.value_basis as valueBasis',
            ])
            .where('o.warehouse_id', '=', warehouseId)
            .execute()
        ).map((r) => ({ ...r, quantity: quantity(r.quantity_e6) })),
      };
    },
    async saveOpening(raw: OpeningInput) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        const v = OpeningSchema.parse(raw);
        await s.warehouse(v.warehouseId);
        await s.openingUnlocked();
        checkRevision((await s.control()).opening_revision, v.revision);
        const old = await s.opening(v.warehouseId);
        if (old.rows.length && !v.confirmReplace)
          fail(
            'REPLACE',
            '当前仓库已存在期初数据',
            '预览完整替换集合后确认覆盖；空集合也会清空期初',
          );
        const seen = new Set<number>();
        const rows = [];
        for (const [i, r] of v.rows.entries()) {
          const p = await s.product(r.productCode, i + 1);
          if (p.disabled) fail('DISABLED', `产品 ${p.code} 已停用`);
          if (seen.has(p.id)) fail('DUPLICATE', `第 ${i + 1} 行产品 ${p.code} 重复`);
          seen.add(p.id);
          const value = openingValue(r);
          rows.push({
            warehouse_id: v.warehouseId,
            product_id: p.id,
            quantity_e6: e6(r.quantity),
            unit_price: value.unitPrice,
            amount_cents: value.amountCents,
            value_basis: value.valueBasis,
            calculation_status: 'uncalculated',
            calculation_batch: null,
            calculation_period: null,
          });
        }
        const balance = await s.balances(v.warehouseId);
        for (const r of old.rows) {
          const p = await s.product(r.productCode);
          balance.set(p.id, safe((balance.get(p.id) ?? 0) - e6(r.quantity)));
        }
        for (const r of rows)
          balance.set(r.product_id, safe((balance.get(r.product_id) ?? 0) + r.quantity_e6));
        if ([...balance.values()].some((v) => v < 0))
          fail('INBOUND_USED', '期初修改会造成负库存', '先调整已保存的出库单');
        await tdb
          .deleteFrom('inventory_opening')
          .where('warehouse_id', '=', v.warehouseId)
          .execute();
        if (rows.length) await tdb.insertInto('inventory_opening').values(rows).execute();
        await tdb
          .updateTable('inventory_control')
          .set({ opening_revision: sql`opening_revision+1` })
          .where('id', '=', 1)
          .execute();
        await s.bump();
        await t.log.write({ action: 'inventory.opening.save', summary: '保存库存期初', detail: v });
        return s.opening(v.warehouseId);
      });
    },
    async documents(filter: Filter = {}) {
      const f = FilterSchema.parse(filter);
      let q = db
        .selectFrom('inventory_document as d')
        .innerJoin('inventory_warehouse as w', 'w.id', 'd.warehouse_id')
        .leftJoin('app_user as u', 'u.id', 'd.audited_by')
        .selectAll('d')
        .select(['w.name as warehouse_name', 'u.name as auditor_name'])
        .orderBy('d.date', 'desc')
        .orderBy('d.id', 'desc');
      if (f.id) q = q.where('d.id', '=', f.id);
      if (f.kind) q = q.where('d.kind', '=', f.kind);
      if (f.warehouseId) q = q.where('d.warehouse_id', '=', f.warehouseId);
      if (f.from) q = q.where('d.date', '>=', f.from);
      if (f.to) q = q.where('d.date', '<=', f.to);
      if (f.category) q = q.where('d.category', '=', f.category);
      if (f.keyword)
        q = q.where((eb) =>
          eb.or([
            eb('d.number', 'like', `%${f.keyword}%`),
            eb('d.summary', 'like', `%${f.keyword}%`),
          ]),
        );
      if (f.unaudited) q = q.where('d.audited_by', 'is', null);
      if (f.unvouchered)
        q = q
          .where('d.voucher_id', 'is', null)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('inventory_voucher_source as vs')
                  .select('vs.voucher_id')
                  .whereRef('vs.document_id', '=', 'd.id'),
              ),
            ),
          );
      if (f.productCode) {
        const p = await product(f.productCode);
        q = q.where(
          'd.id',
          'in',
          db.selectFrom('inventory_line').select('document_id').where('product_id', '=', p.id),
        );
      }
      if (f.productFrom || f.productTo) {
        let matching = db
          .selectFrom('inventory_line as l')
          .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
          .select('l.document_id');
        if (f.productFrom) matching = matching.where('p.code', '>=', f.productFrom);
        if (f.productTo) matching = matching.where('p.code', '<=', f.productTo);
        q = q.where('d.id', 'in', matching);
      }
      const documents = await q.execute();
      const links = await db.selectFrom('inventory_voucher_source').selectAll().execute();
      const transfers = await db.selectFrom('inventory_transfer').selectAll().execute();
      const reversals = await db.selectFrom('inventory_reversal').selectAll().execute();
      return documents.map((d) => ({
        ...d,
        transfer: transfers.find(
          (p) => p.issue_document_id === d.id || p.receipt_document_id === d.id,
        ),
        reversal: reversals.find(
          (p) => p.original_document_id === d.id || p.reversal_document_id === d.id,
        ),
        voucherSources: links.filter((l) => l.document_id === d.id),
        voucher_id: d.voucher_id ?? links.find((l) => l.document_id === d.id)?.voucher_id ?? null,
      }));
    },
    async getDocument(id: number) {
      const r = await document(id);
      const voucherSources = await db
        .selectFrom('inventory_voucher_source')
        .selectAll()
        .where('document_id', '=', id)
        .execute();
      const lines = await db
        .selectFrom('inventory_line as l')
        .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
        .selectAll('l')
        .select(['p.code as productCode', 'p.name as productName'])
        .where('l.document_id', '=', id)
        .orderBy('l.position')
        .execute();
      return {
        ...r,
        voucher_id: r.voucher_id ?? voucherSources[0]?.voucher_id ?? null,
        voucherSources,
        transfer: await pairedTransfer(id),
        reversal: await db
          .selectFrom('inventory_reversal')
          .selectAll()
          .where((eb) =>
            eb.or([eb('original_document_id', '=', id), eb('reversal_document_id', '=', id)]),
          )
          .executeTakeFirst(),
        lines: lines.map((l) => ({
          ...l,
          quantity: quantity(l.quantity_e6),
          unitPrice: l.price_includes_tax ? l.tax_unit_price : l.unit_price,
          priceIncludesTax: !!l.price_includes_tax,
        })),
      };
    },
    async previewDocument(raw: DocumentInput) {
      return svc.tx(async (t) => {
        const p = await inventoryService(t).prepare(raw);
        return {
          shortages: p.shortages,
          confirmation: p.token,
          netCents: sumCents(p.lines.map((l) => l.net_cents)),
          taxCents: sumCents(p.lines.map((l) => l.tax_cents)),
          grossCents: sumCents(p.lines.map((l) => l.gross_cents)),
        };
      });
    },
    async saveDocument(raw: DocumentInput, invoice?: InvoiceDocumentOptions) {
      return svc.tx(async (t) => {
        assertContractHistoryWrite(t);
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        const parsed = DocumentSchema.parse(raw);
        if (invoice) {
          if (t.moduleId !== 'invoice') fail('INVOICE_OWNER', '发票来源出库只能由发票处理调用');
          t.permissions.require('invoice.voucher');
          if (parsed.kind !== 'issue' || invoice.lineValues.length !== parsed.lines.length)
            fail('INVOICE_INPUT', '发票出库方向或明细数量不正确');
        }
        const { negativeConfirmation: _n, ...req } = parsed;
        const payloadHash = hash(invoice ? { input: req, invoice } : req);
        const done = await tdb
          .selectFrom('inventory_request')
          .selectAll()
          .where('request_key', '=', parsed.requestKey)
          .executeTakeFirst();
        if (done) {
          if (done.payload_hash !== payloadHash)
            fail('REQUEST', '同一次保存的请求编号被用于不同内容', '重新发起保存');
          return s.getDocument(done.document_id);
        }
        const p = await s.prepare(parsed, invoice?.invoiceId),
          v = p.input;
        if (p.shortages.length) {
          t.permissions.require('inventory.negative-stock');
          if (!(invoice?.negativeConfirmed || v.negativeConfirmation === p.token))
            fail(
              'NEGATIVE',
              '出库数量超过可用库存，尚未确认或数据版本已变化',
              '点击库存检查，核对当前量、申请量与差额；默认取消',
            );
          await t.log.write({
            action: 'inventory.negative-stock',
            summary: `负库存例外：${v.number}`,
            detail: p.shortages,
          });
        }
        const data = {
          kind: v.kind,
          warehouse_id: v.warehouseId,
          number: v.number,
          date: v.date,
          period: periodOfDate(v.date),
          category: v.category,
          operator: v.operator || t.user.name,
          summary: v.summary,
          account_id: v.accountId,
          cost_account_id: v.costAccountId,
          tax_rate: v.taxRate,
          invoice_kind: v.invoiceKind,
          source_type: invoice ? 'invoice' : v.sourceType,
          source_id: invoice ? invoice.invoiceId : v.sourceId,
        };
        let id = v.id;
        if (id) {
          await tdb
            .updateTable('inventory_document')
            .set({ ...data, revision: sql`revision+1` })
            .where('id', '=', id)
            .execute();
          await tdb.deleteFrom('inventory_line').where('document_id', '=', id).execute();
        } else {
          id = (
            await tdb
              .insertInto('inventory_document')
              .values({
                ...data,
                audited_by: null,
                audited_at: null,
                voucher_id: null,
                calculation_status: 'uncalculated',
                calculation_batch: null,
                calculation_period: null,
                calculation_cutoff_date: null,
                revision: 1,
                created_by: t.user.id,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
        await tdb
          .insertInto('inventory_line')
          .values(
            p.lines.map(({ productCode: _c, productName: _pn, ...l }, i) => ({
              ...l,
              ...invoice?.lineValues[i],
              document_id: id!,
              outbound_cost_cents: null,
              unit_cost: null,
              calculation_status: 'uncalculated',
              calculation_batch: null,
              calculation_period: null,
            })),
          )
          .execute();
        await tdb
          .insertInto('inventory_request')
          .values({ request_key: v.requestKey, payload_hash: payloadHash, document_id: id })
          .execute();
        await s.bump();
        await t.log.write({
          action: 'inventory.document.save',
          summary: `保存${v.kind === 'receipt' ? '入' : '出'}库单 ${v.number}`,
          targetId: id,
        });
        return s.getDocument(id);
      });
    },
    async removeDocument(v: { id: number; revision: number; confirmed: boolean }) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        if (!v.confirmed) fail('CONFIRM', '删除单据需要确认');
        const r = await s.document(v.id);
        checkRevision(r.revision, v.revision);
        await inventoryService(t).protectedDocument(r.id, true);
        await s.sourceUnlocked(r);
        const dependent = await tdb
          .selectFrom('inventory_document')
          .select('number')
          .where('source_type', '=', 'document')
          .where('source_id', '=', r.id)
          .executeTakeFirst();
        if (dependent)
          fail(
            'DOCUMENT_REFERENCED',
            `单据 ${r.number} 被单据 ${dependent.number} 引用，不能删除`,
            '请先处理引用单据，再删除来源单据',
          );
        if (r.kind === 'receipt') {
          const b = await s.balances(r.warehouse_id);
          for (const l of await tdb
            .selectFrom('inventory_line')
            .selectAll()
            .where('document_id', '=', r.id)
            .execute())
            b.set(l.product_id, safe((b.get(l.product_id) ?? 0) - l.quantity_e6));
          if ([...b.values()].some((n) => n < 0))
            fail('INBOUND_USED', `入库单 ${r.number} 已被出库使用，删除会造成负库存`);
        }
        const reversal = await tdb
          .selectFrom('inventory_reversal')
          .selectAll()
          .where('reversal_document_id', '=', r.id)
          .executeTakeFirst();
        await tdb.deleteFrom('inventory_document').where('id', '=', r.id).execute();
        if (reversal) {
          const original = await s.document(reversal.original_document_id);
          if (original.source_type === 'contract' && original.source_id != null)
            await assertContractWithinPlan(t, original.source_id, '撤销反冲');
          await tdb
            .updateTable('inventory_document')
            .set({ revision: sql`revision+1` })
            .where('id', '=', reversal.original_document_id)
            .execute();
        }
        await s.bump();
        await t.log.write({
          action: 'inventory.document.delete',
          summary: `删除单据 ${r.number}`,
          targetId: r.id,
        });
      });
    },
    async audit(v: { id: number; revision: number; to: boolean }, pairId?: number) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          r = await s.document(v.id);
        checkRevision(r.revision, v.revision);
        const pair = await inventoryService(t).pairedTransfer(r.id);
        if (pair && pair.id !== pairId)
          fail(
            'TRANSFER_PAIR',
            `单据属于调拨 ${pair.number}，不能单独审核或撤审`,
            '请进入仓库调拨成对处理',
          );
        await s.sourceUnlocked(r, true);
        if (!v.to && r.audited_by !== t.user.id) t.permissions.require('inventory.audit-admin');
        if (v.to && r.audited_by != null) fail('AUDITED', `单据 ${r.number} 已审核`);
        if (!v.to && r.audited_by == null) fail('AUDITED', `单据 ${r.number} 尚未审核`);
        await t.db
          .withTables<InventoryTables>()
          .updateTable('inventory_document')
          .set({
            audited_by: v.to ? t.user.id : null,
            audited_at: v.to ? t.ctx.now().toISOString() : null,
            revision: r.revision + 1,
          })
          .where('id', '=', v.id)
          .execute();
        await t.log.write({
          action: v.to ? 'inventory.audit' : 'inventory.unaudit',
          summary: `${v.to ? '审核' : '取消审核'}单据 ${r.number}`,
          targetId: r.id,
        });
        await s.bump();
        return s.getDocument(r.id);
      });
    },
    async nextNumber(v: { kind: 'receipt' | 'issue'; warehouseId: number; date: string }) {
      await warehouse(v.warehouseId);
      await unlocked(v.date);
      const pref = await svc.settings.get('preferences', { numberRule: 'monthly' });
      const date = v.date.replaceAll('-', '');
      const prefix =
        pref.numberRule === 'daily'
          ? date.slice(2)
          : pref.numberRule === 'monthly'
            ? date.slice(0, 6)
            : '';
      const numbers = await db
        .selectFrom('inventory_document')
        .select('number')
        .where('warehouse_id', '=', v.warehouseId)
        .where('kind', '=', v.kind)
        .execute();
      const occupied = new Set(numbers.map((r) => r.number));
      for (let n = 1; n <= 999999; n++) {
        const candidate = prefix + String(n).padStart(4, '0');
        if (!occupied.has(candidate)) return candidate;
      }
      return fail('NUMBER', '可用单号已耗尽');
    },
    async copyDocument(id: number) {
      const r = await self.getDocument(id);
      if (r.source_type === 'invoice')
        fail(
          'INVOICE_SOURCE',
          '发票来源出库单不能作为普通单据复制',
          '请从发票处理选择原发票并办理出库',
        );
      return {
        kind: r.kind,
        warehouseId: r.warehouse_id,
        number: '',
        date: r.date,
        category: r.category as z.infer<typeof DocumentSchema>['category'],
        operator: svc.user.name,
        summary: r.summary,
        accountId: r.account_id,
        costAccountId: r.cost_account_id,
        taxRate: r.tax_rate,
        invoiceKind: r.invoice_kind,
        sourceType: 'document' as const,
        sourceId: r.id,
        requestKey: randomBytes(16).toString('hex'),
        lines: r.lines.map((l) => ({
          productCode: l.productCode,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          priceIncludesTax: l.priceIncludesTax,
          note: l.note,
        })),
      };
    },
    async stock(filter: Filter = {}) {
      const f = FilterSchema.parse(filter);
      const products = await self.products(f.keyword);
      const ws = f.warehouseId ? [await warehouse(f.warehouseId, false)] : await self.warehouses();
      const rows = [];
      const startDate = periodStartDate((await svc.book.info()).startPeriod);
      for (const w of ws) {
        const initial = await db
          .selectFrom('inventory_opening')
          .selectAll()
          .where('warehouse_id', '=', w.id)
          .execute();
        const moves = await movements({ ...f, warehouseId: w.id });
        const adjusted = await adjustments(w.id, f.to);
        for (const p of products) {
          if (f.productCode && p.code !== f.productCode) continue;
          if (f.productFrom && p.code < f.productFrom) continue;
          if (f.productTo && p.code > f.productTo) continue;
          const opening =
            !f.to || f.to >= startDate ? initial.find((o) => o.product_id === p.id) : undefined;
          const before = moves.filter((l) => l.product_id === p.id && f.from && l.date < f.from);
          const during = moves.filter(
            (l) => l.product_id === p.id && (!f.from || l.date >= f.from),
          );
          const beforeAdjustments = adjusted.filter(
            (a) => a.product_id === p.id && f.from && a.date < f.from,
          );
          const duringAdjustments = adjusted.filter(
            (a) => a.product_id === p.id && (!f.from || a.date >= f.from),
          );
          const adjustmentE6 = duringAdjustments.reduce((n, a) => safe(n + a.quantity_e6), 0);
          const adjustmentCents = sumCents(
            duringAdjustments.flatMap((a) => [a.amount_cents, a.zero_cents]),
          );
          const start = safe(
            (opening?.quantity_e6 ?? 0) +
              beforeAdjustments.reduce((n, a) => safe(n + a.quantity_e6), 0) +
              before.reduce(
                (n, l) => safe(n + (l.kind === 'receipt' ? l.quantity_e6 : -l.quantity_e6)),
                0,
              ),
          );
          const received = during
            .filter((l) => l.kind === 'receipt')
            .reduce((n, l) => safe(n + l.quantity_e6), 0);
          const issued = during
            .filter((l) => l.kind === 'issue')
            .reduce((n, l) => safe(n + l.quantity_e6), 0);
          const end = safe(start + received - issued + adjustmentE6);
          if (f.hideZero && end === 0) continue;
          const issues = during.filter((l) => l.kind === 'issue');
          const cost = totalIssueCost(issues);
          const beforeCost = totalIssueCost(before.filter((l) => l.kind === 'issue'));
          const openingCents =
            beforeCost == null
              ? null
              : sumCents([
                  opening?.amount_cents,
                  ...before.filter((l) => l.kind === 'receipt').map((l) => l.net_cents),
                  -beforeCost,
                  ...beforeAdjustments.flatMap((a) => [a.amount_cents, a.zero_cents]),
                ]);
          const receiptCents = sumCents(
            during.filter((l) => l.kind === 'receipt').map((l) => l.net_cents),
          );
          const balanceCents =
            openingCents == null || cost == null
              ? null
              : sumCents([openingCents, receiptCents, -cost, adjustmentCents]);
          rows.push({
            key: `${w.id}-${p.id}`,
            warehouseId: w.id,
            warehouseName: w.name,
            productId: p.id,
            productCode: p.code,
            productName: p.name,
            unit: p.unit,
            opening: quantity(start),
            received: quantity(received),
            issued: quantity(issued),
            balance: quantity(end),
            openingCents,
            receiptCents,
            issueCostCents: cost,
            balanceCents,
            adjustmentQuantity: quantity(adjustmentE6),
            adjustmentCents,
            costStatus: balanceCents == null ? '待成本核算' : '账面金额完整',
            estimatedReceiptCents: multiplyToCents(quantity(end), p.receiptPrice),
            estimatedIssueCents: multiplyToCents(quantity(end), p.issuePrice),
          });
        }
      }
      return rows;
    },
    async ledger(filter: Filter) {
      const f = FilterSchema.parse(filter);
      if (!f.warehouseId || !f.productCode) fail('FILTER', '台账需要选择仓库与产品');
      const p = await product(f.productCode);
      const stock = (await self.stock({ ...f, hideZero: false })).find((r) => r.productId === p.id);
      if (!stock || (f.to && f.to < periodStartDate((await svc.book.info()).startPeriod)))
        return [];
      let balance = e6(stock.opening);
      let balanceCents = stock.openingCents;
      const rows = [
        {
          key: 'opening',
          date: f.from ?? periodStartDate((await svc.book.info()).startPeriod),
          number: '期初/期前结余',
          documentId: null as number | null,
          kind: 'opening',
          received: stock.opening,
          issued: '0',
          balance: stock.opening,
          amountCents: stock.openingCents,
          balanceCents,
          unitPrice: null as string | null,
          balanceUnitPrice:
            balance !== 0 && balanceCents != null
              ? new Decimal(balanceCents).mul(10000).div(balance).toFixed(6)
              : null,
          costStatus: balanceCents == null ? '待成本核算' : '账面金额完整',
        },
      ];
      for (const l of await movements(f)) {
        if (f.from && l.date < f.from) continue;
        balance = safe(balance + (l.kind === 'receipt' ? l.quantity_e6 : -l.quantity_e6));
        const amountCents = l.kind === 'receipt' ? l.net_cents : issueCost(l);
        balanceCents =
          balanceCents == null || amountCents == null
            ? null
            : sumCents([balanceCents, l.kind === 'receipt' ? amountCents : -amountCents]);
        rows.push({
          key: String(l.id),
          date: l.date,
          number: l.number,
          documentId: l.document_id,
          kind: l.kind,
          received: l.kind === 'receipt' ? quantity(l.quantity_e6) : '0',
          issued: l.kind === 'issue' ? quantity(l.quantity_e6) : '0',
          balance: quantity(balance),
          amountCents,
          balanceCents,
          unitPrice:
            amountCents != null && l.quantity_e6 !== 0
              ? new Decimal(amountCents).mul(10000).div(l.quantity_e6).toFixed(6)
              : null,
          balanceUnitPrice: null,
          costStatus:
            l.kind === 'receipt' ? '入库原单金额' : amountCents == null ? '待成本核算' : '已核算',
        });
      }
      for (const a of await adjustments(f.warehouseId, f.to)) {
        if (a.product_id !== p.id || (f.from && a.date < f.from)) continue;
        rows.push({
          key: `adjustment-${a.batch_id}-${p.id}`,
          date: a.date,
          number: '盘点/零数量调整',
          documentId: null,
          kind: 'adjustment',
          received: a.quantity_e6 >= 0 ? quantity(a.quantity_e6) : '0',
          issued: a.quantity_e6 < 0 ? quantity(-a.quantity_e6) : '0',
          balance: '0',
          amountCents: sumCents([a.amount_cents, a.zero_cents]),
          balanceCents: null,
          unitPrice: null,
          balanceUnitPrice: null,
          costStatus: '正式核算调整',
        });
      }
      const openingRow = rows.shift()!;
      balance = e6(stock.opening);
      balanceCents = stock.openingCents;
      rows.sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.kind === 'adjustment' ? 1 : b.kind === 'adjustment' ? -1 : 0) ||
          Number(a.key) - Number(b.key),
      );
      return [
        openingRow,
        ...rows.map((r) => {
          balance = safe(balance + e6(r.received) - e6(r.issued));
          balanceCents =
            balanceCents == null || r.amountCents == null
              ? null
              : sumCents([balanceCents, r.kind === 'issue' ? -r.amountCents : r.amountCents]);
          return {
            ...r,
            balance: quantity(balance),
            balanceCents,
            balanceUnitPrice:
              balance !== 0 && balanceCents != null
                ? new Decimal(balanceCents).mul(10000).div(balance).toFixed(6)
                : null,
          };
        }),
      ];
    },
    async sales(filter: Filter = {}) {
      const f = FilterSchema.parse(filter);
      return (await movements(f))
        .filter(
          (l) =>
            l.kind === 'issue' &&
            l.category === '销售' &&
            (!f.from || l.date >= f.from) &&
            (!f.category || l.category === f.category),
        )
        .map((l) => ({
          id: l.id,
          date: l.date,
          number: l.number,
          documentId: l.document_id,
          warehouseId: l.warehouse_id,
          productCode: l.code,
          productName: l.name,
          quantity: quantity(l.quantity_e6),
          unitPrice: l.unit_price,
          revenueCents: l.net_cents,
          unitCost: issueCost(l) == null ? null : l.unit_cost,
          costCents: issueCost(l),
          costStatus: issueCost(l) != null ? '已核算' : '待成本核算',
        }));
    },
    async summary(v: {
      filter: Filter;
      group: 'product' | 'category' | 'account' | 'costAccount';
      detail: boolean;
      valuation: 'document' | 'cost';
    }) {
      const f = FilterSchema.parse(v.filter);
      const accounts = new Map(
        (await svc.accounts.list()).map((a) => [a.id, `${a.code} ${a.fullName}`]),
      );
      const rows = new Map<
        string,
        {
          key: string;
          group: string;
          productCode: string;
          quantity_e6: number;
          amounts: number[];
          taxes: number[];
          gross: number[];
          costs: (number | null)[];
        }
      >();
      for (const l of await movements(f)) {
        if (
          (f.from && l.date < f.from) ||
          (f.kind && l.kind !== f.kind) ||
          (f.category && l.category !== f.category)
        )
          continue;
        const label =
          v.group === 'product'
            ? `${l.code} ${l.name}`
            : v.group === 'category'
              ? l.category
              : (accounts.get((v.group === 'account' ? l.account_id : l.cost_account_id) ?? 0) ??
                '未设置');
        const key = `${label}-${v.detail ? l.product_id : ''}`;
        let r = rows.get(key);
        if (!r) {
          r = {
            key,
            group: label,
            productCode: v.detail ? l.code : '',
            quantity_e6: 0,
            amounts: [],
            taxes: [],
            gross: [],
            costs: [],
          };
          rows.set(key, r);
        }
        r.quantity_e6 = safe(r.quantity_e6 + l.quantity_e6);
        r.amounts.push(l.net_cents);
        r.taxes.push(l.tax_cents);
        r.gross.push(l.gross_cents);
        r.costs.push(l.kind === 'receipt' ? l.net_cents : issueCost(l));
      }
      return [...rows.values()].map((r) => ({
        key: r.key,
        group: r.group,
        productCode: r.productCode,
        quantity: quantity(r.quantity_e6),
        amountCents:
          v.valuation === 'cost'
            ? r.costs.every((c) => c != null)
              ? sumCents(r.costs)
              : null
            : sumCents(r.amounts),
        taxCents: sumCents(r.taxes),
        grossCents: sumCents(r.gross),
        costStatus:
          v.valuation === 'cost' && r.costs.some((c) => c == null)
            ? '待成本核算'
            : v.valuation === 'cost'
              ? '已核算'
              : '单据金额',
      }));
    },
    async count(v: { warehouseId: number; period: number }) {
      await warehouse(v.warehouseId, false);
      const c = await db
        .selectFrom('inventory_count')
        .selectAll()
        .where('warehouse_id', '=', v.warehouseId)
        .where('period', '=', v.period)
        .executeTakeFirst();
      if (!c) return { id: null, revision: 0, rows: [] };
      const rows = await db
        .selectFrom('inventory_count_line as l')
        .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
        .selectAll('l')
        .select(['p.code as productCode', 'p.name as productName'])
        .where('count_id', '=', c.id)
        .orderBy('p.code')
        .execute();
      const officialAdjustments =
        c.calculation_status === 'calculated' && c.calculation_batch
          ? await db
              .selectFrom('inventory_costing_adjustment')
              .selectAll()
              .where('batch_id', '=', c.calculation_batch)
              .where('count_id', '=', c.id)
              .execute()
          : [];
      return {
        id: c.id,
        revision: c.revision,
        rows: rows.map((r) => {
          const adjustment = officialAdjustments.find((a) => a.product_id === r.product_id);
          const actualCents =
            c.calculation_status === 'calculated' && r.book_cents != null
              ? sumCents([r.book_cents, adjustment?.amount_cents, adjustment?.zero_cents])
              : countAmount(r.book_cents, r.book_e6, r.actual_e6);
          return {
            ...r,
            book: quantity(r.book_e6),
            actual: quantity(r.actual_e6),
            difference: quantity(r.actual_e6 - r.book_e6),
            bookCents: r.book_cents,
            actualCents,
            differenceCents:
              r.book_cents == null || actualCents == null
                ? null
                : sumCents([actualCents, -r.book_cents]),
            amountStatus:
              c.calculation_status === 'calculated' && actualCents != null
                ? '正式核算金额'
                : r.book_cents == null
                  ? '金额快照缺失或待成本核算'
                  : r.book_e6 === 0 && (r.actual_e6 !== 0 || r.book_cents !== 0)
                    ? '零账面数量，无法确定单价'
                    : '按账面快照折算',
          };
        }),
      };
    },
    async countPeriod(period: number) {
      const b = await svc.book.info();
      const current = await svc.periods.current();
      await svc.periods.require(period);
      if (period < b.startPeriod || !current || period > current.period)
        fail(
          'COUNT_PERIOD',
          `盘点月份必须在 ${b.startPeriod} 到 ${current?.period ?? b.startPeriod} 之间`,
        );
      await unlocked(periodEndDate(period));
    },
    async generateCount(v: {
      warehouseId: number;
      period: number;
      revision: number;
      confirmed: boolean;
    }) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        await s.warehouse(v.warehouseId);
        await s.countPeriod(v.period);
        const old = await s.count(v);
        checkRevision(old.revision, v.revision);
        if (old.id && !v.confirmed)
          fail(
            'COUNT_OVERWRITE',
            '盘点表已存在，重生成会替换账面快照和已录实盘值',
            '先预览现有差异，明确确认后再重生成',
          );
        if (old.id) {
          const h = await tdb
            .selectFrom('inventory_count')
            .selectAll()
            .where('id', '=', old.id)
            .executeTakeFirstOrThrow();
          if (h.calculation_status !== 'uncalculated' || h.calculation_batch)
            fail('CALCULATED', '盘点表已核算');
          await tdb.deleteFrom('inventory_count_line').where('count_id', '=', old.id).execute();
          await tdb
            .updateTable('inventory_count')
            .set({ revision: old.revision + 1 })
            .where('id', '=', old.id)
            .execute();
        }
        const id =
          old.id ??
          (
            await tdb
              .insertInto('inventory_count')
              .values({
                warehouse_id: v.warehouseId,
                period: v.period,
                revision: 1,
                calculation_status: 'uncalculated',
                calculation_batch: null,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        const rows = await s.stock({ warehouseId: v.warehouseId, to: periodEndDate(v.period) });
        if (rows.length)
          await tdb
            .insertInto('inventory_count_line')
            .values(
              rows.map((r) => ({
                count_id: id,
                product_id: r.productId,
                book_e6: e6(r.balance),
                book_cents: r.balanceCents,
                actual_e6: e6(r.balance),
                note: '',
              })),
            )
            .execute();
        await t.log.write({
          action: 'inventory.count.generate',
          summary: `生成盘点 ${v.period}`,
          detail: v,
        });
        await s.bump();
        return s.count(v);
      });
    },
    async saveCount(raw: z.input<typeof CountSchema>) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        const v = CountSchema.parse(raw);
        await s.warehouse(v.warehouseId);
        await s.countPeriod(v.period);
        const old = await s.count(v);
        checkRevision(old.revision, v.revision);
        if (!old.id) fail('COUNT', '请先生成账面快照');
        const header = await tdb
          .selectFrom('inventory_count')
          .selectAll()
          .where('id', '=', old.id)
          .executeTakeFirstOrThrow();
        if (header.calculation_status !== 'uncalculated' || header.calculation_batch)
          fail('CALCULATED', '盘点表已核算');
        const seen = new Set<number>();
        if (old.rows.length !== v.rows.length)
          fail('COUNT_ROWS', '保存实盘必须包含原快照的完整产品集合');
        for (const [i, r] of v.rows.entries()) {
          const p = await s.product(r.productCode, i + 1);
          if (seen.has(p.id)) fail('DUPLICATE', `第 ${i + 1} 行产品 ${p.code} 重复`);
          seen.add(p.id);
          if (!old.rows.some((l) => l.product_id === p.id))
            fail('COUNT_ROWS', `产品 ${p.code} 不在盘点快照中`);
          await tdb
            .updateTable('inventory_count_line')
            .set({ actual_e6: e6(r.actual), note: r.note })
            .where('count_id', '=', old.id)
            .where('product_id', '=', p.id)
            .execute();
        }
        await tdb
          .updateTable('inventory_count')
          .set({ revision: old.revision + 1 })
          .where('id', '=', old.id)
          .execute();
        await t.log.write({ action: 'inventory.count.save', summary: `录入实盘 ${v.period}` });
        await s.bump();
        return s.count(v);
      });
    },
    async resetCount(v: {
      warehouseId: number;
      period: number;
      revision: number;
      confirmed: boolean;
    }) {
      if (!v.confirmed) fail('CONFIRM', '请先预览将清零的盘点差异并确认');
      return svc.tx(async (t) => {
        const s = inventoryService(t);
        const old = await s.count(v);
        checkRevision(old.revision, v.revision);
        return s.saveCount({
          ...v,
          rows: old.rows.map((r) => ({ productCode: r.productCode, actual: r.book, note: r.note })),
        });
      });
    },
    async replaceCountProducts(v: {
      warehouseId: number;
      period: number;
      revision: number;
      productCodes: string[];
      confirmed: boolean;
    }) {
      return svc.tx(async (t) => {
        t.permissions.require('inventory.edit');
        if (!v.confirmed) fail('CONFIRM', '调整盘点产品集合需要核对移除行的实盘和差异后确认');
        if (new Set(v.productCodes).size !== v.productCodes.length)
          fail('DUPLICATE', '盘点产品集合包含重复编号');
        const s = inventoryService(t),
          db = t.db.withTables<InventoryTables>();
        await s.warehouse(v.warehouseId);
        await s.countPeriod(v.period);
        const old = await s.count(v);
        checkRevision(old.revision, v.revision);
        if (!old.id) fail('COUNT', '请先生成账面快照');
        const header = await db
          .selectFrom('inventory_count')
          .selectAll()
          .where('id', '=', old.id)
          .executeTakeFirstOrThrow();
        if (header.calculation_status !== 'uncalculated' || header.calculation_batch)
          fail('CALCULATED', '盘点表已核算，不能调整产品集合');
        const current = await s.stock({ warehouseId: v.warehouseId, to: periodEndDate(v.period) });
        const added = [];
        for (const code of v.productCodes) {
          if (old.rows.some((r) => r.productCode === code)) continue;
          const p = await s.product(code);
          if (p.disabled) fail('DISABLED', `产品 ${code} 已停用，不能加入盘点`);
          const row = current.find((r) => r.productId === p.id)!;
          added.push({
            count_id: old.id,
            product_id: p.id,
            book_e6: e6(row.balance),
            actual_e6: e6(row.balance),
            book_cents: row.balanceCents,
            note: '',
          });
        }
        const removed = old.rows.filter((r) => !v.productCodes.includes(r.productCode));
        if (removed.length)
          await db
            .deleteFrom('inventory_count_line')
            .where(
              'id',
              'in',
              removed.map((r) => r.id),
            )
            .execute();
        if (added.length) await db.insertInto('inventory_count_line').values(added).execute();
        await db
          .updateTable('inventory_count')
          .set({ revision: old.revision + 1 })
          .where('id', '=', old.id)
          .execute();
        await t.log.write({
          action: 'inventory.count.products',
          summary: `调整盘点 ${v.period} 产品集合`,
          detail: {
            removed: removed.map((r) => ({
              productCode: r.productCode,
              book: r.book,
              actual: r.actual,
              difference: r.difference,
            })),
            added,
          },
        });
        await s.bump();
        return s.count(v);
      });
    },
    async removeCount(v: {
      warehouseId: number;
      period: number;
      revision: number;
      confirmed: boolean;
    }) {
      if (!v.confirmed) fail('CONFIRM', '删除盘点表需要确认');
      return svc.tx(async (t) => {
        const s = inventoryService(t);
        await s.countPeriod(v.period);
        const old = await s.count(v);
        checkRevision(old.revision, v.revision);
        if (!old.id) fail('COUNT', '盘点表已不存在');
        const tdb = t.db.withTables<InventoryTables>();
        const h = await tdb
          .selectFrom('inventory_count')
          .selectAll()
          .where('id', '=', old.id)
          .executeTakeFirstOrThrow();
        if (h.calculation_status !== 'uncalculated' || h.calculation_batch)
          fail('CALCULATED', '盘点表已核算');
        await tdb.deleteFrom('inventory_count').where('id', '=', old.id).execute();
        await t.log.write({ action: 'inventory.count.delete', summary: `删除盘点 ${v.period}` });
        await s.bump();
      });
    },
    async contracts(filter: Filter = {}) {
      const f = FilterSchema.parse(filter);
      let q = db
        .selectFrom('inventory_contract as c')
        .innerJoin('dimension_item as p', 'p.id', 'c.supplier_id')
        .selectAll('c')
        .select('p.name as supplier_name')
        .orderBy('c.date', 'desc')
        .orderBy('c.id', 'desc');
      if (f.id) q = q.where('c.id', '=', f.id);
      if (f.warehouseId) q = q.where('c.warehouse_id', '=', f.warehouseId);
      if (f.keyword) q = q.where('c.number', 'like', `%${f.keyword}%`);
      if (f.from) q = q.where('c.date', '>=', f.from);
      if (f.to) q = q.where('c.date', '<=', f.to);
      return q.execute();
    },
    async getContract(id: number) {
      const h = (await self.contracts({ id }))[0];
      if (!h) fail('CONTRACT', '采购合同已不存在');
      const lines = await db
        .selectFrom('inventory_contract_line as l')
        .innerJoin('inventory_product as p', 'p.id', 'l.product_id')
        .selectAll('l')
        .select(['p.code as productCode', 'p.name as productName'])
        .where('l.contract_id', '=', id)
        .orderBy('l.id')
        .execute();
      return {
        ...h,
        lines: lines.map((l) => ({
          ...l,
          quantity: quantity(l.quantity_e6),
          unitPrice: l.unit_price,
          priceIncludesTax: false,
        })),
      };
    },
    async saveContract(raw: ContractInput) {
      return svc.tx(async (t) => {
        const s = inventoryService(t),
          tdb = t.db.withTables<InventoryTables>();
        const v = ContractSchema.parse(raw);
        if (v.lines.some((l) => l.priceIncludesTax))
          fail(
            'CONTRACT_TAX',
            '采购合同单价采用不含税口径',
            '请填写不含税单价，入库时再选择税率与含税口径',
          );
        await s.warehouse(v.warehouseId);
        await s.unlocked(v.date);
        const supplier = await t.dimensions.get(v.supplierId);
        if (!supplier || supplier.typeId !== 'partner' || supplier.disabled || !supplier.isLeaf)
          fail('SUPPLIER', '供应商必须是当前账套启用的末级客供档案');
        if (v.dueDate && v.dueDate < v.date) fail('CONTRACT_DATE', '交期不能早于合同日期');
        const dup = await tdb
          .selectFrom('inventory_contract')
          .select('id')
          .where('number', '=', v.number)
          .executeTakeFirst();
        if (dup && dup.id !== v.id) fail('CONTRACT_NUMBER', `采购合同号 ${v.number} 重复`);
        if (v.id) {
          const old = await s.getContract(v.id);
          checkRevision(old.revision, v.revision);
          await s.unlocked(old.date);
          if (
            await tdb
              .selectFrom('inventory_document')
              .select('id')
              .where('source_type', '=', 'contract')
              .where('source_id', '=', v.id)
              .executeTakeFirst()
          )
            fail(
              'CONTRACT_USED',
              '采购合同已有来源入库，当前版本不能再修改',
              '可以查询原合同或复制新合同',
            );
        }
        const rows = [];
        const productQuantities = new Map<number, number>();
        for (const [i, l] of v.lines.entries()) {
          const p = await s.product(l.productCode, i + 1);
          if (p.disabled) fail('DISABLED', `产品 ${p.code} 已停用`);
          const totalQuantity = (productQuantities.get(p.id) ?? 0) + e6(l.quantity);
          if (!Number.isSafeInteger(totalQuantity))
            fail(
              'CONTRACT_QUANTITY',
              `产品 ${p.code} 的合同累计数量超出可核算范围`,
              '请核对同产品的全部明细，减少数量或拆分合同',
            );
          productQuantities.set(p.id, totalQuantity);
          rows.push({
            product_id: p.id,
            quantity_e6: e6(l.quantity),
            unit_price: l.unitPrice,
            amount_cents: multiplyToCents(l.quantity, l.unitPrice),
            note: l.note,
          });
        }
        const data = {
          number: v.number,
          warehouse_id: v.warehouseId,
          supplier_id: v.supplierId,
          date: v.date,
          agent: v.agent,
          due_date: v.dueDate,
          note: v.note,
          status: v.status,
        };
        let id = v.id;
        if (id) {
          await tdb
            .updateTable('inventory_contract')
            .set({ ...data, revision: sql`revision+1` })
            .where('id', '=', id)
            .execute();
          await tdb.deleteFrom('inventory_contract_line').where('contract_id', '=', id).execute();
        } else {
          id = (
            await tdb
              .insertInto('inventory_contract')
              .values({ ...data, revision: 1 })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
        await tdb
          .insertInto('inventory_contract_line')
          .values(rows.map((l) => ({ ...l, contract_id: id! })))
          .execute();
        await t.log.write({
          action: 'inventory.contract.save',
          summary: `保存采购合同 ${v.number}`,
        });
        await s.bump();
        return s.getContract(id);
      });
    },
    async contractDraft(id: number) {
      const c = await self.getContract(id);
      if (c.status !== 'open') fail('CONTRACT', '已完成或取消的合同不能带入入库');
      const fulfillment = await contractFulfillment(svc, id);
      const consumed = new Map(fulfillment.rows.map((r) => [r.productCode, e6(r.received)]));
      const lines = c.lines.flatMap((l) => {
        const skip = Math.min(Math.max(consumed.get(l.productCode) ?? 0, 0), l.quantity_e6);
        consumed.set(l.productCode, (consumed.get(l.productCode) ?? 0) - skip);
        const remaining = l.quantity_e6 - skip;
        return remaining > 0
          ? [
              {
                productCode: l.productCode,
                quantity: quantity(remaining),
                unitPrice: l.unitPrice,
                priceIncludesTax: false,
                note: l.note,
              },
            ]
          : [];
      });
      if (!lines.length)
        fail(
          'CONTRACT_COMPLETE',
          '合同数量已经全部入库',
          '请查询履约明细；需要退货时先办理原入库单反冲',
        );
      return {
        requestKey: randomBytes(16).toString('hex'),
        kind: 'receipt' as const,
        number: '',
        date: c.date,
        warehouseId: c.warehouse_id,
        category: '采购' as const,
        operator: svc.user.name,
        summary: `采购合同 ${c.number}`,
        sourceType: 'contract' as const,
        sourceId: c.id,
        taxRate: '0',
        accountId: null,
        costAccountId: null,
        lines,
      };
    },
    async contractFulfillment(id: number) {
      return contractFulfillment(svc, id);
    },
    async setContractStatus(v: {
      id: number;
      revision: number;
      status: 'open' | 'completed' | 'cancelled';
      confirmed: boolean;
    }) {
      return svc.tx(async (t) => {
        t.permissions.require('inventory.edit');
        if (!v.confirmed) fail('CONFIRM', '变更采购合同执行状态需要确认');
        const s = inventoryService(t),
          c = await s.getContract(v.id);
        checkRevision(c.revision, v.revision);
        await s.unlocked(c.date);
        if (v.status === 'completed') {
          const f = await contractFulfillment(t, c.id);
          if (f.rows.some((r) => e6(r.remaining) !== 0))
            fail(
              'CONTRACT_INCOMPLETE',
              '合同尚有未入库数量，不能标记全部完成',
              '如需终止剩余采购，请确认取消合同',
            );
        }
        await t.db
          .withTables<InventoryTables>()
          .updateTable('inventory_contract')
          .set({ status: v.status, revision: c.revision + 1 })
          .where('id', '=', c.id)
          .execute();
        await t.log.write({
          action: 'inventory.contract.status',
          summary: `变更采购合同 ${c.number} 执行状态`,
          targetId: c.id,
          detail: { from: c.status, to: v.status },
        });
        await s.bump();
        return s.getContract(c.id);
      });
    },
    async removeContract(v: { id: number; revision: number; confirmed: boolean }) {
      return svc.tx(async (t) => {
        t.permissions.require('inventory.edit');
        if (!v.confirmed) fail('CONFIRM', '删除采购合同及明细需要确认');
        const s = inventoryService(t),
          c = await s.getContract(v.id);
        checkRevision(c.revision, v.revision);
        await s.unlocked(c.date);
        const db = t.db.withTables<InventoryTables>();
        if (
          await db
            .selectFrom('inventory_document')
            .select('id')
            .where('source_type', '=', 'contract')
            .where('source_id', '=', c.id)
            .executeTakeFirst()
        )
          fail(
            'CONTRACT_USED',
            '采购合同已有来源入库，不能删除',
            '请保留历史合同，必要时变更执行状态',
          );
        await db.deleteFrom('inventory_contract').where('id', '=', c.id).execute();
        await s.bump();
        await t.log.write({
          action: 'inventory.contract.delete',
          summary: `删除采购合同 ${c.number}`,
          targetId: c.id,
        });
      });
    },
    async bulk(raw: z.input<typeof BulkSchema>) {
      return svc.tx(async (t) => {
        const v = BulkSchema.parse(raw),
          s = inventoryService(t);
        if (new Set(v.products.map((p) => p.id)).size !== v.products.length)
          fail('BULK_DUPLICATE', '批量修改集合包含重复产品', '请重新选择互不重复的产品');
        const all = await s.products();
        const changes = [];
        for (const p of v.products) {
          const old = all.find((r) => r.id === p.id);
          if (!old) fail('PRODUCT', '批量集合中产品不存在');
          checkRevision(old.revision, p.revision);
          let value: string | boolean = v.value;
          if (v.field === 'disabled') {
            if (!['true', 'false'].includes(v.value)) fail('BULK', '停用值必须为 true 或 false');
            value = v.value === 'true';
          }
          const patch =
            v.field === 'inventoryAccountCode' || v.field === 'salesAccountCode'
              ? {
                  [v.field === 'inventoryAccountCode' ? 'inventoryAccountId' : 'salesAccountId']:
                    v.value.trim() ? (await t.accounts.require(v.value.trim())).id : null,
                }
              : { [v.field]: value };
          const next = ProductSchema.parse({
            ...old,
            ...patch,
            confirmZeroFactor: v.confirmZeroFactor,
          });
          await s.checkProduct(next);
          if (new Decimal(next.allocationFactor).isZero()) next.allocationFactor = '1';
          changes.push({ before: old, after: next });
        }
        if (v.confirmed) {
          for (const c of changes) await s.saveProduct(c.after);
          await t.log.write({
            action: 'inventory.product.bulk',
            summary: `批量修改 ${changes.length} 个产品的 ${v.field}`,
            detail: changes,
          });
        }
        return changes;
      });
    },
    async saveSettings(raw: z.input<typeof SettingsSchema>) {
      return svc.tx(async (t) => {
        const v = SettingsSchema.parse(raw);
        await t.settings.set('preferences', v);
        await t.log.write({
          action: 'inventory.settings',
          summary: '修改仓库编号、显示精度及默认税率',
          detail: v,
        });
        return v;
      });
    },
    bump,
    control,
    warehouse,
    product,
    used,
    openingUnlocked,
    balances,
    document,
    pairedTransfer,
    protectedDocument,
    sourceUnlocked,
    unlocked,
    prepare,
  };
  return self;
}
