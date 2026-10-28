import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { AssetPrintSettingsSchema, type CardInput } from '../shared';
import { parseQueryLogic, queryLogicText } from '../query-logic';
import { assetLabelsPrint } from '../web/label-print';
import { assetReportPrint, assetCardPrint } from '../web/asset-print';
import { readAssetPrintFile } from '../web/PrintSettings';
import { renderPrintDocument } from '@caiwu/print';
import { depreciationPrint } from '../web/query-print';
import {
  createOpeningWorkbook,
  openingHeaders,
  readOpeningWorkbook,
} from '../web/opening-workbook';
import server from '../server';

const caller = (a: TestApp, token?: string) => a.call(server, token);
let app: TestApp, api: ReturnType<typeof caller>, data: CardInput, ids: number[];
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  const categoryId = await api.saveMaster({
    data: { kind: 'category', code: '01', name: '办公设备' },
  });
  const purposeId = await api.saveMaster({ data: { kind: 'purpose', code: '01', name: '管理用' } });
  const statusId = await api.saveMaster({ data: { kind: 'status', code: '01', name: '在用' } });
  data = {
    code: 'A',
    name: '<script>服务器</script>',
    categoryId,
    purposeId,
    statusId,
    departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
    acquired: '2026-01-01',
    useDate: '2026-01-01',
    original: 600000,
    rate: '0',
    method: '1',
    lifeMonths: 60,
    manufacturer: '100%精密厂',
    installation: '机房一',
    manufactured: '2025-12-01',
    machineCode: 'M-01',
    custodian: '合成保管人',
    currencyCode: 'USD',
    foreignOriginal: '12.3456',
    reference: 'REF-01',
    quantity: '1.25',
  };
  ids = [
    await api.save({ data }),
    await api.save({
      data: {
        ...data,
        code: 'B',
        name: '打印机',
        original: 300000,
        manufacturer: '其他厂',
        quantity: '1',
      },
    }),
    await api.save({
      data: {
        ...data,
        code: 'C',
        name: '服务器维护设备',
        original: 120000,
        manufacturer: '其他厂',
        quantity: '3.5',
      },
    }),
  ];
  const p = await api.preview({ period: 202602 });
  await api.depreciate({ period: 202602, token: p.token, confirm: true });
});
afterEach(async () => app.close());

