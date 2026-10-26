import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import type { ContractInput } from '../contracts';
import type { AnalysisTables } from '../server/migrations';
import analysis from '../server';
import { contractService } from '../server/contracts';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(analysis, token).contracts;
let api: ReturnType<typeof caller>;
let input: ContractInput;
const filter = {
  signedFrom: '2020-01-01',
  signedTo: '2026-12-31',
  from: '2026-04-01',
  to: '2026-04-30',
};
beforeEach(async () => {
  app = await createTestApp({ modules: [analysis] });
  api = caller(app);
  const account = await app.svc.accounts.create(
    {
      code: '100203',
      name: '合同银行',
      isBank: true,
      dimensions: [{ type: 'partner', required: true }],
    },
    [4, 2, 2],
  );
  input = {
    expectedRevision: 0,
    code: 'HT001',
    name: '合成测试合同',
    partnerId: (await app.svc.dimensions.getByCode('partner', 'C001'))!.id,
    accountId: account.id,
    signedDate: '2026-01-01',
    kind: 'receipt',
    amount: 100_00,
    opening: 10_00,
    description: '原始到期日未提供',
    remark: '',
  };
});
afterEach(async () => app.close());
async function approved(values: Partial<ContractInput> = {}) {
  const row = await api.save({ ...input, ...values });
  return api.review({ id: row.id, expectedRevision: row.revision, reviewed: true });
}
async function settlement(
  amount = 20_00,
  date = '2026-04-01',
  status: 'pending' | 'posted' = 'posted',
  partner = 'C001',
  account = '100203',
) {
  return (
    await seedVouchers(app.svc, [
      {
        date,
        status,
        lines:
          amount > 0
            ? [
                { account, debit: amount, dims: { partner } },
                { account: '6001', credit: amount },
              ]
            : [
                { account, credit: -amount, dims: { partner } },
                { account: '6001', debit: -amount },
              ],
      },
    ])
  )[0]!;
}
const version = (row: { id: number; revision: number }) => ({
  id: row.id,
  expectedRevision: row.revision,
});
const link = (
  row: { id: number; revision: number },
  voucher: Awaited<ReturnType<typeof settlement>>,
) => api.link({ ...version(row), voucherId: voucher.id, lineId: voucher.lines[0]!.id });

