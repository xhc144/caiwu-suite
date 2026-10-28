import { z } from 'zod';
import { zPeriod } from '@caiwu/core';

export const InitializationOptionsSchema = z.object({
  startPeriod: zPeriod,
  preserveData: z.boolean().default(false),
  keepArchives: z.boolean().default(true),
});
export const InitializationPreviewSchema = InitializationOptionsSchema.extend({
  password: z.string().min(1, '请输入当前管理员密码').max(256),
});
export const InitializationApplySchema = InitializationPreviewSchema.extend({
  hash: z.string().length(64),
  expiresAt: z.number().int(),
  confirmed: z.boolean(),
  confirmation: z.literal('初始化工资', { error: '请准确输入“初始化工资”确认' }),
});
