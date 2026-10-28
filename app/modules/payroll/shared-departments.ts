import { z } from 'zod';
import { zId } from '@caiwu/core';

export const DepartmentUpdateSchema = z.object({
  id: zId,
  revision: z.number().int().nonnegative(),
  code: z.string().trim().min(1, '部门编码不能为空').max(30),
  name: z.string().trim().min(1, '部门名称不能为空').max(60),
});
export const DepartmentStatusSchema = z.object({
  id: zId,
  revision: z.number().int().nonnegative(),
  disabled: z.boolean(),
  confirmed: z.boolean(),
});
export const DepartmentDeleteSchema = z.object({
  id: zId,
  revision: z.number().int().nonnegative(),
  expiresAt: z.number().int(),
  fingerprint: z.string(),
  confirmed: z.boolean(),
});
