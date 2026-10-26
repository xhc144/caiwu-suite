import { z } from 'zod';
import { zDate, zId } from '@caiwu/core';

export const NewPasswordSchema = z
  .string()
  .min(8, '新密码须为 8–64 个字符')
  .max(64, '新密码须为 8–64 个字符');
const confirmation = { password: NewPasswordSchema, confirmPassword: z.string() };
export const UserCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]{1,20}$/, '用户编号须为 1–20 位字母、数字、下划线、点或连字符'),
    name: z.string().trim().min(1, '用户名称不能为空').max(60),
    isAdmin: z.boolean().default(false),
    permissions: z.array(z.string()).max(2000).default([]),
    ...confirmation,
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: '两次新密码不一致',
    path: ['confirmPassword'],
  });
export const UserUpdateSchema = z.object({
  id: zId,
  name: z.string().trim().min(1, '用户名称不能为空').max(60),
  disabled: z.boolean(),
  confirmCode: z.string(),
});
export const PermissionSchema = z.object({
  id: zId,
  isAdmin: z.boolean(),
  permissions: z.array(z.string()).max(2000),
  confirmCode: z.string(),
});
export const PasswordSchema = z
  .object({ oldPassword: z.string().max(64), ...confirmation })
  .refine((v) => v.password === v.confirmPassword, {
    message: '两次新密码不一致',
    path: ['confirmPassword'],
  });
export const PasswordResetSchema = z
  .object({ id: zId, confirmCode: z.string(), ...confirmation })
  .refine((v) => v.password === v.confirmPassword, {
    message: '两次新密码不一致',
    path: ['confirmPassword'],
  });
export const LogFilterSchema = z
  .object({
    from: zDate,
    to: zDate,
    userId: zId.optional(),
    module: z.string().max(100).optional(),
    action: z.string().max(100).optional(),
    target: z.string().max(100).optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(30),
  })
  .refine((v) => v.from <= v.to, { message: '开始日期不能晚于结束日期', path: ['to'] });
export const AUDIT_SCOPES = [
  'accounts',
  'opening',
  'vouchers',
  'currencies',
  'periods',
  'dimensions',
] as const;
export const SCOPE_NAMES: Record<(typeof AUDIT_SCOPES)[number], string> = {
  accounts: '科目',
  opening: '期初',
  vouchers: '凭证与分录',
  currencies: '币种与汇率',
  periods: '期间',
  dimensions: '辅助档案',
};
export const AuditSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  scopes: z.array(z.enum(AUDIT_SCOPES)).min(1, '至少选择一类资料'),
});
export type AuditInput = z.infer<typeof AuditSchema>;
export type LogFilter = z.input<typeof LogFilterSchema>;
export type UserRow = {
  id: number;
  code: string;
  name: string;
  isAdmin: boolean;
  disabled: boolean;
};
export type CheckItem = {
  id: string;
  category: string;
  status: '通过' | '不通过' | '无数据' | '无法检查';
  target: string;
  message: string;
  suggestion: string;
  to?: string;
};
