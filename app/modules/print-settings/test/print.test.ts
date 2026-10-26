import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { BusinessError } from '@caiwu/core';
import { sql } from '@caiwu/db';
import { buildLedgerView, buildVoucherView, defaultLayout } from '@caiwu/print';
import server from '../server';
import { defaultSettings, LayoutSchema, TemplateSchema } from '../shared';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());
const selection = { from: 202601, to: 202601 };
const format = {
  code: 1,
  name: '凭证签章',
  rows: 3,
  cols: 2,
  rowHeight: 8,
  colWidth: 40,
  cells: [{ row: 1, col: 1, text: '单位', align: 'left' as const }],
};
async function seed() {
  return seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      attachments: 3,
      status: 'posted',
      lines: [
        { account: '1001', debit: 12345, summary: '实际现金收入' },
        { account: '6603', credit: 12345, summary: '实际现金收入' },
      ],
    },
  ]);
}
describe('当前账套打印服务', () => {
  it('w_pz_prn_1 真实字段、附件、制单审核和整数分，预览不改变凭证', async () => {
    const [v] = await seed(),
      api = app.call(server);
    const before = await app.svc.vouchers.get(v!.id);
    const m = await api.vouchers({ ...selection, voucherId: v!.id });
    expect(m.vouchers[0]).toMatchObject({
      id: v!.id,
      debitTotal: 12345,
      attachments: 3,
      createdBy: { name: v!.createdBy.name },
    });
    expect(m.vouchers[0]!.lines[0]!.accountCode).toBe('1001');
    const html = buildVoucherView(m, defaultLayout).pages[0]!.html;
    expect(html).toContain('123.45');
    expect(html).toContain('实际现金收入');
    expect(await app.svc.vouchers.get(v!.id)).toEqual(before);
  });
  it('w_pz_prn_1 辅助项目取真实档案名称，汇率数量用字符串', async () => {
    const [v] = await seedVouchers(
      app.svc,
      [
        {
          date: '2026-01-06',
          lines: [
            { account: '6602', debit: 710, dims: { department: '01' } },
            { account: '1002.01', credit: 710 },
          ],
        },
      ].map((x) => ({
        ...x,
        lines: x.lines.map((l) => ({
          ...l,
          account: l.account === '1002.01' ? '100201' : l.account,
        })),
      })),
    );
    const m = await app.call(server).vouchers({ ...selection, voucherId: v!.id });
    expect(m.vouchers[0]!.auxiliary[0]).toContain('行政部');
  });
  it('w_pz_prn_2 / w_pz_prn_3 拒绝未查询、重复 ID、反向范围', async () => {
    const api = app.call(server);
    await expect(api.vouchers({ ...selection, order: 'queried' })).rejects.toThrow('先查询');
    await expect(api.vouchers({ ...selection, order: 'queried', ids: [1, 1] })).rejects.toThrow(
      '不能重复',
    );
    await expect(api.vouchers({ from: 202602, to: 202601 })).rejects.toThrow('开始期间');
  });
  it('w_pz_prn_2 已查询集合保持明确顺序，普通范围按期间类型编号稳定排序', async () => {
    const [a] = await seed(),
      [b] = await seed();
    const api = app.call(server);
    expect(
      (await api.vouchers({ ...selection, order: 'queried', ids: [b!.id, a!.id] })).vouchers.map(
        (v) => v.id,
      ),
    ).toEqual([b!.id, a!.id]);
    expect((await api.vouchers(selection)).vouchers.map((v) => v.id)).toEqual([a!.id, b!.id]);
    expect(
      (await api.vouchers({ ...selection, numberFrom: 2, numberTo: 2 })).vouchers.map((v) => v.id),
    ).toEqual([b!.id]);
  });
  it('w_print / w_preview / w_print_root 空记录不可打印，无内容不会假成功', async () => {
    await expect(app.call(server).vouchers(selection)).rejects.toThrow('无记录');
    await expect(
      app.call(server).ledger({ ...selection, account: '1001', kind: 'detail' }),
    ).rejects.toThrow('无记录');
  });
  it('w_print_zc 真实期初、本期、累计和日记账对方科目', async () => {
    await seed();
    const api = app.call(server),
      model = await api.ledger({ ...selection, account: '1001', kind: 'cash' });
    expect(model).toMatchObject({ opening: 0, debit: 12345, credit: 0, ytdDebit: 12345 });
    expect(model.rows[0]).toMatchObject({ debit: 12345, balance: 12345 });
    expect(model.rows[0]!.counterpart).toContain('6603');
    expect(buildLedgerView(model, defaultLayout).pages[0]!.html).toContain('对方科目');
    const general = await api.ledger({ ...selection, account: '1001', kind: 'general' });
    expect(general.rows[0]!.summary).toBe('本月发生额');
    await expect(api.ledger({ ...selection, account: '1001', kind: 'bank' })).rejects.toThrow(
      '银行科目',
    );
  });
  it('w_print_zc 空科目、无发生按明确选项，零余额需要两个开关', async () => {
    const api = app.call(server);
    await expect(
      api.ledger({ ...selection, account: '1001', kind: 'detail', printNoActivity: true }),
    ).rejects.toThrow('无记录');
    const m = await api.ledger({
      ...selection,
      account: '1001',
      kind: 'detail',
      printNoActivity: true,
      printEmpty: true,
    });
    expect(m.rows[0]!.summary).toBe('本期无发生');
  });
  it('w_xt_tz_zc 保存立即生效、模块作用域隔离，恢复默认后可保存', async () => {
    const api = app.call(server);
    const s = structuredClone(defaultSettings);
    s.voucher.perPage = 2;
    s.voucher.supervisor = '主管甲';
    s.ledger.rows = 5;
    s.ledger.startPage = 10;
    await api.saveSettings(s);
    expect(await api.settings()).toEqual(s);
    expect(await app.svc.settings.get('layouts', null)).toBeNull();
    expect((await app.svc.log.list())[0]!.summary).not.toContain('实际现金');
    await api.saveSettings(defaultSettings);
    expect(await api.settings()).toEqual(defaultSettings);
  });
  it.each([
    { rows: 0 },
    { startPage: 0 },
    { offsetY: 99 },
    { copies: 100 },
    { scale: 0 },
    { widthMm: -1 },
  ])('w_xt_tz_zc / w_print_zc_pg 拒绝边界 %j', (patch) =>
    expect(LayoutSchema.safeParse({ ...defaultSettings.voucher, ...patch }).success).toBe(false),
  );
  it('打印和 PDF 动作权限不能通过直接 API 绕过', async () => {
    const [v] = await seed();
    const token = await app.addUser('viewer', { permissions: ['print-settings.view'] });
    const api = app.call(server, token);
    await expect(api.vouchers({ ...selection, voucherId: v!.id })).rejects.toThrow('权限');
    await expect(api.ledger({ ...selection, account: '1001', kind: 'detail' })).rejects.toThrow(
      '权限',
    );
    await expect(api.saveSettings(defaultSettings)).rejects.toThrow('权限');
    await expect(api.saveFormat({ data: format })).rejects.toThrow('权限');
    await expect(api.recordOutput({ kind: 'voucher', action: 'pdf', pages: 1 })).rejects.toThrow(
      '权限',
    );
    const p = await app.addUser('printer', {
      permissions: ['print-settings.view', 'print-settings.voucher.print'],
    });
    await expect(
      app.call(server, p).recordOutput({ kind: 'voucher', action: 'pdf', pages: 1 }),
    ).rejects.toThrow('权限');
    await app.call(server, p).recordOutput({ kind: 'voucher', action: 'print', pages: 1 });
  });
  it('跨账套相同 ID 只返回会话账套的实体、模板和设置', async () => {
    await seed();
    await app.call(server).saveFormat({ data: format });
    const s = structuredClone(defaultSettings);
    s.voucher.unitName = '私有单位甲';
    await app.call(server).saveSettings(s);
    const other = await createTestApp({ modules: [server] });
    try {
      const [v] = await seedVouchers(other.svc, [
        {
          date: '2026-01-05',
          summary: '账套乙',
          lines: [
            { account: '1001', debit: 987 },
            { account: '6603', credit: 987 },
          ],
        },
      ]);
      const api = other.call(server);
      expect(v!.id).toBe(1);
      expect((await api.vouchers({ ...selection, voucherId: 1 })).vouchers[0]!.debitTotal).toBe(
        987,
      );
      expect(await api.formats()).toEqual([]);
      expect((await api.settings()).voucher.unitName).toBe('');
      await expect(api.copyFormat({ source: 1, code: 2, name: '不可复制' })).rejects.toThrow(
        '格式数据缺失',
      );
    } finally {
      await other.close();
    }
  });
});
describe('特殊格式原版规则', () => {
  it.each([
    { code: 100 },
    { code: -1 },
    { name: '' },
    { rows: 0 },
    { cols: 0 },
    { rows: 1000 },
    { cols: 251 },
    { cells: [] },
    { cells: [{ row: 1, col: 1, field: 'eval', align: 'left' }] },
  ])('w_bb_add_gs 拒绝编码/名称/行列/缺失或危险字段 %j', (patch) =>
    expect(TemplateSchema.safeParse({ ...format, ...patch }).success).toBe(false),
  );
  it('w_bb_add_gs / w_bb_copy_gs 编码重复阻止，边界 99/999/250 可保存', async () => {
    const api = app.call(server);
    await api.saveFormat({ data: format });
    await expect(api.saveFormat({ data: format })).rejects.toThrow('编码重复');
    await expect(api.copyFormat({ source: 1, code: 1, name: '复制' })).rejects.toThrow('编码重复');
    await api.saveFormat({ data: { ...format, code: 99, rows: 999, cols: 250 } });
    expect(await api.formats()).toHaveLength(2);
  });
  it('w_bb_copy_gs 未选来源、来源不存在不创建空格式；同账套复制定义', async () => {
    const api = app.call(server);
    await expect(api.copyFormat({ source: 2, code: 3, name: '副本' })).rejects.toThrow(
      '格式数据缺失',
    );
    await api.saveFormat({ data: format });
    await api.copyFormat({ source: 1, code: 2, name: '副本' });
    expect((await api.formats())[1]).toMatchObject({ code: 2, name: '副本', cells: format.cells });
  });
  it('w_bb_def_gs 修改/改名并校验版本，丢失格式不能创建空定义', async () => {
    const api = app.call(server);
    await api.saveFormat({ data: format });
    await api.saveFormat({ data: { ...format, name: '新名称' }, revision: 1 });
    expect((await api.formats())[0]).toMatchObject({ name: '新名称', revision: 2 });
    await expect(api.saveFormat({ data: format, revision: 1 })).rejects.toThrow('已被修改');
    await expect(api.saveFormat({ data: { ...format, code: 3 }, revision: 1 })).rejects.toThrow(
      '删除',
    );
  });
  it('w_bb_main_gs 删除必须确认；删除成功后列表立即更新', async () => {
    const api = app.call(server);
    await api.saveFormat({ data: format });
    await expect(api.removeFormat({ code: 1, confirmed: false })).rejects.toThrow('需要确认');
    expect(await api.formats()).toHaveLength(1);
    await api.removeFormat({ code: 1, confirmed: true });
    expect(await api.formats()).toEqual([]);
  });
  it('w_bb_def_gs 数据读错返回可操作的原因，不创建空格式', async () => {
    await app.svc.db
      .withTables<{
        print_settings_format: { code: number; name: string; definition: string; revision: number };
      }>()
      .insertInto('print_settings_format')
      .values({ code: 1, name: '坏格式', definition: 'not json', revision: 1 })
      .execute();
    const e = await app
      .call(server)
      .formats()
      .catch((e) => e);
    expect(e.cause).toBeInstanceOf(BusinessError);
    expect(e.cause.data.message).toContain('格式数据');
  });
});