describe('w_ht_htda / w_ht_htda_nr 真实合同档案与原阻止规则', () => {
  it('保存并重新读取说明、客供、收付款类型、整数金额、录入人和版本', async () => {
    const row = await api.save(input);
    expect(await api.get({ id: row.id })).toMatchObject({
      code: 'HT001',
      name: input.name,
      description: input.description,
      amount: 10000,
      opening: 1000,
      kind: 'receipt',
      partner_id: input.partnerId,
      created_by: 1,
      reviewed_by: null,
      revision: 1,
      lines: [],
    });
    expect(await api.list()).toHaveLength(1);
  });
  it('合同号唯一、名称非空，错误保存不覆盖原合同', async () => {
    const row = await api.save(input);
    await expect(api.save(input)).rejects.toThrow('合同号已存在');
    await expect(api.save({ ...input, name: '  ' })).rejects.toThrow('请输入合同名称');
    expect(await api.get({ id: row.id })).toEqual(row);
  });
  it('拒绝非现金银行、未启用客供核算科目和错误维度类型', async () => {
    await expect(
      api.save({ ...input, accountId: (await app.svc.accounts.require('1122')).id }),
    ).rejects.toThrow('末级现金或银行');
    await expect(
      api.save({ ...input, accountId: (await app.svc.accounts.require('100201')).id }),
    ).rejects.toThrow('末级现金或银行');
    await expect(
      api.save({ ...input, partnerId: (await app.svc.dimensions.items('department'))[0]!.id }),
    ).rejects.toThrow('末级客供');
  });
  it.each([0.1, -1, Number.MAX_SAFE_INTEGER + 1])(
    '金额 %s 被拒绝，不能存为小数分/负数/不精确整数',
    async (amount) => {
      await expect(api.save({ ...input, amount })).rejects.toThrow();
      expect(await api.list()).toEqual([]);
    },
  );
  it('并发旧版本保存失败；先成功的资料完整保留', async () => {
    const row = await api.save(input);
    const results = await Promise.allSettled(
      ['甲', '乙'].map((name) => api.save({ ...input, ...version(row), name })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await api.get({ id: row.id })).revision).toBe(2);
  });
  it('只有审核本人可取消审核，管理员也不能代替；已审核合同不能改删', async () => {
    const token = await app.addUser('reviewer', {
      permissions: ['analysis.contract.review', 'analysis.contract.view'],
    });
    const row = await api.save(input);
    const reviewed = await caller(app, token).review({ ...version(row), reviewed: true });
    await expect(api.review({ ...version(reviewed), reviewed: false })).rejects.toThrow(
      '本人取消审核',
    );
    await expect(api.save({ ...input, ...version(reviewed) })).rejects.toThrow('不能修改');
    await expect(api.remove({ ...version(reviewed), confirmed: true })).rejects.toThrow('不能删除');
    const released = await caller(app, token).review({ ...version(reviewed), reviewed: false });
    expect(released.reviewed_by).toBeNull();
  });
  it('删除必须明确确认；取消不删，确认后才删', async () => {
    const row = await api.save(input);
    await expect(api.remove({ ...version(row), confirmed: false })).rejects.toThrow('明确确认');
    expect(await api.list()).toHaveLength(1);
    await api.remove({ ...version(row), confirmed: true });
    expect(await api.list()).toHaveLength(0);
  });
  it('存盘日志失败时事务回滚，合同和日志都不留下半成品', async () => {
    app.runtime.bookStore
      .open(app.book.id)
      .raw.exec(
        "CREATE TEMP TRIGGER analysis_test_fail_log BEFORE INSERT ON operation_log WHEN NEW.action = 'analysis.contract.save' BEGIN SELECT RAISE(ABORT, '合成日志失败'); END;",
      );
    await expect(api.save(input)).rejects.toThrow('合成日志失败');
    expect(await api.list()).toEqual([]);
    expect(
      await app.svc.db
        .selectFrom('operation_log')
        .select('id')
        .where('action', '=', 'analysis.contract.save')
        .execute(),
    ).toEqual([]);
  });
  it('w_ht_htda 删除存入失败时原合同仍在，未写删除日志', async () => {
    const row = await api.save(input);
    app.runtime.bookStore
      .open(app.book.id)
      .raw.exec(
        "CREATE TEMP TRIGGER analysis_test_fail_delete BEFORE INSERT ON operation_log WHEN NEW.action = 'analysis.contract.delete' BEGIN SELECT RAISE(ABORT, '合成删除失败'); END;",
      );
    await expect(api.remove({ ...version(row), confirmed: true })).rejects.toThrow('合成删除失败');
    expect(await api.get({ id: row.id })).toEqual(row);
    expect(
      await app.svc.db
        .selectFrom('operation_log')
        .select('id')
        .where('action', '=', 'analysis.contract.delete')
        .execute(),
    ).toEqual([]);
  });
});

