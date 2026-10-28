import type { CoreServiceProviders } from '@caiwu/core/server';
import type { FixedAssetsTables } from './migrations';

/** 零金额折旧批次已完成计提，不需要生成空凭证。 */
export const assetPeriodDependencies: NonNullable<
  CoreServiceProviders['periodDependencies']
>[number] = async (ctx, input) => {
  if (input.mode !== 'year-close') return [];
  const batches = await ctx.db
    .withTables<FixedAssetsTables>()
    .selectFrom('fixed_assets_batch as b')
    .innerJoin('fixed_assets_line as l', 'l.batch_id', 'b.id')
    .select('b.id')
    .distinct()
    .where('b.period', '=', input.period)
    .where('b.voucher_id', 'is', null)
    .where('l.amount', '!=', 0)
    .execute();
  return batches.length
    ? [
        {
          category: '未制证折旧批次',
          count: batches.length,
          to: '/m/fixed-assets/depreciation',
        },
      ]
    : [];
};
