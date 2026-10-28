import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { inventoryRouter } from './router';
import { inventoryCosting, withInventoryCosting } from './costing';
import { fail, inventoryService } from './service';
import { invoiceIssueReferences, previewInvoiceIssue, saveInvoiceIssue } from './invoice-issue';
import type {
  InvoiceIssueInput,
  InvoiceIssueReferencesInput,
  SaveInvoiceIssueInput,
} from '../invoice-issue';
import type { DocumentInput } from '../shared';
export default defineServerModule(manifest, {
  router: inventoryRouter,
  migrations,
  providers: {
    inventory: (svc) => ({
      snapshot: (period) => inventoryCosting(svc).snapshot(period),
      invoiceIssueReferences: (input: InvoiceIssueReferencesInput) =>
        invoiceIssueReferences(svc, input),
      previewInvoiceIssue: (input: InvoiceIssueInput) => previewInvoiceIssue(svc, input),
      saveInvoiceIssue: (input: SaveInvoiceIssueInput) => saveInvoiceIssue(svc, input),
      with: (run) =>
        withInventoryCosting(svc, (inventory) => {
          const capability = {
            ...inventory,
            saveInvoiceIssue: (input: SaveInvoiceIssueInput) => saveInvoiceIssue(svc, input),
            saveDocument: (input: DocumentInput) => {
              if (svc.moduleId === 'invoice')
                fail('INVOICE_CAPABILITY', '发票只能使用专用出库操作');
              svc.permissions.require('inventory.edit');
              return inventoryService(svc).saveDocument(input);
            },
            removeDocument: (input: { id: number; revision: number; confirmed: boolean }) => {
              if (svc.moduleId === 'invoice')
                fail('INVOICE_CAPABILITY', '发票不能调用普通库存删除操作');
              svc.permissions.require('inventory.edit');
              return inventoryService(svc).removeDocument(input);
            },
          };
          return run(capability);
        }),
    }),
  },
});
export { inventoryCosting, withInventoryCosting } from './costing';
export type {
  CostingCommitInput,
  CostingCancelInput,
  VoucherSourceInput,
} from '../costing-contract';