describe('w_ht_httj / w_ht_pz 明确关联、账款口径与来源保护', () => {
  it('本期/累计/未完成与真实分录一致，签订日期和收付日期分别筛选，不按摘要猜关联', async () => {
    let row = await approved();
    row = await link(row, await settlement(20_00, '2026-02-01'));
    row = await link(row, await settlement(30_00));
    row = await link(row, await settlement(40_00, '2026-05-01'));
    await settlement(999_00); // 未明确关联，永不计入。
    const report = await api.report(filter);
    expect(report.rows[0]).toMatchObject({
      current: 3000,
      cumulative: 6000,
      remaining: 4000,
      dueDate: null,
      overdueDays: null,
    });
    expect(report.totals).toEqual({
      amount: 10000,
      opening: 1000,
      current: 3000,
      cumulative: 6000,
      remaining: 4000,
    });
    expect((await api.report({ ...filter, signedFrom: '2026-02-01' })).rows).toEqual([]);
    expect((await api.report({ ...filter, kind: 'payment' })).rows).toEqual([]);
    expect(
      (
        await api.report({
          ...filter,
          partnerId: (await app.svc.dimensions.getByCode('partner', 'S001'))!.id,
        })
      ).rows,
    ).toEqual([]);
    expect(await api.get({ id: row.id })).toMatchObject({
      lines: expect.arrayContaining([
        expect.objectContaining({ displayNo: expect.stringContaining('记-'), amount: 3000 }),
      ]),
    });
  });
  it('付款合同按银行贷方计算，超付保留负未完成金额', async () => {
    let row = await approved({ kind: 'payment', amount: 1000, opening: 0 });
    row = await link(row, await settlement(-2000));
    expect((await api.report(filter)).rows[0]).toMatchObject({
      cumulative: 2000,
      remaining: -1000,
      kind: 'payment',
    });
    await expect(link(row, await settlement(100))).rejects.toThrow('方向');
  });
  it('未审核不能关联；未过账、错误客供/科目/方向均拒绝且版本与日志不变', async () => {
    const initial = await api.save(input);
    await expect(link(initial, await settlement())).rejects.toThrow('先审核');
    const row = await api.review({ ...version(initial), reviewed: true });
    for (const [v, message] of [
      [await settlement(2000, '2026-04-01', 'pending'), '已过账'],
      [await settlement(2000, '2026-04-01', 'posted', 'S001'), '客供'],
      [await settlement(-2000), '方向'],
    ] as const)
      await expect(link(row, v)).rejects.toThrow(message);
    const v = await settlement();
    await expect(
      api.link({ ...version(row), voucherId: v.id, lineId: v.lines[1]!.id }),
    ).rejects.toThrow('科目');
    expect(await api.get({ id: row.id })).toEqual(row);
    expect(
      await app.svc.db
        .selectFrom('operation_log')
        .select('id')
        .where('action', '=', 'analysis.contract.link')
        .execute(),
    ).toEqual([]);
  });
  it('来源凭证既不能关联合同，也不能从 analysis 身份改删；来源锁保留', async () => {
    const row = await approved();
    const spec = await voucherInputFromSpec(app.svc, {
      date: '2026-04-01',
      lines: [
        { account: '100203', debit: 100, dims: { partner: 'C001' } },
        { account: '6001', credit: 100 },
      ],
    });
    const source = app.svcFor('example');
    const voucher = await source.vouchers.create({
      ...spec,
      source: { type: 'memo', id: 'synthetic-contract' },
    });
    await source.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await source.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    const posted = (await source.vouchers.get(voucher.id))!;
    await expect(link(row, posted)).rejects.toThrow('来源单据');
    await expect(app.svcFor('analysis').vouchers.delete(voucher.id)).rejects.toThrow('不能在这里');
    await expect(
      app
        .svcFor('analysis')
        .vouchers.update(voucher.id, spec, { expectedRevision: posted.revision }),
    ).rejects.toThrow('不能在这里');
  });
  it('一条分录只能属于一个合同，重复和并发关联不会重复计款', async () => {
    const a = await approved();
    const b = await approved({ code: 'HT002' });
    const voucher = await settlement();
    const results = await Promise.allSettled([link(a, voucher), link(b, voucher)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await api.report(filter)).totals.current).toBe(2000);
  });
  it('已用禁删；必须先确认取消关联，再本人取消审核后才能删除', async () => {
    const row = await link(await approved(), await settlement());
    await expect(api.remove({ ...version(row), confirmed: true })).rejects.toThrow('已经使用');
    await expect(api.review({ ...version(row), reviewed: false })).rejects.toThrow('已使用');
    await expect(
      api.unlink({ ...version(row), lineId: row.lines[0]!.line_id, confirmed: false }),
    ).rejects.toThrow('明确确认');
    const unlinked = await api.unlink({
      ...version(row),
      lineId: row.lines[0]!.line_id,
      confirmed: true,
    });
    const unreviewed = await api.review({ ...version(unlinked), reviewed: false });
    await api.remove({ ...version(unreviewed), confirmed: true });
    expect(await api.list()).toEqual([]);
  });
  it('核心反过账后拒绝账款报告；外键阻止修改/删除已关联原分录并完整回滚', async () => {
    const voucher = await settlement();
    const row = await link(await approved(), voucher);
    await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await expect(api.report(filter)).rejects.toThrow('已反过账或作废');
    await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'pending' });
    const before = await app.svc.vouchers.get(voucher.id);
    const update = await voucherInputFromSpec(app.svc, {
      date: '2026-04-02',
      lines: [
        { account: '100203', debit: 999, dims: { partner: 'C001' } },
        { account: '6001', credit: 999 },
      ],
    });
    await expect(
      app.svc.vouchers.update(voucher.id, update, { expectedRevision: before!.revision }),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(await app.svc.vouchers.get(voucher.id)).toEqual(before);
    await expect(app.svc.vouchers.delete(voucher.id)).rejects.toThrow(/FOREIGN KEY/);
    expect(await app.svc.vouchers.get(voucher.id)).toEqual(before);
    await api.unlink({ ...version(row), lineId: voucher.lines[0]!.id, confirmed: true });
    await app.svc.vouchers.delete(voucher.id);
    expect(await app.svc.vouchers.get(voucher.id)).toBeNull();
  });
  it('关联日志失败时插入和合同版本一并回滚', async () => {
    const row = await approved();
    const voucher = await settlement();
    app.runtime.bookStore
      .open(app.book.id)
      .raw.exec(
        "CREATE TEMP TRIGGER analysis_test_fail_link BEFORE INSERT ON operation_log WHEN NEW.action = 'analysis.contract.link' BEGIN SELECT RAISE(ABORT, '合成关联失败'); END;",
      );
    await expect(link(row, voucher)).rejects.toThrow('合成关联失败');
    expect(await api.get({ id: row.id })).toEqual(row);
  });
  it('错误日期范围和启用前收付查询拒绝；期初不冒充历史期间金额', async () => {
    await approved();
    await expect(api.report({ ...filter, from: '2026-05-01' })).rejects.toThrow('开始日期');
    await expect(api.report({ ...filter, from: '2025-01-01' })).rejects.toThrow('启用日期');
  });
  it('安全整数边界可精确导出并回读；溢出累计拒绝输出', async () => {
    await approved({ amount: Number.MAX_SAFE_INTEGER, opening: 0, name: '=1+1' });
    const exported = await api.export(filter);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
    const ws = wb.getWorksheet('合同账款')!;
    expect(ws.getCell('F4').value).toBe('90071992547409.91');
    expect(ws.getCell('F4').numFmt).toBe('@');
    expect(ws.getCell('B4').value).toBe('=1+1');
    expect(ws.getCell('K4').value).toBe('未知');
    await approved({ code: 'HT002', amount: 1, opening: 0 });
    await expect(api.report(filter)).rejects.toThrow('安全整数范围');
  });
  it('在线备份包含真实合同、关联和外键；查询与导出不改原账套，备份副本独立', async () => {
    const row = await link(await approved(), await settlement());
    const before = await app.svc.db.selectFrom('operation_log').selectAll().execute();
    await api.report(filter);
    await api.export(filter);
    expect(await app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(before);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'analysis-backup-'));
    try {
      const file = path.join(dir, 'snapshot.sqlite');
      await app.runtime.bookStore.open(app.book.id).raw.backup(file);
      const snapshot = new Database(file, { readonly: true, fileMustExist: true });
      try {
        expect(snapshot.prepare('SELECT code, revision FROM analysis_contract').get()).toEqual({
          code: row.code,
          revision: row.revision,
        });
        expect(snapshot.prepare('SELECT contract_id FROM analysis_contract_line').get()).toEqual({
          contract_id: row.id,
        });
        expect(snapshot.pragma('foreign_key_check')).toEqual([]);
      } finally {
        snapshot.close();
      }
      expect(await api.get({ id: row.id })).toEqual(row);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('随机真实收付款及关联逆操作保持金额守恒', async () => {
    let sequence = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000000 }),
        fc.boolean(),
        async (amount, payment) => {
          const row = await approved({
            code: `HT-PROP-${sequence++}`,
            kind: payment ? 'payment' : 'receipt',
            opening: 0,
            amount: 1000000,
          });
          const v = await settlement(payment ? -amount : amount);
          const linked = await link(row, v);
          const report = await api.report({ ...filter, kind: payment ? 'payment' : 'receipt' });
          const result = report.rows.find((r) => r.id === row.id)!;
          expect(result.cumulative + result.remaining).toBe(row.amount);
          expect(result.current).toBe(amount);
          await api.unlink({ ...version(linked), lineId: v.lines[0]!.id, confirmed: true });
          const restored = (await api.report(filter)).rows.find((r) => r.id === row.id)!;
          expect(restored.current).toBe(0);
          expect(restored.remaining).toBe(row.amount);
        },
      ),
      { numRuns: 10 },
    );
  });
});

