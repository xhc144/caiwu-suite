import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import cashierServer from '../server';

let app: TestApp;
const api = () => app.call(cashierServer);
beforeEach(async () => {
  app = await createTestApp({ modules: [cashierServer] });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

async function prepared(mode: 'individual' | 'summary' = 'individual') {
  const a = api();
  await app.svc.voucherPolicy.set({
    numbering: 'automatic',
    renumberAfterDelete: true,
    allowModifyOthers: true,
  });
  await a.enable({ period: 202601 });
  const bank = (await app.svc.accounts.require('100201')).id;
  const opposite = (await app.svc.accounts.require('6603')).id;
  const cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  const account = await a.saveAccount({
    data: { name: '编号策略测试银行', coreAccountId: bank, currency: 'CNY', opening: 0 },
  });
  const manual = async (summary: string) =>
    (
      await seedVouchers(app.svc, [
        {
          date: '2026-01-10',
          summary,
          lines: [
            { account: '100201', debit: 999, dims: { cashflow: 'CF01' } },
            { account: '6603', credit: 999 },
          ],
        },
      ])
    )[0]!;
  const earlier = await manual('批次前手工凭证');
  for (const amount of [100, 200])
    await a.createDocument({
      accountId: account.id,
      period: 202601,
      date: '2026-01-10',
      summary: `待撤销原单${amount}`,
      direction: 'receipt',
      amount,
      oppositeAccountId: opposite,
      dimensions: { cashflow },
      requestKey: randomUUID(),
    });
  const generated = await a.generate({
    documents: (await a.documents({})).map((d) => ({ id: d.id, revision: d.revision })),
    date: '2026-01-10',
    mode,
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    requestKey: randomUUID(),
  });
  const docs = await a.documents({});
  const voucherIds = [...new Set(docs.map((d) => d.voucherId!))];
  const later = await manual('批次后手工凭证');
  return { earlier, later, voucherIds, batchId: generated.batchId, docs, accountId: account.id };
}

describe('w_cn_pz 删除后重排策略下的出纳整批撤销', () => {
  it.each(['individual', 'summary'] as const)(
    '%s 展示全部来源及完整编号影响，强确认后整批删除、真实重排且原单保留',
    async (mode) => {
      const f = await prepared(mode);
      const a = api();
      await expect(a.revoke({ batchId: f.batchId, confirmed: true })).rejects.toThrow();
      expect(await a.documents({})).toEqual(f.docs);
      const preview = await a.previewRevoke({ batchId: f.batchId });
      expect(preview.voucherIds.toSorted((x, y) => x - y)).toEqual(f.voucherIds);
      expect(preview.plan.renumber).toBe(true);
      expect(preview.plan.ids).toEqual(f.voucherIds);
      expect(preview.plan.impacts).toContainEqual({
        id: f.earlier.id,
        oldNumber: 1,
        number: 1,
      });
      expect(preview.plan.impacts).toContainEqual({
        id: f.later.id,
        oldNumber: mode === 'individual' ? 4 : 3,
        number: 2,
      });
      await expect(
        a.revoke({ batchId: f.batchId, confirmed: false as true, plan: preview.plan }),
      ).rejects.toThrow();
      await a.revoke({ batchId: f.batchId, confirmed: true, plan: preview.plan });
      for (const id of f.voucherIds) expect(await app.svc.vouchers.get(id)).toBeNull();
      expect(await app.svc.vouchers.get(f.earlier.id)).toMatchObject({ number: 1 });
      expect(await app.svc.vouchers.get(f.later.id)).toMatchObject({ number: 2 });
      const remaining = await a.documents({});
      expect(remaining.map((d) => [d.id, d.amount, d.voucherId])).toEqual(
        f.docs.map((d) => [d.id, d.amount, null]),
      );
      expect(remaining.every((d) => d.revision > f.docs.find((r) => r.id === d.id)!.revision)).toBe(
        true,
      );
    },
  );

  it('来源凭证已审核、或受重排影响的其他凭证已审核时拒绝预览，全部数据保留', async () => {
    const f = await prepared();
    const a = api();
    await app.svc.vouchers.changeStatus({ ids: [f.voucherIds[0]!], to: 'audited' });
    await expect(a.previewRevoke({ batchId: f.batchId })).rejects.toThrow('已审核');
    await app.svc.vouchers.changeStatus({ ids: [f.voucherIds[0]!], to: 'pending' });
    await app.svc.vouchers.changeStatus({ ids: [f.later.id], to: 'audited' });
    await expect(a.previewRevoke({ batchId: f.batchId })).rejects.toThrow('已审核');
    expect((await a.documents({})).every((d) => d.voucherId != null)).toBe(true);
    for (const id of f.voucherIds) expect(await app.svc.vouchers.get(id)).not.toBeNull();
    expect(await app.svc.vouchers.get(f.later.id)).toMatchObject({ number: 4, status: 'audited' });
  });

  it('已勾账原单阻止整批撤销，不删除任何来源凭证', async () => {
    const f = await prepared();
    await app.svc.vouchers.changeStatus({ ids: f.voucherIds, to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: f.voucherIds, to: 'posted' });
    const a = api();
    const rec = await a.reconcile({ accountId: f.accountId, cutoff: '2026-01-31' });
    const first = rec.documents[0]!;
    await a.match({
      accountId: f.accountId,
      cutoff: rec.cutoff,
      documents: [{ id: first.id, revision: first.revision }],
      lineIds: [rec.entries.find((e) => e.voucherId === f.voucherIds[0])!.lineId],
      snapshot: rec.snapshot,
      confirmed: true,
    });
    await expect(a.previewRevoke({ batchId: f.batchId })).rejects.toThrow('勾账');
    for (const id of f.voucherIds) expect(await app.svc.vouchers.get(id)).not.toBeNull();
    expect((await a.documents({})).every((d) => d.batchId === f.batchId)).toBe(true);
  });

  it('过期计划、预览后新增凭证或伪造删除集合均拒绝，不改变批次和号码', async () => {
    const f = await prepared();
    const a = api();
    const preview = await a.previewRevoke({ batchId: f.batchId });
    const clock = vi
      .spyOn(app.runtime, 'now')
      .mockReturnValue(new Date(preview.plan.expiresAt + 1));
    await expect(
      a.revoke({ batchId: f.batchId, confirmed: true, plan: preview.plan }),
    ).rejects.toThrow('过期');
    clock.mockRestore();
    await expect(
      a.revoke({
        batchId: f.batchId,
        confirmed: true,
        plan: { ...preview.plan, ids: [f.earlier.id] },
      }),
    ).rejects.toThrow();
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '100201', debit: 1, dims: { cashflow: 'CF01' } },
          { account: '6603', credit: 1 },
        ],
      },
    ]);
    await expect(
      a.revoke({ batchId: f.batchId, confirmed: true, plan: preview.plan }),
    ).rejects.toThrow('变化');
    expect(await app.svc.vouchers.get(f.later.id)).toMatchObject({ number: 4 });
    expect(await a.documents({})).toEqual(f.docs);
  });

  it('删除、重排后批次写入失败时整笔回滚，保留来源关联和全部原编号，原计划可重试', async () => {
    const f = await prepared();
    const a = api();
    const preview = await a.previewRevoke({ batchId: f.batchId });
    const ids = [f.earlier.id, ...f.voucherIds, f.later.id];
    const vouchers = await Promise.all(ids.map((id) => app.svc.vouchers.get(id)));
    await sql`CREATE TRIGGER cashier_revoke_policy_failure BEFORE UPDATE ON cashier_batch WHEN NEW.active = 0 BEGIN SELECT RAISE(ABORT, '合成撤销批次写入失败'); END`.execute(
      app.svc.db,
    );
    await expect(
      a.revoke({ batchId: f.batchId, confirmed: true, plan: preview.plan }),
    ).rejects.toThrow('合成撤销批次写入失败');
    expect(await Promise.all(ids.map((id) => app.svc.vouchers.get(id)))).toEqual(vouchers);
    expect(await a.documents({})).toEqual(f.docs);
    await sql`DROP TRIGGER cashier_revoke_policy_failure`.execute(app.svc.db);
    await a.revoke({ batchId: f.batchId, confirmed: true, plan: preview.plan });
    expect(await app.svc.vouchers.get(f.later.id)).toMatchObject({ number: 2 });
  });
});
