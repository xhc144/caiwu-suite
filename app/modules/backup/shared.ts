import { z } from 'zod';

// 单包 base64 后低于 W0 的 50 MiB bodyLimit，批量逐包发送。
export const TRANSFER_LIMIT = 32 * 1024 * 1024;
export const IdSchema = z.string().uuid();
export const NameSchema = z
  .string()
  .trim()
  .min(1, '备份名称不能为空')
  .max(60, '名称最多 60 字')
  .refine(
    (v) =>
      !/[\\/]/.test(v) && !Array.from(v).some((c) => c.charCodeAt(0) < 32) && !v.includes('..'),
    '名称不能包含路径或控制字符',
  );
export const DirectorySchema = z
  .string()
  .trim()
  .min(1, '请设置备份目录')
  .max(40)
  .regex(/^[\p{L}\p{N}_-]+$/u, '目录只能是受管目录下的一个名称，不能填写路径');
export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
  directory: DirectorySchema.default('自动备份'),
  onStart: z.boolean().default(true),
  onExit: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5, '间隔至少 5 分钟').max(43200),
  keep: z.number().int().min(1, '至少保留一份').max(100),
});
export type BackupSettings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: BackupSettings = {
  enabled: true,
  directory: '自动备份',
  onStart: true,
  onExit: true,
  intervalMinutes: 60,
  keep: 10,
};
export const CreateSchema = z.object({ requestId: IdSchema, name: NameSchema });
export const UploadSchema = z.object({
  name: NameSchema,
  base64: z.string().max(Math.ceil(TRANSFER_LIMIT / 3) * 4, '文件超过 32 MiB，需受管流式传输接口'),
});
export const ConfirmSchema = z.object({
  planId: IdSchema,
  text: z.string().max(100),
  password: z.string().max(64),
});
export const DeleteSchema = z.object({
  id: IdSchema,
  text: z.string().max(100),
  password: z.string().max(64),
});
export const KindSchema = z.enum(['manual', 'automatic', 'pre-restore', 'imported']);
export const MetadataSchema = z.object({
  format: z.literal('caiwu-sqlite-backup'),
  version: z.literal(1),
  appVersion: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  type: KindSchema,
  length: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  book: z.object({
    id: IdSchema,
    name: z.string().min(1).max(60),
    orgName: z.string().min(1).max(100),
    product: z.enum(['qingsong', 'minfei', 'chengben']),
    regime: z.string().min(1).max(200),
    templateId: z.string().min(1).max(100),
    templateVersion: z.string().min(1).max(80),
    startPeriod: z.number().int(),
    currentPeriod: z.number().int(),
  }),
  migrations: z
    .array(
      z.object({
        scope: z.string().min(1).max(80),
        id: z.string().min(1).max(100),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(2000),
});
export type BackupMetadata = z.infer<typeof MetadataSchema>;
