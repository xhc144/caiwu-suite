import { afterEach, beforeEach, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import type { ExcelInput, ReferenceKind } from '../shared';
import server from '../server';
import type { MasterdataTables } from '../server/migrations';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(server, token);
let api: ReturnType<typeof caller>;
async function withPreview(input: ExcelInput): Promise<ExcelInput> {
  return { ...input, previewToken: (await api.excel.preview(input)).previewToken };
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  api = caller(app);
});
afterEach(async () => app.close());

async function file(kind: ReferenceKind, rows?: unknown[][]) {
  const out = await api.excel.export({ kind: 'reference', referenceKind: kind });
  const wb = new Workbook();
  await wb.xlsx.load(
    Buffer.from(out.content, 'base64') as unknown as Parameters<typeof wb.xlsx.load>[0],
  );
  let output = wb;
  if (rows) {
    output = new Workbook();
    const ws = output.addWorksheet('参考档案');
    ws.addRow((wb.worksheets[0]!.getRow(1).values as unknown[]).slice(1));
    rows.forEach((row) => ws.addRow(row));
  }
  return {
    kind: 'reference' as const,
    referenceKind: kind,
    fileName: out.fileName,
    content: Buffer.from(await output.xlsx.writeBuffer()).toString('base64'),
  };
}

it.each<ReferenceKind>(['voucherTypes', 'settlementMethods', 'currencies', 'summaries'])(
  'w_xt_pzlx / w_xt_jslb / w_xt_fbwh / w_xt_zy：%s真实Excel预览不保存，确认保留ID、重复回导无损',
  async (kind) => {
    const sample = {
      kind,
      code: kind === 'currencies' ? 'EUR' : '09',
      name: '收款档案',
      shortName: kind === 'voucherTypes' ? '收' : '',
      symbol: kind === 'currencies' ? '€' : null,
      category: kind === 'summaries' ? '收款' : '',
      shortcut: kind === 'summaries' ? 'sk' : '',
      sort: 5,
    };
    await api.reference.save(sample);
    const before = await api.reference.list({ kind });
    const saved = before.find((r) => r.code === sample.code)!;
    if (kind === 'summaries')
      await app.svc.db
        .updateTable('summary_phrase')
        .set({ use_count: 37 })
        .where('id', '=', saved.id)
        .execute();
    const source = await file(kind);
    await api.reference.save({ ...sample, id: saved.id, name: '导入前名称' });
    const snapshot = await api.reference.list({ kind });
    expect((await api.excel.preview(source)).valid).toBe(true);
    expect(await api.reference.list({ kind })).toEqual(snapshot);
    await expect(api.excel.commit(await withPreview(source))).rejects.toThrow('确认导入');
    expect(await api.reference.list({ kind })).toEqual(snapshot);
    await api.excel.commit(await withPreview({ ...source, confirmations: ['import'] }));
    const after = await api.reference.list({ kind });
    expect(after.find((r) => r.code === sample.code)).toMatchObject({
      ...saved,
      useCount: kind === 'summaries' ? 37 : saved.useCount,
    });
    await api.excel.commit(await withPreview({ ...source, confirmations: ['import'] }));
    expect(await api.reference.list({ kind })).toEqual(after);
  },
);