it('w_print_2_zw 显式多科目顺序读取、没有外部账套选择参数', async () => {
  await seed();
  const models = await app
    .call(server)
    .ledgerBook({ ...selection, account: '1001,6603', kind: 'detail' });
  expect(models.map((x) => x.account.split(' ')[0])).toEqual(['1001', '6603']);
  expect(models[0]!.debit).toBe(12345);
  expect(models[1]!.credit).toBe(12345);
});
it('w_pz_prn_1 实际外币汇率和数量保持 Decimal 字符串', async () => {
  const [v] = await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: 710 },
        { account: '100202', credit: 710, currency: 'USD', rate: '7.1', fcAmount: 100 },
      ],
    },
  ]);
  const model = await app.call(server).vouchers({ ...selection, voucherId: v!.id });
  expect(model.vouchers[0]!.lines[1]!.exchangeRate).toBe('7.1');
  expect(
    buildVoucherView(model, defaultLayout)
      .pages.map((x) => x.html)
      .join(''),
  ).toContain('汇率 7.1');
});

it('w_print_2_zw 全部/一级/明细筛选，跳过无发生科目并保持编码顺序', async () => {
  await seed();
  const api = app.call(server);
  const all = await api.ledgerBatch({
    ...selection,
    account: '',
    kind: 'detail',
    accountScope: 'all',
  });
  expect(all.models.map((x) => x.account.split(' ')[0])).toEqual(['1001', '6603']);
  expect(all.skipped).toContain('1002');
  const first = await api.ledgerBatch({
    ...selection,
    account: '1001',
    kind: 'detail',
    accountScope: 'first',
    printNoActivity: true,
    printEmpty: true,
  });
  const leaf = await api.ledgerBatch({
    ...selection,
    account: '1001',
    kind: 'detail',
    accountScope: 'leaf',
    printNoActivity: true,
    printEmpty: true,
  });
  expect(first.models.some((m) => m.account.startsWith('1002 '))).toBe(true);
  expect(first.models.some((m) => m.account.startsWith('100201 '))).toBe(false);
  expect(leaf.models.some((m) => m.account.startsWith('1002 '))).toBe(false);
  expect(leaf.models.some((m) => m.account.startsWith('100201 '))).toBe(true);
  const cash = await api.ledgerBatch({
    ...selection,
    account: '1001',
    kind: 'cash',
    accountScope: 'all',
  });
  expect(cash.models.every((m) => m.account.startsWith('1001 '))).toBe(true);
  await expect(
    api.ledgerBatch({ ...selection, account: 'missing,1001', kind: 'detail' }),
  ).rejects.toThrow('不存在');
  await expect(
    api.ledgerBatch({ ...selection, account: '100201', kind: 'detail' }),
  ).rejects.toThrow('均无符合条件');
});

