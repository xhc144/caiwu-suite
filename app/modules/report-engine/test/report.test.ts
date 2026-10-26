import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { Report } from '../shared';
import { balanceFormula, emptyTemplate, ReportTemplateSchema } from '../shared';
import reportServer from '../server';
import example from '../templates/example.json';
import { workbookBase64 } from '../server/export';
import ExcelJS from 'exceljs';

let app: TestApp;
const caller = () => app.call(reportServer);
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer] });
});
afterEach(async () => {
  await app.close();
});
const formula = (
  metric: 'closing' | 'opening' | 'debit' | 'credit' | 'ytdDebit' | 'ytdCredit' = 'closing',
  account = '1001',
) =>
  balanceFormula({
    account,
    metric,
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: 'none',
    item: '',
  });
async function create(
  source = formula(),
  unit: 'cents' | 'number' | 'quantity' | 'foreignCents' = 'cents',
  code = '101',
) {
  const t = emptyTemplate({ code, name: '测试报表', rows: 6, cols: 5 });
  t.cells = [
    {
      address: 'A1',
      kind: 'formula',
      source,
      unit,
      currency: unit === 'foreignCents' ? 'USD' : 'CNY',
    },
  ];
  return caller().importTemplate(t);
}
const generate = (
  r: Report,
  opts: {
    period?: number;
    includeUnposted?: boolean;
    confirmUnposted?: boolean;
    requestId?: string;
  } = {},
) =>
  caller().generate({
    id: r.id,
    expectedRevision: r.revision,
    period: 202601,
    requestId: randomUUID(),
    ...opts,
  });
