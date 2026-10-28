import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { cashflowRows } from '../cashflow';
import { cashflowService } from '../server/cashflow-service';
import balancesServer from '../server';
import { seedCashflowCases, seedFlow } from './cashflow-fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
});
afterEach(async () => app.close());
const range = { periodFrom: 202602, periodTo: 202602 };
const api = () => app.call(balancesServer);

describe('w_zc_xjll/w_zc_xjll_1 现金流量试算', () => {
  it('现金银行真实期初期末、红字收付、原币折本位币、互转去重、历史空流向及本年累计', async () => {
    const ids = await seedCashflowCases(app.svc);
    const report = await api().cashflow(range);
    expect(report).toMatchObject({
      cashOpening: 22000,
      cashClosing: 46410,
      balanceDifference: 0,
      ytdFrom: 202601,
      totals: {
        cashNet: 24410,
        inflow: 25710,
        outflow: 2000,
        internalNet: 0,
        unallocatedNet: 700,
        unallocatedCount: 1,
      },
      ytd: { cashNet: 34410, inflow: 35710, outflow: 2000, internalNet: 0, unallocatedNet: 700 },
    });
    expect(report.rows).toHaveLength(7);
    expect(report.projects.find((p) => p.key === String(ids.internal))).toMatchObject({
      cashNet: 0,
      inflow: 0,
      outflow: 0,
      internalNet: 0,
    });
    expect(report.internalUnbalancedVouchers).toEqual([]);
    expect(report.rows.find((r) => r.voucherId === ids.historical)).toMatchObject({
      allocated: false,
      projectKey: 'unallocated',
      directionName: '未填流向',
    });
    expect(report.rows.at(-1)!.runningNet).toBe(24410);
    const all = await api().cashflow({ ...range, includeUnposted: true });
    expect(all.totals).toMatchObject({ cashNet: 25710, inflow: 27010 });
    expect(all.rows).toHaveLength(9); // 不含草稿及作废
  });
  it('项目仅筛汇总和明细；单个银行显示范围互转净额，整张凭证仍配平', async () => {
    const ids = await seedCashflowCases(app.svc);
    const selected = await api().cashflow({ ...range, project: String(ids.outflow) });
    expect(selected.rows).toHaveLength(1);
    expect(selected.projects).toHaveLength(1);
    expect(selected.totals.cashNet).toBe(24410);
    expect(selected.rows[0]!.runningNet).toBe(-2000);
    const bank = await api().cashflow({ ...range, codeFrom: '100201', codeTo: '100201' });
    expect(bank.totals).toMatchObject({ cashNet: 23100, internalNet: -600 });
    expect(bank.internalUnbalancedVouchers).toEqual([]);
    expect(bank.balanceDifference).toBe(0);
    const unallocated = await api().cashflow({ ...range, project: 'unallocated' });
    expect(unallocated.rows.map((r) => r.voucherId)).toEqual([ids.historical]);
    const parent = await api().cashflow({ ...range, codeFrom: '1002', codeTo: '1002' });
    expect(parent.rows.every((r) => r.accountCode.startsWith('1002'))).toBe(true);
  });
  it('跨年期间的本年累计从结束年度起，余额连续承接；缺期间不视为零', async () => {
    const ids = await seedCashflowCases(app.svc);
    await app.svc.periods.ensureYear(2027);
    await ids.incoming('2027-01-04', 200);
    const report = await api().cashflow({ periodFrom: 202612, periodTo: 202701 });
    expect(report).toMatchObject({
      ytdFrom: 202701,
      cashOpening: 46410,
      cashClosing: 46610,
      balanceDifference: 0,
      totals: { cashNet: 200 },
      ytd: { cashNet: 200 },
    });
    await app.svc.db.deleteFrom('period').where('period', '=', 202603).execute();
    await expect(api().cashflow({ periodFrom: 202602, periodTo: 202604 })).rejects.toThrow(/缺少/);
  });
  it('科目不存在、范围倒置、无现金银行科目、项目不存在与启用前期间阻止', async () => {
    await expect(api().cashflow({ ...range, codeFrom: '不存在' })).rejects.toThrow(/不存在/);
    await expect(api().cashflow({ ...range, codeFrom: '1002', codeTo: '1001' })).rejects.toThrow(
      /开始科目/,
    );
    await expect(api().cashflow({ ...range, codeFrom: '6001', codeTo: '6001' })).rejects.toThrow(
      /无符合条件/,
    );
    await expect(api().cashflow({ ...range, project: '999999' })).rejects.toThrow(/项目不存在/);
    await expect(api().cashflow({ periodFrom: 202602, periodTo: 202601 })).rejects.toThrow(
      /开始期间/,
    );
    await expect(api().cashflow({ periodFrom: 202512, periodTo: 202601 })).rejects.toThrow(
      /早于启用/,
    );
    await expect(api().cashflow({ periodFrom: 202613 })).rejects.toThrow();
  });
  it('查看、导出和格式保存权限独立；格式恢复与过期保存失败不覆盖', async () => {
    const viewer = app.call(
      balancesServer,
      await app.addUser('read', { permissions: ['balances.view'] }),
    );
    const exporter = app.call(
      balancesServer,
      await app.addUser('export', { permissions: ['balances.export'] }),
    );
    const none = app.call(balancesServer, await app.addUser('none'));
    await expect(viewer.cashflow(range)).resolves.toBeDefined();
    await expect(viewer.exportCashflow(range)).rejects.toThrow(/权限/);
    await expect(exporter.exportCashflow(range)).rejects.toThrow(/权限/);
    await expect(none.cashflow(range)).rejects.toThrow(/权限/);
    const input = {
      revision: 0,
      display: { sort: 'amount' as const, pageSize: 20 as const, showAccount: false },
    };
    await expect(viewer.saveCashflowSettings(input)).rejects.toThrow(/权限/);
    const saved = await api().saveCashflowSettings(input);
    expect(saved.revision).toBe(1);
    await expect(api().saveCashflowSettings(input)).rejects.toThrow(/没有覆盖/);
    expect((await api().cashflowMetadata()).settings).toEqual(saved);
    const standard = await api().saveCashflowSettings({
      revision: 1,
      display: { sort: 'date', pageSize: 50, showAccount: true },
    });
    expect(standard.revision).toBe(2);
  });
  it('查询、定位、排序及导出均只读，不改凭证、期初或设置', async () => {
    await seedCashflowCases(app.svc);
    const before = {
      vouchers: await app.svc.vouchers.list({}),
      opening: await app.svc.opening.list(2026),
      metadata: await api().cashflowMetadata(),
    };
    const report = await api().exportCashflow(range);
    expect(cashflowRows(report, 'amount')[0]!.debit).toBe(30000);
    expect(cashflowRows(report, 'date', '历史流向为空')).toHaveLength(1);
    expect(
      cashflowRows(report, 'account')
        .map((r) => r.runningNet)
        .sort((a, b) => a - b),
    ).toEqual(report.rows.map((r) => r.runningNet).sort((a, b) => a - b));
    expect({
      vouchers: await app.svc.vouchers.list({}),
      opening: await app.svc.opening.list(2026),
      metadata: await api().cashflowMetadata(),
    }).toEqual(before);
  });
  it('大数据刷新确认及共享明细上限错误均不返回截断汇总', async () => {
    const svc = app.svcFor('balances');
    const realTx = svc.tx.bind(svc);
    const tx = vi.spyOn(svc, 'tx').mockImplementation((fn) =>
      realTx(async (t) => {
        const flow = t.ledger.cashflow.bind(t.ledger);
        vi.spyOn(t.ledger, 'cashflow').mockImplementation(async (filter) => {
          const result = await flow(filter);
          return { ...result, rows: Array.from({ length: 5001 }, () => result.rows[0]!) };
        });
        return fn(t);
      }),
    );
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 1 },
          { account: '4001', credit: 1 },
        ],
      },
    ]);
    await expect(cashflowService(svc).query(range)).rejects.toThrow(/超过 5000/);
    tx.mockRestore();
    // 上限由 core 执行；本模块不能捕获后以空表冒充成功。
    vi.spyOn(svc, 'tx').mockImplementation((fn) =>
      realTx(async (t) => {
        vi.spyOn(t.ledger, 'cashflow').mockRejectedValue(
          new Error('现金流量查询超过 200000 条分录，不能截断汇总'),
        );
        return fn(t);
      }),
    );
    await expect(cashflowService(svc).query({ ...range, allowLarge: true })).rejects.toThrow(
      /不能截断/,
    );
  });
  it('任意整数金额及红字：已分配收付、互转、未分配与现金银行净变动逐分相等', async () => {
    const ids = await seedCashflowCases(app.svc);
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -1000000, max: 1000000 }).filter((n) => n !== 0),
        async (amount) => {
          await seedFlow(
            app.svc,
            {
              date: '2026-02-12',
              status: 'posted',
              lines: [
                {
                  account: '100201',
                  debit: Math.max(amount, 0),
                  credit: Math.max(-amount, 0),
                  dims: { cashflow: amount > 0 ? 'CF01' : 'CF02' },
                },
                { account: '6001', credit: Math.max(amount, 0), debit: Math.max(-amount, 0) },
              ],
            },
            [amount > 0 ? 'inflow' : 'outflow', null],
          );
          const r = await api().cashflow(range);
          const t = r.totals;
          expect(
            BigInt(t.inflow) - BigInt(t.outflow) + BigInt(t.internalNet) + BigInt(t.unallocatedNet),
          ).toBe(BigInt(t.cashNet));
          expect(BigInt(r.cashClosing) - BigInt(r.cashOpening)).toBe(BigInt(t.cashNet));
          expect(r.projects.find((p) => p.key === String(ids.internal))!.cashNet).toBe(0);
        },
      ),
      { numRuns: 15 },
    );
  });
});

