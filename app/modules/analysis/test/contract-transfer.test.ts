import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import analysis from '../server';
import { CONTRACT_ARCHIVE_HEADERS } from '../contract-transfer';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(analysis, token).contracts;
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [analysis] });
  api = caller(app);
  await app.svc.accounts.create(
    {
      code: '100203',
      name: '合同银行',
      isBank: true,
      dimensions: [{ type: 'partner', required: true }],
    },
    [4, 2, 2],
  );
});
afterEach(async () => app.close());
const row = (code = 'HT001', extra: Partial<Record<number, string | number>> = {}) => {
  const cells: (string | number)[] = [
    code,
    '合成合同',
    'C001',
    '100203',
    '2026-01-02',
    '收款',
    '123.45',
    '6.78',
    '说明',
    '一列',
    '二列',
  ];
  for (const [key, value] of Object.entries(extra)) cells[Number(key)] = value!;
  return cells;
};
async function file(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet('合同档案');
  sheet.addRow(CONTRACT_ARCHIVE_HEADERS);
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
async function imported(fileBase64: string, overwrite = false) {
  const preview = await api.previewImport({ fileBase64, overwrite });
  return api.importArchive({
    fileBase64,
    overwrite,
    previewHash: preview.previewHash,
    confirmed: true,
  });
}

describe('w_ht_htda / m_work_ht_zw 合同导入另存与逐行错误', () => {
  it('预览不写数据，明确确认后按客供/科目编码导入，两列备注独立保存', async () => {
    const fileBase64 = await file([row()]);
    const preview = await api.previewImport({ fileBase64 });
    expect(preview).toMatchObject({ valid: 1, invalid: 0, rows: [{ row: 2, action: '新增' }] });
    expect(await api.list()).toEqual([]);
    await expect(
      api.importArchive({ fileBase64, previewHash: preview.previewHash, confirmed: false }),
    ).rejects.toThrow('明确确认');
    const result = await api.importArchive({
      fileBase64,
      previewHash: preview.previewHash,
      confirmed: true,
    });
    expect(result).toMatchObject({ succeeded: 1, failed: 0 });
    expect((await api.archive()).rows[0]).toMatchObject({
      code: 'HT001',
      amount: 12345,
      opening: 678,
      remark: '一列',
      remark2: '二列',
      reviewed_by: null,
    });
  });
  it('逐行反馈不存在客供、错误科目、非法日期、重复号和金额，其他行仍可成功', async () => {
    const fileBase64 = await file([
      row(),
      row('HT002', { 2: 'UNKNOWN' }),
      row('HT003', { 3: '1122' }),
      row('HT004', { 4: '2026-02-30' }),
      row('HT005', { 6: '不是金额' }),
      row(),
    ]);
    const preview = await api.previewImport({ fileBase64 });
    expect(preview.valid).toBe(1);
    expect(preview.invalid).toBe(5);
    expect(preview.rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(preview.rows[1]!.error).toContain('客供');
    expect(preview.rows[2]!.error).toContain('科目');
    expect(preview.rows[4]!.error).toContain('金额');
    expect(preview.rows[5]!.error).toContain('重复');
    expect(await imported(fileBase64)).toMatchObject({ succeeded: 1, failed: 5 });
    expect(await api.list()).toHaveLength(1);
  });
  it('重复合同号默认阻止；选定覆盖后保留合同ID且不能覆盖已审核合同', async () => {
    await imported(await file([row()]));
    const original = (await api.list())[0]!;
    const changed = await file([row('HT001', { 1: '更新合同' })]);
    expect(await api.previewImport({ fileBase64: changed })).toMatchObject({
      valid: 0,
      invalid: 1,
    });
    expect(await imported(changed, true)).toMatchObject({ succeeded: 1, failed: 0 });
    const current = (await api.list())[0]!;
    expect(current).toMatchObject({ id: original.id, name: '更新合同', revision: 2 });
    await api.review({ id: current.id, expectedRevision: current.revision, reviewed: true });
    expect(
      (await api.previewImport({ fileBase64: changed, overwrite: true })).rows[0]!.error,
    ).toContain('不能覆盖');
  });
  it('预览后被另一窗口修改时拒绝全部提交，不覆盖新版本', async () => {
    await imported(await file([row()]));
    const fileBase64 = await file([row('HT001', { 1: '导入覆盖' }), row('HT002')]);
    const preview = await api.previewImport({ fileBase64, overwrite: true });
    const current = (await api.archive()).rows[0]!;
    await api.save({
      id: current.id,
      expectedRevision: current.revision,
      code: current.code,
      name: '另一窗口',
      partnerId: current.partner_id,
      accountId: current.account_id,
      signedDate: current.signed_date,
      kind: current.kind,
      amount: current.amount,
      opening: current.opening,
    });
    await expect(
      api.importArchive({
        fileBase64,
        overwrite: true,
        previewHash: preview.previewHash,
        confirmed: true,
      }),
    ).rejects.toThrow('预览已失效');
    expect(await api.list()).toHaveLength(1);
    expect((await api.list())[0]!.name).toBe('另一窗口');
  });
  it('单行存盘日志失败回滚本行，报告失败而保留其他成功合同', async () => {
    app.runtime.bookStore
      .open(app.book.id)
      .raw.exec(
        "CREATE TEMP TRIGGER analysis_test_import_log BEFORE INSERT ON operation_log WHEN NEW.action = 'analysis.contract.save' AND NEW.summary = '保存合同 HT002' BEGIN SELECT RAISE(ABORT, '合成导入失败'); END;",
      );
    const result = await imported(await file([row(), row('HT002'), row('HT003')]));
    expect(result).toMatchObject({ succeeded: 2, failed: 1 });
    expect(result.results[1]).toMatchObject({ code: 'HT002', success: false });
    expect((await api.list()).map((r) => r.code)).toEqual(['HT001', 'HT003']);
  });
  it('最大安全整数金额Excel使用精确文本并可无损再次导入；公式状字符串仍为文本', async () => {
    await imported(
      await file([row('HT001', { 1: '=HYPERLINK("x")', 6: '90071992547409.91', 7: '0.01' })]),
    );
    const exported = await api.exportArchive();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
    const sheet = wb.getWorksheet('合同档案')!;
    expect(sheet.getCell('G2').value).toBe('90071992547409.91');
    expect(sheet.getCell('G2').numFmt).toBe('@');
    expect(sheet.getCell('B2').value).toBe('=HYPERLINK("x")');
    expect(await imported(exported.base64, true)).toMatchObject({ succeeded: 1, failed: 0 });
    expect((await api.archive()).rows[0]!.amount).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('超过两位小数的金额和期初逐行拒绝，不四舍五入成合法值', async () => {
    const fileBase64 = await file([
      row('FRACTION', { 6: '1.234' }),
      row('SUBCENT', { 7: '0.001' }),
      row('MAX-FRACTION', { 6: '90071992547409.911' }),
      row('NEG-SUBCENT', { 6: '-0.001' }),
      row('TRAILING-ZERO', { 6: '1.2300' }),
      row('NUMERIC-FRACTION', { 6: 1.234 }),
      row('EXACT', { 6: '0.01' }),
    ]);
    const preview = await api.previewImport({ fileBase64 });
    expect(preview).toMatchObject({ valid: 1, invalid: 6 });
    expect(preview.rows.slice(0, 3).every((r) => r.error?.includes('两位小数'))).toBe(true);
    expect(preview.rows[3]!.error).toContain('不能为负');
    expect(await imported(fileBase64)).toMatchObject({ succeeded: 1, failed: 6 });
    expect((await api.list())[0]!.amount).toBe(1);
  });
  it('大额Excel数值单元格拒绝，避免已丢失末分的数值被当作精确金额', async () => {
    const numeric = await api.previewImport({
      fileBase64: await file([
        row('NUMERIC-AMOUNT', { 6: 90071992547409.91 }),
        row('NUMERIC-OPENING', { 7: 90071992547409.91 }),
        row('TEXT-EXACT', { 6: '90071992547409.91' }),
        row('SMALL-NUMERIC', { 6: 123.45 }),
      ]),
    });
    expect(numeric.valid).toBe(2);
    expect(numeric.invalid).toBe(2);
    expect(numeric.rows[0]!.error).toContain('精确文本');
    expect(numeric.rows[1]!.error).toContain('精确文本');
    expect(numeric.rows[2]!.input!.amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(numeric.rows[3]!.input!.amount).toBe(12345);
    expect(await api.list()).toEqual([]);
  });
  it('公式单元格拒绝而不采用缓存结果；越界金额不写入', async () => {
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet('合同档案');
    sheet.addRow(CONTRACT_ARCHIVE_HEADERS);
    sheet.addRow(row());
    sheet.getCell('G2').value = { formula: '1+1', result: 2 };
    const preview = await api.previewImport({
      fileBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    });
    expect(preview).toMatchObject({ valid: 0, invalid: 1 });
    expect(preview.rows[0]!.error).toContain('公式');
    const overflow = await api.previewImport({
      fileBase64: await file([row('HT002', { 6: '90071992547409.92' })]),
    });
    expect(overflow).toMatchObject({ valid: 0, invalid: 1 });
    expect(await api.list()).toEqual([]);
  });
  it('w_ht_pz 独立明细另存保留真实借贷金额与关联状态', async () => {
    await imported(await file([row()]));
    const current = (await api.list())[0]!;
    const reviewed = await api.review({
      id: current.id,
      expectedRevision: current.revision,
      reviewed: true,
    });
    const [voucher] = await seedVouchers(app.svc, [
      {
        date: '2026-01-03',
        status: 'posted',
        lines: [
          { account: '100203', debit: 12345, dims: { partner: 'C001' }, summary: '明确关联收入' },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
    await api.link({
      id: reviewed.id,
      expectedRevision: reviewed.revision,
      voucherId: voucher!.id,
      lineId: voucher!.lines[0]!.id,
    });
    const exported = await api.exportLines({ id: reviewed.id });
    expect(exported.contract.lines[0]).toMatchObject({
      debit: 12345,
      credit: 0,
      amount: 12345,
      currency: '本位币',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
    const sheet = wb.getWorksheet('合同收付明细')!;
    expect(sheet.getCell('E3').value).toBe('123.45');
    expect(sheet.getCell('F3').value).toBe('0.00');
    expect(sheet.getCell('G3').value).toBe('123.45');
    expect(sheet.getCell('I3').value).toBe('已过账');
  });
  it('独立权限：查看者不能导入，维护者缺查看权限不能取档案或导出', async () => {
    const viewer = caller(
      app,
      await app.addUser('viewer', { permissions: ['analysis.contract.view'] }),
    );
    await expect(viewer.previewImport({ fileBase64: await file([row()]) })).rejects.toThrow();
    const editor = caller(
      app,
      await app.addUser('editor', { permissions: ['analysis.contract.edit', 'analysis.export'] }),
    );
    await expect(editor.archive()).rejects.toThrow();
    await expect(editor.exportArchive()).rejects.toThrow();
  });
});