async function generated(r: Report, opts: Parameters<typeof generate>[1] = {}) {
  const out = await generate(r, opts);
  if (out.kind !== 'generated') throw new Error('意外的未过账确认');
  return out.snapshot;
}
async function seedCash(
  amount = 12345,
  status: 'posted' | 'pending' = 'posted',
  date = '2026-01-05',
) {
  return seedVouchers(app.svc, [
    {
      date,
      status,
      lines: [
        { account: '1001', debit: amount, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: amount },
      ],
    },
  ]);
}
describe('w_bb_main / w_bb_add / w_bb_copy / w_bb_main_bhxg', () => {
  it.each([
    { code: '1000' },
    { code: 'a' },
    { name: '' },
    { name: '   ' },
    { rows: 0 },
    { cols: 0 },
    { rows: 1000 },
    { cols: 251 },
  ])('w_bb_add 拒绝无效编码/空名/行列边界 %j', async (patch) => {
    await expect(
      caller().create({ code: '101', name: '测试', rows: 2, cols: 2, ...patch }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await caller().list({})).toHaveLength(0);
  });
  it('w_bb_add 数字编码规范化唯一；小于100的自定义表可编辑', async () => {
    const r = await caller().create({ code: '001', name: '低编号', rows: 1, cols: 250 });
    expect(r.template.code).toBe('1');
    await expect(caller().create({ code: '1', name: '重复', rows: 999, cols: 1 })).rejects.toThrow(
      /已存在/,
    );
    const saved = await caller().save({
      id: r.id,
      expectedRevision: r.revision,
      template: { ...r.template, code: '2' },
    });
    expect((await caller().get({ id: r.id })).template.code).toBe('2');
    expect(saved.revision).toBe(2);
  });
  it('w_bb_copy 缺源/重复拒绝；只读模板不能改删，可复制为可编辑版本', async () => {
    await expect(caller().copy({ sourceId: 999, code: '102', name: '副本' })).rejects.toThrow(
      /不存在/,
    );
    const r = await caller().importTemplate(ReportTemplateSchema.parse(example));
    await expect(
      caller().save({ id: r.id, expectedRevision: 1, template: { ...r.template, name: '改' } }),
    ).rejects.toThrow(/只读/);
    await expect(
      caller().remove({ id: r.id, expectedRevision: 1, confirmed: true }),
    ).rejects.toThrow(/只读/);
    await expect(
      caller().copy({ sourceId: r.id, code: r.template.code, name: '副本' }),
    ).rejects.toThrow(/已存在/);
    const copy = await caller().copy({ sourceId: r.id, code: '102', name: '副本' });
    expect(copy.template.readOnly).toBe(false);
    expect(copy.template.cells).toEqual(r.template.cells);
  });
  it('w_bb_main 删除需确认；w_bb_main_bhxg 编码重复和过期版本不能覆盖', async () => {
    const a = await create(),
      b = await create('2', 'number', '102');
    await expect(
      caller().remove({ id: a.id, expectedRevision: 1, confirmed: false }),
    ).rejects.toThrow(/确认/);
    await expect(
      caller().save({
        id: a.id,
        expectedRevision: 1,
        template: { ...a.template, code: b.template.code },
      }),
    ).rejects.toThrow(/重复/);
    const edited = await caller().save({
      id: a.id,
      expectedRevision: 1,
      template: { ...a.template, name: '新版本' },
    });
    await expect(
      caller().save({ id: a.id, expectedRevision: 1, template: a.template }),
    ).rejects.toThrow(/不能覆盖/);
    await expect(
      caller().remove({ id: a.id, expectedRevision: 1, confirmed: true }),
    ).rejects.toThrow(/不能覆盖/);
    expect((await caller().get({ id: a.id })).template.name).toBe('新版本');
    await caller().remove({ id: a.id, expectedRevision: edited.revision, confirmed: true });
    expect(await caller().list({})).toHaveLength(1);
  });
});
describe('w_bb_proc 真实取数、口径与持久化', () => {
  it('期初/期末/发生额/累计与core及手算分一致，重算不读陈旧缓存', async () => {
    await seedCash();
    const r = await create();
    r.template.cells = ['opening', 'closing', 'debit', 'credit', 'ytdDebit', 'ytdCredit'].map(
      (metric, i) => ({
        address: `A${i + 1}`,
        kind: 'formula' as const,
        source: formula(metric as Parameters<typeof formula>[0]),
        unit: 'cents' as const,
        currency: 'CNY',
      }),
    );
    const saved = await caller().save({ id: r.id, expectedRevision: 1, template: r.template });
    const s = await generated(saved);
    expect(s.cells.map((c) => c.value)).toEqual(['0', '12345', '12345', '0', '12345', '0']);
    const core = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      accountCodes: ['1001'],
      rollup: false,
    });
    expect(s.cells[1]!.value).toBe(String(core[0]!.closing));
    expect((await caller().snapshot({ id: r.id, period: 202601 }))!.cells).toEqual(s.cells);
    await seedCash(55);
    expect((await generated(saved)).cells[1]!.value).toBe('12400');
    expect((await generated(saved, { period: 202602 })).cells[0]!.value).toBe('12400');
    await expect(generate(saved, { period: 202701 })).rejects.toThrow(/还没有建立/);
  });
  it('w_bb_proc 未过账列数量；取消无快照；明确继续保持口径并可显式纳入', async () => {
    await seedCash(100);
    await seedCash(20, 'pending');
    const r = await create();
    const warning = await generate(r);
    expect(warning).toMatchObject({ kind: 'confirmation', count: 1 });
    if (warning.kind === 'confirmation')
      expect(warning.links[0]!.to).toBe('/m/voucher-book?period=202601&status=pending');
    expect(await caller().snapshot({ id: r.id, period: 202601 })).toBeNull();
    const posted = await generated(r, { confirmUnposted: true });
    expect(posted.cells[0]!.value).toBe('100');
    expect(posted).toMatchObject({ unpostedCount: 1, includeUnposted: false });
    const all = await generated(r, { confirmUnposted: true, includeUnposted: true });
    expect(all.cells[0]!.value).toBe('120');
    expect(all.includeUnposted).toBe(true);
  });
  it('同一请求幂等；不同请求内容不能复用编号', async () => {
    const r = await create();
    const requestId = randomUUID();
    const a = await generated(r, { requestId }),
      b = await generated(r, { requestId });
    expect(a.id).toBe(b.id);
    await expect(generate(r, { requestId, period: 202602 })).rejects.toThrow(/不同/);
  });
  it('w_bb_proc 除零/引用不存在可控失败，失败事务不覆盖上次成功结果', async () => {
    const r = await create('10', 'number');
    const s = await generated(r);
    const edited = await caller().save({
      id: r.id,
      expectedRevision: 1,
      template: { ...r.template, cells: [{ ...r.template.cells[0]!, source: '1/0' }] },
    });
    await expect(generate(edited)).rejects.toThrow(/A1.*除数为零/);
    expect((await caller().snapshot({ id: r.id, period: 202601 }))!.id).toBe(s.id);
    const missing = await create('Z999', 'number', '102');
    await expect(generate(missing)).rejects.toThrow(/不存在/);
  });
  it('父科目不重复累计，贷方正常方向保留反向符号', async () => {
    await seedVouchers(app.svc, [
      {
        date: '2026-01-02',
        status: 'posted',
        lines: [
          { account: '100201', debit: 500, dims: { cashflow: 'CF01' } },
          { account: '6001', credit: 500 },
        ],
      },
    ]);
    const r = await create(formula('closing', '1002'));
    expect((await generated(r)).cells[0]!.value).toBe('500');
    const t = emptyTemplate({ code: '102', name: '方向', rows: 1, cols: 1 });
    t.cells = [
      {
        address: 'A1',
        kind: 'formula',
        source: balanceFormula({
          account: '6001',
          metric: 'closing',
          unit: 'cents',
          currency: 'CNY',
          direction: 'normal',
          dimension: 'none',
          item: '',
        }),
        unit: 'cents',
        currency: 'CNY',
      },
    ];
    expect((await generated(await caller().importTemplate(t))).cells[0]!.value).toBe('500');
  });
  it('外币/数量/四类辅助/现金流量发生额均由真实core提供', async () => {
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          {
            account: '100202',
            debit: 7100,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 1000,
            dims: { cashflow: 'CF01' },
          },
          { account: '6001', credit: 7100 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1403', debit: 300, quantity: '1.234567', unitPrice: '2.43' },
          { account: '6001', credit: 300 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '5001', debit: 111, dims: { project: 'XM01' } },
          { account: '6001', credit: 111 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1122', debit: 222, dims: { partner: 'C001' } },
          { account: '6001', credit: 222 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '6602', debit: 333, dims: { department: '01' } },
          { account: '6001', credit: 333 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1221', debit: 444, dims: { person: 'P01' } },
          { account: '6001', credit: 444 },
        ],
      },
    ]);
    const configs = [
      { account: '100202', unit: 'foreignCents', currency: 'USD', dimension: 'none', item: '' },
      { account: '1403', unit: 'quantity', currency: 'CNY', dimension: 'none', item: '' },
      { account: '5001', unit: 'cents', currency: 'CNY', dimension: 'project', item: 'XM01' },
      { account: '1122', unit: 'cents', currency: 'CNY', dimension: 'partner', item: 'C001' },
      { account: '6602', unit: 'cents', currency: 'CNY', dimension: 'department', item: '01' },
      { account: '1221', unit: 'cents', currency: 'CNY', dimension: 'person', item: 'P01' },
      { account: '100202', unit: 'cents', currency: 'CNY', dimension: 'cashflow', item: 'CF01' },
    ] as const;
    for (const [i, config] of configs.entries()) {
      const r = await create(
        balanceFormula({ ...config, metric: 'debit', direction: 'signed' }),
        config.unit,
        String(101 + i),
      );
      expect((await generated(r)).cells[0]!.value).toBe(
        ['1000', '1.234567', '111', '222', '333', '444', '7100'][i],
      );
    }
  });
});
describe('w_bb_def / w_bb_def_help / 模板与表间审核', () => {
  it('模板往返/未知危险字段/合并越界相交/缩小尺寸不能删除内容', async () => {
    const t = ReportTemplateSchema.parse(example);
    expect(ReportTemplateSchema.parse(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(ReportTemplateSchema.safeParse({ ...t, sql: 'DELETE' }).success).toBe(false);
    expect(
      ReportTemplateSchema.safeParse({ ...t, cells: [{ ...t.cells[0], script: 'x' }] }).success,
    ).toBe(false);
    expect(
      ReportTemplateSchema.safeParse({ ...t, merges: [{ row: 4, col: 2, rows: 2, cols: 1 }] })
        .success,
    ).toBe(false);
    const empty = emptyTemplate({ code: '102', name: '格式', rows: 4, cols: 4 });
    expect(
      ReportTemplateSchema.safeParse({
        ...empty,
        merges: [
          { row: 1, col: 1, rows: 2, cols: 2 },
          { row: 2, col: 2, rows: 2, cols: 2 },
        ],
      }).success,
    ).toBe(false);
    const r = await create();
    const edited = await caller().save({
      id: r.id,
      expectedRevision: 1,
      template: {
        ...r.template,
        cells: [
          ...r.template.cells,
          { address: 'E6', kind: 'text', source: '不能丢失', unit: 'number', currency: 'CNY' },
        ],
      },
    });
    await expect(
      caller().save({
        id: r.id,
        expectedRevision: edited.revision,
        template: { ...r.template, rows: 1, cols: 1 },
      }),
    ).rejects.toThrow(/删除已有单元格/);
    expect((await caller().get({ id: r.id })).template.cells).toHaveLength(2);
  });
  it('表内/表间引用同期间重算，循环依赖可控；勾稽算不出为错误', async () => {
    await seedCash(100);
    const a = await create();
    const b = await create('REF("101","A1")*2', 'cents', '102');
    b.template.checks = [
      { name: '相等', left: 'A1', right: 'REF("101","A1")*2', tolerance: '0' },
      { name: '差异', left: 'A1', right: 'REF("101","A1")', tolerance: '1' },
      { name: '错误', left: '1/0', right: '0', tolerance: '0' },
    ];
    const b2 = await caller().save({ id: b.id, expectedRevision: 1, template: b.template });
    const s = await generated(b2);
    expect(s.cells[0]!.value).toBe('200');
    expect(s.checks.map((c) => c.status)).toEqual(['pass', 'fail', 'error']);
    expect(s.dependencies).toEqual(
      expect.arrayContaining([
        { id: a.id, code: '101', revision: 1 },
        { id: b.id, code: '102', revision: 2 },
      ]),
    );
    await seedCash(25);
    expect((await generated(b2)).cells[0]!.value).toBe('250');
    const cycle = await caller().save({
      id: a.id,
      expectedRevision: 1,
      template: { ...a.template, cells: [{ ...a.template.cells[0]!, source: 'REF("102","A1")' }] },
    });
    await expect(generate(cycle)).rejects.toThrow(/循环依赖/);
    const c = await create('A1', 'number', '103');
    await expect(generate(c)).rejects.toThrow(/循环依赖/);
  });
  it('w_bb_def SUM区域保留金额单位，空格为零，REF规范化数字编码', async () => {
    const t = emptyTemplate({ code: '001', name: '区域', rows: 6, cols: 5 });
    t.cells = [
      { address: 'A1', kind: 'money', source: '100', unit: 'cents', currency: 'CNY' },
      { address: 'A3', kind: 'money', source: '200', unit: 'cents', currency: 'CNY' },
      { address: 'B1', kind: 'formula', source: 'SUM(A1:A6)', unit: 'cents', currency: 'CNY' },
      { address: 'C1', kind: 'formula', source: 'A2+A1', unit: 'cents', currency: 'CNY' },
      { address: 'D1', kind: 'formula', source: 'SUM(A4:A6)', unit: 'cents', currency: 'CNY' },
      { address: 'E1', kind: 'formula', source: 'REF("001","a1")', unit: 'cents', currency: 'CNY' },
    ];
    const snapshot = await generated(await caller().importTemplate(t));
    expect(snapshot.cells.map((c) => c.value)).toEqual(['100', '200', '300', '100', '0', '100']);
  });

  it('w_bb_proc 过深单元格引用有明确上限，不会耗尽调用栈', async () => {
    const t = emptyTemplate({ code: '101', name: '引用深度', rows: 65, cols: 1 });
    t.cells = Array.from({ length: 65 }, (_, i) => ({
      address: `A${i + 1}`,
      kind: 'formula',
      source: i === 64 ? '1' : `A${i + 2}`,
      unit: 'number',
      currency: 'CNY',
    }));
    const r = await caller().importTemplate(t);
    await expect(generate(r)).rejects.toThrow(/超过64层/);
    expect(await caller().snapshot({ id: r.id, period: 202601 })).toBeNull();
  });

  it('金额比例使用Decimal，明确落分；不同单位不能相加', async () => {
    await seedCash(101);
    const r = await create(`${formula()}*0.5`);
    expect((await generated(r)).cells[0]!.value).toBe('51');
    const bad = await create(`${formula()}+1`, 'cents', '102');
    await expect(generate(bad)).rejects.toThrow(/单位/);
  });
  it('w_bb_saveas 真实xlsx含结果、合并、样式；攻击文本只作为字符串', async () => {
    const t = emptyTemplate({ code: '101', name: '导出', rows: 2, cols: 2 });
    t.cells = [
      {
        address: 'A1',
        kind: 'text',
        source: '=HYPERLINK("http://invalid")',
        unit: 'number',
        currency: 'CNY',
      },
      { address: 'A2', kind: 'money', source: '12345', unit: 'cents', currency: 'CNY' },
    ];
    t.merges = [{ row: 1, col: 1, rows: 1, cols: 2 }];
    t.styles = [{ address: 'A1', align: 'center', wrap: true, bold: true, format: 'general' }];
    const s = await generated(await caller().importTemplate(t));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(await workbookBase64(s), 'base64')).buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe(t.cells[0]!.source);
    expect(ws.getCell('A1').type).toBe(ExcelJS.ValueType.String);
    expect(ws.getCell('B1').isMerged).toBe(true);
    expect(ws.getCell('A1').alignment.horizontal).toBe('center');
    expect(ws.getCell('A2').value).toBe(123.45);
  });
  it('服务端权限：view不能编辑、生成持久化快照、导出或绕过输入校验', async () => {
    const r = await create();
    const viewer = app.call(
      reportServer,
      await app.addUser('viewer', { permissions: ['report-engine.view'] }),
    );
    expect(await viewer.get({ id: r.id })).toEqual(r);
    await expect(viewer.create({ code: '102', name: '非法', rows: 1, cols: 1 })).rejects.toThrow(
      /权限/,
    );
    await expect(
      viewer.save({ id: r.id, expectedRevision: 1, template: r.template }),
    ).rejects.toThrow(/权限/);
    await expect(viewer.copy({ sourceId: r.id, code: '102', name: '非法' })).rejects.toThrow(
      /权限/,
    );
    await expect(viewer.remove({ id: r.id, expectedRevision: 1, confirmed: true })).rejects.toThrow(
      /权限/,
    );
    await expect(viewer.importTemplate(r.template)).rejects.toThrow(/权限/);
    await expect(
      viewer.generate({ id: r.id, expectedRevision: 1, period: 202601, requestId: randomUUID() }),
    ).rejects.toThrow(/权限/);
    await expect(viewer.exportTemplate({ id: r.id })).rejects.toThrow(/权限/);
    await expect(viewer.exportResult({ id: r.id, period: 202601 })).rejects.toThrow(/权限/);
    expect(await viewer.snapshot({ id: r.id, period: 202601 })).toBeNull();
  });
});
