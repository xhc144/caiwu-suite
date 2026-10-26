import { afterEach, beforeEach, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import Database from 'better-sqlite3';
import { createTestApp, createTestBook, type TestApp } from '@caiwu/testkit';
import { runMigrations } from '@caiwu/db';
import { migrations } from '../server/migrations';
import { excelService } from '../server/excel';
import { createCoreServices } from '@caiwu/core/server';
import type { ExcelInput, ReferenceKind } from '../shared';
import server from '../server';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(server, token);
let api: ReturnType<typeof caller>;
let concurrent: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  api = caller(app);
  concurrent = caller(
    app,
    await app.addUser('operator-b', { permissions: ['masterdata.reference.edit'] }),
  );
});
afterEach(async () => app.close());

async function file(kind: ReferenceKind, rows: unknown[][]): Promise<ExcelInput> {
  const source = await api.excel.export({ kind: 'reference', referenceKind: kind });
  const original = new Workbook();
  await original.xlsx.load(
    Buffer.from(source.content, 'base64') as unknown as Parameters<typeof original.xlsx.load>[0],
  );
  const output = new Workbook();
  const sheet = output.addWorksheet('参考档案');
  sheet.addRow((original.worksheets[0]!.getRow(1).values as unknown[]).slice(1));
  rows.forEach((row) => sheet.addRow(row));
  return {
    ...source,
    kind: 'reference',
    referenceKind: kind,
    content: Buffer.from(await output.xlsx.writeBuffer()).toString('base64'),
  };
}
async function planned(input: ExcelInput) {
  const preview = await api.excel.preview(input);
  expect(preview.valid).toBe(true);
  return {
    ...input,
    previewToken: preview.previewToken,
    confirmations: [...preview.confirmations.map((w) => w.key), 'import'],
  };
}
const original = {
  kind: 'summaries' as const,
  code: '03',
  name: 'A预览名称',
  category: 'A分类',
  shortcut: 'A快捷词',
};
const state = () => api.reference.list({ kind: 'summaries' });