describe('合同服务端权限与账套隔离', () => {
  it('w_ht_pz 来源屏障在敏感 core.get 之前拒绝，不把拒绝变成逐行 reason', async () => {
    const contract = await approved();
    const owner = app.svcFor('payroll');
    const voucher = await owner.vouchers.create({
      ...(await voucherInputFromSpec(app.svc, {
        date: '2026-04-01',
        lines: [
          { account: '100203', debit: 7654321, summary: '私密工资摘要', dims: { partner: 'C001' } },
          { account: '6001', credit: 7654321 },
        ],
      })),
      source: { type: 'batch', id: 'private-payroll' },
    });
    const scoped = app.svcFor('analysis');
    const sensitiveGet = vi.spyOn(scoped.vouchers, 'get');
    try {
      await expect(
        contractService(scoped).candidatesInTransaction(contract.id, voucher.id),
      ).rejects.toMatchObject({ data: { code: 'ANALYSIS_CONTRACT_VOUCHER_READ_DENIED' } });
      await expect(
        contractService(scoped).linkInTransaction({
          ...version(contract),
          voucherId: voucher.id,
          lineId: voucher.lines[0]!.id,
        }),
      ).rejects.toMatchObject({ data: { code: 'ANALYSIS_CONTRACT_VOUCHER_READ_DENIED' } });
      expect(sensitiveGet).not.toHaveBeenCalled();
    } finally {
      sensitiveGet.mockRestore();
    }
  });
  it('无权用户不能读写，只有查看权不能审核/关联/导出', async () => {
    const row = await api.save(input);
    const nobody = caller(app, await app.addUser('nobody'));
    await expect(nobody.list()).rejects.toThrow('权限');
    await expect(nobody.save(input)).rejects.toThrow('权限');
    const viewer = caller(
      app,
      await app.addUser('viewer', { permissions: ['analysis.contract.view'] }),
    );
    expect(await viewer.list()).toHaveLength(1);
    await expect(viewer.review({ ...version(row), reviewed: true })).rejects.toThrow('权限');
    await expect(viewer.link({ ...version(row), voucherId: 1, lineId: 1 })).rejects.toThrow('权限');
    await expect(viewer.export(filter)).rejects.toThrow('权限');
    const exporter = app.call(
      analysis,
      await app.addUser('exporter', { permissions: ['analysis.export'] }),
    );
    await expect(exporter.contracts.export(filter)).rejects.toThrow('权限');
    await expect(exporter.printAllowed('contracts')).rejects.toThrow('权限');
  });
  it('另一账套相同合同ID和分录ID不跨库查询或关联', async () => {
    const original = await api.save(input);
    const originalVoucher = await settlement(1234);
    const other = await createTestApp({ modules: [analysis] });
    try {
      expect(await caller(other).list()).toEqual([]);
      await expect(caller(other).get({ id: 1 })).rejects.toThrow('不存在');
      const account = await other.svc.accounts.create(
        {
          code: '100203',
          name: '另一账套银行',
          isBank: true,
          dimensions: [{ type: 'partner', required: true }],
        },
        [4, 2, 2],
      );
      const otherApi = caller(other);
      const saved = await otherApi.save({
        ...input,
        accountId: account.id,
        partnerId: (await other.svc.dimensions.getByCode('partner', 'C001'))!.id,
        opening: 0,
      });
      const reviewed = await otherApi.review({ ...version(saved), reviewed: true });
      expect(reviewed.id).toBe(original.id);
      await expect(
        otherApi.link({
          ...version(reviewed),
          voucherId: originalVoucher.id,
          lineId: originalVoucher.lines[0]!.id,
        }),
      ).rejects.toThrow('凭证或分录不存在');
      const [otherVoucher] = await seedVouchers(other.svc, [
        {
          date: '2026-04-01',
          status: 'posted',
          lines: [
            { account: '100203', debit: 5678, dims: { partner: 'C001' } },
            { account: '6001', credit: 5678 },
          ],
        },
      ]);
      expect(otherVoucher!.id).toBe(originalVoucher.id);
      expect(otherVoucher!.lines[0]!.id).toBe(originalVoucher.lines[0]!.id);
      await otherApi.link({
        ...version(reviewed),
        voucherId: originalVoucher.id,
        lineId: originalVoucher.lines[0]!.id,
      });
      expect((await otherApi.report(filter)).totals.current).toBe(5678);
      expect((await api.get({ id: original.id })).lines).toEqual([]);
      expect((await api.report(filter)).totals.current).toBe(0);
    } finally {
      await other.close();
    }
    expect(
      await app.svc.db
        .withTables<AnalysisTables>()
        .selectFrom('analysis_contract')
        .select('id')
        .execute(),
    ).toHaveLength(1);
  });
});
