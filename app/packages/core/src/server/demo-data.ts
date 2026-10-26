import type { DimensionTypeId } from '../dimensions';
import type { CoreServices } from './services';

/** 演示数据里的辅助档案编码，测试里可以直接用。 */
export const DEMO_DIMENSIONS: Record<DimensionTypeId, { code: string; name: string }[]> = {
  department: [
    { code: '01', name: '行政部' },
    { code: '02', name: '销售部' },
  ],
  partner: [
    { code: 'C001', name: '华东贸易有限公司' },
    { code: 'S001', name: '原料供应有限公司' },
  ],
  person: [{ code: 'P01', name: '张三' }],
  project: [{ code: 'XM01', name: '一号项目' }],
  cashflow: [
    { code: 'CF01', name: '销售商品、提供劳务收到的现金' },
    { code: 'CF02', name: '购买商品、接受劳务支付的现金' },
  ],
};

/**
 * 预置演示数据：辅助档案、美元汇率、两条常用摘要。只用于开发模式和自动化测试
 * （测试夹具默认调用；开发模式下可通过 core.dev.seedDemo 接口调用）。已存在的跳过。
 */
export async function seedDemoData(svc: CoreServices, startPeriod: number): Promise<void> {
  for (const [type, items] of Object.entries(DEMO_DIMENSIONS) as [
    DimensionTypeId,
    { code: string; name: string }[],
  ][]) {
    for (const item of items) {
      if (!(await svc.dimensions.getByCode(type, item.code)))
        await svc.dimensions.create({ type, ...item });
    }
  }
  const usd = await svc.db
    .selectFrom('currency')
    .select('code')
    .where('code', '=', 'USD')
    .executeTakeFirst();
  if (usd) {
    await svc.db
      .insertInto('exchange_rate')
      .values({ currency_code: 'USD', period: startPeriod, rate: '7.1' })
      .onConflict((oc) => oc.columns(['currency_code', 'period']).doNothing())
      .execute();
  }
  const phrases = await svc.reference.summaries();
  if (!phrases.length) {
    await svc.db
      .insertInto('summary_phrase')
      .values([
        { code: '01', text: '提取备用金', pinyin: 'tqbyj', use_count: 0, sort: 0 },
        { code: '02', text: '支付货款', pinyin: 'zfhk', use_count: 0, sort: 0 },
      ])
      .execute();
  }
}
