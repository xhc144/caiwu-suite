import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { Direction, PlanInput } from '../shared';
import type { InvoiceTables } from '../server/migrations';
import server from '../server';
import { mapping, single } from './fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});
async function setup(direction: Direction = 'input', mode: PlanInput['mode'] = 'monthly') {
  const api = app.call(server),
    cfg = await mapping(app.svc, direction);
  const scheme = (await app.svc.book.info()).codeScheme;
  const parent = await app.svc.accounts.create(
    { code: '9800', name: '合成往来上级', categoryId: 'liability' },
    scheme,
  );
  const existing = await app.svc.accounts.create({ code: '980001', name: '合成已有往来' }, scheme);
  cfg.settlement = { accountId: parent.id, dimensions: {} };
  cfg.settlementMode = 'partnerName';
  await api.saveSettings(cfg);
  for (const [i, name] of ['合成已有往来', '合成新增往来', '合成新增往来'].entries()) {
    const red = i === 2;
    await api.save({
      data: single({
        direction,
        number: `PARTNER-${i}`,
        confirmDate: direction === 'input' ? '2026-02-05' : null,
        date: '2026-02-05',
        sellerName: direction === 'input' ? name : '合成销方',
        buyerName: direction === 'output' ? name : '合成购方',
        amount: red ? -2000 : 10000,
        tax: red ? -200 : 1000,
        total: red ? -2200 : 11000,
      }),
    });
  }
  await api.audit({
    selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    to: 'audited',
  });
  const input: PlanInput = {
    selection: (await api.list({})).map(({ id, revision }) => ({ id, revision })),
    date: '2026-02-28',
    voucherTypeId: 1,
    mode,
  };
  return { api, cfg, parent, existing, input };
}
const request = (input: PlanInput, fingerprint: string) => ({
  ...input,
  fingerprint,
  requestId: randomUUID(),
  newAccountsConfirmed: true,
});

