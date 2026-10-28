import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import type { ImportBatch, ImportKind, PrepareInput } from '../shared';
import legacyImportServer from '../server';

const caller = (app: TestApp, token?: string) => app.call(legacyImportServer, token);
let app: TestApp;
let api: ReturnType<typeof caller>;

beforeEach(async () => {
  app = await createTestApp({ modules: [legacyImportServer] });
  api = caller(app);
});
afterEach(async () => app.close());

function csv(name: string, kind: ImportKind, rows: (string | number)[][]) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  return {
    name,
    kind,
    contentBase64: Buffer.from(rows.map((row) => row.map(escape).join(',')).join('\r\n')).toString(
      'base64',
    ),
  };
}

function voucherFile(
  debit = '10.01',
  credit = debit,
  code = '1601',
  extra: { number?: number; date?: string; department?: string } = {},
) {
  return csv('凭证.csv', 'vouchers', [
    ['凭证日期', '凭证字', '凭证号', '摘要', '科目编码', '借方金额', '贷方金额', '部门编码'],
    [
      extra.date ?? '2026-01-05',
      '记',
      extra.number ?? 7,
      '迁移购置',
      code,
      debit,
      '',
      extra.department ?? '',
    ],
    [extra.date ?? '2026-01-05', '记', extra.number ?? 7, '迁移购置', '4001', '', credit, ''],
  ]);
}

function completeInput(): PrepareInput {
  return {
    name: '合成原账完整迁移',
    files: [
      csv('科目.csv', 'accounts', [
        ['科目编码', '科目名称', '科目类别', '余额方向', '部门核算'],
        ['9999', '迁移资产', '资产', '借', '是'],
      ]),
      csv('档案.csv', 'dimensions', [
        ['辅助类型', '档案编码', '档案名称'],
        ['部门', 'D99', '迁移部门'],
      ]),
      csv('期初.csv', 'opening', [
        ['年度', '科目编码', '部门编码', '期初余额', '累计借方', '累计贷方'],
        [2026, '9999', 'D99', '123.45', '0', '0'],
        [2026, '4001', '', '-123.45', '0', '0'],
      ]),
      voucherFile('10.01', '10.01', '9999', { department: 'D99' }),
    ],
  };
}

async function prepareChecked(input: PrepareInput): Promise<ImportBatch> {
  const batch = await api.prepare(input);
  const checked = await api.preflight({ id: batch.id });
  expect(checked.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  expect(checked.status).toBe('checked');
  return checked;
}

async function businessCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).not.toBeNull();
  const wrapped = error as { cause?: { data?: { code?: string } }; data?: { code?: string } };
  return wrapped.cause?.data?.code ?? wrapped.data?.code;
}

async function accountingSnapshot() {
  return {
    accounts: await app.svc.db.selectFrom('account').selectAll().orderBy('id').execute(),
    dimensions: await app.svc.db.selectFrom('dimension_item').selectAll().orderBy('id').execute(),
    openings: await app.svc.db.selectFrom('opening_balance').selectAll().orderBy('id').execute(),
    vouchers: await app.svc.db.selectFrom('voucher').selectAll().orderBy('id').execute(),
    lines: await app.svc.db.selectFrom('voucher_line').selectAll().orderBy('id').execute(),
    logs: await app.svc.db.selectFrom('operation_log').selectAll().orderBy('id').execute(),
  };
}