it('w_xt_zy：A预览新增03，B随后新增同码，旧预览必须拒绝且B字段与前行均不变', async () => {
  const plan = await planned(
    await file('summaries', [
      ['00', '批次前行', '', '', 0],
      ['03', original.name, original.category, original.shortcut, 0],
    ]),
  );
  await concurrent.reference.save({
    ...original,
    name: 'B新名称',
    category: 'B分类',
    shortcut: 'B快捷词',
  });
  const before = await state();
  await expect(api.excel.commit(plan)).rejects.toThrow('重新预览');
  expect(await state()).toEqual(before);
});
it('w_xt_zy：预览已有项后另一调用编辑名称/类别/快捷词，旧预览不能覆盖', async () => {
  await api.reference.save(original);
  const plan = await planned(
    await file('summaries', [['03', '导入名称', '导入分类', '导入快捷词', 0]]),
  );
  const row = (await state()).find((r) => r.code === '03')!;
  await concurrent.reference.save({
    ...row,
    kind: 'summaries',
    name: 'B编辑',
    category: 'B类别',
    shortcut: 'B检索词',
  });
  const before = await state();
  await expect(api.excel.commit(plan)).rejects.toThrow('重新预览');
  expect(await state()).toEqual(before);
});
it('w_xt_zy：预览后删除并原样重建，SQLite复用ID也必须拒绝旧预览', async () => {
  await api.reference.save(original);
  const input = await file('summaries', [
    ['03', original.name, original.category, original.shortcut, 0],
  ]);
  const plan = await planned(input);
  const row = (await state()).find((r) => r.code === '03')!;
  await concurrent.reference.remove({
    kind: 'summaries',
    id: row.id,
    code: row.code,
    confirmed: true,
  });
  await concurrent.reference.save(original);
  const before = await state();
  // 真实核心表的INTEGER PRIMARY KEY允许重用最高ID；不能只比较当前字段摘要。
  expect(before.find((r) => r.code === '03')?.id).toBe(row.id);
  await expect(api.excel.commit(plan)).rejects.toThrow('重新预览');
  expect(await state()).toEqual(before);
});
it('w_xt_jslb：预览后停用类别，旧内容不能重新启用它', async () => {
  await api.reference.save({ kind: 'settlementMethods', code: 'W2', name: '测试结算' });
  const plan = await planned(await file('settlementMethods', [['W2', '测试结算', 0, 0]]));
  const row = (await api.reference.list({ kind: 'settlementMethods' })).find(
    (r) => r.code === 'W2',
  )!;
  await concurrent.reference.save({ ...row, kind: 'settlementMethods', disabled: true });
  const before = await api.reference.list({ kind: 'settlementMethods' });
  await expect(api.excel.commit(plan)).rejects.toThrow('重新预览');
  expect(await api.reference.list({ kind: 'settlementMethods' })).toEqual(before);
});
it('w_xt_zy：预览后编辑再还原原字段也必须失效；重新预览后可提交', async () => {
  await api.reference.save(original);
  const input = await file('summaries', [['03', '目标名称', '', '', 0]]);
  const plan = await planned(input);
  const row = (await state()).find((r) => r.code === '03')!;
  await concurrent.reference.save({ ...row, kind: 'summaries', name: '中间编辑' });
  await concurrent.reference.save({ ...row, kind: 'summaries' });
  expect(await state()).toContainEqual(row);
  await expect(api.excel.commit(plan)).rejects.toThrow('重新预览');
  await api.excel.commit(await planned(input));
  expect((await state()).find((r) => r.code === '03')).toMatchObject({
    id: row.id,
    name: '目标名称',
  });
});
it('w_xt_zy：没有预览、篡改文件/类型/账套或指纹均不能确认，未变化预览仍保留最终确认', async () => {
  const input = await file('summaries', [
    ['03', original.name, original.category, original.shortcut, 0],
  ]);
  const plan = await planned(input);
  await expect(api.excel.commit({ ...input, confirmations: ['import'] })).rejects.toThrow(
    '重新预览',
  );
  const changed = await file('summaries', [['03', '替换文件', '', '', 0]]);
  await expect(api.excel.commit({ ...plan, ...changed })).rejects.toThrow('重新预览');
  await expect(api.excel.commit({ ...plan, referenceKind: 'settlementMethods' })).rejects.toThrow();
  const currencies = await planned(await file('currencies', [['EUR', '欧元', '€', 0, 0]]));
  // 币种表头包含结算表的全部必填列，保证不是仅靠缺表头校验挡住类型偷换。
  await expect(
    api.excel.commit({ ...currencies, referenceKind: 'settlementMethods' }),
  ).rejects.toThrow('重新预览');
  await expect(api.excel.commit({ ...plan, previewToken: '0'.repeat(64) })).rejects.toThrow(
    '重新预览',
  );
  const other = await createTestApp({ modules: [server] });
  try {
    await expect(other.call(server).excel.commit(plan)).rejects.toThrow('重新预览');
  } finally {
    await other.close();
  }
  const confirmationPlan = await planned(input);
  await expect(
    api.excel.commit({ ...confirmationPlan, previewToken: '0'.repeat(64) }),
  ).rejects.toThrow('重新预览');
  await expect(api.excel.commit({ ...confirmationPlan, confirmations: [] })).rejects.toThrow(
    '确认导入',
  );
  expect((await state()).some((r) => r.code === '03')).toBe(false);
  await expect(api.excel.commit(confirmationPlan)).rejects.toThrow('重新预览');
  const freshPlan = await planned(input);
  await api.excel.commit(freshPlan);
  expect((await state()).find((r) => r.code === '03')?.name).toBe(original.name);
  await expect(api.excel.commit(freshPlan)).rejects.toThrow('重新预览');
});