describe('w_fp_sz/_2 → w_fp_pz 往来名称匹配与确认新增科目', () => {
  it.each(['input', 'output'] as const)(
    '%s 精确匹配、同名新往来去重、红字整数金额、重试和来源锁',
    async (direction) => {
      const { api, input, existing, parent } = await setup(direction);
      const plan = await api.previewVoucher(input);
      expect(plan.newAccounts.map(({ code, name }) => ({ code, name }))).toEqual([
        { code: '980002', name: '合成新增往来' },
      ]);
      expect(await app.svc.accounts.getByCode('980002')).toBeNull();
      expect(plan.groups[0]).toMatchObject({ debit: 19800, credit: 19800 });
      const lines = plan.groups[0]!.lines.filter((l) => l.accountCode.startsWith('9800'));
      expect(lines.map((l) => (direction === 'input' ? l.credit : l.debit))).toEqual([
        11000, 11000, -2200,
      ]);
      expect(lines[0]!.accountId).toBe(existing.id);
      const req = request(input, plan.fingerprint),
        generated = await api.generate(req);
      expect(await api.generate(req)).toEqual(generated);
      const account = (await app.svc.accounts.getByCode('980002'))!;
      expect(account).toMatchObject({ name: '合成新增往来', parentId: parent.id, isLeaf: true });
      const voucher = (await app.svc.vouchers.get(generated[0]!.voucher_id!))!;
      expect(voucher.lines.filter((l) => l.accountId === account.id)).toHaveLength(2);
      expect(
        voucher.lines.every((l) => Number.isSafeInteger(l.debit) && Number.isSafeInteger(l.credit)),
      ).toBe(true);
      await expect(app.svc.vouchers.delete(voucher.id)).rejects.toThrow(/由「发票」生成/);
      await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
      await expect(
        api.revoke({ id: generated[0]!.id, expectedRevision: 3, confirmed: true }),
      ).rejects.toThrow(/审核|过账/);
      expect((await api.list({})).every((d) => d.state === 'generated')).toBe(true);
      expect(
        (await app.svc.log.list()).filter((l) => l.action === 'invoice.account.create'),
      ).toHaveLength(1);
    },
  );
  it('确认与独立权限均不可少；仅匹配已有科目不需要新增权限', async () => {
    const { api, input } = await setup(),
      plan = await api.previewVoucher(input),
      req = request(input, plan.fingerprint);
    await expect(api.generate({ ...req, newAccountsConfirmed: false })).rejects.toThrow(
      /必须逐项核对并确认/,
    );
    const limited = app.call(
      server,
      await app.addUser('voucher-only', { permissions: ['invoice.view', 'invoice.voucher'] }),
    );
    await expect(limited.generate(req)).rejects.toThrow(/权限/);
    const reader = app.call(
      server,
      await app.addUser('view-only', { permissions: ['invoice.view'] }),
    );
    await expect(reader.generate(req)).rejects.toThrow(/权限/);
    expect(await app.svc.accounts.getByCode('980002')).toBeNull();
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    const existingOnly = { ...input, selection: [input.selection[0]!] },
      existingPlan = await limited.previewVoucher(existingOnly);
    expect(existingPlan.newAccounts).toEqual([]);
    expect(
      await limited.generate({
        ...request(existingOnly, existingPlan.fingerprint),
        newAccountsConfirmed: false,
      }),
    ).toHaveLength(1);
  });
  it('统一模式拒绝非末级；匹配模式拒绝末级或停用上级', async () => {
    const { api, cfg, existing, parent } = await setup(),
      current = (await api.settings({ direction: 'input' }))!;
    await expect(api.saveSettings({ ...current, settlementMode: 'unified' })).rejects.toThrow(
      /末级/,
    );
    await expect(
      api.saveSettings({ ...current, settlement: { accountId: existing.id, dimensions: {} } }),
    ).rejects.toThrow(/已有下级/);
    await app.svc.db
      .updateTable('account')
      .set({ disabled: 1 })
      .where('id', '=', parent.id)
      .execute();
    await expect(
      api.saveSettings({ ...cfg, expectedRevision: current.expectedRevision }),
    ).rejects.toThrow(/可用非末级/);
    expect((await api.settings({ direction: 'input' }))!.expectedRevision).toBe(
      current.expectedRevision,
    );
  });
  it.each([
    'disabled',
    'currency',
    'quantity',
    'nonleaf',
    'requiredDimension',
    'ambiguous',
  ] as const)('同名科目 %s 阻止预览，不能另建同名科目绕过', async (condition) => {
    const { api, input, existing } = await setup();
    const accounts = app.svc.db.updateTable('account').where('id', '=', existing.id);
    if (condition === 'disabled') await accounts.set({ disabled: 1 }).execute();
    if (condition === 'currency') await accounts.set({ currency_code: 'USD' }).execute();
    if (condition === 'quantity') await accounts.set({ quantity_unit: '件' }).execute();
    if (condition === 'nonleaf')
      await app.svc.accounts.create(
        { code: '98000101', name: '合成更下级' },
        (await app.svc.book.info()).codeScheme,
      );
    if (condition === 'requiredDimension')
      await app.svc.db
        .insertInto('account_dimension')
        .values({
          account_id: existing.id,
          dimension_type: 'partner',
          required: 1,
          default_item_id: null,
        })
        .execute();
    if (condition === 'ambiguous')
      await app.svc.accounts.create(
        { code: '980002', name: existing.name },
        (await app.svc.book.info()).codeScheme,
      );
    await expect(api.previewVoucher(input)).rejects.toThrow(/末级|外币|数量|必需|多个下级/);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });
  it.each(['business', 'tax'] as const)(
    '名称匹配结果与 %s 科目重合时拒绝，保持原科目角色隔离',
    async (role) => {
      const { api, input, existing } = await setup();
      const cfg = (await api.settings({ direction: 'input' }))!;
      cfg[role] = { accountId: existing.id, dimensions: {} };
      await api.saveSettings(cfg);
      await expect(api.previewVoucher(input)).rejects.toThrow(/与业务或税额科目重复/);
      expect(await app.svc.accounts.getByCode('980002')).toBeNull();
      expect((await app.svc.vouchers.list({})).total).toBe(0);
    },
  );
  it('编码满额和层数用尽阻止预览，不能溢出编码', async () => {
    const { api, input } = await setup(),
      scheme = (await app.svc.book.info()).codeScheme;
    for (let n = 2; n <= 99; n++)
      await app.svc.accounts.create(
        { code: `9800${String(n).padStart(2, '0')}`, name: `合成占位${n}` },
        scheme,
      );
    await expect(api.previewVoucher(input)).rejects.toThrow(/编码空间已满/);
    await app.svc.db
      .updateTable('book_info')
      .set({ code_scheme: '4' })
      .where('id', '=', 1)
      .execute();
    await expect(api.previewVoucher(input)).rejects.toThrow(/编码末级/);
  });
  it('编码占用和科目改名使预览过期，旧预览不能新增科目', async () => {
    const { api, input } = await setup(),
      plan = await api.previewVoucher(input);
    await app.svc.accounts.create(
      { code: '980002', name: '合成并发科目' },
      (await app.svc.book.info()).codeScheme,
    );
    await expect(api.generate(request(input, plan.fingerprint))).rejects.toThrow(/旧预览/);
    expect(await app.svc.accounts.getByCode('980003')).toBeNull();
    const next = await api.previewVoucher(input);
    expect(next.newAccounts[0]!.code).toBe('980003');
    await app.svc.db
      .updateTable('account')
      .set({ name: '合成已改名' })
      .where('code', '=', '980001')
      .execute();
    await expect(api.generate(request(input, next.fingerprint))).rejects.toThrow(/旧预览/);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });
  it('制证中途失败回滚新增科目、全部凭证、来源和日志；已有科目与期初不变', async () => {
    const { api, input } = await setup('input', 'individual'),
      plan = await api.previewVoucher(input);
    const accounts = await app.svc.accounts.list(),
      openings = await app.svc.opening.list(2026),
      logs = await app.svc.log.list();
    await sql`CREATE TRIGGER invoice_partner_failure BEFORE INSERT ON invoice_group WHEN (SELECT count(*) FROM invoice_group)>=1 BEGIN SELECT RAISE(ABORT,'synthetic partner transaction failure'); END`.execute(
      app.svc.db,
    );
    await expect(api.generate(request(input, plan.fingerprint))).rejects.toThrow(
      /synthetic partner transaction failure/,
    );
    expect(await app.svc.accounts.list()).toEqual(accounts);
    expect(await app.svc.opening.list(2026)).toEqual(openings);
    expect(await app.svc.log.list()).toEqual(logs);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    expect((await api.list({})).every((d) => d.state === 'audited' && d.groupId === null)).toBe(
      true,
    );
    const db = app.svc.db.withTables<InvoiceTables>();
    expect(await db.selectFrom('invoice_run').selectAll().execute()).toEqual([]);
    expect(await db.selectFrom('invoice_group').selectAll().execute()).toEqual([]);
  });
});
