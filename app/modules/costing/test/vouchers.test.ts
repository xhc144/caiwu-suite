import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sourceRoute } from '@caiwu/core';
import manifest from '../manifest';
import { sql } from '@caiwu/db';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { cancelCostVoucher, generateVoucher } from '../server/vouchers';
import { caller, setup } from './fixtures';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(async () => {
  await t.app.close();
});
const svc = () => t.app.svcFor('costing');
const snapshot = () => svc().inventory.snapshot(202612);
async function publish() {
  const preview = await t.api.preview({ period: 202601 });
  return t.api.commit({
    period: 202601,
    fingerprint: preview.fingerprint,
    requestKey: randomUUID(),
    confirmed: true,
  });
}
async function seed() {
  await t.opening();
  const receipt = await t.document('receipt', '10', '3');
  const issue = await t.document('issue', '5', '10');
  const batch = await publish();
  return { receipt, issue, batch };
}
async function payload(documentId: number) {
  const preview = await t.api.previewVoucher({ documentId, purpose: 'cost' });
  return {
    documentId,
    purpose: 'cost' as const,
    fingerprint: preview.fingerprint,
    voucherTypeId: (await t.app.svc.reference.voucherTypes())[0]!.id,
    confirmed: true,
  };
}
async function cancellation(documentId: number) {
  const state = await t.api.costVoucherState({ documentId });
  return {
    bookId: state.bookId,
    documentId,
    documentRevision: state.documentRevision,
    voucherId: state.voucher!.id,
    voucherRevision: state.voucher!.revision,
    confirmed: true,
  };
}
async function state() {
  return {
    snapshot: await snapshot(),
    vouchers: await t.app.svc.vouchers.list({ includeVoided: true }),
    logs: await t.app.svc.db.selectFrom('operation_log').selectAll().orderBy('id').execute(),
  };
}