describe('w_zjgl_cx：组合条件、自选显示和保存查询', () => {
  it('OR/AND 优先级及嵌套括号按手算集合过滤，排序、打印列与合计使用同一结果', async () => {
    const conditions = [
      { field: 'name', op: 'contains', value: '服务器' },
      { field: 'code', op: 'eq', value: 'B' },
      { field: 'amount', op: 'gt', value: '4000' },
    ] as const;
    const input = {
      from: 202602,
      to: 202602,
      conditions: [...conditions],
      expression: '(1 或者 2) 并且 3',
      sortField: 'amount' as const,
      sortDirection: 'desc' as const,
      displayColumns: ['code', 'amount', 'reference'] as const,
    };
    const p = await api.query({ ...input, displayColumns: [...input.displayColumns] });
    expect(p.rows.map((r) => r.code)).toEqual(['A', 'B']);
    expect(p.total).toBe(15000);
    expect(p.rows[0]).toMatchObject({
      reference: 'REF-01',
      original: 600000,
      quantity: '1.25',
      manufacturer: '100%精密厂',
    });
    const union = await api.query({
      ...input,
      displayColumns: [...input.displayColumns],
      expression: '1 或者 (2 并且 3)',
    });
    expect(union.rows.map((r) => r.code)).toEqual(['A', 'B', 'C']);
    expect(union.total).toBe(17000);
    const html = depreciationPrint(
      p,
      {
        ...input,
        displayColumns: [...input.displayColumns],
        departmentLevel: 'detail',
        categoryLevel: 'detail',
      },
      'detail',
    ).html;
    expect(html).toContain('<th>编号</th><th>折旧额（元）</th><th>参考编号</th>');
    expect(html).toContain('组合：((1 或者 2) 并且 3)');
    expect(html).toContain('合计：150.00 元');
    expect(html).not.toContain('<script>');
  });
  it('不含有与百分号均按字面比较；金额边界、数量六位小数及历史部门可组合', async () => {
    expect(
      (
        await api.query({
          from: 202602,
          to: 202602,
          conditions: [{ field: 'manufacturer', op: 'contains', value: '%' }],
        })
      ).rows.map((r) => r.code),
    ).toEqual(['A']);
    expect(
      (
        await api.query({
          from: 202602,
          to: 202602,
          conditions: [{ field: 'manufacturer', op: 'notContains', value: '%' }],
        })
      ).rows.map((r) => r.code),
    ).toEqual(['B', 'C']);
    const q = await api.query({
      from: 202602,
      to: 202602,
      conditions: [
        { field: 'quantity', op: 'gt', value: '1.2' },
        { field: 'amount', op: 'gte', value: '2000' },
        { field: 'department', op: 'eq', value: '行政部' },
      ],
    });
    expect(q.rows.map((r) => r.code)).toEqual(['A', 'C']);
    expect(
      (
        await api.query({
          from: 202602,
          to: 202602,
          conditions: [{ field: 'foreignOriginal', op: 'eq', value: '12.3456' }],
          sorts: [
            { field: 'manufacturer', direction: 'desc' },
            { field: 'amount', direction: 'asc' },
          ],
        })
      ).rows.map((r) => r.code),
    ).toEqual(['C', 'B', 'A']);
    await expect(
      api.query({
        from: 202602,
        to: 202602,
        conditions: [{ field: 'work', op: 'eq', value: '0.0000001' }],
      }),
    ).rejects.toThrow('最多六位小数');
    await expect(
      api.query({
        from: 202602,
        to: 202602,
        conditions: [{ field: 'months', op: 'notContains', value: '0' }],
      }),
    ).rejects.toThrow('不能使用');
  });
  it.each([
    '1 或者 9',
    '1; DROP TABLE fixed_assets_card',
    '(1 或者 2',
    '1 2',
    '1',
    '('.repeat(13) + '1 或者 2' + ')'.repeat(13),
  ])('错误组合整次拒绝：%s', async (expression) => {
    await expect(
      api.query({
        from: 202602,
        to: 202602,
        conditions: [
          { field: 'code', op: 'eq', value: 'A' },
          { field: 'code', op: 'eq', value: 'B' },
        ],
        expression,
      }),
    ).rejects.toThrow();
    expect((await api.query({ from: 202602, to: 202602 })).total).toBe(17000);
  });
  it('查询定义按操作员隔离，包含组合、列顺序和排序；并发版本和删除确认生效', async () => {
    await api.saveQueryDefinition({
      name: '全部设备',
      revision: 0,
      query: {
        from: 202602,
        to: 202602,
        displayColumns: ['reference', 'code', 'amount'],
        sortField: 'amount',
        sortDirection: 'desc',
        hideRepeated: true,
      },
    });
    const p = await api.queryDefinitions();
    expect(p.items[0]?.query).toMatchObject({
      displayColumns: ['reference', 'code', 'amount'],
      sortDirection: 'desc',
      hideRepeated: true,
    });
    await expect(
      api.saveQueryDefinition({
        name: '另一查询',
        revision: 0,
        query: { from: 202602, to: 202602 },
      }),
    ).rejects.toThrow('其他窗口');
    const reader = caller(app, await app.addUser('reader', { permissions: ['fixed-assets.view'] }));
    expect((await reader.queryDefinitions()).items).toEqual([]);
    await reader.saveQueryDefinition({
      name: '自己的查询',
      revision: 0,
      query: { from: 202602, to: 202602 },
    });
    expect((await api.queryDefinitions()).items).toHaveLength(1);
    await expect(
      api.removeQueryDefinition({ name: '全部设备', revision: p.revision, confirm: false }),
    ).rejects.toThrow('确认');
    await api.removeQueryDefinition({ name: '全部设备', revision: p.revision, confirm: true });
    expect((await api.queryDefinitions()).items).toEqual([]);
    expect(queryLogicText(parseQueryLogic('1 OR (2 AND 3)', 3)!)).toBe('(1 或者 (2 并且 3))');
  });
});

