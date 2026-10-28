import { z } from 'zod';
import { BusinessError, zDate, zId, zPeriod } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
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
} from '../shared';
import { inventoryService } from './service';
import { inventoryCosting, withInventoryCosting } from './costing';
import { CostingCommitSchema, CostingCancelSchema } from '../costing-contract';
import { ImportSchema, importInventory } from './imports';
import { InventoryQuerySchema } from '../query';
import { inventoryQuery } from './query';
import { TransferSchema, AuditTransferSchema, RemoveTransferSchema } from '../transfer';
import { inventoryTransfer } from './transfer';
import { ExportDocumentsSchema, ImportDocumentsSchema } from '../exchange';
import { exportDocuments, importDocuments } from './exchange';
import { ReversalSchema } from '../reversal';
import { inventoryReversal } from './reversal';
import { exportContracts } from './contract-exchange';
import { inventoryLedgers } from './ledgers';
const m = moduleKit(manifest);
const base = m.procedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof z.ZodError) {
    const issue = result.error.cause.issues[0]!;
    const labels: Record<string, string> = {
      code: '产品编号',
      name: '产品名称',
      productCode: '产品编号',
      warehouseId: '仓库',
      sourceWarehouseId: '调出仓库',
      targetWarehouseId: '调入仓库',
      clearingAccountId: '调拨对方科目',
      unitPrices: '退回入库单价',
      supplierId: '供应商',
      number: '单号',
      date: '日期',
      from: '起始日期',
      to: '截止日期',
      quantity: '数量',
      actual: '实盘数量',
      unitPrice: '单价',
      taxRate: '税率',
      allocationFactor: '费用分摊系数',
      accountId: '收付款科目',
      costAccountId: '成本科目',
      revision: '数据版本',
      period: '月份',
      lines: '单据明细',
      rows: '导入明细',
      field: '批量修改字段',
      value: '批量修改数值',
    };
    const path = issue.path;
    const row = path.find((p) => typeof p === 'number');
    const field = [...path].reverse().find((p) => typeof p === 'string');
    const label = typeof field === 'string' ? (labels[field] ?? '输入数据') : '输入数据';
    const message = /[\u4e00-\u9fff]/.test(issue.message)
      ? issue.message
      : `${label}的值、类型或格式不正确`;
    throw new BusinessError({
      code: 'INVENTORY_INPUT',
      message: `${typeof row === 'number' ? `第 ${row + 1} 行：` : ''}${message}`,
      hint: '请核对必填项、日期 YYYY-MM-DD、数字类型和小数位数后重试',
    });
  }
  return result;
});
const view = base.meta({ permission: 'inventory.view' });
const edit = base.meta({ permission: 'inventory.edit' });
const countKey = z.object({ warehouseId: zId, period: z.number().int() });
const confirmedCount = countKey.extend({
  revision: z.number().int().nonnegative(),
  confirmed: z.boolean(),
});
export const inventoryRouter = m.router({
  previewReversal: edit
    .input(ReversalSchema)
    .mutation(({ ctx, input }) => inventoryReversal(ctx.svc).preview(input)),
  reverseDocument: edit
    .input(ReversalSchema)
    .mutation(({ ctx, input }) => inventoryReversal(ctx.svc).save(input)),
  queryDocuments: view
    .input(InventoryQuerySchema)
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryQuery(svc, input))),
  previewTransfer: edit
    .input(TransferSchema)
    .mutation(({ ctx, input }) => inventoryTransfer(ctx.svc).preview(input)),
  saveTransfer: edit
    .input(TransferSchema)
    .mutation(({ ctx, input }) => inventoryTransfer(ctx.svc).save(input)),
  transfers: view
    .input(FilterSchema)
    .query(({ ctx, input }) => inventoryTransfer(ctx.svc).list(input)),
  transfer: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryTransfer(svc).get(input.id))),
  auditTransfer: base
    .meta({ permission: 'inventory.audit' })
    .input(AuditTransferSchema)
    .mutation(({ ctx, input }) => inventoryTransfer(ctx.svc).audit(input)),
  removeTransfer: edit
    .input(RemoveTransferSchema)
    .mutation(({ ctx, input }) => inventoryTransfer(ctx.svc).remove(input)),
  exportDocuments: view
    .input(ExportDocumentsSchema)
    .query(({ ctx, input }) => exportDocuments(ctx.svc, input)),
  importDocumentsPreview: base
    .meta({ permission: 'inventory.import' })
    .input(ImportDocumentsSchema)
    .mutation(({ ctx, input }) => importDocuments(ctx.svc, input)),
  importDocuments: base
    .meta({ permission: 'inventory.import' })
    .input(ImportDocumentsSchema)
    .mutation(({ ctx, input }) => importDocuments(ctx.svc, input, true)),
  costingSnapshot: view
    .input(z.object({ period: zPeriod }))
    .query(({ ctx, input }) => inventoryCosting(ctx.svc).snapshot(input.period)),
  commitCosting: base
    .meta({ permission: 'inventory.costing' })
    .input(CostingCommitSchema)
    .mutation(({ ctx, input }) =>
      ctx.svc.tx((svc) => withInventoryCosting(svc, (inventory) => inventory.commitCosting(input))),
    ),
  cancelCosting: base
    .meta({ permission: 'inventory.costing' })
    .input(CostingCancelSchema)
    .mutation(({ ctx, input }) =>
      ctx.svc.tx((svc) => withInventoryCosting(svc, (inventory) => inventory.cancelCosting(input))),
    ),
  context: view.query(({ ctx }) => inventoryService(ctx.svc).context()),
  products: view
    .input(z.object({ keyword: z.string().default('') }).default({ keyword: '' }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).products(input.keyword)),
  saveProduct: edit
    .input(ProductSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveProduct(input)),
  removeProducts: edit
    .input(
      z.object({
        products: z
          .array(z.object({ id: zId, revision: z.number().int().positive() }))
          .min(1)
          .max(1000),
        confirmSet: z.boolean(),
        confirmDelete: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).removeProducts(input)),
  warehouses: view.query(({ ctx }) => inventoryService(ctx.svc).warehouses()),
  saveWarehouse: edit
    .input(WarehouseSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveWarehouse(input)),
  removeWarehouse: edit
    .input(z.object({ id: zId, revision: z.number().int().positive(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).removeWarehouse(input)),
  opening: view
    .input(z.object({ warehouseId: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).opening(input.warehouseId)),
  saveOpening: edit
    .input(OpeningSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveOpening(input)),
  documents: view
    .input(FilterSchema)
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).documents(input))),
  document: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).getDocument(input.id))),
  previewDocument: edit
    .input(DocumentSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).previewDocument(input)),
  saveDocument: edit.input(DocumentSchema).mutation(({ ctx, input }) =>
    ctx.svc.tx((svc) =>
      svc.inventory.with(async (inventory) => {
        const saved = await inventory.saveDocument(input);
        return inventoryService(svc).getDocument(saved.id);
      }),
    ),
  ),
  removeDocument: edit
    .input(z.object({ id: zId, revision: z.number().int().positive(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) =>
      ctx.svc.tx((svc) => svc.inventory.with((inventory) => inventory.removeDocument(input))),
    ),
  audit: base
    .meta({ permission: 'inventory.audit' })
    .input(z.object({ id: zId, revision: z.number().int().positive(), to: z.boolean() }))
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).audit(input)),
  nextNumber: edit
    .input(z.object({ kind: z.enum(['receipt', 'issue']), warehouseId: zId, date: zDate }))
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).nextNumber(input)),
  copyDocument: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).copyDocument(input.id)),
  stock: view
    .input(FilterSchema)
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).stock(input))),
  ledger: view
    .input(FilterSchema)
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).ledger(input))),
  ledgers: view
    .input(z.object({ filter: FilterSchema, hideInactive: z.boolean().default(false) }))
    .query(({ ctx, input }) =>
      ctx.svc.tx((svc) => inventoryLedgers(svc, input.filter, input.hideInactive)),
    ),
  sales: view
    .input(FilterSchema)
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).sales(input))),
  summary: view
    .input(
      z.object({
        filter: FilterSchema,
        group: z.enum(['product', 'category', 'account', 'costAccount']),
        detail: z.boolean(),
        valuation: z.enum(['document', 'cost']),
      }),
    )
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).summary(input))),
  count: view
    .input(countKey)
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).count(input))),
  generateCount: edit
    .input(confirmedCount)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).generateCount(input)),
  saveCount: edit
    .input(CountSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveCount(input)),
  resetCount: edit
    .input(confirmedCount)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).resetCount(input)),
  replaceCountProducts: edit
    .input(
      countKey.extend({
        revision: z.number().int().nonnegative(),
        productCodes: z.array(z.string().trim().min(1).max(200)).max(1000),
        confirmed: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).replaceCountProducts(input)),
  removeCount: edit
    .input(confirmedCount)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).removeCount(input)),
  contracts: view
    .input(FilterSchema)
    .query(({ ctx, input }) => inventoryService(ctx.svc).contracts(input)),
  exportContracts: view
    .input(z.object({ ids: z.array(zId).min(1).max(200) }))
    .query(({ ctx, input }) => ctx.svc.tx((svc) => exportContracts(svc, input.ids))),
  contract: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).getContract(input.id)),
  saveContract: edit
    .input(ContractSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveContract(input)),
  contractDraft: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => ctx.svc.tx((svc) => inventoryService(svc).contractDraft(input.id))),
  contractFulfillment: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) =>
      ctx.svc.tx((svc) => inventoryService(svc).contractFulfillment(input.id)),
    ),
  setContractStatus: edit
    .input(
      z.object({
        id: zId,
        revision: z.number().int().positive(),
        status: z.enum(['open', 'completed', 'cancelled']),
        confirmed: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).setContractStatus(input)),
  removeContract: edit
    .input(z.object({ id: zId, revision: z.number().int().positive(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).removeContract(input)),
  bulk: edit.input(BulkSchema).mutation(({ ctx, input }) => inventoryService(ctx.svc).bulk(input)),
  saveSettings: base
    .meta({ permission: 'inventory.settings' })
    .input(SettingsSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveSettings(input)),
  importPreview: base
    .meta({ permission: 'inventory.import' })
    .input(ImportSchema)
    .mutation(({ ctx, input }) => importInventory(ctx.svc, input)),
  importSave: base
    .meta({ permission: 'inventory.import' })
    .input(ImportSchema)
    .mutation(({ ctx, input }) => importInventory(ctx.svc, input, true)),
});
export type InventoryRouter = typeof inventoryRouter;
