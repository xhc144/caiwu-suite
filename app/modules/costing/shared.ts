import { z } from 'zod';
import { isPeriod, VoucherSourceSchema, zDate, zId } from '@caiwu/core';

export const CalculationSchema = z.object({
  period: z.number().int().refine(isPeriod, '请选择有效的核算年月'),
  adjustZeroQuantity: z.boolean().default(false),
});
export type CalculationInput = z.input<typeof CalculationSchema>;
export const SaveWorksheetSchema = CalculationSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/, '请先重新试算'),
});
export const CommitCalculationSchema = SaveWorksheetSchema.extend({
  requestKey: z.string().min(8).max(100),
  confirmed: z.boolean(),
});
export const CancelCalculationSchema = z.object({
  batchId: z.string().min(1),
  revision: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.boolean(),
  voucherDeletion: VoucherSourceSchema.shape.voucherDeletion.optional(),
});
export const CancelWorksheetSchema = z.object({
  id: zId,
  revision: z.number().int().positive(),
  confirmed: z.boolean(),
});
export const ReportSchema = z
  .object({
    from: zDate,
    to: zDate,
    warehouseId: zId.optional(),
    productFrom: z.string().trim().optional(),
    productTo: z.string().trim().optional(),
  })
  .refine((v) => v.to >= v.from, '截止日期不能小于起始日期')
  .refine(
    (v) => !v.productFrom || !v.productTo || v.productTo >= v.productFrom,
    '产品截止编号不能小于起始编号',
  );
export const VoucherTargetSchema = z
  .object({
    documentId: zId.optional(),
    countId: zId.optional(),
    purpose: z.enum(['receipt', 'revenue', 'cost', 'count']),
  })
  .refine(
    (v) => (v.purpose === 'count' ? !!v.countId && !v.documentId : !!v.documentId && !v.countId),
    '请选择与凭证用途一致的来源单据或盘点表',
  );
export const VoucherPreviewSchema = VoucherTargetSchema.safeExtend({
  taxAccountId: zId.optional(),
  revenueAccountId: zId.optional(),
  adjustmentAccountId: zId.optional(),
});
export const GenerateVoucherSchema = VoucherPreviewSchema.safeExtend({
  voucherTypeId: zId,
  number: z.number().int().positive().optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.number().int().positive(),
  confirmed: z.boolean(),
});
export const DeleteVoucherSchema = VoucherTargetSchema.safeExtend({
  expectedRevision: z.number().int().positive(),
  confirmed: z.boolean(),
  voucherDeletion: VoucherSourceSchema.shape.voucherDeletion.optional(),
});
export const RegenerateVoucherSchema = GenerateVoucherSchema.safeExtend({
  voucherDeletion: VoucherSourceSchema.shape.voucherDeletion.optional(),
});

export type CostRow = {
  warehouseId: number;
  warehouseName: string;
  productId: number;
  productCode: string;
  productName: string;
  openingQuantity: string;
  openingCents: number;
  receivedQuantity: string;
  receivedCents: number;
  issuedQuantity: string;
  issuedCents: number;
  unitCost: string;
  countDifference: string;
  countCents: number;
  zeroQuantityAdjustmentCents: number;
  closingQuantity: string;
  closingCents: number;
};
export type LineCost = { lineId: number; documentId: number; costCents: number; unitCost: string };
export type CalculationResult = {
  period: number;
  method: 'monthly-weighted-average';
  status: 'preview';
  fingerprint: string;
  rows: CostRow[];
  lines: LineCost[];
};
export type ProfitLine = {
  id: number;
  documentId: number;
  date: string;
  number: string;
  warehouseId: number;
  productCode: string;
  productName: string;
  quantity: string;
  revenueCents: number;
  taxCents: number;
  costCents: number | null;
  grossProfitCents: number | null;
  costStatus: '已核算' | '待成本核算' | '历史成本未知';
};
