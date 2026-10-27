import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TRPCError } from '@trpc/server';
import type { BusinessError } from '@caiwu/core';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { collectAudit, textFile } from '../server/audit';
import { runChecks, voucherIssues } from '../server/checks';

let app: TestApp;
const api = () => app.call(server);
const dates = { from: '2000-01-01', to: '2100-12-31' };
async function error(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(e).not.toBeNull();
  return ((e as TRPCError).cause as BusinessError).data;
}
async function vouchers() {
  return seedVouchers(app.svc, [
    {
      date: '2026-01-10',
      status: 'posted',
      lines: [
        { account: '1001', debit: 12345, summary: '=HYPERLINK("test")' },
        { account: '6001', credit: 12345 },
      ],
    },
    {
      date: '2026-01-11',
      lines: [
        { account: '1001', debit: 500 },
        { account: '6001', credit: 500 },
      ],
    },
  ]);
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('w_xt_dlxx 操作日志', () => {
  it('w_xt_dlxx 日期、用户、模块、操作、目标过滤及分页；详情只返回白名单', async () => {
    const svc = app.svcFor('system-admin');
    await svc.log.write({
      action: 'system-admin.user.permissions',
      summary: '权限更新',
      targetType: 'app_user',
      targetId: 1,
      detail: {
        isAdmin: true,
        preserved: 2,
        password_hash: 'hidden-secret',
        token: 'secret-token',
      },
    });
    for (let i = 0; i < 3; i++)
      await svc.log.write({
        action: 'system-admin.test',
        summary: `记录${i}`,
        targetType: 'voucher',
        targetId: 1,
      });
    const list = await api().logs.list({
      ...dates,
      module: 'system-admin',
      userId: 1,
      action: 'system-admin.',
      target: '1',
      page: 1,
      pageSize: 2,
    });
    expect(list.total).toBe(4);
    expect(list.rows).toHaveLength(2);
    expect(
      (await api().logs.list({ ...dates, module: 'system-admin', action: 'user.permissions' }))
        .rows[0]?.detail,
    ).toBe('管理员：是；保留未加载权限：2 项');
    const serialized = JSON.stringify(
      await api().logs.export({ ...dates, module: 'system-admin' }),
    );
    expect(serialized).not.toContain('hidden-secret');
    expect(serialized).not.toContain('secret-token');
    expect(list.rows[0]?.to).toBe('/m/voucher-entry/edit?id=1');
    expect((await api().logs.list({ ...dates, module: 'not-loaded' })).total).toBe(0);
    await expect(api().logs.list({ from: '2026-02-01', to: '2026-01-01' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
  it('w_xt_dlxx 非管理员有日志权限也只能查看本人非敏感业务日志', async () => {
    const token = await app.addUser('viewer', { permissions: ['system-admin.logs.view'] });
    const u = (await app.svc.users.list()).find((u) => u.code === 'viewer')!;
    const now = new Date().toISOString();
    await app.svc.db
      .insertInto('operation_log')
      .values([
        {
          at: now,
          user_id: u.id,
          user_name: 'viewer',
          module: 'business',
          action: 'business.save',
          target_type: null,
          target_id: null,
          summary: '本人的业务',
          detail: '{"password":"secret"}',
        },
        {
          at: now,
          user_id: u.id,
          user_name: 'viewer',
          module: 'system-admin',
          action: 'system-admin.password.change',
          target_type: null,
          target_id: null,
          summary: '敏感管理日志',
          detail: null,
        },
      ])
      .execute();
    const logs = await app.call(server, token).logs.list(dates);
    expect(logs.rows.map((l) => l.summary)).toEqual(['本人的业务']);
    expect(logs.rows[0]?.detail).toBe('');
    const file = await app.call(server, token).logs.export(dates);
    expect(file.content).not.toContain('敏感管理日志');
    expect(file.content).not.toContain('secret');
  });
  it('w_xt_dlxx 无数据不假报导出成功；无权限拒绝查询和导出', async () => {
    expect((await error(api().logs.export({ ...dates, module: 'none' }))).code).toBe('NO_DATA');
    const token = await app.addUser('viewer');
    expect((await error(app.call(server, token).logs.list(dates))).code).toBe('FORBIDDEN');
    expect((await error(app.call(server, token).logs.export(dates))).code).toBe('FORBIDDEN');
  });
});

describe('w_bf_98001 通用审计资料', () => {
  it('w_bf_98001 真实文件可解析，预览数量、金额与 core 查询一致，字段白名单且公式为文字', async () => {
    const vs = await vouchers();
    const account = await app.svc.accounts.require('1001');
    await app.svc.opening.upsert({ year: 2026, accountId: account.id, balance: 900 });
    const input = {
      year: 2026,
      scopes: ['accounts', 'opening', 'vouchers', 'currencies', 'periods', 'dimensions'] as const,
    };
    const preview = await api().audit.preview({ ...input, scopes: [...input.scopes] });
    const file = await api().audit.export({
      ...input,
      scopes: [...input.scopes],
      digest: preview.digest,
    });
    expect(file.filename).toBe('通用审计资料-2026.json');
    const data = JSON.parse(file.content) as {
      counts: typeof preview.counts;
      lines: { summary: string; debit: number; credit: number }[];
      vouchers: { id: number }[];
      opening: { balance: number }[];
      book: { id: string };
    };
    expect(data.book.id).toBe(app.book.id);
    expect(data.counts).toEqual(preview.counts);
    expect(data.counts.accounts).toBe((await app.svc.accounts.list()).length);
    expect(data.vouchers.map((v) => v.id)).toEqual(vs.map((v) => v.id));
    expect(data.lines).toHaveLength(4);
    expect(data.lines[0]?.summary).toMatch(/^'=/);
    expect(data.lines.reduce((s, l) => s + l.debit, 0)).toBe(12845);
    expect(data.opening[0]?.balance).toBe(900);
    expect(file.content).not.toMatch(/password_hash|scrypt\$|session|startup|\/workspace|\.caiwu/i);
    const coreLines = await app.svc.ledger.entries({
      periodFrom: 202601,
      periodTo: 202612,
      includeUnposted: true,
    });
    expect(data.lines.reduce((s, l) => s + l.debit, 0)).toBe(
      coreLines.reduce((s, l) => s + l.debit, 0),
    );
    expect(file.content).not.toContain('符合');
  });
  it('w_bf_98001 年度早于启用年阻止；无资料不导出，选择范围不静默扩大', async () => {
    expect((await error(api().audit.preview({ year: 2025, scopes: ['vouchers'] }))).code).toBe(
      'AUDIT_BEFORE_START',
    );
    const p = await api().audit.preview({ year: 2026, scopes: ['vouchers'] });
    expect(p.total).toBeGreaterThanOrEqual(1); // 凭证类型也属于凭证资料
    const empty = await api().audit.preview({ year: 2027, scopes: ['opening'] });
    expect(empty.total).toBe(0);
    expect(
      (await error(api().audit.export({ year: 2027, scopes: ['opening'], digest: empty.digest })))
        .code,
    ).toBe('NO_DATA');
    const collected = await collectAudit(app.svc, { year: 2026, scopes: ['opening'] });
    expect(collected.data.accounts).toEqual([]);
    expect(collected.data.vouchers).toEqual([]);
  });
  it('w_bf_98001 数据改变后拒绝过期预览；取消预览不写文件或日志', async () => {
    const input = { year: 2026, scopes: ['vouchers'] as const };
    const p = await api().audit.preview({ ...input, scopes: [...input.scopes] });
    const before = await app.svc.log.list();
    await api().audit.preview({ ...input, scopes: [...input.scopes] });
    expect(await app.svc.log.list()).toEqual(before);
    await vouchers();
    expect(
      (await error(api().audit.export({ ...input, scopes: [...input.scopes], digest: p.digest })))
        .code,
    ).toBe('PREVIEW_CHANGED');
    expect((await app.svc.log.list()).some((l) => l.action === 'system-admin.audit.export')).toBe(
      false,
    );
  });
  it('w_bf_98001 用户输入不可成为公式；生成文件失败不返回成功', () => {
    const file = textFile('safe.json', {
      strings: ['=1+1', '+cmd', '-cmd', '@cmd', '  =1', '普通文本'],
      amount: -123,
    });
    const data = JSON.parse(file.content) as { strings: string[]; amount: number };
    expect(data.strings.slice(0, 5).every((s) => s.startsWith("'"))).toBe(true);
    expect(data.amount).toBe(-123);
    const circular: unknown[] = [];
    circular.push(circular);
    expect(() => textFile('broken.json', circular)).toThrow('生成文件失败');
  });
  it('w_bf_98001 无导出权限的用户不能预览或导出', async () => {
    const token = await app.addUser('viewer');
    expect(
      (await error(app.call(server, token).audit.preview({ year: 2026, scopes: ['vouchers'] })))
        .code,
    ).toBe('FORBIDDEN');
    expect(
      (
        await error(
          app
            .call(server, token)
            .audit.export({ year: 2026, scopes: ['vouchers'], digest: '0'.repeat(64) }),
        )
      ).code,
    ).toBe('FORBIDDEN');
  });
});

describe('w_zh_zhjc 综合检查', () => {
  it('w_zh_zhjc 损坏快照的头行总额、期间、科目及行号异常均被识别，无需 SQL 修改凭证', () => {
    const header = { period: 202601, debit_total: 100, credit_total: 100 };
    const lines = [
      { period: 202602, account_id: 99, line_no: 1, debit: 10, credit: 0 },
      { period: 202601, account_id: 1, line_no: 1, debit: 0, credit: 20 },
    ];
    const issues = voucherIssues(header, lines, new Set([1]));
    expect(issues).toContain('凭证头合计与分录不一致');
    expect(issues).toContain('凭证头与分录期间不一致');
    expect(issues).toContain('分录科目不存在');
    expect(issues).toContain('分录行号重复');
    expect(issues.join('；')).toContain('借贷不平');
    expect(
      voucherIssues(
        header,
        [{ period: 202601, account_id: 1, line_no: 1, debit: 0.5, credit: 0 }],
        new Set([1]),
      ),
    ).toContain('金额不是安全整数分或合计溢出');
  });

  it('w_zh_zhjc 没有凭证/期初为无数据，不误报账套损坏', async () => {
    const checks = await api().checks();
    expect(checks.find((r) => r.category === '凭证')?.status).toBe('无数据');
    expect(checks.find((r) => r.category === '期初试算')?.status).toBe('无数据');
    expect(checks.filter((r) => r.status === '不通过')).toEqual([]);
  });
  it('w_zh_zhjc 科目级次、父级和末级异常定位到具体科目；检查不修改数据', async () => {
    const cash = await app.svc.accounts.require('1001');
    await app.svc.db
      .updateTable('account')
      .set({
        code: '12345',
        level: 3,
        parent_id: (await app.svc.accounts.require('6001')).id,
        is_leaf: 0,
      })
      .where('id', '=', cash.id)
      .execute();
    const before = await app.svc.db.selectFrom('account').selectAll().execute();
    const checks = await api().checks();
    const row = checks.find((r) => r.target.startsWith('12345'))!;
    expect(row.status).toBe('不通过');
    expect(row.message).toMatch(/编码长度/);
    expect(row.message).toMatch(/上级/);
    expect(row.message).toMatch(/末级/);
    expect(await app.svc.db.selectFrom('account').selectAll().execute()).toEqual(before);
  });
  it('w_zh_zhjc 定位期初差额、未审核、未过账、零额行、借贷不等和异常期间', async () => {
    const cash = await app.svc.accounts.require('1001');
    await app.svc.opening.upsert({ year: 2026, accountId: cash.id, balance: 501 });
    const vs = await vouchers();
    const draft = await app.svc.vouchers.create({
      date: '2026-01-12',
      voucherTypeId: 1,
      draft: true,
      lines: [
        { accountId: cash.id, summary: '零行' },
        { accountId: cash.id, summary: '不平', debit: 5 },
      ],
    });
    await app.svc.periods.setStatus(202601, 'closed');
    const checks = await api().checks();
    expect(checks.find((r) => r.category === '期初试算')?.message).toContain('501 分');
    expect(checks.find((r) => r.category === '零额行')?.target).toContain(`ID ${draft.id}`);
    expect(
      checks.find((r) => r.category === '凭证借贷及头行' && r.target.includes(`ID ${draft.id}`))
        ?.message,
    ).toContain('借贷不平');
    expect(
      checks.find((r) => r.category === '未审核/未过账' && r.target.includes(`ID ${vs[1]!.id}`))
        ?.to,
    ).toBe('/m/voucher-book?period=202601&type=1&status=pending');
    expect(checks.some((r) => r.category === '异常期间' && r.status === '不通过')).toBe(true);
    expect(
      checks.find((r) => r.category === '余额与凭证取数' && r.target === '202601')?.status,
    ).toBe('通过');
  });
  it('w_zh_zhjc 断号具体定位，余额取数失败明确无法检查，审核凭证保持不变', async () => {
    const vs = await vouchers();
    {
      const numberPlan = await app.svc.vouchers.previewNumbers([{ id: vs[1]!.id, number: 3 }]);
      await app.svc.vouchers.setNumbers(numberPlan.updates, { plan: numberPlan, confirmed: true });
    }
    const before = await app.svc.vouchers.get(vs[0]!.id);
    const checks = await api().checks();
    expect(checks.find((r) => r.category === '断号')?.message).toBe('缺号 2');
    expect(await app.svc.vouchers.get(vs[0]!.id)).toEqual(before);
    vi.spyOn(app.svc.ledger, 'balances').mockRejectedValue(new Error('synthetic unavailable'));
    expect(
      (await runChecks(app.svc))
        .filter((r) => r.category === '余额与凭证取数')
        .every((r) => r.status === '无法检查'),
    ).toBe(true);
  });
  it('w_zh_zhjc 无检查权限拒绝查询', async () => {
    expect((await error(app.call(server, await app.addUser('viewer')).checks())).code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('w_xt_kgzb / w_zh_zhjc_kzrq 初始化保护', () => {
  it('w_xt_kgzb_0 / _1 真实预检显示账套、模板、期间、计数；取消不改变数据', async () => {
    await vouchers();
    const before = await app.svc.vouchers.list({});
    const preflight = await api().reset.preflight();
    expect(preflight.book.id).toBe(app.book.id);
    expect(preflight.template?.id).toBe('demo-enterprise');
    expect(preflight.counts.voucher).toBe(2);
    expect(preflight.counts.voucher_line).toBe(4);
    expect(preflight.periods).toHaveLength(12);
    expect(preflight.executable).toBe(false);
    expect(await app.svc.vouchers.list({})).toEqual(before);
  });
  it('w_xt_kgzb / _2 / _3 缺独占锁和完整备份服务时禁用执行，不能绕过凭证审核/过账锁', async () => {
    const vs = await vouchers();
    const before = await app.svc.vouchers.get(vs[0]!.id);
    expect(
      (await error(api().reset.execute({ confirmBookName: app.book.name, confirmed: true }))).code,
    ).toBe('RESET_UNAVAILABLE');
    expect(
      (await error(api().reset.execute({ confirmBookName: 'wrong', confirmed: false }))).code,
    ).toBe('RESET_UNAVAILABLE');
    expect((await error(api().reset.adjustStartDate())).code).toBe('RESET_UNAVAILABLE');
    expect(await app.svc.vouchers.get(vs[0]!.id)).toEqual(before);
    expect((await api().reset.preflight()).reason).toContain('尚未备份或更改数据');
  });
  it('w_xt_kgzb 管理员资格与专用权限均检查，非管理员不能执行或预检', async () => {
    const token = await app.addUser('viewer', { permissions: ['system-admin.reset'] });
    expect((await error(app.call(server, token).reset.preflight())).code).toBe('FORBIDDEN');
    expect(
      (
        await error(
          app
            .call(server, token)
            .reset.execute({ confirmBookName: app.book.name, confirmed: true }),
        )
      ).code,
    ).toBe('FORBIDDEN');
  });
});
