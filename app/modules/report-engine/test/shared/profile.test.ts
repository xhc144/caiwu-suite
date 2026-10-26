import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { CoreServices } from '@caiwu/core/server';
import reportServer from '../../server';
import { reportService } from '../../server/service';
import { readProfileBinding } from '../../server/profile';
import { emptyTemplate, type Report } from '../../shared';
import { buildPurchaseReclassificationComparatives } from '../../templates/enterprise/purchase-reclassification';
import { balanceSheetSlots } from '../../templates/enterprise';
import { purchaseBindings, purchaseTemplate, seedPurchaseFixture } from '../enterprise/purchase-fixture';
import { extendedBalanceSheetTemplate } from '../../templates/small-business/extended';
import { officialInventoryMapping } from '../../templates/small-business/inventory-balance';
import { seedInventoryBook } from '../small-business/inventory-fixture';
import { smallBusinessApp } from '../small-business/fixture';
import {
  classifiedChart, classifiedMapping, classifiedServer, seedClassifiedBook,
} from '../nonprofit/activity-classified-fixture';
import { activity402ClassifiedTemplate, checkActivityClassifiedSources } from '../../templates/nonprofit/activity-classified';

let app: TestApp | undefined;
afterEach(async () => { vi.restoreAllMocks(); await app?.close(); app = undefined; });
const generate = (r: Report, period = 202601, requestId = randomUUID()) => app!.call(reportServer).generate({
  id: r.id, expectedRevision: r.revision, period, requestId,
});
async function purchaseApp() {
  app = await createTestApp({ modules: [reportServer], startYear: 2025 });
  await seedPurchaseFixture(app.svc);
  return app;
}

