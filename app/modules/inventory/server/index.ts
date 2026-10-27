import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { inventoryRouter } from './router';
export default defineServerModule(manifest, { router: inventoryRouter, migrations });
export { inventoryCosting, withInventoryCosting } from './costing';
export type {
  CostingCommitInput,
  CostingCancelInput,
  VoucherSourceInput,
} from '../costing-contract';
