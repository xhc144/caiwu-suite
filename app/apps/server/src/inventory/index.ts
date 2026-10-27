import { z } from 'zod';
import { BusinessError, zId, type InventoryDocumentInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { DocumentSchema } from '../../../../modules/inventory/shared';
import { defineServerModule, moduleKit, type ServerModule } from '@caiwu/server-kit';
import { inventoryService } from '../../../../modules/inventory/server/service';
import { inventoryCosting, withInventoryCosting } from './costing';
import { migrations, type InventoryTables } from './migrations';

async function assertSourceUnlocked(svc: CoreServices, id: number | undefined) {
  if (id == null) return;
  const links = await svc.db
    .withTables<InventoryTables>()
    .selectFrom('inventory_voucher_source')
    .select('voucher_id')
    .where('document_id', '=', id)
    .execute();
  if (links.length)
    throw new BusinessError({
      code: 'INVENTORY_SOURCE_LOCKED',
      message: `单据 ${id} 已生成凭证，不能修改或删除`,
      hint: '先在来源模块合法撤销对应凭证，再修改单据',
    });
}
function saveDocument(svc: CoreServices, input: InventoryDocumentInput) {
  return svc.tx(async (t) => {
    await assertSourceUnlocked(t, input.id);
    return inventoryService(t).saveDocument(input);
  });
}
function removeDocument(
  svc: CoreServices,
  input: { id: number; revision: number; confirmed: boolean },
) {
  return svc.tx(async (t) => {
    await assertSourceUnlocked(t, input.id);
    return inventoryService(t).removeDocument(input);
  });
}
export function withInventoryProvider<R extends ServerModule>(module: R): R {
  if (module.manifest.id !== 'inventory' || module.providers?.inventory) return module;
  const manifest = {
    ...module.manifest,
    permissions: [
      ...module.manifest.permissions,
      { id: 'inventory.costing', name: '正式库存成本核算' },
      { id: 'inventory.voucher', name: '库存来源凭证' },
    ],
    sources: [
      ...module.manifest.sources,
      ...(['receipt', 'revenue', 'cost'] as const).map((type) => ({
        type,
        name:
          type === 'receipt' ? '入库凭证' : type === 'revenue' ? '销售收入凭证' : '出库成本凭证',
        path: `/receipts?id={id}`,
      })),
    ],
  };
  const kit = moduleKit(manifest);
  const edit = kit.procedure.meta({ permission: 'inventory.edit' });
  return defineServerModule(manifest, {
    ...module,
    router: kit.router({
      ...module.router._def.record,
      saveDocument: edit
        .input(DocumentSchema)
        .mutation(({ ctx, input }) => saveDocument(ctx.svc, input)),
      removeDocument: edit
        .input(z.object({ id: zId, revision: z.number().int().positive(), confirmed: z.boolean() }))
        .mutation(({ ctx, input }) => removeDocument(ctx.svc, input)),
    }),
    migrations: [...module.migrations, ...migrations],
    providers: {
      ...module.providers,
      inventory: (svc) => ({
        snapshot: (period) => inventoryCosting(svc).snapshot(period),
        with: (run) =>
          withInventoryCosting(svc, (inv) =>
            run({
              ...inv,
              saveDocument: async (input) => {
                svc.permissions.require('inventory.edit');
                return saveDocument(svc, input);
              },
              removeDocument: async (input) => {
                svc.permissions.require('inventory.edit');
                return removeDocument(svc, input);
              },
            }),
          ),
      }),
    },
  }) as R;
}
