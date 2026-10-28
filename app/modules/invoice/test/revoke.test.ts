import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { sql } from '@caiwu/db';
import type { InvoiceTables } from '../server/migrations';
import server from '../server';
import { mapping, single } from './fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());

async function setup(renumberAfterDelete = true) {
  const api = app.call(server);
  await api.saveSettings(await mapping(app.svc));
  await app.svc.voucherPolicy.set({
    ...(await app.svc.voucherPolicy.get()),
    renumberAfterDelete,
  });
  for (let i = 0; i < 3; i++) await api.save({ data: single({ number: `REVOKE-${i}` }) });
  await api.audit({
    selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    to: 'audited',
  });
  const input = {
    selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    date: '2026-02-28',
    voucherTypeId: 1,
    mode: 'individual' as const,
  };
  const plan = await api.previewVoucher(input);
  const groups = await api.generate({
    ...input,
    fingerprint: plan.fingerprint,
    requestId: randomUUID(),
  });
  const target = { id: groups[1]!.id, expectedRevision: 1 };
  const snapshot = async () => ({
    docs: await api.list({}),
    groups: await api.groups({}),
    vouchers: await app.svc.vouchers.list({ includeVoided: true }),
    logs: await app.svc.log.list(),
  });
  return { api, groups, target, snapshot };
}