it('w_zc_xjll 年中启用明确累计起点，不把启用前现金流量当作零', async () => {
  await app.close();
  app = await createTestApp({ modules: [balancesServer], startMonth: 7 });
  await seedVouchers(app.svc, [
    {
      date: '2026-07-03',
      status: 'posted',
      lines: [
        { account: '1001', debit: 123 },
        { account: '4001', credit: 123 },
      ],
    },
  ]);
  const report = await api().cashflow({ periodFrom: 202607, periodTo: 202607 });
  expect(report).toMatchObject({ ytdComplete: false, ytdFrom: 202607, ytd: { cashNet: 123 } });
});

it('w_zc_xjll_1 格式存盘发生写入失败后事务回滚，原格式和原版本保留', async () => {
  const svc = app.svcFor('balances');
  const original = await cashflowService(svc).metadata();
  const realTx = svc.tx.bind(svc);
  const tx = vi.spyOn(svc, 'tx').mockImplementation((fn) =>
    realTx(async (t) => {
      const set = t.settings.set.bind(t.settings);
      vi.spyOn(t.settings, 'set').mockImplementation(async (...args) => {
        await set(...args);
        throw new Error('合成磁盘写入失败');
      });
      return fn(t);
    }),
  );
  await expect(
    cashflowService(svc).saveSettings({
      revision: 0,
      display: { sort: 'amount', pageSize: 20, showAccount: false },
    }),
  ).rejects.toThrow('合成磁盘写入失败');
  tx.mockRestore();
  expect((await cashflowService(svc).metadata()).settings).toEqual(original.settings);
});