it('w_xt_zy：逐行重复/非法排序和坏后行撤销前行、附加字段与导入日志', async () => {
  const before = await api.reference.list({ kind: 'summaries' });
  const logs = await app.svc.db.selectFrom('operation_log').selectAll().execute();
  const input = await file('summaries', [
    ['03', '首行收款', '收款', 'sk', 1],
    ['04', '坏后行', '付款', 'fk', '1e2'],
    ['03', '重复', '', '', 0],
  ]);
  const preview = await api.excel.preview(input);
  expect(preview.valid).toBe(false);
  expect(preview.rows).toMatchObject([
    { row: 2, code: '03', action: '新增', error: '' },
    { row: 4, code: '03', action: '拒绝', error: expect.stringContaining('重复') },
    { row: 3, code: '04', action: '拒绝', error: expect.stringContaining('整数') },
  ]);
  expect(await api.reference.list({ kind: 'summaries' })).toEqual(before);
  await expect(
    api.excel.commit(await withPreview({ ...input, confirmations: ['import'] })),
  ).rejects.toThrow();
  expect(await api.reference.list({ kind: 'summaries' })).toEqual(before);
  expect(
    await app.svc.db
      .withTables<MasterdataTables>()
      .selectFrom('masterdata_reference_extra')
      .selectAll()
      .execute(),
  ).toEqual([]);
  expect(await app.svc.db.selectFrom('operation_log').selectAll().execute()).toEqual(logs);
});

it('w_xt_fbwh：本位币停用不允许，币种导入坏后行不能留下前行', async () => {
  const before = await api.reference.list({ kind: 'currencies' });
  const input = await file('currencies', [
    ['AAA', '前行币种', 'A', 0, 0],
    ['CNY', '人民币', '¥', 1, 0],
  ]);
  const preview = await api.excel.preview(input);
  expect(preview.rows.find((r) => r.code === 'CNY')?.error).toContain('本位币');
  await expect(
    api.excel.commit(await withPreview({ ...input, confirmations: ['import'] })),
  ).rejects.toThrow('本位币');
  expect(await api.reference.list({ kind: 'currencies' })).toEqual(before);
});

it('w_xt_pzlx / w_xt_jslb：Excel不能停用最后类别或变更已用凭证字，历史整数金额及来源锁不变', async () => {
  const type = (await api.reference.list({ kind: 'voucherTypes' }))[0]!;
  const last = await file('voucherTypes', [[type.code, type.shortName, type.name, 1, 0]]);
  expect((await api.excel.preview(last)).rows[0]?.error).toContain('至少保留');
  await expect(
    api.excel.commit(await withPreview({ ...last, confirmations: ['import'] })),
  ).rejects.toThrow('至少保留');
  await api.reference.save({ kind: 'voucherTypes', code: '09', shortName: '转', name: '转账凭证' });
  const input = await voucherInputFromSpec(app.svc, {
    date: '2026-01-05',
    lines: [
      { account: '1001', debit: 12345 },
      { account: '6603', credit: 12345 },
    ],
  });
  const source = await app.svcFor('masterdata').vouchers.create({
    ...input,
    source: { type: 'test', id: 'source-1' },
  });
  const changed = await file('voucherTypes', [[type.code, '付', type.name, 0, 0]]);
  expect((await api.excel.preview(changed)).rows[0]?.error).toContain('历史凭证字');
  await expect(
    api.excel.commit(await withPreview({ ...changed, confirmations: ['import'] })),
  ).rejects.toThrow('历史凭证字');
  expect(await app.svc.vouchers.get(source.id)).toEqual(source);
  expect(source.debitTotal).toBe(12345);
  expect(source.creditTotal).toBe(12345);
  await expect(
    app.svc.vouchers.update(source.id, input, { expectedRevision: source.revision }),
  ).rejects.toThrow('生成');
  await expect(app.svc.vouchers.delete(source.id)).rejects.toThrow('生成');
  const settlements = await api.reference.list({ kind: 'settlementMethods' });
  for (const row of settlements.slice(1))
    await api.reference.save({ ...row, kind: 'settlementMethods', disabled: true });
  const remaining = settlements[0]!;
  const stop = await file('settlementMethods', [[remaining.code, remaining.name, 1, 0]]);
  await expect(
    api.excel.commit(await withPreview({ ...stop, confirmations: ['import'] })),
  ).rejects.toThrow('至少保留');
  expect(
    (await api.reference.list({ kind: 'settlementMethods' })).find((r) => r.id === remaining.id)
      ?.disabled,
  ).toBe(false);
});

