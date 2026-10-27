import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { inventoryRouter } from './router';
import { inventoryCosting, withInventoryCosting } from './costing';
import { inventoryService } from './service';
export default defineServerModule(manifest, {
  router: inventoryRouter,
  migrations,
  providers: {
    inventory: (svc) => ({
      snapshot: (period) => inventoryCosting(svc).snapshot(period),
      with: (run) =>
        withInventoryCosting(svc, (inventory) =>
          run({
            ...inventory,
            saveDocument: (input) => {
              svc.permissions.require('inventory.edit');
              return inventoryService(svc).saveDocument(input);
            },
            removeDocument: (input) => {
              svc.permissions.require('inventory.edit');
              return inventoryService(svc).removeDocument(input);
            },
          }),
        ),
    }),
  },
});
export { inventoryCosting, withInventoryCosting } from './costing';
export type {
  CostingCommitInput,
  CostingCancelInput,
  VoucherSourceInput,
} from '../costing-contract';
