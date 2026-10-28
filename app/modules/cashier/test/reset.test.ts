import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@caiwu/db';
import { createCoreServices } from '@caiwu/core/server';
import { defineServerModule } from '@caiwu/server-kit';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import cashierServer from '../server';
import { resetService, type ResetProtection } from '../server/reset';
import type { CashierTables } from '../server/migrations';

let app: TestApp;
let accountId: number;
let oppositeId: number;
let cashflow: number;
const guardedCashier = defineServerModule(cashierServer.manifest, {
  ...cashierServer,
  providers: {
    periodDependencies: [
      async (ctx, check) => {
        if (check.mode !== 'business' || ctx.moduleId !== 'cashier') return [];
        const closed = await ctx.db
          .withTables<CashierTables>()
          .selectFrom('cashier_period')
          .select('period')
          .where('period', '=', check.period)
          .where('closed', '=', 1)
          .execute();
        const extra = await ctx.db
          .selectFrom('book_setting')
          .select('value')
          .where('scope', '=', 'cashier')
          .where('key', '=', 'test.resetGuardBlock')
          .executeTakeFirst();
        return [
          { category: '出纳已结账月份', count: closed.length },
          { category: '合成其他业务依赖', count: extra?.value === 'true' ? 1 : 0 },
        ];
      },
    ],
  },
});
const api = () => app.call(cashierServer);
const service = (protect?: ResetProtection) => resetService(app.svcFor('cashier'), protect);
const documentInput = () => ({
  accountId,
  period: 202601,
  date: '2026-01-10',
  summary: '初始化测试收款',
  direction: 'receipt' as const,
  amount: 1234,
  oppositeAccountId: oppositeId,
  dimensions: { cashflow },
  requestKey: randomUUID(),
});
const input = async () => ({
  period: 202602,
  snapshot: (await service().preview()).snapshot,
  bookName: app.book.name,
  confirmation: '清空出纳数据' as const,
  confirmed: true as const,
  requestKey: randomUUID(),
});
const protectedBackup = () =>
  vi.fn<ResetProtection>().mockResolvedValue({
    id: randomUUID(),
    status: 'valid',
    sha256: 'a'.repeat(64),
  });

beforeEach(async () => {
  app = await createTestApp({ modules: [guardedCashier] });
  await api().enable({ period: 202601 });
  const bank = (await app.svc.accounts.require('100201')).id;
  oppositeId = (await app.svc.accounts.require('6603')).id;
  cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  accountId = (
    await api().saveAccount({
      data: { name: '工商银行', coreAccountId: bank, currency: 'CNY', opening: 100000 },
    })
  ).id;
  await api().createDocument(documentInput());
});
afterEach(async () => app.close());

