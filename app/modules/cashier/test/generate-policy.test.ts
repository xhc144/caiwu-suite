import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import cashierServer from '../server';

let app: TestApp;
let accountId: number;
let oppositeId: number;
let cashflow: number;
let voucherTypeId: number;
beforeEach(async () => {
  app = await createTestApp({ modules: [cashierServer] });
  const api = app.call(cashierServer);
  await api.enable({ period: 202601 });
  accountId = (
    await api.saveAccount({
      data: {
        name: '手工编号银行',
        coreAccountId: (await app.svc.accounts.require('100201')).id,
        currency: 'CNY',
        opening: 0,
      },
    })
  ).id;
  oppositeId = (await app.svc.accounts.require('6603')).id;
  cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  voucherTypeId = (await app.svc.reference.voucherTypes())[0]!.id;
  for (const amount of [100, 200])
    await api.createDocument({
      accountId,
      period: 202601,
      date: '2026-01-10',
      direction: 'receipt',
      amount,
      oppositeAccountId: oppositeId,
      summary: '手工编号收款',
      dimensions: { cashflow },
      requestKey: randomUUID(),
    });
});
afterEach(() => app.close());
const input = async (firstNumber?: number) => ({
  documents: (await app.call(cashierServer).documents({}))
    .filter((d) => d.voucherId == null)
    .map((d) => ({ id: d.id, revision: d.revision })),
  mode: 'individual' as const,
  date: '2026-01-10',
  voucherTypeId,
  firstNumber,
});

describe('w_cn_pz 按账套凭证编号策略生成', () => {
  it('手工编号须明确起号，逐张预览及保存连续编号，同请求不重复生成', async () => {
    await app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const api = app.call(cashierServer);
    await expect(api.preview(await input())).rejects.toThrow('手工编号');
    const data = await input(7);
    const preview = await api.preview(data);
    expect(preview.groups.map((g) => g.number)).toEqual([7, 8]);
    const request = { ...data, requestKey: randomUUID() };
    const saved = await api.generate(request);
    expect(await api.generate(request)).toEqual(saved);
    const vouchers = await app.svc.vouchers.list({});
    expect(vouchers.items.map((v) => v.number).sort()).toEqual([7, 8]);
    expect(vouchers.items.every((v) => v.source?.module === 'cashier')).toBe(true);
  });
  it('自动编号不能借出纳指定号码，切换策略后的旧预览也不能提交', async () => {
    const api = app.call(cashierServer);
    await expect(api.preview(await input(10))).rejects.toThrow('自动编号');
    const data = await input();
    await api.preview(data);
    await app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    await expect(api.generate({ ...data, requestKey: randomUUID() })).rejects.toThrow('手工编号');
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    expect((await api.documents({})).every((d) => d.voucherId == null)).toBe(true);
  });
  it('预览识别占号，生成前再次复核并整体回滚', async () => {
    await app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const api = app.call(cashierServer);
    const data = await input(3);
    await api.preview(data);
    await app.svc.vouchers.create({
      date: data.date,
      voucherTypeId,
      number: 4,
      lines: [
        {
          accountId: (await app.svc.accounts.require('1001')).id,
          summary: '合成占号',
          debit: 1,
          dimensions: { cashflow },
        },
        { accountId: oppositeId, summary: '合成占号', credit: 1 },
      ],
    });
    await expect(api.preview(data)).rejects.toThrow('凭证号已使用');
    await expect(api.generate({ ...data, requestKey: randomUUID() })).rejects.toThrow(
      '凭证号已使用',
    );
    expect((await app.svc.vouchers.list({})).total).toBe(1);
    expect((await api.documents({})).every((d) => d.voucherId == null)).toBe(true);
  });
  it('内部现金银行划转生成两侧内部现金流方向', async () => {
    const api = app.call(cashierServer);
    const doc = (await api.documents({}))[0]!;
    await api.updateDocument({
      id: doc.id,
      revision: doc.revision,
      data: { ...doc, oppositeAccountId: (await app.svc.accounts.require('1001')).id },
    });
    const row = (await api.documents({ id: doc.id }))[0]!;
    const request = {
      documents: [{ id: row.id, revision: row.revision }],
      mode: 'individual' as const,
      date: row.date,
      voucherTypeId,
      requestKey: randomUUID(),
    };
    const preview = await api.preview(request);
    expect(preview.groups[0]!.lines.map((l) => l.cashflowDirection)).toEqual([
      'internal',
      'internal',
    ]);
    await api.generate(request);
    const voucher = (await app.svc.vouchers.get(
      (await api.documents({ id: row.id }))[0]!.voucherId!,
    ))!;
    expect(voucher.lines.map((l) => l.cashflowDirection)).toEqual(['internal', 'internal']);
  });
});
