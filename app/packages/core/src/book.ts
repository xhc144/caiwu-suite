import { z } from 'zod';
import type { CodeScheme } from './code-scheme';
import type { Period } from './period';
import { PRODUCT_IDS, type ProductId } from './products';

export interface BookInfo {
  id: string;
  name: string;
  orgName: string;
  templateId: string;
  templateName: string;
  regime: string;
  product: ProductId;
  startPeriod: Period;
  codeScheme: CodeScheme;
  baseCurrency: string;
  createdAt: string;
}

export interface BookSummary extends BookInfo {
  /** 账套文件大小（字节） */
  fileSize: number;
  lastOpenedAt: string | null;
}

export interface PeriodInfo {
  period: Period;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
}

export interface CurrentUser {
  id: number;
  code: string;
  name: string;
  isAdmin: boolean;
  permissions: string[];
}

export const CreateBookInputSchema = z.object({
  name: z.string().trim().min(1, '账套名称不能为空').max(60),
  orgName: z.string().trim().min(1, '单位名称不能为空').max(100),
  templateId: z.string().min(1),
  product: z.enum(PRODUCT_IDS),
  startYear: z.number().int().min(2000).max(2100),
  startMonth: z.number().int().min(1).max(12),
  /** 科目级次，例如 "4-3-3"；不填用模板默认 */
  codeScheme: z.string().optional(),
  adminCode: z.string().trim().default('admin'),
  adminName: z.string().trim().default('系统管理员'),
  adminPassword: z.string().max(64).default(''),
});
export type CreateBookInput = z.input<typeof CreateBookInputSchema>;

export interface TemplateSummary {
  id: string;
  version: string;
  name: string;
  regime: string;
  description: string | null;
  order: number;
  status: 'current' | 'deprecated';
  codeScheme: string;
  devOnly: boolean;
  accountCount: number;
}