describe('w_cn_xtcsh 保护备份后重新初始化', () => {
  it('预览真实范围；备份成功才清空出纳，保留总账、科目和日志，并建立新的启用期间', async () => {
    const bank = (await app.svc.accounts.require('100201')).id;
    await app.svc.opening.upsert({ year: 2026, accountId: bank, balance: 100000 });
    const [manual] = await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '100201', debit: 1234, dims: { cashflow: 'CF01' } },
          { account: '6603', credit: 1234 },
        ],
      },
    ]);
    const r = await api().reconcile({ accountId, cutoff: '2026-01-31' });
    await api().match({
      accountId,
      cutoff: r.cutoff,
      documents: r.documents.map((d) => ({ id: d.id, revision: d.revision })),
      lineIds: r.entries.map((l) => l.lineId),
      snapshot: r.snapshot,
      confirmed: true,
    });
    await api().receiveCheck({ accountId, number: 'RESET-001', receivedDate: '2026-01-11' });
    const p = await api().periods();
    await api().closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true });
    await app.svcFor('cashier').settings.set(`import:${randomUUID()}`, { ids: [1] });
    const preview = await service().preview();
    expect(preview).toMatchObject({
      bookName: app.book.name,
      enabledPeriod: 202601,
      accounts: 1,
      openings: 1,
      documents: 1,
      checks: 1,
      matches: 1,
      closedPeriods: 1,
      vouchers: 0,
      blocked: false,
    });
    const protect = protectedBackup().mockImplementationOnce(async (request) => {
      expect(request).toMatchObject({ bookId: app.book.id, reason: 'cashier.reset' });
      expect(await api().documents({})).toHaveLength(1);
      expect(await api().checks({})).toHaveLength(1);
      expect(
        await app.svc.db
          .withTables<CashierTables>()
          .selectFrom('cashier_period')
          .select('closed')
          .where('period', '=', 202601)
          .executeTakeFirst(),
      ).toEqual({ closed: 1 });
      return { id: '完整保护备份', status: 'valid', sha256: 'b'.repeat(64) };
    });
    const request = { ...(await input()), snapshot: preview.snapshot };
    const result = await service(protect).reset(request);
    expect(result).toMatchObject({ period: 202602, backupId: '完整保护备份' });
    expect(protect).toHaveBeenCalledOnce();
    expect(await api().status()).toEqual({ period: 202602 });
    expect(await api().accounts({})).toEqual([]);
    expect(await api().documents({})).toEqual([]);
    expect(await api().checks({})).toEqual([]);
    expect(await app.svc.vouchers.get(manual!.id)).toEqual(manual);
    expect(await app.svc.opening.list(2026)).toContainEqual(
      expect.objectContaining({ accountId: bank, balance: 100000 }),
    );
    expect((await app.svc.log.list()).some((log) => log.action === 'cashier.reset')).toBe(true);
    expect(
      await app.svc.db
        .selectFrom('book_setting')
        .select('key')
        .where('scope', '=', 'cashier')
        .where('key', 'like', 'import:%')
        .execute(),
    ).toEqual([]);
    expect(await service(protect).reset(request)).toEqual(result);
    expect(protect).toHaveBeenCalledOnce();
  });

  it('备份失败、未校验成功或缺少保护能力时原数据完整保留', async () => {
    const before = await api().documents({});
    const request = await input();
    await expect(service().reset(request)).rejects.toThrow('保护备份暂不可用');
    const failed = protectedBackup().mockRejectedValueOnce(new Error('合成备份失败'));
    await expect(service(failed).reset(request)).rejects.toThrow('完整保护备份失败');
    const invalid = protectedBackup().mockResolvedValueOnce({
      id: '尚未成功',
      status: 'valid',
      sha256: '',
    });
    await expect(service(invalid).reset(request)).rejects.toThrow('未通过完整校验');
    expect(await api().documents({})).toEqual(before);
    expect(await api().accounts({})).toHaveLength(1);
  });

  it('自有闭月允许重置，总账闭月或其他依赖阻止时闭月标志、单据和账户全部保留', async () => {
    const p = await api().periods();
    await api().closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true });
    const db = app.svc.db.withTables<CashierTables>();
    const before = await db.selectFrom('cashier_period').selectAll().execute();
    const protect = protectedBackup();
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(service(protect).reset(await input())).rejects.toThrow('已经结账');
    expect(await db.selectFrom('cashier_period').selectAll().execute()).toEqual(before);
    await app.svc.periods.setStatus(202601, 'open');
    await app.svcFor('cashier').settings.set('test.resetGuardBlock', true);
    await expect(service(protect).reset(await input())).rejects.toThrow('合成其他业务依赖');
    expect(await db.selectFrom('cashier_period').selectAll().execute()).toEqual(before);
    expect(await api().documents({})).toHaveLength(1);
    expect(await api().accounts({})).toHaveLength(1);
    expect(protect).not.toHaveBeenCalled();
    await app.svcFor('cashier').settings.set('test.resetGuardBlock', false);
    await service(protect).reset(await input());
    expect(await db.selectFrom('cashier_period').selectAll().execute()).toEqual([]);
    expect(await api().documents({})).toEqual([]);
  });

  it('备份后其他依赖重新阻止时最终事务回滚临时解除的全部自有闭月标志', async () => {
    const p = await api().periods();
    await api().closePeriod({ period: p.current, snapshot: p.snapshot, confirmed: true });
    const db = app.svc.db.withTables<CashierTables>();
    const before = await db.selectFrom('cashier_period').selectAll().execute();
    const svc = app.svcFor('cashier');
    let afterBackup = false;
    const withExternalDependency = createCoreServices({
      ...svc.ctx,
      providers: {
        ...svc.ctx.providers,
        periodDependencies: [
          ...(svc.ctx.providers?.periodDependencies ?? []),
          async () => [{ category: '合成备份后新依赖', count: afterBackup ? 1 : 0 }],
        ],
      },
    });
    const protect = protectedBackup().mockImplementationOnce(async () => {
      afterBackup = true;
      return { id: '保留原闭月保护', status: 'valid', sha256: 'f'.repeat(64) };
    });
    await expect(
      resetService(withExternalDependency, protect).reset(await input()),
    ).rejects.toThrow('合成备份后新依赖');
    expect(protect).toHaveBeenCalledOnce();
    expect(await db.selectFrom('cashier_period').selectAll().execute()).toEqual(before);
    expect(await api().documents({})).toHaveLength(1);
    expect(await api().accounts({})).toHaveLength(1);
  });

  it('备份等待期间新增业务或状态变化时拒绝旧预览，保留新增业务和原数据', async () => {
    const protect = protectedBackup().mockImplementationOnce(async () => {
      await api().createDocument({ ...documentInput(), summary: '备份期间新增' });
      return { id: '旧快照保护', status: 'valid', sha256: 'c'.repeat(64) };
    });
    await expect(service(protect).reset(await input())).rejects.toThrow('已变化');
    expect(await api().documents({})).toHaveLength(2);
    expect(await api().accounts({})).toHaveLength(1);
  });

  it('备份等待期间管理员被停用时重新校验身份，不执行清空', async () => {
    const request = await input();
    const protect = protectedBackup().mockImplementationOnce(async () => {
      await app.svc.db.updateTable('app_user').set({ disabled: 1 }).where('id', '=', 1).execute();
      return { id: '停用前保护', status: 'valid', sha256: 'd'.repeat(64) };
    });
    await expect(service(protect).reset(request)).rejects.toThrow('已停用或不再是账套管理员');
    expect(
      await app.svc.db
        .withTables<CashierTables>()
        .selectFrom('cashier_document')
        .selectAll()
        .execute(),
    ).toHaveLength(1);
    await app.svc.db.updateTable('app_user').set({ disabled: 0 }).where('id', '=', 1).execute();
    expect(await api().accounts({})).toHaveLength(1);
  });

  it('清空后续写入失败时所有删除回滚，保护备份仍可保留并用于重试', async () => {
    const before = await api().documents({});
    const request = await input();
    await sql`CREATE TRIGGER cashier_reset_failure BEFORE DELETE ON cashier_account BEGIN SELECT RAISE(ABORT, '合成初始化写入失败'); END`.execute(
      app.svc.db,
    );
    const protect = protectedBackup();
    await expect(service(protect).reset(request)).rejects.toThrow('合成初始化写入失败');
    expect(await api().documents({})).toEqual(before);
    expect(await api().accounts({})).toHaveLength(1);
    expect(await api().status()).toEqual({ period: 202601 });
    await sql`DROP TRIGGER cashier_reset_failure`.execute(app.svc.db);
    await service(protect).reset(request);
    expect(await api().documents({})).toEqual([]);
  });

  it('已有出纳来源凭证（含缺映射的来源）时不调用备份也不清空', async () => {
    const docs = await api().documents({});
    await api().generate({
      documents: docs.map((d) => ({ id: d.id, revision: d.revision })),
      date: '2026-01-10',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      mode: 'individual',
      requestKey: randomUUID(),
    });
    await app.svc.db.withTables<CashierTables>().deleteFrom('cashier_batch_document').execute();
    expect(await service().preview()).toMatchObject({ vouchers: 1, blocked: true });
    const protect = protectedBackup();
    await expect(service(protect).reset(await input())).rejects.toThrow('仍有关联凭证');
    expect(protect).not.toHaveBeenCalled();
    expect(await api().documents({})).toHaveLength(1);
    expect((await app.svc.vouchers.list({})).total).toBe(1);
  });

  it('当前账套管理员、强确认、准确账套名称、服务端期间与快照均不可绕过', async () => {
    const viewer = createCoreServices({
      ...app.svc.ctx,
      moduleId: 'cashier',
      user: { ...app.svc.user, isAdmin: false, permissions: new Set(['cashier.reset']) },
    });
    await expect(resetService(viewer).preview()).rejects.toThrow('管理员');
    const denied = createCoreServices({
      ...viewer.ctx,
      user: { ...viewer.user, permissions: new Set() },
    });
    await expect(resetService(denied).preview()).rejects.toThrow('权限');
    const request = await input();
    const protect = protectedBackup();
    await expect(
      service(protect).reset({ ...request, confirmed: false as true }),
    ).rejects.toThrow();
    await expect(service(protect).reset({ ...request, bookName: '其他账套' })).rejects.toThrow(
      '账套名称',
    );
    await expect(service(protect).reset({ ...request, period: 202512 })).rejects.toThrow(
      '启用期间',
    );
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(service(protect).reset(request)).rejects.toThrow('已变化');
    await expect(service(protect).reset(await input())).rejects.toThrow('已经结账');
    expect(protect).not.toHaveBeenCalled();
    expect(await api().documents({})).toHaveLength(1);
  });

  it('重放请求只返回原收据，改变请求内容和旧快照均不能再次清空新数据', async () => {
    const protect = protectedBackup();
    const request = await input();
    await service(protect).reset(request);
    await expect(service(protect).reset({ ...request, period: 202603 })).rejects.toThrow(
      '已用于其他内容',
    );
    await expect(service(protect).reset({ ...request, requestKey: randomUUID() })).rejects.toThrow(
      '已变化',
    );
    expect(protect).toHaveBeenCalledOnce();
  });
});