describe('原账迁移真实事务与权限', () => {
  it('w_bb_saveas 四类数据一次预检不写账、确认后关联档案并以整数金额保存', async () => {
    const before = await accountingSnapshot();
    const batch = await api.prepare(completeInput());
    expect(batch.status).toBe('prepared');
    const checked = await api.preflight({ id: batch.id });
    expect(checked.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(checked.summary).toMatchObject({
      accounts: 1,
      dimensions: 1,
      opening: 2,
      vouchers: 1,
      lines: 2,
    });
    expect(await accountingSnapshot()).toEqual(before);

    const done = await api.commit({ id: batch.id, revision: checked.revision, confirmed: true });
    expect(done.status).toBe('completed');
    expect(done.receipt?.vouchers).toHaveLength(1);
    expect(done.receipt?.vouchers[0]).toMatchObject({
      original: '202601 记-7',
      displayNo: '记-0001',
    });
    const importedAccount = await app.svc.accounts.require('9999');
    const importedDepartment = (await app.svc.dimensions.getByCode('department', 'D99'))!;
    expect(importedAccount.dimensions).toMatchObject([{ type: 'department', required: true }]);
    const opening = (await app.svc.opening.list(2026)).find(
      (row) => row.accountId === importedAccount.id,
    )!;
    expect(opening).toMatchObject({
      balance: 12345,
      dimensions: { department: importedDepartment.id },
    });
    const voucher = (await app.svc.vouchers.get(done.receipt!.vouchers[0]!.id))!;
    expect(voucher).toMatchObject({ status: 'pending', debitTotal: 1001, creditTotal: 1001 });
    expect(voucher.lines[0]).toMatchObject({
      accountCode: '9999',
      debit: 1001,
      dimensions: { department: importedDepartment.id },
    });
    expect(await api.get({ id: batch.id })).toEqual(done);
  });

  it('w_bb_saveas 正式保存最后一步失败时全部账务回滚且保留源数据可重试', async () => {
    const checked = await prepareChecked(completeInput());
    const before = await accountingSnapshot();
    await sql
      .raw(
        `CREATE TRIGGER legacy_import_test_failure BEFORE INSERT ON operation_log
      WHEN NEW.action = 'legacy-import.execute' BEGIN SELECT RAISE(ABORT, '合成磁盘保存失败'); END`,
      )
      .execute(app.svc.db);
    await expect(
      api.commit({ id: checked.id, revision: checked.revision, confirmed: true }),
    ).rejects.toThrow();
    expect(await accountingSnapshot()).toEqual(before);
    const failed = await api.get({ id: checked.id });
    expect(failed.status).toBe('failed');
    expect(failed.receipt).toBeNull();
    expect(failed.files).toHaveLength(4);
    await sql.raw('DROP TRIGGER legacy_import_test_failure').execute(app.svc.db);
    const rechecked = await api.preflight({ id: failed.id });
    expect(rechecked.status).toBe('checked');
    expect(
      (await api.commit({ id: failed.id, revision: rechecked.revision, confirmed: true })).status,
    ).toBe('completed');
  });

  it('w_pz_get 借贷不平按原表行定位并且不留下科目和凭证', async () => {
    const input = completeInput();
    input.files[3] = voucherFile('10.01', '10.00', '9999', { department: 'D99' });
    const before = await accountingSnapshot();
    const prepared = await api.prepare(input);
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        file: '凭证.csv',
        row: 2,
        severity: 'error',
        message: expect.stringMatching(/借贷不平衡/),
      }),
    );
    expect(await accountingSnapshot()).toEqual(before);
    expect(
      await businessCode(
        api.commit({ id: checked.id, revision: checked.revision, confirmed: true }),
      ),
    ).toBe('IMPORT_CHECK_REQUIRED');
  });

  it.each([
    ['8888', /不存在/],
    ['1002', /非末级/],
  ])('w_pz_get 科目%s缺失或非末级时拒绝且保留原行', async (code, message) => {
    const prepared = await api.prepare({ name: '错误科目', files: [voucherFile('1', '1', code)] });
    const result = await api.preflight({ id: prepared.id });
    expect(result.status).toBe('failed');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: '凭证.csv',
        row: 2,
        column: '科目编码',
        message: expect.stringMatching(message),
      }),
    );
    const exported = await api.issuesExport({ id: result.id });
    expect(Buffer.from(exported.contentBase64, 'base64').toString('utf8')).toContain('凭证.csv');
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });

  it('w_pz_get 停用辅助档案不能转入，错误指出原行和辅助列', async () => {
    await app.svc.dimensions.create({
      type: 'department',
      code: 'OFF',
      name: '已停用部门',
      disabled: true,
    });
    const prepared = await api.prepare({
      name: '停用部门',
      files: [voucherFile('1', '1', '6602', { department: 'OFF' })],
    });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        column: '部门编码',
        message: expect.stringMatching(/已停用/),
      }),
    );
  });

  it('w_bb_saveas 期初锁定时禁止导入且原余额不变', async () => {
    await app.svc.db
      .insertInto('book_setting')
      .values({
        scope: 'opening',
        key: 'lock.2026',
        value: 'true',
        updated_at: new Date().toISOString(),
      })
      .execute();
    const prepared = await api.prepare({ name: '锁定期初', files: [completeInput().files[2]!] });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/期初已锁定/) }),
    );
    expect(await app.svc.opening.list(2026)).toEqual([]);
  });

  it('w_pz_get 已月结期间禁止导入凭证', async () => {
    await app.svc.periods.setStatus(202601, 'closed');
    const prepared = await api.prepare({ name: '已月结', files: [voucherFile()] });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/已经结账/) }),
    );
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });

  it('w_bb_saveas 已年结年度禁止导入科目档案与凭证', async () => {
    await app.svc.db
      .updateTable('fiscal_year')
      .set({ status: 'closed' })
      .where('year', '=', 2026)
      .execute();
    const prepared = await api.prepare(completeInput());
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/已经年结/) }),
    );
    expect(await app.svc.accounts.getByCode('9999')).toBeNull();
    expect(await app.svc.dimensions.getByCode('department', 'D99')).toBeNull();
  });

  it('w_bb_saveas 重复期初默认拒绝，明确替换后展示旧值并整体保存', async () => {
    const asset = await app.svc.accounts.require('1601');
    const equity = await app.svc.accounts.require('4001');
    await app.svc.opening.upsert({ year: 2026, accountId: asset.id, balance: 2000 });
    await app.svc.opening.upsert({ year: 2026, accountId: equity.id, balance: -2000 });
    const file = csv('替换期初.csv', 'opening', [
      ['年度', '科目编码', '期初余额'],
      [2026, '1601', '30.01'],
      [2026, '4001', '-30.01'],
    ]);
    const first = await api.prepare({ name: '默认拒绝重复', files: [file] });
    const firstCheck = await api.preflight({ id: first.id });
    expect(firstCheck.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/已有余额/) }),
    );
    expect(
      (await app.svc.opening.list(2026)).find((row) => row.accountId === asset.id)?.balance,
    ).toBe(2000);
    const checked = await prepareChecked({
      name: '已核对替换',
      files: [file],
      options: { openingMode: 'replace-matching' },
    });
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringMatching(/20.00.*30.01/),
      }),
    );
    await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(
      (await app.svc.opening.list(2026)).map((row) => row.balance).sort((a, b) => a - b),
    ).toEqual([-3001, 3001]);
  });

  it('w_bb_saveas 期初借贷不平不能保存', async () => {
    const prepared = await api.prepare({
      name: '缺少贷方期初',
      files: [
        csv('期初.csv', 'opening', [
          ['年度', '科目编码', '期初余额'],
          [2026, '1601', '1.00'],
        ]),
      ],
    });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({ column: '期初试算', message: expect.stringMatching(/借贷不平衡/) }),
    );
    expect(await app.svc.opening.list(2026)).toEqual([]);
  });

  it('w_pz_get 保留原号要求手工编号，自动编号不会擅改账套策略', async () => {
    const prepared = await api.prepare({
      name: '保留原号',
      files: [voucherFile()],
      options: { numbering: 'preserve' },
    });
    const rejected = await api.preflight({ id: prepared.id });
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({ column: '凭证号', message: expect.stringMatching(/手工编号/) }),
    );
    expect((await app.svc.voucherPolicy.get()).numbering).toBe('automatic');
    await app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('checked');
    const done = await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(done.receipt?.vouchers[0]?.displayNo).toBe('记-0007');
  });

  it('w_pz_get 重复确认同批次只导入一次，新批相同原凭证被识别', async () => {
    const checked = await prepareChecked({ name: '原账一次', files: [voucherFile()] });
    const done = await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(
      await api.commit({ id: checked.id, revision: checked.revision, confirmed: true }),
    ).toEqual(done);
    expect((await app.svc.vouchers.list({})).total).toBe(1);
    const repeated = await api.prepare({ name: '原账误重复', files: [voucherFile()] });
    const repeatedCheck = await api.preflight({ id: repeated.id });
    expect(repeatedCheck.status).toBe('failed');
    expect(repeatedCheck.issues).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/已经导入过/) }),
    );
    expect((await app.svc.vouchers.list({})).total).toBe(1);
  });

  it('w_bb_saveas 预检后目标变化拒绝导入，资料仍可重新预检', async () => {
    const checked = await prepareChecked({ name: '检查后变化', files: [voucherFile()] });
    await app.svc.dimensions.create({ type: 'department', code: 'NEW', name: '预检后新增' });
    expect(
      await businessCode(
        api.commit({ id: checked.id, revision: checked.revision, confirmed: true }),
      ),
    ).toBe('IMPORT_TARGET_CHANGED');
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    const failed = await api.get({ id: checked.id });
    expect(failed.files).toHaveLength(1);
    expect(failed.status).toBe('failed');
    expect((await api.preflight({ id: checked.id })).status).toBe('checked');
  });

  it('w_bb_saveas 查看权限不能暂存或导入，操作员不能读取或执行他人批次', async () => {
    const checked = await prepareChecked({ name: '管理员批次', files: [voucherFile()] });
    const viewer = caller(
      app,
      await app.addUser('viewer', { permissions: ['legacy-import.view'] }),
    );
    expect(await viewer.list({})).toEqual([]);
    expect(await businessCode(viewer.prepare({ name: '越权暂存', files: [voucherFile()] }))).toBe(
      'FORBIDDEN',
    );
    expect(
      await businessCode(
        viewer.commit({ id: checked.id, revision: checked.revision, confirmed: true }),
      ),
    ).toBe('FORBIDDEN');
    const importer = caller(
      app,
      await app.addUser('importer', {
        permissions: ['legacy-import.view', 'legacy-import.prepare', 'legacy-import.execute'],
      }),
    );
    expect(await businessCode(importer.get({ id: checked.id }))).toBe('IMPORT_NOT_FOUND');
    expect(await businessCode(importer.preflight({ id: checked.id }))).toBe('IMPORT_NOT_FOUND');
    expect(
      await businessCode(
        importer.commit({ id: checked.id, revision: checked.revision, confirmed: true }),
      ),
    ).toBe('IMPORT_NOT_FOUND');
    expect((await api.get({ id: checked.id })).status).toBe('checked');
  });

  it('w_bb_saveas 科目与档案可按子级在前的源顺序导入且保持层级依赖', async () => {
    const checked = await prepareChecked({
      name: '乱序父子档案',
      files: [
        csv('层级科目.csv', 'accounts', [
          ['科目编码', '科目名称', '科目类别'],
          ['910101', '迁移明细', '资产'],
          ['9101', '迁移总账', '资产'],
        ]),
        csv('层级档案.csv', 'dimensions', [
          ['辅助类型', '档案编码', '档案名称', '上级编码'],
          ['部门', 'D0102', '迁移二部', 'D01'],
          ['部门', 'D01', '迁移总部', ''],
        ]),
      ],
    });
    expect(await app.svc.accounts.getByCode('9101')).toBeNull();
    await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    const parent = await app.svc.accounts.require('9101');
    const child = await app.svc.accounts.require('910101');
    expect(parent.isLeaf).toBe(false);
    expect(child).toMatchObject({
      parentId: parent.id,
      fullName: '迁移总账/迁移明细',
      isLeaf: true,
    });
    const department = (await app.svc.dimensions.getByCode('department', 'D01'))!;
    expect(department.isLeaf).toBe(false);
    expect(await app.svc.dimensions.getByCode('department', 'D0102')).toMatchObject({
      parentId: department.id,
      isLeaf: true,
    });
  });

  it('w_pz_get 零本币但有外币或数量的原分录保持借贷侧及六位数量精度', async () => {
    const checked = await prepareChecked({
      name: '外币数量迁移',
      files: [
        csv('复币数量.csv', 'vouchers', [
          [
            '凭证日期',
            '凭证字',
            '凭证号',
            '摘要',
            '科目编码',
            '借方金额',
            '贷方金额',
            '币种',
            '汇率',
            '外币金额',
            '数量',
            '单价',
            '借贷方向',
          ],
          [
            '2026-01-06',
            '记',
            9,
            '外币转入',
            '100202',
            '',
            '',
            'USD',
            '7.100001',
            '1.23',
            '',
            '',
            '借',
          ],
          [
            '2026-01-06',
            '记',
            9,
            '外币转出',
            '100202',
            '',
            '',
            'USD',
            '7.100001',
            '1.23',
            '',
            '',
            '贷',
          ],
          [
            '2026-01-06',
            '记',
            9,
            '数量转入',
            '1403',
            '',
            '',
            '',
            '',
            '',
            '1.234567',
            '12.3456789',
            '借',
          ],
          [
            '2026-01-06',
            '记',
            9,
            '数量转出',
            '1403',
            '',
            '',
            '',
            '',
            '',
            '1.234567',
            '12.3456789',
            '贷',
          ],
        ]),
      ],
    });
    const done = await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    const voucher = (await app.svc.vouchers.get(done.receipt!.vouchers[0]!.id))!;
    expect(voucher).toMatchObject({ debitTotal: 0, creditTotal: 0, status: 'pending' });
    expect(
      voucher.lines.map((line) => [
        line.entrySide,
        line.currency,
        line.fcAmount,
        line.quantity,
        line.unitPrice,
      ]),
    ).toEqual([
      ['debit', 'USD', 123, null, null],
      ['credit', 'USD', 123, null, null],
      ['debit', null, null, '1.234567', '12.3456789'],
      ['credit', null, null, '1.234567', '12.3456789'],
    ]);
  });

  it('w_bb_saveas 明确贷方期初方向时本币、外币与数量按同一方向承接', async () => {
    const checked = await prepareChecked({
      name: '贷方原账期初',
      files: [
        csv('贷方期初.csv', 'opening', [
          ['年度', '科目编码', '期初余额', '期初方向', '币种', '外币余额', '数量'],
          [2026, '100202', '71', '贷', 'USD', '10', ''],
          [2026, '1403', '12.34', '贷', '', '', '1.25'],
          [2026, '4001', '83.34', '借', '', '', ''],
        ]),
      ],
    });
    await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    const rows = await app.svc.opening.list(2026);
    const foreign = await app.svc.accounts.require('100202');
    const quantity = await app.svc.accounts.require('1403');
    expect(rows.find((row) => row.accountId === foreign.id)).toMatchObject({
      balance: -7100,
      fcBalance: -1000,
      currency: 'USD',
    });
    expect(rows.find((row) => row.accountId === quantity.id)).toMatchObject({
      balance: -1234,
      quantity: '-1.25',
    });
  });

  it('w_pz_get 原分录号排序保持源分录顺序，01和1视为重复并拒绝', async () => {
    const headers = [
      '凭证日期',
      '凭证字',
      '凭证号',
      '原分录号',
      '摘要',
      '科目编码',
      '借方金额',
      '贷方金额',
    ];
    const rows = [
      ['2026-01-07', '记', '10', '2', '原第二行', '1601', '1.01', ''],
      ['2026-01-07', '记', '10', '1', '原第一行', '4001', '', '1.01'],
    ];
    const checked = await prepareChecked({
      name: '原分录顺序',
      files: [csv('排序凭证.csv', 'vouchers', [headers, ...rows])],
    });
    const done = await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(
      (await app.svc.vouchers.get(done.receipt!.vouchers[0]!.id))!.lines.map(
        (line) => line.summary,
      ),
    ).toEqual(['原第一行', '原第二行']);
    rows[0]![3] = '01';
    const duplicate = await api.prepare({
      name: '重复分录号',
      files: [csv('重复分录.csv', 'vouchers', [headers, ...rows])],
    });
    const result = await api.preflight({ id: duplicate.id });
    expect(result.status).toBe('failed');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringMatching(/原分录号重复/),
      }),
    );
    expect((await app.svc.vouchers.list({})).total).toBe(1);
  });

  it('w_pz_get 同一原凭证表头不一致时整张拒绝', async () => {
    const prepared = await api.prepare({
      name: '同号日期冲突',
      files: [
        csv('日期冲突.csv', 'vouchers', [
          ['凭证日期', '凭证字', '凭证号', '摘要', '科目编码', '借方金额', '贷方金额'],
          ['2026-01-07', '记', 12, '借方', '1601', '1', ''],
          ['2026-01-08', '记', 12, '贷方', '4001', '', '1'],
        ]),
      ],
    });
    const result = await api.preflight({ id: prepared.id });
    expect(result.status).toBe('failed');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        row: 3,
        column: '凭证日期',
        message: expect.stringMatching(/不一致/),
      }),
    );
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });

  it('w_bb_saveas 期初辅助类型不匹配时不能借用同编码的其他类型档案', async () => {
    const prepared = await api.prepare({
      name: '错误辅助类型',
      files: [
        csv('错误辅助期初.csv', 'opening', [
          ['年度', '科目编码', '部门编码', '期初余额'],
          [2026, '6602', 'XM01', '1'],
          [2026, '4001', '', '-1'],
        ]),
      ],
    });
    const result = await api.preflight({ id: prepared.id });
    expect(result.status).toBe('failed');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        column: '部门编码',
        message: expect.stringMatching(/不存在/),
      }),
    );
    expect(await app.svc.opening.list(2026)).toEqual([]);
  });

  it('w_bb_saveas 来源导出回读历史审核资料及凭证对照，原状态不伪造成新审批', async () => {
    const checked = await prepareChecked({
      name: '历史制单资料',
      files: [
        csv('历史凭证.csv', 'vouchers', [
          [
            '凭证日期',
            '凭证字',
            '凭证号',
            '摘要',
            '科目编码',
            '借方金额',
            '贷方金额',
            '原状态',
            '原制单人',
            '原审核人',
            '原过账人',
          ],
          [
            '2026-01-09',
            '记',
            15,
            '原账借方',
            '1601',
            '1.25',
            '',
            '已过账',
            '原制单甲',
            '原审核乙',
            '原记账丙',
          ],
          [
            '2026-01-09',
            '记',
            15,
            '原账贷方',
            '4001',
            '',
            '1.25',
            '已过账',
            '原制单甲',
            '原审核乙',
            '原记账丙',
          ],
        ]),
      ],
    });
    const done = await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    const exported = await api.sourceExport({ id: checked.id });
    const bytes = Buffer.from(exported.contentBase64, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const source = workbook.worksheets.find((sheet) => sheet.getCell('H1').value === '原状态')!;
    expect(source.getRow(2).values).toEqual([
      undefined,
      '2026-01-09',
      '记',
      '15',
      '原账借方',
      '1601',
      '1.25',
      '',
      '已过账',
      '原制单甲',
      '原审核乙',
      '原记账丙',
    ]);
    expect(workbook.getWorksheet('凭证对照')!.getRow(2).values).toContain('202601 记-15');
    const voucher = (await app.svc.vouchers.get(done.receipt!.vouchers[0]!.id))!;
    expect(voucher).toMatchObject({ status: 'pending', auditedBy: null, postedBy: null });
    expect(voucher.createdBy.name).toBe('系统管理员');
    const outsider = caller(
      app,
      await app.addUser('source_outsider', { permissions: ['legacy-import.view'] }),
    );
    expect(await businessCode(outsider.sourceExport({ id: checked.id }))).toBe('IMPORT_NOT_FOUND');
  });

  it('w_bb_saveas 错误CSV导出将公式开头文件名与列名转义为文字', async () => {
    const prepared = await api.prepare({
      name: '公式文本文件名',
      files: [
        csv('=1+1.csv', 'accounts', [
          ['科目编码', '科目名称', '=DANGEROUS()'],
          ['BAD', '错误编码', '原文'],
        ]),
      ],
    });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    const exported = await api.issuesExport({ id: checked.id });
    const text = Buffer.from(exported.contentBase64, 'base64').toString('utf8');
    expect(text).toContain('"\'=1+1.csv"');
    expect(text).toContain('"\'=DANGEROUS()"');
  });

  it('w_bb_saveas 客供独立资料列保持文本首零并与扩展资料合并，角色按原账含义保存', async () => {
    const checked = await prepareChecked({
      name: '客供全资料',
      files: [
        csv('原客供档案.csv', 'dimensions', [
          [
            '辅助类型',
            '档案编码',
            '档案名称',
            '联系人',
            '电话',
            '通讯地址',
            '邮编',
            '开户银行',
            '银行账号',
            '税号',
            '简称',
            '客供角色',
            '分类名称',
            '扩展资料',
          ],
          [
            '客供',
            '0012',
            '合成客户',
            '联系人甲',
            '010-001234',
            '合成地址一号',
            '001234',
            '合成银行',
            '000123456789',
            '000987654321',
            '合客',
            '客户',
            '华东客户',
            '{"备注":"原账保留"}',
          ],
          ['客供', '0013', '合成供应商', '', '', '', '', '', '', '', '', '供应商', '', ''],
          ['客供', '0014', '合成双向单位', '', '', '', '', '', '', '', '', '双向', '', ''],
          ['客供', '0015', '原账未分角色', '', '', '', '', '', '', '', '', '', '', ''],
        ]),
      ],
    });
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        row: 5,
        column: '客供角色',
        severity: 'warning',
        message: expect.stringMatching(/双向/),
      }),
    );
    expect(await app.svc.dimensions.getByCode('partner', '0012')).toBeNull();
    await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect((await app.svc.dimensions.getByCode('partner', '0012'))!.attrs).toEqual({
      contact: '联系人甲',
      phone: '010-001234',
      address: '合成地址一号',
      postalCode: '001234',
      bank: '合成银行',
      bankAccount: '000123456789',
      taxNumber: '000987654321',
      shortName: '合客',
      role: 'customer',
      category: '华东客户',
      备注: '原账保留',
    });
    expect((await app.svc.dimensions.getByCode('partner', '0013'))!.attrs.role).toBe('supplier');
    expect((await app.svc.dimensions.getByCode('partner', '0014'))!.attrs.role).toBe('both');
    expect((await app.svc.dimensions.getByCode('partner', '0015'))!.attrs.role).toBe('both');
  });

  it.each([
    ['联系人', '联系人乙', '{"contact":"联系人甲"}', '客供'],
    ['客供角色', '供应商', '{"role":"customer"}', '客供'],
    ['现金流量方向', '流入', '{"cashflowDirection":"outflow"}', '现金流量项目'],
    ['分类名称', '分类乙', '{"category":"分类甲"}', '客供'],
  ])('w_bb_saveas 独立%s与扩展资料冲突时定位列并拒绝', async (column, value, attrs, type) => {
    const before = await accountingSnapshot();
    const prepared = await api.prepare({
      name: '独立列冲突',
      files: [
        csv('资料冲突.csv', 'dimensions', [
          ['辅助类型', '档案编码', '档案名称', column, '扩展资料'],
          [type, 'CONFLICT', '合成冲突资料', value, attrs],
        ]),
      ],
    });
    const result = await api.preflight({ id: prepared.id });
    expect(result.status).toBe('failed');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        file: '资料冲突.csv',
        row: 2,
        column,
        severity: 'error',
        message: expect.stringMatching(/不一致/),
      }),
    );
    expect(await accountingSnapshot()).toEqual(before);
  });

  it('w_bb_saveas 已有档案可提供一致资料子集，嵌套扩展对象属性顺序不造成冲突或覆盖', async () => {
    const attrs = {
      role: 'customer',
      contact: '联系人甲',
      phone: '010-123456',
      customInfo: { code: '007', nested: { area: '华北', tax: '001' } },
    };
    const old = await app.svc.dimensions.create({
      type: 'partner',
      code: 'EXIST',
      name: '已有合成客供',
      attrs,
    });
    const checked = await prepareChecked({
      name: '核对已有资料',
      files: [
        csv('已有客供.csv', 'dimensions', [
          ['辅助类型', '档案编码', '档案名称', '联系人', '扩展资料'],
          [
            '客供',
            'EXIST',
            '已有合成客供',
            '联系人甲',
            '{"customInfo":{"nested":{"tax":"001","area":"华北"},"code":"007"}}',
          ],
        ]),
      ],
    });
    expect(checked.summary.reusedDimensions).toBe(1);
    expect(checked.summary.dimensions).toBe(0);
    await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(await app.svc.dimensions.getByCode('partner', 'EXIST')).toMatchObject({
      id: old.id,
      attrs,
    });
    expect((await app.svc.dimensions.getByCode('partner', 'EXIST'))!.attrs.phone).toBe(
      '010-123456',
    );
  });

  it('w_bb_saveas 新现金流量档案必须明确方向，合法三种方向落入资料属性', async () => {
    const file = csv('现金流量档案.csv', 'dimensions', [
      ['辅助类型', '档案编码', '档案名称', '现金流量方向'],
      ['现金流量项目', 'FLOW-IN', '合成流入', '流入'],
      ['现金流量项目', 'FLOW-OUT', '合成流出', '流出'],
      ['现金流量项目', 'FLOW-INT', '合成内部转移', '内部转移'],
    ]);
    const missing = await api.prepare({
      name: '未明确流量方向',
      files: [
        csv('缺少方向.csv', 'dimensions', [
          ['辅助类型', '档案编码', '档案名称'],
          ['现金流量项目', 'FLOW-MISSING', '未分类流量'],
        ]),
      ],
    });
    const rejected = await api.preflight({ id: missing.id });
    expect(rejected.status).toBe('failed');
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        column: '现金流量方向',
        severity: 'error',
        message: expect.stringMatching(/必须填写/),
      }),
    );
    const checked = await prepareChecked({ name: '明确流量方向', files: [file] });
    await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(
      (await app.svc.dimensions.getByCode('cashflow', 'FLOW-IN'))!.attrs.cashflowDirection,
    ).toBe('inflow');
    expect(
      (await app.svc.dimensions.getByCode('cashflow', 'FLOW-OUT'))!.attrs.cashflowDirection,
    ).toBe('outflow');
    expect(
      (await app.svc.dimensions.getByCode('cashflow', 'FLOW-INT'))!.attrs.cashflowDirection,
    ).toBe('internal');
    expect(await app.svc.dimensions.getByCode('cashflow', 'FLOW-MISSING')).toBeNull();
  });

  it('w_bb_saveas 首月已结账后仍可在当前未结账月导入新往来科目档案及当月凭证', async () => {
    await app.svc.periods.setStatus(202601, 'closed');
    const checked = await prepareChecked({
      name: '次月新增迁移',
      files: [
        csv('次月往来科目.csv', 'accounts', [
          ['科目编码', '科目名称', '科目类别', '往来科目', '客供核算'],
          ['9199', '合成应收项目', '资产', '是', '是'],
        ]),
        csv('次月客供.csv', 'dimensions', [
          ['辅助类型', '档案编码', '档案名称', '客供角色'],
          ['客供', 'FEB-C', '次月合成客户', '客户'],
        ]),
        csv('次月凭证.csv', 'vouchers', [
          ['凭证日期', '凭证字', '凭证号', '摘要', '科目编码', '借方金额', '贷方金额', '客供编码'],
          ['2026-02-01', '记', 1, '次月借方', '9199', '2.01', '', 'FEB-C'],
          ['2026-02-01', '记', 1, '次月贷方', '4001', '', '2.01', ''],
        ]),
      ],
    });
    const done = await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(await app.svc.accounts.require('9199')).toMatchObject({
      isPartner: true,
      dimensions: [{ type: 'partner', required: true }],
    });
    expect(await app.svc.dimensions.getByCode('partner', 'FEB-C')).not.toBeNull();
    expect(await app.svc.vouchers.get(done.receipt!.vouchers[0]!.id)).toMatchObject({
      period: 202602,
      debitTotal: 201,
      creditTotal: 201,
    });
    expect((await app.svc.periods.require(202601)).status).toBe('closed');
  });
});