it('w_print_2_zw 有累计但期初和余额归零仍打印，不把未过账或作废计入', async () => {
  await seedVouchers(app.svc, [
    {
      date: '2026-01-02',
      status: 'posted',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6603', credit: 12345 },
      ],
    },
    {
      date: '2026-01-03',
      status: 'posted',
      lines: [
        { account: '6603', debit: 12345 },
        { account: '1001', credit: 12345 },
      ],
    },
    {
      date: '2026-02-03',
      lines: [
        { account: '1001', debit: 1 },
        { account: '6603', credit: 1 },
      ],
    },
  ]);
  const api = app.call(server);
  const [voided] = await seedVouchers(app.svc, [
    {
      date: '2026-02-04',
      lines: [
        { account: '1001', debit: 700 },
        { account: '6603', credit: 700 },
      ],
    },
  ]);
  await app.svc.vouchers.setVoided(voided!.id, true);
  const noActivity = { from: 202602, to: 202602, account: '1001', kind: 'detail' as const };
  await expect(api.ledger(noActivity)).rejects.toThrow('无记录');
  const model = await api.ledger({ ...noActivity, printNoActivity: true });
  expect(model).toMatchObject({
    opening: 0,
    debit: 0,
    credit: 0,
    ytdDebit: 12345,
    ytdCredit: 12345,
  });
  expect(model.rows[0]!.summary).toBe('本期无发生');
  const unposted = await api.ledger({ ...noActivity, includeUnposted: true });
  expect(unposted.debit).toBe(1);
});

it('w_print_2_zw 新批次接口和旧账册接口都检查打印权限', async () => {
  const token = await app.addUser('batch-viewer', { permissions: ['print-settings.view'] });
  const api = app.call(server, token);
  await expect(
    api.ledgerBatch({ ...selection, account: '1001', kind: 'detail', accountScope: 'all' }),
  ).rejects.toThrow('权限');
  await expect(api.ledgerBook({ ...selection, account: '1001', kind: 'detail' })).rejects.toThrow(
    '权限',
  );
});

it('w_xt_tz_zc 设置与日志在真实 SQLite 事务中一起回滚', async () => {
  const api = app.call(server);
  const before = await api.settings();
  const logs = await app.svc.log.list();
  await sql`CREATE TRIGGER print_settings_fail_log BEFORE INSERT ON operation_log WHEN NEW.action = 'print.settings' BEGIN SELECT RAISE(ABORT, '模拟日志存储失败'); END`.execute(
    app.svc.db,
  );
  const changed = structuredClone(before);
  changed.voucher.offsetX = 3;
  await expect(api.saveSettings(changed)).rejects.toThrow('模拟日志存储失败');
  expect(await api.settings()).toEqual(before);
  expect(await app.svc.log.list()).toEqual(logs);
});