describe('w_zcgl_kp / w_xt_kgzb_zc：扩展资料与列表存盘', () => {
  it('制造、地点、外币原值在卡片/报表/双表期初导出中保留；旧文件不能清空这些资料', async () => {
    const c = (await api.detail({ id: ids[0]! })).card;
    expect(c).toMatchObject({
      manufacturer: '100%精密厂',
      installation: '机房一',
      manufactured: '2025-12-01',
      machine_code: 'M-01',
      custodian: '合成保管人',
      currency_code: 'USD',
      foreign_original: '12.3456',
      original: 600000,
    });
    const report = await api.reports({ kind: 'list', year: 2026, cutoff: '2026-02-28' });
    expect(report.rows[0]).toMatchObject({
      manufacturer: '100%精密厂',
      currencyCode: 'USD',
      foreignOriginal: '12.3456',
    });
    const values = [
      'A',
      data.name,
      '01',
      '01',
      '01',
      '01',
      '2026-01-01',
      '2026-01-01',
      '6000',
      '0',
      '1',
      '60',
      '0',
      '0',
      '0',
      '0',
      '',
      '台',
      '1.25',
      '否',
      '0',
      'REF-01',
      '100%精密厂',
      '机房一',
      '2025-12-01',
      'M-01',
      '合成保管人',
      'USD',
      '12.3456',
    ];
    const wb = await createOpeningWorkbook([{ values, accessories: [] }]);
    const refs = {
      masters: await api.masters(),
      departments: await app.svc.dimensions.items('department'),
    };
    const parsed = readOpeningWorkbook(wb, refs);
    expect(parsed.rows[0]?.data).toMatchObject({
      manufacturer: '100%精密厂',
      currencyCode: 'USD',
      foreignOriginal: '12.3456',
    });
    expect((await api.importPreview({ rows: parsed.rows })).rows[0]?.status).toBe('已存在，跳过');
    const { Workbook } = await import('exceljs');
    const legacy = new Workbook();
    legacy.addWorksheet('期初卡片').addRows([openingHeaders.slice(0, 22), values.slice(0, 22)]);
    expect(legacy.worksheets[0]!.getRow(1).cellCount).toBe(22);
    const old = readOpeningWorkbook(legacy, refs);
    expect((await api.importPreview({ rows: old.rows })).valid).toBe(false);
    expect(openingHeaders).toHaveLength(29);
    await api.saveListEdits({ rows: [{ id: c.id, revision: c.revision, changes: { unit: '' } }] });
    const blankUnit = await createOpeningWorkbook([
      { values: values.map((value, index) => (index === 17 ? '' : value)), accessories: [] },
    ]);
    const blankParsed = readOpeningWorkbook(blankUnit, refs);
    expect(blankParsed.rows[0]?.data.unit).toBe('');
    expect((await api.detail({ id: c.id })).card).toMatchObject({
      unit: '',
      manufacturer: c.manufacturer,
      machine_code: c.machine_code,
      reference: c.reference,
    });
    expect((await api.importPreview({ rows: blankParsed.rows })).rows[0]?.status).toBe(
      '已存在，跳过',
    );
    const outside = await createOpeningWorkbook([{ values, accessories: [] }]);
    outside.worksheets[0]!.getRow(2).getCell(30).value = { formula: '1+1' };
    expect(() => readOpeningWorkbook(outside, refs)).toThrow('模板外数据');
  });
  it('错误制造日期和未知币种不落库，列表编辑第二条失败时第一条也回滚', async () => {
    await expect(
      api.save({ data: { ...data, code: 'BAD', manufactured: '2026-02-01' } }),
    ).rejects.toThrow('制造日期');
    await expect(
      api.save({ data: { ...data, code: 'BAD', currencyCode: 'UNKNOWN' } }),
    ).rejects.toThrow('币种');
    const a = (await api.detail({ id: ids[0]! })).card,
      b = (await api.detail({ id: ids[1]! })).card;
    await expect(
      api.saveListEdits({
        rows: [
          { id: a.id, revision: a.revision, changes: { name: '待回滚' } },
          { id: b.id, revision: 999, changes: { unit: '套' } },
        ],
      }),
    ).rejects.toThrow('其他操作');
    expect((await api.detail({ id: a.id })).card).toEqual(a);
    await api.saveListEdits({
      rows: [
        { id: a.id, revision: a.revision, changes: { name: '已列表保存', manufacturer: '新厂' } },
      ],
    });
    expect((await api.detail({ id: a.id })).card).toMatchObject({
      name: '已列表保存',
      manufacturer: '新厂',
      revision: a.revision + 1,
    });
    const reader = caller(
      app,
      await app.addUser('no-edit', { permissions: ['fixed-assets.view'] }),
    );
    await expect(
      reader.saveListEdits({ rows: [{ id: b.id, revision: b.revision, changes: { unit: '套' } }] }),
    ).rejects.toThrow();
  });
});

