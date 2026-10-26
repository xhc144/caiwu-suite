import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { inventoryRouter } from './router';
import { inventoryCosting, withInventoryCosting } from './costing';
export default defineServerModule(manifest, {
  router: inventoryRouter,
  migrations,
  providers: {
    inventory: (svc) => ({
      snapshot: (period) => inventoryCosting(svc).snapshot(period),
      with: (run) => withInventoryCosting(svc, run),
    }),
  },
});
export { inventoryCosting, withInventoryCosting } from './costing';
export type {
  CostingCommitInput,
  CostingCancelInput,
  VoucherSourceInput,
} from '../costing-contract';