describe('w_fp_pz / w_fp_lr_1 撤销删除计划', () => {
  it.each([false, true])(
    '重排 %s：无写入预览、明确确认及完整编号映射，撤销后仍可生成',
    async (renumber) => {
      const { api, groups, target, snapshot } = await setup(renumber);
      const before = await snapshot();
      const preview = await api.previewRevoke(target);
      expect(await snapshot()).toEqual(before);
      expect(preview.deletionPlan.renumber).toBe(renumber);
      expect(preview.deletionPlan.ids).toEqual([groups[1]!.voucher_id]);
      expect(preview.impacts.map((p) => [p.oldNumber, p.number])).toEqual(
        renumber
          ? [
              [1, 1],
              [3, 2],
            ]
          : [],
      );
      expect(preview.invoices).toHaveLength(1);
      await expect(api.revoke({ ...preview, confirmed: false })).rejects.toThrow(/必须确认/);
      await expect(api.revoke({ ...target, confirmed: true })).rejects.toThrow(/先预览撤销/);
      expect(await snapshot()).toEqual(before);
      await api.revoke({ ...preview, confirmed: true });
      expect((await app.svc.vouchers.list({})).items.map((v) => v.number).sort()).toEqual(
        renumber ? [1, 2] : [1, 3],
      );
      const doc = (await api.list({})).find((d) => d.id === preview.invoices[0]!.id)!;
      expect(doc).toMatchObject({ state: 'audited', groupId: null, voucherId: null });
      const input = {
        selection: [{ id: doc.id, revision: doc.revision }],
        date: '2026-02-28',
        voucherTypeId: 1,
        mode: 'individual' as const,
      };
      const next = await api.previewVoucher(input);
      await api.generate({ ...input, fingerprint: next.fingerprint, requestId: randomUUID() });
      const numbers = (await app.svc.vouchers.list({})).items.map((v) => v.number);
      expect(new Set(numbers).size).toBe(3);
      expect(numbers.every((n) => n != null && n > 0)).toBe(true);
    },
  );

  it('不能把另一批次的合法删除计划套入当前撤销', async () => {
    const { api, groups, target, snapshot } = await setup();
    const preview = await api.previewRevoke(target);
    const other = await api.previewRevoke({ id: groups[0]!.id, expectedRevision: 1 });
    const before = await snapshot();
    await expect(
      api.revoke({ ...preview, deletionPlan: other.deletionPlan, confirmed: true }),
    ).rejects.toThrow(/已变化/);
    expect(await snapshot()).toEqual(before);
  });

  it('原计划过期、伪造期限或签名均拒绝且零写入', async () => {
    const { api, target, snapshot } = await setup();
    let now = Date.now();
    app.runtime.now = () => new Date(now);
    const preview = await api.previewRevoke(target);
    const before = await snapshot();
    await expect(
      api.revoke({
        ...preview,
        deletionPlan: { ...preview.deletionPlan, expiresAt: preview.deletionPlan.expiresAt - 1 },
        confirmed: true,
      }),
    ).rejects.toThrow(/已变化/);
    await expect(
      api.revoke({
        ...preview,
        deletionPlan: { ...preview.deletionPlan, fingerprint: '0'.repeat(64) },
        confirmed: true,
      }),
    ).rejects.toThrow(/已变化/);
    now = preview.deletionPlan.expiresAt;
    await expect(api.revoke({ ...preview, confirmed: true })).rejects.toThrow(/过期/);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['voucher', 'invoice', 'group', 'issue', 'line'] as const)(
    '预览后 %s 版本或来源变化，拒绝旧计划',
    async (change) => {
      const { api, target, snapshot } = await setup();
      const preview = await api.previewRevoke(target);
      const db = app.svc.db.withTables<InvoiceTables>();
      const invoiceId = preview.invoices[0]!.id;
      if (change === 'voucher') {
        const v = (await app.svcFor('invoice').vouchers.get(preview.deletionPlan.ids[0]!))!;
        await app
          .svcFor('invoice')
          .vouchers.update(
            v.id,
            { date: v.date, voucherTypeId: v.voucherTypeId, lines: v.lines, source: v.source! },
            { expectedRevision: v.revision },
          );
      } else if (change === 'invoice') {
        await db
          .updateTable('invoice_document')
          .set((eb) => ({ revision: eb('revision', '+', 1) }))
          .where('id', '=', invoiceId)
          .execute();
      } else if (change === 'group') {
        await db
          .updateTable('invoice_group')
          .set({ data: JSON.stringify({ ids: [invoiceId], changed: true }) })
          .where('id', '=', target.id)
          .execute();
      } else if (change === 'line') {
        await db
          .insertInto('invoice_line')
          .values({
            document_id: invoiceId,
            line_no: 1,
            quantity_e6: null,
            data: JSON.stringify({
              name: '变化的来源行',
              specification: '',
              unit: '',
              unitPrice: null,
              taxRate: null,
              taxMark: 'unspecified',
              amount: 10000,
              tax: 1000,
              total: 11000,
            }),
          })
          .execute();
      } else {
        await db
          .insertInto('invoice_issue')
          .values({
            invoice_id: invoiceId,
            inventory_document_id: 123,
            inventory_revision: 1,
            number: '变更的出库来源',
            date: '2026-02-28',
            input: '{}',
            created_at: new Date().toISOString(),
          })
          .execute();
      }
      const changed = await snapshot();
      await expect(api.revoke({ ...preview, confirmed: true })).rejects.toThrow(
        /版本已变化|已变化/,
      );
      expect(await snapshot()).toEqual(changed);
    },
  );

  it('并发新增凭证及编号策略改变后拒绝旧计划，重新预览后编号连续', async () => {
    const { api, target, snapshot } = await setup();
    const preview = await api.previewRevoke(target);
    const v = (await app.svc.vouchers.get(preview.deletionPlan.ids[0]!))!;
    await app.svc.vouchers.create({ date: v.date, voucherTypeId: v.voucherTypeId, lines: v.lines });
    const changed = await snapshot();
    await expect(api.revoke({ ...preview, confirmed: true })).rejects.toThrow(/已变化/);
    expect(await snapshot()).toEqual(changed);
    const second = await api.previewRevoke(target);
    await app.svc.voucherPolicy.set({
      ...(await app.svc.voucherPolicy.get()),
      renumberAfterDelete: false,
    });
    await expect(api.revoke({ ...second, confirmed: true })).rejects.toThrow(/已变化/);
    await app.svc.voucherPolicy.set({
      ...(await app.svc.voucherPolicy.get()),
      renumberAfterDelete: true,
    });
    await api.revoke({ ...(await api.previewRevoke(target)), confirmed: true });
    expect((await app.svc.vouchers.list({})).items.map((r) => r.number).sort()).toEqual([1, 2, 3]);
  });

  it('两次并发确认仅一次生效，不重复重排', async () => {
    const { api, target } = await setup();
    const preview = await api.previewRevoke(target);
    const results = await Promise.allSettled([
      api.revoke({ ...preview, confirmed: true }),
      api.revoke({ ...preview, confirmed: true }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await app.svc.vouchers.list({})).items.map((r) => r.number).sort()).toEqual([1, 2]);
    expect((await app.svc.log.list()).filter((r) => r.action === 'invoice.revoke')).toHaveLength(1);
  });

  it('重排后日志写入失败，凭证编号、票据状态与关联全部回滚', async () => {
    const { api, target, snapshot } = await setup();
    const preview = await api.previewRevoke(target);
    const before = await snapshot();
    await sql`CREATE TRIGGER invoice_test_revoke_rollback BEFORE INSERT ON operation_log WHEN NEW.action='invoice.revoke' BEGIN SELECT RAISE(ABORT,'合成撤销事务失败'); END`.execute(
      app.svc.db,
    );
    await expect(api.revoke({ ...preview, confirmed: true })).rejects.toThrow(/合成撤销事务失败/);
    expect(await snapshot()).toEqual(before);
    await sql`DROP TRIGGER invoice_test_revoke_rollback`.execute(app.svc.db);
    await api.revoke({ ...preview, confirmed: true });
    expect((await app.svc.vouchers.list({})).items.map((r) => r.number).sort()).toEqual([1, 2]);
  });

  it.each(['target', 'affected'] as const)(
    '审核锁：%s 在预览后审核，整批拒绝且来源关联不变',
    async (which) => {
      const { api, groups, target, snapshot } = await setup();
      const preview = await api.previewRevoke(target);
      await app.svc.vouchers.changeStatus({
        ids: [groups[which === 'target' ? 1 : 2]!.voucher_id!],
        to: 'audited',
      });
      const changed = await snapshot();
      await expect(api.revoke({ ...preview, confirmed: true })).rejects.toThrow(/审核|过账/);
      await expect(
        api.previewRevoke({ ...target, expectedRevision: which === 'target' ? 2 : 1 }),
      ).rejects.toThrow(/审核|过账/);
      expect(await snapshot()).toEqual(changed);
    },
  );

  it('来源不符和缺失关联拒绝预览，独立权限不能绕过', async () => {
    const { api, groups, target } = await setup();
    const token = await app.addUser('view', { permissions: ['invoice.view'] });
    await expect(app.call(server, token).previewRevoke(target)).rejects.toThrow(/权限/);
    await app.svc.db
      .withTables<InvoiceTables>()
      .updateTable('invoice_group')
      .set({ voucher_id: groups[0]!.voucher_id })
      .where('id', '=', target.id)
      .execute();
    await expect(api.previewRevoke(target)).rejects.toThrow(/来源.*不一致/);
    await app.svc.db
      .withTables<InvoiceTables>()
      .updateTable('invoice_group')
      .set({ voucher_id: groups[1]!.voucher_id })
      .where('id', '=', target.id)
      .execute();
    await app.svc.db
      .withTables<InvoiceTables>()
      .updateTable('invoice_document')
      .set({ group_id: null })
      .where('group_id', '=', target.id)
      .execute();
    await expect(api.previewRevoke(target)).rejects.toThrow(/关联不完整/);
  });
});
