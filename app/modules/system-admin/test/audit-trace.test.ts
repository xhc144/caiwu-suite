import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineManifest } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';

const manifest = defineManifest({
  id: 'trace-test',
  name: '合成来源单据',
  products: 'all',
  sources: [{ type: 'document', name: '合成单据', path: '/document?id={id}' }],
});
const source = defineServerModule(manifest, { router: moduleKit(manifest).router({}) });
let app: TestApp;
const input = { year: 2026, scopes: ['vouchers'] as ['vouchers'] };
beforeEach(async () => {
  app = await createTestApp({ modules: [server, source] });
});
afterEach(async () => {
  await app.close();
});

async function seed() {
  const [voucher] = await seedVouchers(app.svcFor(manifest.id), [
    {
      date: '2026-01-10',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6001', credit: 12345 },
      ],
    },
  ]);
  const original = await app.svcFor(manifest.id).vouchers.get(voucher!.id);
  const created = await app.svcFor(manifest.id).vouchers.create({
    date: '2026-01-11',
    voucherTypeId: 1,
    source: { type: 'document', id: 'synthetic-001' },
    reversalOfId: original!.id,
    lines: original!.lines.map((line) => ({
      ...line,
      id: undefined,
      debit: -line.debit,
      credit: -line.credit,
    })),
  });
  await app.svc.vouchers.changeStatus({ ids: [created.id], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [created.id], to: 'posted' });
  return (await app.svc.vouchers.get(created.id))!;
}

describe('w_bf_98001 通用审计资料可追溯信息', () => {
  it('w_bf_98001 期初累计及外币字段也必须是安全整数分，不能只校验合计涉及的余额', async () => {
    const cash = await app.svc.accounts.require('1001');
    const selected = { year: 2026, scopes: ['opening'] as ['opening'] };
    const logs = await app.svc.log.list();
    for (const field of ['fcBalance', 'ytdDebit', 'ytdCredit'] as const) {
      await app.svc.opening.upsert({ year: 2026, accountId: cash.id, balance: 0, [field]: 0.5 });
      await expect(app.call(server).audit.preview(selected)).rejects.toMatchObject({
        cause: { data: { code: 'AMOUNT_INVALID' } },
      });
      await expect(
        app.call(server).audit.export({ ...selected, digest: '0'.repeat(64) }),
      ).rejects.toMatchObject({ cause: { data: { code: 'AMOUNT_INVALID' } } });
    }
    expect(await app.svc.log.list()).toEqual(logs);
  });

  it('w_bf_98001 来源、冲销、修订、处理时间和仅关联人员白名单完整；读取不解锁来源凭证', async () => {
    const voucher = await seed();
    await app.addUser('unrelated', {
      password: 'not-for-export',
      permissions: ['system-admin.reset'],
    });
    const preview = await app.call(server).audit.preview(input);
    const file = await app.call(server).audit.export({ ...input, digest: preview.digest });
    const data = JSON.parse(file.content) as {
      format: string;
      vouchers: Record<string, unknown>[];
      operators: Record<string, unknown>[];
    };
    expect(data.format).toBe('通用审计资料 v2');
    expect(data.vouchers.find((v) => v.id === voucher.id)).toMatchObject({
      source_module: 'trace-test',
      source_type: 'document',
      source_id: 'synthetic-001',
      reversal_of_id: voucher.reversalOfId,
      revision: voucher.revision,
      created_by: 1,
      updated_by: 1,
      audited_by: 1,
      posted_by: 1,
      created_at: voucher.createdAt,
      updated_at: voucher.updatedAt,
      audited_at: voucher.auditedAt,
      posted_at: voucher.postedAt,
    });
    expect(data.operators).toEqual([{ id: 1, code: 'admin', name: '系统管理员', disabled: 0 }]);
    expect(file.content).not.toMatch(
      /password_hash|scrypt\$|not-for-export|unrelated|user_permission|is_admin/,
    );
    expect(await app.svc.vouchers.get(voucher.id)).toEqual(voucher);
    await expect(app.svc.vouchers.delete(voucher.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
    await expect(app.svcFor(manifest.id).vouchers.delete(voucher.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_LOCKED' },
    });
    const limited = await app.call(server).audit.preview({ year: 2026, scopes: ['accounts'] });
    expect(limited.counts.operators).toBe(0);
  });

  it('w_bf_98001 人员名称变化使预览过期；失败不写成功日志，重预览后导出新名称', async () => {
    await seed();
    const preview = await app.call(server).audit.preview(input);
    await app.svc.db
      .updateTable('app_user')
      .set({ name: '合成新姓名' })
      .where('id', '=', 1)
      .execute();
    const before = await app.svc.log.list();
    await expect(
      app.call(server).audit.export({ ...input, digest: preview.digest }),
    ).rejects.toMatchObject({ cause: { data: { code: 'PREVIEW_CHANGED' } } });
    expect(await app.svc.log.list()).toEqual(before);
    const next = await app.call(server).audit.preview(input);
    expect(
      (await app.call(server).audit.export({ ...input, digest: next.digest })).content,
    ).toContain('合成新姓名');
  });

  it('w_bf_98001 审计写日志失败时事务拒绝返回文件；原数据、会话和来源锁保留', async () => {
    const voucher = await seed();
    const preview = await app.call(server).audit.preview(input);
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TEMP TRIGGER system_admin_audit_failure BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, '合成审计日志失败'); END",
    );
    const before = await app.svc.log.list();
    try {
      await expect(
        app.call(server).audit.export({ ...input, digest: preview.digest }),
      ).rejects.toThrow('合成审计日志失败');
      expect(await app.svc.log.list()).toEqual(before);
      expect(await app.svc.vouchers.get(voucher.id)).toEqual(voucher);
      expect((await app.core().auth.me()).book.id).toBe(app.book.id);
    } finally {
      raw.exec('DROP TRIGGER system_admin_audit_failure');
    }
    expect(
      (await app.call(server).audit.export({ ...input, digest: preview.digest })).content,
    ).toContain('synthetic-001');
    await expect(app.svc.vouchers.delete(voucher.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
  });
});