it('w_xt_kmwh / w_xt_fhwh：科目和辅助Excel也拒绝预览后编辑，前行与并发字段保持不变', async () => {
  const accountFile = {
    ...(await api.excel.export({ kind: 'accounts' })),
    kind: 'accounts' as const,
  };
  const accountPlan = await planned(accountFile);
  const account = await app.svc.accounts.require('6603');
  await api.accounts.save({ ...account, name: 'B修改财务费用', dimensions: [] });
  const accounts = await app.svc.accounts.list();
  await expect(api.excel.commit(accountPlan)).rejects.toThrow('重新预览');
  expect(await app.svc.accounts.list()).toEqual(accounts);
  const dimensionFile = {
    ...(await api.excel.export({ kind: 'dimensions', type: 'department' })),
    kind: 'dimensions' as const,
    type: 'department' as const,
  };
  const dimensionPlan = await planned(dimensionFile);
  const item = (await app.svc.dimensions.getByCode('department', '01'))!;
  await api.dimensions.save({
    ...item,
    type: 'department',
    name: 'B修改部门',
    attrs: { contact: 'B联系人' },
  });
  const dimensions = await app.svc.dimensions.items('department');
  await expect(api.excel.commit(dimensionPlan)).rejects.toThrow('重新预览');
  expect(await app.svc.dimensions.items('department')).toEqual(dimensions);
});

it('w_xt_kmbm_get：原0001账套不改迁移或数据，另一SQLite连接改后还原及重开账套均拒绝旧预览', async () => {
  const old = await createTestBook({
    migrationSets: [{ scope: 'masterdata', migrations: [migrations[0]!] }],
  });
  try {
    const originalRows = await old.svc.reference.summaries();
    const raw = old.book.raw;
    const migrationBefore = raw
      .prepare("SELECT * FROM _migration WHERE scope='masterdata' AND id='0001_masterdata'")
      .get();
    runMigrations(raw, [{ scope: 'masterdata', migrations }]);
    expect(
      raw
        .prepare("SELECT * FROM _migration WHERE scope='masterdata' AND id='0001_masterdata'")
        .get(),
    ).toEqual(migrationBefore);
    expect(await old.svc.reference.summaries()).toEqual(originalRows);
    const excel = excelService(old.forModule('masterdata'));
    const source = {
      ...(await excel.export('reference', undefined, 'summaries')),
      kind: 'reference' as const,
      referenceKind: 'summaries' as const,
    };
    const preview = await excel.process(source, false);
    const version = () => raw.pragma('data_version', { simple: true }) as number;
    const beforeVersion = version();
    const summary = originalRows[0]!;
    const otherConnection = new Database(raw.name);
    try {
      otherConnection
        .prepare('UPDATE summary_phrase SET text=? WHERE id=?')
        .run('其他连接核心写入', summary.id);
      otherConnection
        .prepare('UPDATE summary_phrase SET text=? WHERE id=?')
        .run(summary.text, summary.id);
    } finally {
      otherConnection.close();
    }
    expect(await old.svc.reference.summaries()).toEqual(originalRows);
    const revision = version();
    expect(revision).toBeGreaterThan(beforeVersion);
    await expect(
      excel.process(
        { ...source, previewToken: preview.previewToken, confirmations: ['import'] },
        true,
      ),
    ).rejects.toThrow('重新预览');
    expect(version()).toBe(revision);
    await old.store.closeAll();
    const reopened = old.store.open(old.info.id);
    const resumed = createCoreServices({ ...old.forModule('masterdata').ctx, db: reopened.db });
    await expect(
      excelService(resumed).process(
        { ...source, previewToken: preview.previewToken, confirmations: ['import'] },
        true,
      ),
    ).rejects.toThrow('重新预览');
    expect(await resumed.reference.summaries()).toEqual(originalRows);
    expect(
      reopened.raw
        .prepare("SELECT * FROM _migration WHERE scope='masterdata' AND id='0001_masterdata'")
        .get(),
    ).toEqual(migrationBefore);
  } finally {
    await old.close();
  }
});