describe('w_cb_pz 正式出库成本制证与撤销：真实账套和 core 事务桥', () => {
  it('w_cb_pz：黄金1000分成本生成待审核凭证，数量为出库负数，来源用途锁和日志原子保存', async () => {
    const { issue, receipt, batch } = await seed();
    const input = await payload(issue.id);
    expect((await t.api.previewVoucher(input)).canGenerate).toBe(true);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
    const before = await snapshot();
    const v = await t.api.generateVoucher(input);
    expect(v).toMatchObject({
      status: 'pending',
      voided: false,
      period: 202601,
      date: '2026-01-10',
      number: 1,
      debitTotal: 1000,
      creditTotal: 1000,
      source: { module: 'costing', type: 'cost', id: String(issue.id) },
    });
    expect(sourceRoute(manifest, 'cost', String(issue.id))).toBe(
      `/m/costing/vouchers?id=${issue.id}&purpose=cost`,
    );
    expect(v.lines).toHaveLength(2);
    expect(v.lines[0]).toMatchObject({
      accountCode: '6401',
      debit: 1000,
      credit: 0,
      quantity: null,
    });
    expect(v.lines[1]).toMatchObject({
      accountCode: '1405',
      debit: 0,
      credit: 1000,
      quantity: '-5',
      unitPrice: '2.000000000000',
    });
    const after = await snapshot();
    expect(after.control).toEqual(before.control);
    expect(after.control.costBatch).toBe(batch.inventoryBatchId);
    expect(after.movements).toEqual(before.movements);
    expect(after.stockRevision).toBe(before.stockRevision + 1);
    expect(after.voucherSources).toEqual([
      {
        document_id: issue.id,
        purpose: 'cost',
        voucher_id: v.id,
        owner_module: 'costing',
        actor_id: 1,
      },
    ]);
    expect(after.documents.find((d) => d.id === issue.id)!.revision).toBe(
      before.documents.find((d) => d.id === issue.id)!.revision + 1,
    );
    expect(after.documents.find((d) => d.id === receipt.id)).toEqual(
      before.documents.find((d) => d.id === receipt.id),
    );
    expect((await t.api.previewVoucher(input)).canGenerate).toBe(false);
    const saved = await state();
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/重复生成/);
    await expect(t.app.svc.vouchers.delete(v.id)).rejects.toThrow(/成本核算/);
    expect(await state()).toEqual(saved);
    expect(saved.logs.filter((l) => l.action === 'voucher.create')).toHaveLength(1);
    expect(saved.logs.filter((l) => l.action === 'inventory.voucher.lock')).toHaveLength(1);
    expect(saved.logs.filter((l) => l.action === 'costing.voucher.generate')).toHaveLength(1);
  });

  it('w_cb_pz：并发只生成一张；未审核撤销后必须重新预览才可生成', async () => {
    const { issue } = await seed();
    const input = await payload(issue.id);
    const both = await Promise.allSettled([
      t.api.generateVoucher(input),
      t.api.generateVoucher(input),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await t.app.svc.vouchers.list()).total).toBe(1);
    const cancel = await cancellation(issue.id);
    await expect(t.api.cancelCostVoucher({ ...cancel, confirmed: false })).rejects.toThrow(
      /明确确认/,
    );
    await expect(t.api.cancelCostVoucher({ ...cancel, documentRevision: 999 })).rejects.toThrow(
      /版本/,
    );
    await expect(t.api.cancelCostVoucher({ ...cancel, voucherRevision: 999 })).rejects.toThrow(
      /版本/,
    );
    await expect(t.api.cancelCostVoucher({ ...cancel, bookId: 'another-book' })).rejects.toThrow(
      /账套/,
    );
    await t.api.cancelCostVoucher(cancel);
    expect(await t.app.svc.vouchers.get(cancel.voucherId)).toBeNull();
    expect((await snapshot()).voucherSources).toEqual([]);
    expect((await snapshot()).control.costBatch).not.toBeNull();
    const released = await state();
    await expect(t.api.cancelCostVoucher(cancel)).rejects.toThrow(/不存在|版本/);
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/旧预览/);
    expect(await state()).toEqual(released);
    const regenerated = await t.api.generateVoucher(await payload(issue.id));
    expect(regenerated).toMatchObject({ debitTotal: 1000, status: 'pending' });
    expect((await snapshot()).voucherSources).toHaveLength(1);
  });

  it.each(['audited', 'posted'] as const)(
    'w_cb_pz：已%s凭证拒绝撤销、重复生成及撤销核算，所有记录保持',
    async (status) => {
      const { issue, batch } = await seed();
      const input = await payload(issue.id);
      const v = await t.api.generateVoucher(input);
      await t.app.svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      if (status === 'posted') await t.app.svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
      const before = await state();
      await expect(t.api.cancelCostVoucher(await cancellation(issue.id))).rejects.toThrow(
        /审核|过账/,
      );
      await expect(t.api.generateVoucher(input)).rejects.toThrow(/重复生成/);
      await expect(
        t.api.cancelCalculation({ id: batch.id, revision: batch.revision, confirmed: true }),
      ).rejects.toThrow(/审核|过账/);
      expect(await state()).toEqual(before);
    },
  );

  it('w_cb_pz：已作废成本凭证不得撤销或重复生成', async () => {
    const { issue } = await seed();
    const input = await payload(issue.id);
    const v = await t.api.generateVoucher(input);
    await svc().vouchers.setVoided(v.id, true, { expectedRevision: v.revision });
    const before = await state();
    await expect(t.api.cancelCostVoucher(await cancellation(issue.id))).rejects.toThrow(/作废/);
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/重复生成/);
    expect(await state()).toEqual(before);
  });

  it('w_cb_pz：待审核成本凭证随正式核算撤销一次，旧制证预览不可重放', async () => {
    const { issue, batch } = await seed();
    const input = await payload(issue.id);
    const v = await t.api.generateVoucher(input);
    await t.api.cancelCalculation({ id: batch.id, revision: batch.revision, confirmed: true });
    expect(await t.app.svc.vouchers.get(v.id)).toBeNull();
    expect((await snapshot()).voucherSources).toEqual([]);
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/正式成本核算/);
    expect(
      (await state()).logs.filter(
        (l) => l.action === 'voucher.delete' && l.target_id === String(v.id),
      ),
    ).toHaveLength(1);
  });

  it('w_cb_pz：未确认、旧来源、跨操作员、跨账套及权限不足均不能制证', async () => {
    const { issue } = await seed();
    const input = await payload(issue.id);
    const before = await state();
    await expect(t.api.generateVoucher({ ...input, confirmed: false })).rejects.toThrow(/明确确认/);
    const viewer = caller(t.app, await t.app.addUser('viewer', { permissions: ['costing.view'] }));
    await expect(viewer.generateVoucher(input)).rejects.toThrow(/权限/);
    await expect(
      viewer.cancelCostVoucher({
        bookId: t.app.book.id,
        documentId: issue.id,
        documentRevision: 1,
        voucherId: 1,
        voucherRevision: 1,
        confirmed: true,
      }),
    ).rejects.toThrow(/权限/);
    const actor = caller(
      t.app,
      await t.app.addUser('actor', { permissions: ['costing.view', 'costing.voucher'] }),
    );
    await expect(actor.generateVoucher(input)).rejects.toThrow(/旧预览/);
    await expect(generateVoucher(t.app.svcFor('inventory'), input)).rejects.toThrow(/成本模块/);
    // 增加用户不改变库存、凭证或制证日志。
    expect((await state()).snapshot).toEqual(before.snapshot);
    expect((await state()).vouchers).toEqual(before.vouchers);
    await t.document('receipt', '1', '1', { date: '2026-02-01' });
    const changed = await state();
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/旧预览/);
    expect(await state()).toEqual(changed);
    const other = await setup();
    try {
      await other.opening();
      await other.document('receipt', '10', '3');
      const otherIssue = await other.document('issue', '5', '10');
      const p = await other.api.preview({ period: 202601 });
      await other.api.commit({
        period: 202601,
        fingerprint: p.fingerprint,
        requestKey: randomUUID(),
        confirmed: true,
      });
      await expect(
        other.api.generateVoucher({ ...input, documentId: otherIssue.id }),
      ).rejects.toThrow(/旧预览/);
      expect((await other.app.svc.vouchers.list()).total).toBe(0);
    } finally {
      await other.app.close();
    }
  });

  it('w_cb_pz：科目默认辅助项变更使预览过期；缺必填项、非明细/停用科目和外币拒绝', async () => {
    const { issue } = await seed();
    const input = await payload(issue.id);
    await t.app.svc.db
      .insertInto('account_dimension')
      .values({
        account_id: t.ids.cost,
        dimension_type: 'department',
        required: 1,
        default_item_id: null,
      })
      .execute();
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/辅助核算项/);
    const department = (await t.app.svc.dimensions.items('department'))[0]!;
    await t.app.svc.db
      .updateTable('account_dimension')
      .set({ default_item_id: department.id })
      .where('account_id', '=', t.ids.cost)
      .execute();
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/旧预览/);
    const fresh = await payload(issue.id);
    const v = await t.api.generateVoucher(fresh);
    expect(v.lines[0]!.dimensions.department).toBe(department.id);
    await t.api.cancelCostVoucher(await cancellation(issue.id));
    for (const patch of [{ disabled: 1 }, { is_leaf: 0 }, { currency_code: 'USD' }]) {
      await t.app.svc.db.updateTable('account').set(patch).where('id', '=', t.ids.cost).execute();
      await expect(t.api.generateVoucher(fresh)).rejects.toThrow(/停用|非明细|外币/);
      await t.app.svc.db
        .updateTable('account')
        .set({ disabled: 0, is_leaf: 1, currency_code: null })
        .where('id', '=', t.ids.cost)
        .execute();
    }
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
  });

  it('w_cb_pz：制证期间结账和无效凭证类型拒绝；撤销也检查结账', async () => {
    const { issue } = await seed();
    const input = await payload(issue.id);
    const before = await state();
    await expect(t.api.generateVoucher({ ...input, voucherTypeId: 999999 })).rejects.toThrow(
      /凭证类型/,
    );
    expect(await state()).toEqual(before);
    await t.app.svc.periods.setStatus(202601, 'closed');
    const closed = await state();
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/已经结账/);
    expect(await state()).toEqual(closed);
    await t.app.svc.periods.setStatus(202601, 'open');
    await t.api.generateVoucher(await payload(issue.id));
    const cancel = await cancellation(issue.id);
    await t.app.svc.periods.setStatus(202601, 'closed');
    const locked = await state();
    await expect(t.api.cancelCostVoucher(cancel)).rejects.toThrow(/已经结账/);
    expect(await state()).toEqual(locked);
  });

  it('w_cb_pz：创建凭证和来源锁后日志失败，以及上层失败，全部回滚；撤销后失败也回滚', async () => {
    const { issue } = await seed();
    const input = await payload(issue.id);
    const before = await state();
    await sql`CREATE TEMP TRIGGER fail_costing_log BEFORE INSERT ON operation_log WHEN NEW.action='costing.voucher.generate' BEGIN SELECT RAISE(ABORT,'制证末步失败'); END`.execute(
      t.app.svc.db,
    );
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/制证末步失败/);
    expect(await state()).toEqual(before);
    await sql`DROP TRIGGER fail_costing_log`.execute(t.app.svc.db);
    await expect(
      svc().tx(async (tx) => {
        await generateVoucher(tx, input);
        throw new Error('调用方失败');
      }),
    ).rejects.toThrow('调用方失败');
    expect(await state()).toEqual(before);
    await t.api.generateVoucher(input);
    const cancel = await cancellation(issue.id);
    const saved = await state();
    await expect(
      svc().tx(async (tx) => {
        await cancelCostVoucher(tx, cancel);
        throw new Error('撤销调用方失败');
      }),
    ).rejects.toThrow('撤销调用方失败');
    expect(await state()).toEqual(saved);
    await t.api.cancelCostVoucher(cancel);
    expect((await t.app.svc.vouchers.list()).total).toBe(0);
  });

  it('w_cb_pz：历史凭证尚无来源关联时不覆盖、不孤立生成', async () => {
    const { issue } = await seed();
    const input = await payload(issue.id);
    // 仅用公开 core API 构造有来源但未关联的历史凭证，验证重复保护覆盖断链来源。
    const preview = await t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' });
    await svc().vouchers.create({
      date: preview.date,
      voucherTypeId: input.voucherTypeId,
      lines: preview.lines,
      source: { type: 'cost', id: String(issue.id) },
    });
    const before = await state();
    await expect(t.api.generateVoucher(input)).rejects.toThrow(/重复生成/);
    expect(await state()).toEqual(before);
  });

  it('w_cb_pz：库存模块拥有的成本用途不能覆盖或由成本模块撤销', async () => {
    const { issue } = await seed();
    const preview = await t.api.previewVoucher({ documentId: issue.id, purpose: 'cost' });
    const voucherTypeId = (await t.app.svc.reference.voucherTypes())[0]!.id;
    const v = await t.app.svcFor('inventory').tx((tx) =>
      tx.inventory.with(async (inv) => {
        const source = await inv.snapshot(202612);
        const doc = source.documents.find((d) => d.id === issue.id)!;
        const v = await tx.vouchers.create({
          date: preview.date,
          voucherTypeId,
          lines: preview.lines,
          source: { type: 'cost', id: String(doc.id) },
        });
        await inv.lockVoucherSource({
          bookId: source.bookId,
          documentId: doc.id,
          purpose: 'cost',
          expectedRevision: doc.revision,
          voucherId: v.id,
        });
        return v;
      }),
    );
    const before = await state();
    await expect(t.api.generateVoucher(await payload(issue.id))).rejects.toThrow(/重复生成/);
    await expect(t.api.cancelCostVoucher(await cancellation(issue.id))).rejects.toThrow(/其他模块/);
    expect(await state()).toEqual(before);
    expect((await t.app.svc.vouchers.get(v.id))!.source!.module).toBe('inventory');
  });

  it('w_cb_pz：同单收入用途保留，生成和撤销只影响成本凭证', async () => {
    const { issue } = await seed();
    const voucherTypeId = (await t.app.svc.reference.voucherTypes())[0]!.id;
    const revenue = await svc().tx((tx) =>
      tx.inventory.with(async (inv) => {
        const source = await inv.snapshot(202612);
        const doc = source.documents.find((d) => d.id === issue.id)!;
        const v = await tx.vouchers.create({
          date: doc.date,
          voucherTypeId,
          lines: [
            { summary: '合成收入前置', accountId: t.ids.cash, debit: 5000 },
            { summary: '合成收入前置', accountId: t.ids.sales, credit: 5000 },
          ],
          source: { type: 'revenue', id: String(doc.id) },
        });
        await inv.lockVoucherSource({
          bookId: source.bookId,
          documentId: doc.id,
          purpose: 'revenue',
          expectedRevision: doc.revision,
          voucherId: v.id,
        });
        return v;
      }),
    );
    const cost = await t.api.generateVoucher(await payload(issue.id));
    expect((await snapshot()).voucherSources.map((s) => s.purpose)).toEqual(['cost', 'revenue']);
    await t.api.cancelCostVoucher(await cancellation(issue.id));
    expect(await t.app.svc.vouchers.get(revenue.id)).toEqual(revenue);
    expect(await t.app.svc.vouchers.get(cost.id)).toBeNull();
    expect((await snapshot()).voucherSources.map((s) => s.purpose)).toEqual(['revenue']);
  });

  it('w_cb_pz：全部为零的正式成本不生成空凭证，领用出库按成本制证', async () => {
    await t.opening('3', '0');
    const zero = await t.document('issue', '1', '99', { category: '领用' });
    await publish();
    const before = await state();
    await expect(t.api.previewVoucher({ documentId: zero.id, purpose: 'cost' })).rejects.toThrow(
      /非零金额/,
    );
    expect(await state()).toEqual(before);
    const sample = await setup();
    try {
      await sample.opening('3', '0.01');
      const issue = await sample.document('issue', '1', '99', { category: '领用' });
      const p = await sample.api.preview({ period: 202601 });
      await sample.api.commit({
        period: 202601,
        fingerprint: p.fingerprint,
        requestKey: randomUUID(),
        confirmed: true,
      });
      const preview = await sample.api.previewVoucher({ documentId: issue.id, purpose: 'cost' });
      const v = await sample.api.generateVoucher({
        documentId: issue.id,
        purpose: 'cost',
        fingerprint: preview.fingerprint,
        voucherTypeId: (await sample.app.svc.reference.voucherTypes())[0]!.id,
        confirmed: true,
      });
      expect(v).toMatchObject({
        debitTotal: 1,
        creditTotal: 1,
        source: { type: 'cost', id: String(issue.id) },
      });
    } finally {
      await sample.app.close();
    }
  });

  it('w_cb_pz：受权操作员生成的来源锁绑定实际制单人，权限不提升', async () => {
    const { issue } = await seed();
    const token = await t.app.addUser('clerk', {
      permissions: ['costing.view', 'costing.voucher'],
    });
    const clerk = caller(t.app, token);
    const preview = await clerk.previewVoucher({ documentId: issue.id, purpose: 'cost' });
    const v = await clerk.generateVoucher({
      ...(await payload(issue.id)),
      fingerprint: preview.fingerprint,
    });
    const user = (await loadServiceUser(t.app.svc.db, v.createdBy.id))!;
    const bound = createCoreServices({ ...svc().ctx, user });
    expect((await bound.inventory.snapshot(202612)).voucherSources[0]!.actor_id).toBe(user.id);
    expect(v.createdBy.name).toBe('clerk');
    await expect(clerk.cancelCalculation({ id: 1, revision: 1, confirmed: true })).rejects.toThrow(
      /权限/,
    );
    const source = await clerk.costVoucherState({ documentId: issue.id });
    await clerk.cancelCostVoucher({
      bookId: source.bookId,
      documentId: issue.id,
      documentRevision: source.documentRevision,
      voucherId: v.id,
      voucherRevision: v.revision,
      confirmed: true,
    });
  });

  it('w_cb_pz fast-check：真实凭证严格保留整数分和累计尾差，不使用销售金额', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 3, max: 1000000 }), async (cents) => {
        const sample = await setup();
        try {
          const price = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
          await sample.opening('1', price);
          await sample.document('receipt', '2', '0');
          const issues = [
            await sample.document('issue', '1', '987654.32'),
            await sample.document('issue', '1', '987654.32'),
          ];
          const p = await sample.api.preview({ period: 202601 });
          await sample.api.commit({
            period: 202601,
            fingerprint: p.fingerprint,
            requestKey: randomUUID(),
            confirmed: true,
          });
          const voucherTypeId = (await sample.app.svc.reference.voucherTypes())[0]!.id;
          let actual = 0n;
          for (const [index, issue] of issues.entries()) {
            const preview = await sample.api.previewVoucher({
              documentId: issue.id,
              purpose: 'cost',
            });
            const v = await sample.api.generateVoucher({
              documentId: issue.id,
              purpose: 'cost',
              fingerprint: preview.fingerprint,
              voucherTypeId,
              confirmed: true,
            });
            const cumulative = (BigInt(cents) * BigInt(index + 1) * 2n + 3n) / 6n;
            const expected = cumulative - actual;
            expect(BigInt(v.debitTotal)).toBe(expected);
            expect(BigInt(v.creditTotal)).toBe(expected);
            expect(
              v.lines.every((l) => Number.isSafeInteger(l.debit) && Number.isSafeInteger(l.credit)),
            ).toBe(true);
            expect(v.lines[1]!.quantity).toBe('-1');
            actual += BigInt(v.debitTotal);
          }
          expect(BigInt(p.rows[0]!.closingCents) + actual).toBe(BigInt(cents));
        } finally {
          await sample.app.close();
        }
      }),
      { numRuns: 20 },
    );
  });
});