it('w_bb_get/proc/saveas profile持久绑定两时点；旧202601拒绝202602，新确认分类正例13777/5500、4000/15000及真实xlsx', async () => {
  const t = await purchaseApp();
  const api = t.call(reportServer);
  const original = await api.importTemplate(await purchaseTemplate(t.svc));
  const first = await generate(original);
  if (first.kind !== 'generated') throw new Error('未生成正例');
  expect(first.snapshot.assurance).toBe('guarded-slice');
  expect((await readProfileBinding(t.svc, original.id))?.definitionRevision).toBe(1);
  await seedVouchers(t.svc, [{ date: '2026-02-10', status: 'posted', lines: [
    { account: '190101', debit: 777, dims: { partner: 'S001' } }, { account: '4001', credit: 777 },
  ] }]);
  await expect(generate(original, 202602)).rejects.toThrow(/报告期|分类.*期间/);
  expect(await api.snapshot({ id: original.id, period: 202602 })).toBeNull();
  expect((await api.snapshot({ id: original.id, period: 202601 }))?.id).toBe(first.snapshot.id);
  const b = purchaseBindings(); b.period = 202602;
  b.current.items[0]!.debit.reason = '虚构202602合同和全部采购发生重新复核，适用于本报告日';
  const template = buildPurchaseReclassificationComparatives(b, await t.svc.accounts.list(), await t.svc.dimensions.items('partner'));
  template.code = '211';
  const current = await api.importTemplate(template);
  const result = await generate(current, 202602);
  if (result.kind !== 'generated') throw new Error('未生成新月正例');
  const out = await api.exportResult({ id: current.id, period: 202602 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(Buffer.from(out!.base64, 'base64')).buffer);
  for (const [address, cents, yuan] of [
    [balanceSheetSlots.prepayments!.current, '13777', 137.77],
    [balanceSheetSlots.prepayments!.comparative, '5500', 55],
    [balanceSheetSlots.accountsPayable!.current, '4000', 40],
    [balanceSheetSlots.accountsPayable!.comparative, '15000', 150],
  ] as const) {
    // 实际行址以工厂公布的slots另行验证，不能从生成结果反算期望。
    expect(result.snapshot.cells.find(c => c.address === address)?.value).toBe(cents);
    expect(wb.worksheets[0]!.getCell(address).value).toBe(yuan);
  }
});

it('w_bb_def/copy/get 不能剥离guard、偷改公式或重新绑定旧来源；旧无guard身份必须拒绝', async () => {
  const t = await purchaseApp(); const api = t.call(reportServer);
  const original = await api.importTemplate(await purchaseTemplate(t.svc));
  const copy = await api.copy({ sourceId: original.id, code: '211', name: '自定义名称不能改变法定身份' });
  expect(copy.template.profile).toEqual(original.template.profile);
  const stripped = structuredClone(copy.template); delete stripped.profile;
  await expect(api.save({ id: copy.id, expectedRevision: copy.revision, template: stripped })).rejects.toThrow(/不能删除|profile/);
  const changed = structuredClone(copy.template); changed.cells.find(c => c.address === balanceSheetSlots.prepayments!.current)!.source = '0';
  await expect(api.save({ id: copy.id, expectedRevision: copy.revision, template: changed })).rejects.toThrow(/公式|profile/);
  stripped.code = '212';
  const legacy = await api.importTemplate(stripped);
  await expect(generate(legacy)).rejects.toThrow(/旧无guard|缺少持久/);
  expect(await api.snapshot({ id: legacy.id, period: 202601 })).toBeNull();
  const renamed = { ...copy.template, name: '只改名称与编码不改身份', code: '213' };
  const saved = await api.save({ id: copy.id, expectedRevision: copy.revision, template: renamed });
  expect(saved.revision).toBe(2);
  expect((await readProfileBinding(t.svc, copy.id))?.definitionRevision).toBe(2);
  await seedVouchers(t.svc, [{ date: '2026-01-28', status: 'posted', lines: [
    { account: '190101', debit: 33, dims: { partner: 'S001' } }, { account: '4001', credit: 33 },
  ] }]);
  const exported = await api.exportTemplate({ id: original.id }); exported.code = '215';
  expect(exported.profile?.mode).toBe('bound');
  await expect(api.importTemplate(exported)).rejects.toThrow(/换编码|来源印记/);
  const missingSeal = structuredClone(exported); delete missingSeal.profile!.binding;
  await expect(api.importTemplate(missingSeal)).rejects.toThrow(/来源印记|完整保留/);
  const staleCopy = await api.copy({ sourceId: saved.id, code: '214', name: '复制不能洗白已变化来源' });
  await expect(generate(staleCopy)).rejects.toThrow(/来源.*变更/);
});

it('w_bb_proc 预检后新增净零科目仍拒绝，幂等回放和导出也复核；零新快照，旧快照保留', async () => {
  const t = await purchaseApp(); const api = t.call(reportServer);
  const r = await api.importTemplate(await purchaseTemplate(t.svc)); const requestId = randomUUID();
  const before = await generate(r, 202601, requestId);
  if (before.kind !== 'generated') throw new Error('未生成');
  await t.svc.accounts.create({ code: '190103', name: '净零新增采购', dimensions: [{ type: 'partner' }] }, [4,2,2]);
  await seedVouchers(t.svc, [{ date: '2026-01-28', status: 'posted', lines: [
    { account: '190103', debit: 999, dims: { partner: 'S001' } },
    { account: '190103', credit: 999, dims: { partner: 'S001' } },
  ] }]);
  for (const id of [randomUUID(), requestId]) await expect(generate(r, 202601, id)).rejects.toThrow(/来源|结构|profile/);
  await expect(api.exportResult({ id: r.id, period: 202601 })).rejects.toThrow(/来源|结构|profile/);
  expect((await api.snapshot({ id: r.id, period: 202601 }))?.id).toBe(before.snapshot.id);
  expect(await t.svc.db.withTables<{report_engine_snapshot:{id:number}}>().selectFrom('report_engine_snapshot').selectAll().execute()).toHaveLength(1);
});

it('w_bb_proc 小企业absent1421及显式叶子每次核对完整科目；重确认29465/3565，默认母科目继续动态包含', async () => {
  app = await smallBusinessApp(1, 2025); const t = app; const api = t.call(reportServer);
  await seedInventoryBook(t.svc);
  const mapping = { ...officialInventoryMapping, rawMaterials: { accounts: ['140301', '140302'] } };
  const r = await api.importTemplate(extendedBalanceSheetTemplate({ mapping, accounts: await t.svc.accounts.list(), period: 202602 }));
  const first = await generate(r, 202602); expect(first.kind).toBe('generated');
  const dynamic = extendedBalanceSheetTemplate(); dynamic.code = '311';
  const d = await api.importTemplate(dynamic);
  await t.svc.accounts.create({ code: '140303', name: '新叶子材料' }, [4,2,2]);
  await seedVouchers(t.svc, [{ date: '2026-02-12', status: 'posted', lines: [
    { account: '140303', debit: 777 }, { account: '3001', credit: 777 },
  ] }]);
  await expect(generate(r, 202602)).rejects.toThrow(/完整覆盖|profile/);
  await expect(api.exportResult({ id: r.id, period: 202602 })).rejects.toThrow(/完整覆盖|profile/);
  const renewed = extendedBalanceSheetTemplate({ mapping: { ...mapping, rawMaterials: { accounts: ['140301','140302','140303'] } }, accounts: await t.svc.accounts.list(), period: 202602 });
  renewed.code = '312'; const fresh = await api.importTemplate(renewed);
  for (const report of [d, fresh]) {
    const result = await generate(report, 202602); if (result.kind !== 'generated') throw new Error('未生成');
    expect(result.snapshot.cells.find(c => c.address === 'C14')?.value).toBe('29465');
    expect(result.snapshot.cells.find(c => c.address === 'C15')?.value).toBe('3565');
    expect(result.snapshot.cells.find(c => c.address === 'D14')?.value).toBe('27588');
    expect(await api.exportResult({ id: report.id, period: 202602 })).not.toBeNull();
  }
});

it('w_bb_proc 民非逐笔排他来源持久化，预检后向410101混入限定捐赠500拒绝，不混算且禁导出', async () => {
  app = await createTestApp({ modules: [classifiedServer], product: 'minfei', templateId: classifiedChart.id, seed: false });
  const t = app; await seedClassifiedBook(t.svc); const api = t.call(classifiedServer);
  await checkActivityClassifiedSources(t.svc, 202602, classifiedMapping());
  const r = await api.importTemplate(activity402ClassifiedTemplate(classifiedMapping()));
  const first = await generate(r, 202602); if (first.kind !== 'generated') throw new Error('未生成');
  const binding = await readProfileBinding(t.svc, r.id);
  expect(binding!.recognitions.length).toBeGreaterThan(60);
  expect(binding!.recognitions.find(e => e.account === '410101')).toMatchObject({ classification: 'unrestricted', sourceReference: expect.any(String), resourceReference: expect.any(String), revision: expect.any(Number) });
  const mixed = classifiedMapping(); mixed.recognitions = structuredClone(binding!.recognitions);
  mixed.recognitions[0]!.classification = mixed.recognitions[0]!.classification === 'restricted' ? 'unrestricted' : 'restricted';
  const illegal = activity402ClassifiedTemplate(mixed); illegal.code = '412';
  await expect(api.importTemplate(illegal)).rejects.toThrow(/混合分类|逐笔确认/);
  await seedVouchers(t.svc, [{ date: '2026-02-20', status: 'posted', lines: [
    { account: '1122', debit: 500 }, { account: '410101', credit: 500, summary: '虚构限定捐赠混入非限定专用末级' },
  ] }]);
  await expect(generate(r, 202602)).rejects.toThrow(/重新逐笔确认|来源.*变更/);
  await expect(api.exportResult({ id: r.id, period: 202602 })).rejects.toThrow(/重新逐笔确认|来源.*变更/);
  expect((await api.snapshot({ id: r.id, period: 202602 }))?.id).toBe(first.snapshot.id);
});

it('w_bb_saveas 通用自定义仍可生成试算，audit fail/error router服务层均拒绝导出，不能绕UI', async () => {
  app = await createTestApp({ modules: [reportServer] }); const api = app.call(reportServer);
  const template = emptyTemplate({ code: '901', name: '通用自定义试算', rows: 5, cols: 3 });
  template.cells = [{ address: 'A1', kind: 'money', source: '100', unit: 'cents', currency: 'CNY' }];
  const r = await api.importTemplate(template); const result = await generate(r);
  expect(result.kind === 'generated' && result.snapshot.assurance).toBe('custom-trial');
  expect(await api.exportResult({ id: r.id, period: 202601 })).not.toBeNull();
  for (const [i, right] of ['0','B1'].entries()) {
    const bad = structuredClone(template); bad.code = String(902+i);
    bad.checks = [{ name: '不通过或错误', left: 'A1', right, tolerance: '0' }];
    if (i === 1) bad.cells.push({ address: 'B1', kind: 'text', source: '不能当金额', unit: 'number', currency: 'CNY' });
    const b = await api.importTemplate(bad); const s = await generate(b);
    expect(s.kind === 'generated' && s.snapshot.checks[0]!.status).toBe(i === 0 ? 'fail' : 'error');
    await expect(api.exportResult({ id: b.id, period: 202601 })).rejects.toThrow(/审核/);
  }
});

it('w_bb_proc 生成事务实际服务取数与预检相同，排队写入不能插到预检和快照之间', async () => {
  const t = await purchaseApp(); const service = reportService(t.svcFor('report-engine'));
  const r = await service.importTemplate(await purchaseTemplate(t.svc));
  // 外部预检不授予凭据：修改完成后才发起生成，事务内必重新检查。
  await t.svc.tx(async s => { expect((await readProfileBinding(s, r.id))?.initial.bookId).toBe(t.book.id); });
  let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(resolve => release = resolve);
  const ready = new Promise<void>(resolve => entered = resolve);
  const write = t.svc.tx(async s => {
    await seedVouchers(s, [{ date: '2026-01-29', status: 'posted', lines: [
      { account: '190101', debit: 7, dims: { partner: 'S001' } }, { account: '4001', credit: 7 },
    ] }]);
    entered(); await held;
  });
  await ready;
  const pending = generate(r);
  const assertion = expect(pending).rejects.toThrow(/来源.*变更/);
  release(); await write; await assertion;
  expect(await service.snapshot(r.id, 202601, false)).toBeNull();
});

it('w_bb_proc 真实事务预检后暂停取数，并发修改排队到提交后；快照保持旧一致值，随后回放和导出拒绝', async () => {
  const t = await purchaseApp(); const svc = t.svcFor('report-engine');
  const r = await reportService(svc).importTemplate(await purchaseTemplate(t.svc));
  let reached!: () => void; let resume!: () => void;
  const ready = new Promise<void>(resolve => reached = resolve);
  const held = new Promise<void>(resolve => resume = resolve);
  const actualTx = svc.tx.bind(svc);
  let paused = false;
  // 仅暂停真实查询的调用时点，不替换校验器、数据库、余额或返回值。
  svc.tx = <T>(fn: (s: CoreServices) => Promise<T>): Promise<T> => actualTx(async transaction => {
    const balances = transaction.ledger.balances.bind(transaction.ledger);
    transaction.ledger.balances = async query => {
      if (!paused) { paused = true; reached(); await held; }
      return balances(query);
    };
    return fn(transaction);
  });
  const requestId = randomUUID();
  const input = { id: r.id, expectedRevision: 1, period: 202601, includeUnposted: false,
    confirmUnposted: false, requestId };
  const generating = reportService(svc).generate(input);
  await ready;
  const writing = seedVouchers(t.svc, [{ date: '2026-01-30', status: 'posted', lines: [
    { account: '190101', debit: 7, dims: { partner: 'S001' } }, { account: '4001', credit: 7 },
  ] }]);
  resume();
  const consistent = await generating;
  await writing;
  if (consistent.kind !== 'generated') throw new Error('旧一致事务未生成');
  expect(consistent.snapshot.cells.find(c => c.address === balanceSheetSlots.prepayments!.current)?.value).toBe('13000');
  await expect(reportService(svc).generate(input)).rejects.toThrow(/来源.*变更/);
  await expect(reportService(svc).exportSnapshot(r.id, 202601, false)).rejects.toThrow(/来源.*变更/);
  expect((await reportService(svc).snapshot(r.id, 202601, false))?.id).toBe(consistent.snapshot.id);
});

it('w_bb_proc/saveas 实际REF依赖也校验profile和来源，自定义外层不能绕过依赖门禁', async () => {
  const t = await purchaseApp(); const api = t.call(reportServer);
  const source = await api.importTemplate(await purchaseTemplate(t.svc));
  const template = emptyTemplate({ code: '901', name: '非正式自定义依赖试算', rows: 3, cols: 3 });
  template.cells = [{ address: 'A1', kind: 'formula', source: `REF("201","${balanceSheetSlots.prepayments!.current}")`, unit: 'cents', currency: 'CNY' }];
  const report = await api.importTemplate(template);
  const before = await generate(report);
  if (before.kind !== 'generated') throw new Error('未生成');
  expect(before.snapshot.assurance).toBe('custom-trial');
  expect(before.snapshot.cells[0]!.value).toBe('13000');
  expect(before.snapshot.profileProofs?.map(p => p.reportId)).toContain(source.id);
  expect(await api.exportResult({ id: report.id, period: 202601 })).not.toBeNull();
  await seedVouchers(t.svc, [{ date: '2026-01-30', status: 'posted', lines: [
    { account: '190101', debit: 7, dims: { partner: 'S001' } }, { account: '4001', credit: 7 },
  ] }]);
  await expect(generate(report)).rejects.toThrow(/来源.*变更/);
  await expect(api.exportResult({ id: report.id, period: 202601 })).rejects.toThrow(/来源.*变更/);
  expect((await api.snapshot({ id: report.id, period: 202601 }))?.id).toBe(before.snapshot.id);
});

it('w_bb_proc 已绑定切片审核失败不写新快照；旧通过结果保留且来源已变时不能导出', async () => {
  app = await smallBusinessApp(1, 2025); const t = app; const api = t.call(reportServer);
  await seedInventoryBook(t.svc);
  const report = await api.importTemplate(extendedBalanceSheetTemplate());
  const before = await generate(report, 202602);
  if (before.kind !== 'generated') throw new Error('未生成正例');
  await t.svc.opening.upsert({ year: 2025, accountId: (await t.svc.accounts.require('1401')).id, balance: -100000 });
  await expect(generate(report, 202602)).rejects.toThrow(/审核/);
  await expect(api.exportResult({ id: report.id, period: 202602 })).rejects.toThrow(/来源指纹|profile/);
  expect((await api.snapshot({ id: report.id, period: 202602 }))?.id).toBe(before.snapshot.id);
  expect(await t.svc.db.withTables<{report_engine_snapshot:{id:number}}>().selectFrom('report_engine_snapshot').selectAll().execute()).toHaveLength(1);
});
