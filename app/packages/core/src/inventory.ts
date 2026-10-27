import { z } from 'zod';
import { zCents, zId, zPeriod } from './schemas';
const quantity = z
  .string()
  .max(40)
  .regex(/^\d+(\.\d{1,6})?$/);
const signedQuantity = z
  .string()
  .max(40)
  .regex(/^-?\d+(\.\d{1,6})?$/);

export const CostingCommitSchema = z.object({
  bookId: z.string().min(1),
  period: zPeriod,
  requestKey: z.string().min(8).max(100),
  expectedStockRevision: z.number().int().nonnegative(),
  expectedOpeningRevision: z.number().int().nonnegative(),
  previousBatchId: z.string().nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z
    .array(
      z.object({
        lineId: zId,
        documentId: zId,
        costCents: zCents.nonnegative(),
        unitCost: z
          .string()
          .max(100)
          .regex(/^\d+(\.\d{1,12})?$/),
      }),
    )
    .max(100000),
  balances: z
    .array(
      z.object({
        warehouseId: zId,
        productId: zId,
        quantity,
        amountCents: zCents.nonnegative(),
      }),
    )
    .max(100000),
  countAdjustments: z
    .array(
      z.object({
        warehouseId: zId,
        productId: zId,
        countId: zId.nullable(),
        quantity: signedQuantity,
        amountCents: zCents,
        zeroQuantityAdjustmentCents: zCents,
      }),
    )
    .max(100000),
});
export const CostingCancelSchema = z.object({
  bookId: z.string().min(1),
  batchId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});
export const VoucherSourceSchema = z.object({
  bookId: z.string().min(1),
  documentId: zId,
  purpose: z.enum(['receipt', 'revenue', 'cost']),
  expectedRevision: z.number().int().positive(),
  voucherId: zId,
});
export type CostingCommitInput = z.infer<typeof CostingCommitSchema>;
export type CostingCancelInput = z.infer<typeof CostingCancelSchema>;
export type VoucherSourceInput = z.infer<typeof VoucherSourceSchema>;

/** 库存模块拥有算法和存储；这里只定义跨模块传输数据。金额为整数分，数量为十进制字符串。 */
export interface InventorySnapshot {
  version: 1;
  bookId: string;
  startPeriod: number;
  period: number;
  cutoffDate: string;
  stockRevision: number;
  openingRevision: number;
  actorId: number;
  moduleId: string | null;
  fingerprint: string;
  periodState: 'open' | 'closed';
  previousBatchId: string | null;
  periodOpeningReady: boolean;
  control: {
    costCutoffDate: string | null;
    costPeriod: number | null;
    costBatch: string | null;
    openingLocked: boolean;
  };
  products: {
    id: number;
    code: string;
    name: string;
    unit: string;
    revision: number;
    inventoryAccountId: number | null;
    salesAccountId: number | null;
    allocationFactor: string;
    disabled: boolean;
  }[];
  warehouses: {
    id: number;
    code: string;
    name: string;
    kind: 'warehouse' | 'workshop';
    revision: number;
    disabled: boolean;
  }[];
  opening: {
    id: number;
    warehouseId: number;
    productId: number;
    quantity: string;
    unitPrice: string;
    amountCents: number;
    calculationStatus: string;
    calculationBatch: string | null;
    calculationPeriod: number | null;
  }[];
  documents: {
    id: number;
    revision: number;
    warehouseId: number;
    kind: 'receipt' | 'issue';
    number: string;
    date: string;
    period: number;
    category: string;
    accountId: number | null;
    costAccountId: number | null;
    taxRate: string;
    auditedBy: number | null;
    voucherId: number | null;
    sourceType: string | null;
    sourceId: number | null;
    calculationStatus: string;
    calculationBatch: string | null;
    calculationPeriod: number | null;
    calculationCutoffDate: string | null;
  }[];
  movements: {
    id: number;
    documentId: number;
    productId: number;
    position: number;
    quantity: string;
    unitPrice: string;
    netCents: number;
    taxCents: number;
    grossCents: number;
    outboundCostCents: number | null;
    unitCost: string | null;
    calculationStatus: string;
    calculationBatch: string | null;
    calculationPeriod: number | null;
  }[];
  counts: {
    id: number;
    warehouseId: number;
    period: number;
    revision: number;
    calculationStatus: string;
    calculationBatch: string | null;
    lines: {
      id: number;
      productId: number;
      bookQuantity: string;
      actualQuantity: string;
      bookCents: number | null;
    }[];
  }[];
  batches: {
    id: string;
    period: number;
    status: 'calculated' | 'cancelled';
    revision: number;
    previous_batch_id: string | null;
    actor_id: number;
    module_id: string;
  }[];
  voucherSources: {
    document_id: number;
    purpose: 'receipt' | 'revenue' | 'cost';
    voucher_id: number;
    owner_module: string;
    actor_id: number;
  }[];
  periodOpening: {
    warehouseId: number;
    productId: number;
    quantity: string;
    amountCents: number;
    sourceBatchId: string | null;
  }[];
}

export interface InventoryDocumentInput {
  id?: number;
  revision?: number;
  requestKey: string;
  kind: 'receipt' | 'issue';
  warehouseId: number;
  number: string;
  date: string;
  category: '采购' | '其他入库' | '销售' | '领用' | '其他出库';
  operator?: string;
  summary?: string;
  accountId?: number | null;
  costAccountId?: number | null;
  taxRate?: string;
  sourceType?: 'contract' | 'document' | null;
  sourceId?: number | null;
  negativeConfirmation?: string;
  lines: {
    productCode: string;
    quantity: string;
    unitPrice: string;
    priceIncludesTax?: boolean;
    note?: string;
  }[];
}
export interface InventoryCostingCapability {
  saveDocument(input: InventoryDocumentInput): Promise<{ id: number; revision: number }>;
  removeDocument(input: { id: number; revision: number; confirmed: boolean }): Promise<void>;
  snapshot(period: number): Promise<InventorySnapshot>;
  commitCosting(input: CostingCommitInput): Promise<{
    batchId: string;
    revision: number;
    period: number;
    status: 'calculated';
  }>;
  cancelCosting(input: CostingCancelInput): Promise<{
    batchId: string;
    revision: number;
    period: number;
    status: 'cancelled';
  }>;
  lockVoucherSource(input: VoucherSourceInput): Promise<{
    documentId: number;
    revision: number;
    voucherId: number;
    purpose: 'receipt' | 'revenue' | 'cost';
  }>;
  releaseVoucherSource(input: VoucherSourceInput): Promise<{
    documentId: number;
    revision: number;
    purpose: 'receipt' | 'revenue' | 'cost';
  }>;
}

export interface InventoryService {
  snapshot(period: number): Promise<InventorySnapshot>;
  /** 必须在 svc.tx 回调中使用，传入能力在 with 回调结束时撤销。 */
  with<T>(run: (inventory: InventoryCostingCapability) => Promise<T>): Promise<T>;
}
