import { it, expect, vi } from 'vitest';
import type { CoreServices } from '@caiwu/core/server';
import {
  prepareEnterprise,
  generateEnterprise,
  verifyEnterprise,
  enterpriseDescriptors,
} from '../../templates/enterprise/statutory.server';
import { fixture } from './fixture';
function context() {
  const { c, d } = fixture();
  let pending = 0;
  const requirePermission = vi.fn(async () => {});
  const svc = {
    moduleId: 'report-engine',
    permissions: { require: requirePermission },
    book: {
      info: async () => ({
        id: d.bookId,
        orgName: d.orgName,
        regime: d.regime,
        startPeriod: d.startPeriod,
      }),
    },
    accounts: {
      list: async () => d.accounts,
      categories: async () => [{ id: 'pnl', isPnl: true }],
    },
    periods: {
      list: async () => d.periods.map((period) => ({ period })),
      require: async (p: number) => {
        if (!d.periods.includes(p)) throw new Error(`缺少会计期间${p}`);
      },
    },
    ledger: {
      balances: async (q: { periodFrom: number }) => d.balances[q.periodFrom] ?? [],
      entries: async () => d.entries,
    },
    vouchers: {
      list: async (q: { statuses: string[]; offset?: number; limit?: number }) =>
        q.statuses.includes('posted')
          ? {
              items: d.vouchers.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 10000)),
              total: d.vouchers.length,
            }
          : { items: [], total: pending },
    },
    dimensions: { items: async () => [] },
    opening: { list: async () => [] },
  } as unknown as CoreServices;
  return {
    c,
    d,
    svc,
    requirePermission,
    setPending: (n: number) => {
      pending = n;
    },
  };
}
it('w_bb_proc 保存来源绑定后正确报告日可生成，跨月与失效来源拒绝', async () => {
  const { c, d, svc, requirePermission } = context(),
    prepared = await prepareEnterprise(svc, c);
  const result = await generateEnterprise(svc, { ...prepared, period: c.period });
  expect(result.kind).toBe('generated');
  expect(requirePermission).toHaveBeenCalledWith('report-engine.generate');
  await expect(verifyEnterprise(svc, c, prepared.sourceDigest, 202511)).rejects.toThrow('报告期间');
  d.accounts[0]!.name = '已修改来源';
  await expect(generateEnterprise(svc, { ...prepared, period: c.period })).rejects.toThrow(
    '来源已变化',
  );
});
it('w_bb_proc 未过账确认包含实际比较来源范围，已确认仍只取已过账', async () => {
  const { c, svc, setPending } = context(),
    prepared = await prepareEnterprise(svc, c);
  setPending(1);
  const pending = await generateEnterprise(svc, { ...prepared, period: c.period });
  expect(pending).toMatchObject({ kind: 'confirmation', count: 1, from: 202301, to: 202512 });
  const result = await generateEnterprise(svc, {
    ...prepared,
    period: c.period,
    confirmUnposted: true,
  });
  expect(result.kind).toBe('generated');
  if (result.kind === 'generated') expect(result.result.profit.current.netProfit).toBe('60000');
});
it('w_bb_main 四张真实描述器含年度权益限制，服务拒绝错误模块', async () => {
  expect(enterpriseDescriptors.map((d) => d.code)).toEqual(['201', '202', '203', '204']);
  expect(enterpriseDescriptors[3].annualOnly).toBe(true);
  const { c, svc } = context();
  const wrong = { ...svc, moduleId: 'books' } as CoreServices;
  await expect(prepareEnterprise(wrong, c)).rejects.toThrow('报表管理');
});