describe('w_zcgl_label / w_preview_zc_mxz / w_print_tz：专用文件与版式', () => {
  it('版式文件严格验证，保存后回读与标签 HTML 使用同一字段/颜色/转义和纸张', async () => {
    const settings = AssetPrintSettingsSchema.parse({
      labelTitle: '<script>资产标签',
      labelFields: ['code', 'name', 'reference', 'date'],
      labelBorder: true,
      labelFont: 8,
      color: 'color',
      ruler: true,
      scale: 75,
    });
    const file = readAssetPrintFile(JSON.stringify(settings));
    await api.savePrintSettings(file);
    expect(await api.printSettings()).toEqual(settings);
    const report = await api.reports({ kind: 'labels', year: 2026, cutoff: '2026-02-28' });
    const job = assetLabelsPrint(report.rows, 'color', file);
    expect(job.pageSize).toEqual({ widthMm: 88, heightMm: 51 });
    const html = renderPrintDocument(job);
    expect(html).toContain('&lt;script&gt;资产标签');
    expect(html).toContain('参考编号');
    expect(html).not.toContain('<script>');
    for (const text of [
      '{',
      JSON.stringify({ ...settings, version: 2 }),
      JSON.stringify({ ...settings, html: '<script>' }),
      JSON.stringify({ ...settings, labelFields: ['name', 'name'] }),
    ])
      expect(() => readAssetPrintFile(text)).toThrow();
    expect(() => readAssetPrintFile(' '.repeat(65537))).toThrow('64 KB');
  });
  it('明细账按资产分页、承前页及过次页金额连续，台账与独立卡片显示真实财务数', async () => {
    for (const period of [202603, 202604, 202605, 202606, 202607, 202608, 202609]) {
      const p = await api.preview({ period });
      await api.depreciate({ period, token: p.token, confirm: true });
    }
    const report = await api.reports({
      kind: 'ledger',
      year: 2026,
      cutoff: '2026-09-30',
      fromCode: 'A',
      toCode: 'A',
    });
    const settings = AssetPrintSettingsSchema.parse({
      rowsPerPage: 5,
      pageSize: 'B5',
      ruler: true,
    });
    const output = assetReportPrint(
      report,
      'ledger',
      { unit: '合成单位', year: 2026, cutoff: '2026-09-30' },
      settings,
    );
    expect(output.pageSize).toBe('B5');
    expect(() => renderPrintDocument(output)).not.toThrow();
    expect(output.html).toContain('承前页');
    expect(output.html).toContain('过次页');
    expect(output.html).not.toContain('80,000.00');
    expect(output.html).toContain('800.00');
    expect(output.html).toContain('本设备期末余额');
    expect(output.html).not.toContain('<script>');
    expect(output.html).toContain('&lt;script&gt;服务器&lt;/script&gt;');
    const detail = await api.detail({ id: ids[0]! });
    const card = assetCardPrint(detail, {
      unit: '合成单位',
      category: '办公设备',
      purpose: '管理用',
      status: '在用',
      department: '行政部',
    });
    expect(card.html).toContain('5,200.00');
    expect(card.html).toContain('12.3456');
    expect(card.html).toContain('100%精密厂');
    expect(() =>
      assetReportPrint({ ...report, rows: [] }, 'ledger', {
        unit: '',
        year: 2026,
        cutoff: '2026-09-30',
      }),
    ).toThrow('没有记录');
  });
});