it('w_xt_pzlx / w_xt_kmwh：Excel停用已用类别与科目后禁止新凭证，历史及发生额保护仍在', async () => {
  const type = (await api.reference.list({ kind: 'voucherTypes' }))[0]!;
  const [history] = await seedVouchers(app.svc, [
    {
      date: '2026-01-06',
      lines: [
        { account: '1001', debit: 101 },
        { account: '6603', credit: 101 },
      ],
    },
  ]);
  await api.reference.save({ kind: 'voucherTypes', code: '09', shortName: '转', name: '转账凭证' });
  const input = await file('voucherTypes', [[type.code, type.shortName, type.name, 1, type.sort]]);
  await api.excel.commit(await withPreview({ ...input, confirmations: ['import'] }));
  const v = await voucherInputFromSpec(app.svc, {
    date: '2026-01-07',
    type: type.shortName,
    lines: [
      { account: '1001', debit: 101 },
      { account: '6603', credit: 101 },
    ],
  });
  await expect(app.svc.vouchers.create(v)).rejects.toThrow('已停用');
  const a = await app.svc.accounts.require('6603');
  await api.accounts.save({ ...a, dimensions: [], disabled: true });
  await expect(
    app.svc.vouchers.create({
      ...v,
      voucherTypeId: (await app.svc.reference.voucherTypes()).find((r) => r.code === '转')!.id,
    }),
  ).rejects.toThrow('已停用');
  await expect(api.accounts.remove({ id: a.id, confirmed: true })).rejects.toThrow('已有凭证');
  expect(await app.svc.vouchers.get(history!.id)).toEqual(history);
});

it('w_xt_pzlx / w_xt_jslb / w_xt_fbwh：参考档案返回真实拼音并保留凭证简称', async () => {
  for (const kind of ['voucherTypes', 'settlementMethods', 'currencies'] as const) {
    await api.reference.save({
      kind,
      code: kind === 'currencies' ? 'EUR' : '09',
      name: '收款',
      shortName: kind === 'voucherTypes' ? '收' : '',
    });
    expect((await api.reference.list({ kind })).find((r) => r.name === '收款')).toMatchObject({
      pinyin: 'sk',
    });
  }
});

it('w_xt_kmbm_get：参考Excel拒绝重复表头、公式与缺类型，保留原档案', async () => {
  const before = await api.reference.list({ kind: 'summaries' });
  const out = await file('summaries', [['03', { formula: '1+1' }, '', '', 0]]);
  await expect(api.excel.preview(out)).rejects.toThrow('公式');
  const wb = new Workbook();
  const ws = wb.addWorksheet('摘要');
  ws.addRow(['编码', '摘要短语', '类别', '快捷检索词', '排序', '编码']);
  ws.addRow(['03', '短语', '', '', 0, '04']);
  await expect(
    api.excel.preview({
      ...out,
      content: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    }),
  ).rejects.toThrow('重复表头');
  await expect(api.excel.preview({ ...out, referenceKind: undefined })).rejects.toThrow(
    '参考档案类型',
  );
  expect(await api.reference.list({ kind: 'summaries' })).toEqual(before);
});

it('权限：Excel预览和确认同时要求导入与参考档案权限，读取无需写权限', async () => {
  const input = await file('summaries', [['03', '未授权短语', '收款', 'sk', 0]]);
  for (const permissions of [
    ['masterdata.view', 'masterdata.import'],
    ['masterdata.view', 'masterdata.reference.edit'],
  ]) {
    const restricted = caller(
      app,
      await app.addUser(`u${permissions[1]!.length}`, { permissions }),
    );
    await expect(restricted.excel.preview(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      restricted.excel.commit({ ...input, confirmations: ['import'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await restricted.excel.export({ kind: 'reference', referenceKind: 'summaries' })).fileName,
    ).toBe('摘要.xlsx');
  }
  expect((await api.reference.list({ kind: 'summaries' })).some((r) => r.code === '03')).toBe(
    false,
  );
});
