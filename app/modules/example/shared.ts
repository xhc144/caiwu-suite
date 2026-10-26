// 前后端共用的输入格式和类型。只能 import @caiwu/core 和 zod。
import { z } from 'zod';
import { zCents, zDate, zId } from '@caiwu/core';

export const MemoInputSchema = z.object({
  date: zDate,
  summary: z.string().trim().min(1, '摘要不能为空').max(100),
  debitAccountId: zId,
  creditAccountId: zId,
  amount: zCents.refine((v) => v > 0, '金额必须大于 0'),
  /** 借方科目启用了部门核算时必填 */
  departmentId: zId.nullable().optional(),
});
export type MemoInput = z.input<typeof MemoInputSchema>;

export const MemoListFilterSchema = z
  .object({
    keyword: z.string().optional(),
    id: zId.optional(),
  })
  .default({});

export interface Memo {
  id: number;
  date: string;
  period: number;
  summary: string;
  debitAccountId: number;
  debitAccountName: string;
  creditAccountId: number;
  creditAccountName: string;
  amount: number;
  departmentId: number | null;
  departmentName: string | null;
  voucherId: number | null;
  voucherNo: string | null;
  voucherStatus: string | null;
  createdAt: string;
}
