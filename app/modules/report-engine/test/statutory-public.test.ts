import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { sql } from '@caiwu/db';
import ExcelJS from 'exceljs';
import reportServer from '../server';
import { statutoryRegistry } from '../server/statutory-registry';
import type { ReportTables } from '../server/migrations';
import type { EnterpriseResult } from '../templates/enterprise/model';
import {
  statutoryTestTemplate,
  statutoryIdentity,
  seedStatutoryBook,
  statutoryTestConfiguration,
} from './statutory-fixture';

const mod = { ...reportServer, templates: [statutoryTestTemplate] };
let app: TestApp;
const api = () => app.call(mod).statutory;
const count = async () =>
  (
    await app.svc.db
      .withTables<ReportTables>()
      .selectFrom('report_engine_statutory_snapshot')
      .select('id')
      .execute()
  ).length;
beforeEach(async () => {
  app = await createTestApp({
    modules: [mod],
    templateId: statutoryTestTemplate.id,
    startYear: 2023,
    seed: false,
  });
  await seedStatutoryBook(app.svc);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});
async function saved(code = '201', reportKey = 'balance') {
  return api().save({
    ...statutoryIdentity,
    reportKey,
    code,
    name: '合成企业资产负债表',
    configuration: await statutoryTestConfiguration(app.svc),
  });
}
it('w_bb_main/w_bb_add 制度发现只注册真实定义；强制定义修订、适用制度和204年报', async () => {
  const catalog = await api().catalog();
  expect(catalog.map((d) => d.definitionId)).toEqual(['enterprise-2019-appendix2']);
  expect(catalog[0]!.descriptors.map((d) => d.key)).toEqual([
    'balance',
    'profit',
    'cashflow',
    'equity',
  ]);
  const c = await statutoryTestConfiguration(app.svc);
  await expect(
    api().save({
      ...statutoryIdentity,
      definitionId: 'missing-definition',
      code: '201',
      name: '无定义',
      configuration: c,
    }),
  ).rejects.toThrow('不存在');
  await expect(
    api().save({
      ...statutoryIdentity,
      definitionRevision: 99,
      code: '201',
      name: '错版本',
      configuration: c,
    }),
  ).rejects.toThrow('版本');
  await expect(
    api().save({
      ...statutoryIdentity,
      reportKey: 'equity',
      code: '204',
      name: '权益',
      configuration: { ...c, scope: 'month' },
    }),
  ).rejects.toThrow('年报');
  await app.svc.db.updateTable('book_info').set({ regime: 'nonprofit' }).execute();
  expect(await api().catalog()).toEqual([]);
  await expect(saved()).rejects.toThrow('不适用');
});
it('w_bb_proc 真实账套prepare/verify/generate/成功快照均使用tsvc；重放不重复写入且每次核源', async () => {
  const adapter = statutoryRegistry[0]!;
  const prepared = adapter.prepare.bind(adapter),
    verified = adapter.verify.bind(adapter),
    generated = adapter.generate.bind(adapter);
  const transactions: boolean[] = [];
  vi.spyOn(adapter, 'prepare').mockImplementation((svc, c, key) => {
    transactions.push(svc.db.isTransaction);
    return prepared(svc, c, key);
  });
  const verify = vi.spyOn(adapter, 'verify').mockImplementation((svc, p, period) => {
    transactions.push(svc.db.isTransaction);
    return verified(svc, p, period);
  });
  vi.spyOn(adapter, 'generate').mockImplementation((svc, p, period, confirm) => {
    transactions.push(svc.db.isTransaction);
    return generated(svc, p, period, confirm);
  });
  const p = await saved();
  expect(p.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
  const input = { id: p.id, expectedRevision: p.revision, period: 202512, requestId: randomUUID() };
  const results = await Promise.all([api().generate(input), api().generate(input)]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]!.kind).toBe('generated');
  if (results[0]!.kind !== 'generated') throw new Error('意外确认');
  const snapshot = results[0]!.snapshot;
  expect(snapshot.profile).toEqual(p);
  expect((snapshot.result as EnterpriseResult).balance.current.cash).toBe('100000');
  expect((snapshot.result as EnterpriseResult).balance.current.capital).toBe('100000');
  expect(await count()).toBe(1);
  expect(verify).toHaveBeenCalledTimes(2);
  expect(transactions.every(Boolean)).toBe(true);
  const before = await api().snapshot({ id: p.id, period: 202512 });
  await app.svc.opening.upsert({
    year: 2025,
    accountId: (await app.svc.accounts.require('1001')).id,
    balance: 100001,
  });
  await expect(api().generate(input)).rejects.toThrow('来源已变化');
  await expect(api().generate({ ...input, requestId: randomUUID() })).rejects.toThrow('来源已变化');
  await expect(
    api().output({
      id: p.id,
      expectedRevision: p.revision,
      snapshotId: snapshot.id,
      period: 202512,
      format: 'xlsx',
    }),
  ).rejects.toThrow('来源已变化');
  await expect(
    api().output({
      id: p.id,
      expectedRevision: p.revision,
      snapshotId: snapshot.id,
      period: 202512,
      format: 'print',
    }),
  ).rejects.toThrow('来源已变化');
  expect(await api().snapshot({ id: p.id, period: 202512 })).toEqual(before);
  expect(await count()).toBe(1);
});
it('w_bb_proc 未过账先确认；确认重走核源；请求冲突和期间错误均零新快照', async () => {
  await seedVouchers(app.svc, [
    {
      date: '2025-12-01',
      lines: [
        { account: '1001', debit: 1 },
        { account: '4001', credit: 1 },
      ],
    },
  ]);
  const p = await saved();
  const input = { id: p.id, expectedRevision: p.revision, period: 202512, requestId: randomUUID() };
  expect(await api().generate(input)).toMatchObject({ kind: 'confirmation', count: 1 });
  expect(await count()).toBe(0);
  const out = await api().generate({ ...input, confirmUnposted: true });
  expect(out.kind).toBe('generated');
  const other = await saved('205');
  await expect(api().generate({ ...input, id: other.id, confirmUnposted: true })).rejects.toThrow(
    '请求编号',
  );
  await expect(
    api().generate({ ...input, period: 202511, requestId: randomUUID() }),
  ).rejects.toThrow('报告期间');
  expect(await count()).toBe(1);
});
it('w_bb_proc 计算失败、插入失败和配置冲突保留成功快照；失败不增加快照', async () => {
  const p = await saved();
  const input = { id: p.id, expectedRevision: p.revision, period: 202512, requestId: randomUUID() };
  await api().generate(input);
  const before = await api().snapshot({ id: p.id, period: 202512 });
  await sql`CREATE TRIGGER report_engine_test_insert_failure BEFORE INSERT ON report_engine_statutory_snapshot BEGIN SELECT RAISE(ABORT, 'test snapshot failure'); END`.execute(
    app.svc.db,
  );
  await expect(api().generate({ ...input, requestId: randomUUID() })).rejects.toThrow(
    'test snapshot failure',
  );
  expect(await count()).toBe(1);
  await sql`DROP TRIGGER report_engine_test_insert_failure`.execute(app.svc.db);
  const c = await statutoryTestConfiguration(app.svc);
  await expect(
    api().save({
      ...statutoryIdentity,
      id: p.id,
      expectedRevision: p.revision,
      code: p.code,
      name: p.name,
      configuration: { ...c, cashPolicies: [] },
    }),
  ).rejects.toThrow('现金');
  expect(await api().get({ id: p.id })).toEqual(p);
  c.adjustments.push({
    period: 202512,
    statement: 'balance',
    row: 'cash',
    amount: '1',
    kind: 'error',
    source: '合成不平衡调整',
    version: '1',
  });
  const next = await api().save({
    ...statutoryIdentity,
    id: p.id,
    expectedRevision: p.revision,
    code: p.code,
    name: p.name,
    configuration: c,
  });
  await expect(
    api().generate({ ...input, expectedRevision: next.revision, requestId: randomUUID() }),
  ).rejects.toThrow('差额');
  await expect(api().generate({ ...input, requestId: randomUUID() })).rejects.toThrow('配置已修改');
  expect(await api().snapshot({ id: p.id, period: 202512 })).toEqual(before);
  expect(await count()).toBe(1);
});
it('w_bb_copy/w_bb_get 复制及重引入保留定义身份；不信任外来摘要或错账套科目编号', async () => {
  const p = await saved();
  const copy = await api().copy({
    id: p.id,
    expectedRevision: p.revision,
    code: '205',
    name: '副本',
  });
  expect(copy).toMatchObject({
    ...statutoryIdentity,
    configuration: p.configuration,
    sourceDigest: p.sourceDigest,
  });
  expect(copy.id).not.toBe(p.id);
  const envelope = await api().exportTemplate({ id: p.id });
  const imported = await api().importTemplate({ ...envelope, code: '206', name: '重引入' });
  expect(imported).toMatchObject({
    ...statutoryIdentity,
    configuration: p.configuration,
    sourceDigest: p.sourceDigest,
  });
  expect(await api().list()).toHaveLength(3);
  await expect(
    api().importTemplate({ ...envelope, code: '207', bookId: 'other-book' }),
  ).rejects.toThrow('另一账套');
  await expect(
    api().importTemplate({ ...envelope, code: '208', sourceDigest: 'forged' } as typeof envelope),
  ).rejects.toThrow();
  await expect(
    api().save({
      ...statutoryIdentity,
      id: p.id,
      expectedRevision: p.revision,
      reportKey: 'profit',
      code: p.code,
      name: p.name,
      configuration: p.configuration,
    }),
  ).rejects.toThrow('另一法定定义');
});
it('w_bb_main/proc/saveas 所有公共入口按权限拒绝；真实xlsx及A4来自同一保存结果', async () => {
  const p = await saved();
  const generated = await api().generate({
    id: p.id,
    expectedRevision: p.revision,
    period: 202512,
    requestId: randomUUID(),
  });
  if (generated.kind !== 'generated') throw new Error('意外确认');
  const selection = {
    id: p.id,
    expectedRevision: p.revision,
    snapshotId: generated.snapshot.id,
    period: 202512,
  };
  const clerk = app.call(
    mod,
    await app.addUser('viewer', { permissions: ['report-engine.view'] }),
  ).statutory;
  expect(await clerk.list()).toHaveLength(1);
  await expect(
    clerk.save({ ...statutoryIdentity, code: '205', name: '越权', configuration: p.configuration }),
  ).rejects.toThrow();
  await expect(
    clerk.copy({ id: p.id, expectedRevision: p.revision, code: '205', name: '越权' }),
  ).rejects.toThrow();
  await expect(
    clerk.generate({
      id: p.id,
      expectedRevision: p.revision,
      period: 202512,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow();
  await expect(clerk.output({ ...selection, format: 'xlsx' })).rejects.toThrow();
  await expect(clerk.output({ ...selection, format: 'print' })).rejects.toThrow();
  await expect(clerk.exportTemplate({ id: p.id })).rejects.toThrow();
  const forbidden = app.call(mod, await app.addUser('none')).statutory;
  await expect(forbidden.catalog()).rejects.toThrow();
  await expect(forbidden.list()).rejects.toThrow();
  await expect(forbidden.get({ id: p.id })).rejects.toThrow();
  await expect(
    forbidden.editor({ ...statutoryIdentity, id: p.id, period: 202512, scope: 'annual' }),
  ).rejects.toThrow();
  await expect(forbidden.snapshot({ id: p.id, period: 202512 })).rejects.toThrow();
  await expect(clerk.importTemplate(await api().exportTemplate({ id: p.id }))).rejects.toThrow();
  const xlsx = await api().output({ ...selection, format: 'xlsx' });
  const print = await api().output({ ...selection, format: 'print' });
  expect(xlsx.snapshotId).toBe(print.snapshotId);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(xlsx.data, 'base64')).buffer);
  expect(wb.worksheets).toHaveLength(3);
  expect(wb.worksheets.every((sheet) => sheet.getCell('A1').text.startsWith('资产负债表 · '))).toBe(
    true,
  );
  expect(wb.worksheets[0]!.pageSetup.paperSize).toBe(9);
  expect(wb.worksheets[0]!.getCell('B5').value).toBe(1000);
  expect(print.printJob?.css).toContain('size:A4');
  expect(print.data).toContain('测试单位有限公司');
  expect(print.data).toContain('1000.00');
  expect(await count()).toBe(1);
});
