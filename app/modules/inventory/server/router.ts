import { z } from 'zod';
import { zDate, zId } from '@caiwu/core';
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
import { ImportSchema, importInventory } from './imports';
const m = moduleKit(manifest);
const view = m.procedure.meta({ permission: 'inventory.view' });
const edit = m.procedure.meta({ permission: 'inventory.edit' });
const countKey = z.object({ warehouseId: zId, period: z.number().int() });
const confirmedCount = countKey.extend({
  revision: z.number().int().nonnegative(),
  confirmed: z.boolean(),
});
export const inventoryRouter = m.router({
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
  opening: view
    .input(z.object({ warehouseId: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).opening(input.warehouseId)),
  saveOpening: edit
    .input(OpeningSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveOpening(input)),
  documents: view
    .input(FilterSchema)
    .query(({ ctx, input }) => inventoryService(ctx.svc).documents(input)),
  document: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).getDocument(input.id)),
  previewDocument: edit
    .input(DocumentSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).previewDocument(input)),
  saveDocument: edit
    .input(DocumentSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveDocument(input)),
  removeDocument: edit
    .input(z.object({ id: zId, revision: z.number().int().positive(), confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).removeDocument(input)),
  audit: m.procedure
    .meta({ permission: 'inventory.audit' })
    .input(z.object({ id: zId, revision: z.number().int().positive(), to: z.boolean() }))
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).audit(input)),
  nextNumber: edit
    .input(z.object({ kind: z.enum(['receipt', 'issue']), warehouseId: zId, date: zDate }))
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).nextNumber(input)),
  copyDocument: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).copyDocument(input.id)),
  stock: view.input(FilterSchema).query(({ ctx, input }) => inventoryService(ctx.svc).stock(input)),
  ledger: view
    .input(FilterSchema)
    .query(({ ctx, input }) => inventoryService(ctx.svc).ledger(input)),
  sales: view.input(FilterSchema).query(({ ctx, input }) => inventoryService(ctx.svc).sales(input)),
  summary: view
    .input(
      z.object({
        filter: FilterSchema,
        group: z.enum(['product', 'category', 'account', 'costAccount']),
        detail: z.boolean(),
        valuation: z.enum(['document', 'cost']),
      }),
    )
    .query(({ ctx, input }) => inventoryService(ctx.svc).summary(input)),
  count: view.input(countKey).query(({ ctx, input }) => inventoryService(ctx.svc).count(input)),
  generateCount: edit
    .input(confirmedCount)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).generateCount(input)),
  saveCount: edit
    .input(CountSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveCount(input)),
  resetCount: edit
    .input(confirmedCount)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).resetCount(input)),
  removeCount: edit
    .input(confirmedCount)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).removeCount(input)),
  contracts: view
    .input(FilterSchema)
    .query(({ ctx, input }) => inventoryService(ctx.svc).contracts(input)),
  contract: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).getContract(input.id)),
  saveContract: edit
    .input(ContractSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveContract(input)),
  contractDraft: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => inventoryService(ctx.svc).contractDraft(input.id)),
  bulk: edit.input(BulkSchema).mutation(({ ctx, input }) => inventoryService(ctx.svc).bulk(input)),
  saveSettings: m.procedure
    .meta({ permission: 'inventory.settings' })
    .input(SettingsSchema)
    .mutation(({ ctx, input }) => inventoryService(ctx.svc).saveSettings(input)),
  importPreview: m.procedure
    .meta({ permission: 'inventory.import' })
    .input(ImportSchema)
    .mutation(({ ctx, input }) => importInventory(ctx.svc, input)),
  importSave: m.procedure
    .meta({ permission: 'inventory.import' })
    .input(ImportSchema)
    .mutation(({ ctx, input }) => importInventory(ctx.svc, input, true)),
});
export type InventoryRouter = typeof inventoryRouter;
