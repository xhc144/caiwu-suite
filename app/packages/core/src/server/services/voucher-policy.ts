import { z } from 'zod';
import { withTransaction } from '@caiwu/db';
import { BusinessError } from '../../errors';
import { nowIso, type ServiceContext } from '../context';
import { logService } from './basic';

export const VoucherPolicySchema = z.object({
  numbering: z.enum(['automatic', 'manual']).default('automatic'),
  renumberAfterDelete: z.boolean().default(false),
  allowModifyOthers: z.boolean().default(true),
});
export type VoucherPolicy = z.infer<typeof VoucherPolicySchema>;
export function voucherPolicyService(ctx: ServiceContext) {
  return {
    async get(): Promise<VoucherPolicy> {
      const row = await ctx.db
        .selectFrom('book_setting')
        .select('value')
        .where('scope', '=', 'core')
        .where('key', '=', 'voucherPolicy')
        .executeTakeFirst();
      return VoucherPolicySchema.parse(row ? JSON.parse(row.value) : {});
    },
    async set(raw: VoucherPolicy): Promise<VoucherPolicy> {
      if (!ctx.db.isTransaction)
        return withTransaction(ctx.db, (db) => voucherPolicyService({ ...ctx, db }).set(raw));
      if (!ctx.user.isAdmin)
        throw new BusinessError({ code: 'FORBIDDEN', message: '只有账套管理员可以修改凭证策略' });
      const policy = VoucherPolicySchema.parse(raw);
      await ctx.db
        .insertInto('book_setting')
        .values({
          scope: 'core',
          key: 'voucherPolicy',
          value: JSON.stringify(policy),
          updated_at: nowIso(ctx),
        })
        .onConflict((oc) =>
          oc
            .columns(['scope', 'key'])
            .doUpdateSet({ value: JSON.stringify(policy), updated_at: nowIso(ctx) }),
        )
        .execute();
      await logService(ctx).write({
        action: 'voucher.policy',
        summary: '修改账套凭证编号及互改策略',
        detail: policy,
      });
      return policy;
    },
  };
}
