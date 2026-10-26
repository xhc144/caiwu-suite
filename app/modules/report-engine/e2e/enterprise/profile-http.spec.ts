import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { seedVouchers } from '@caiwu/testkit';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { emptyTemplate, type Report, type ReportSnapshot } from '../../shared';
import { balanceSheetSlots } from '../../templates/enterprise';
import { purchaseBindings, purchaseTemplate } from '../../test/enterprise/purchase-fixture';
import { test } from './fixture';

test('直接HTTP绕过UI：固定报告期、去guard保存/复制、净零科目变化、幂等旧快照及导出门禁', async ({ page, enterprise }) => {
  const { bookId, token } = await loginWithNewBook(page, enterprise.request, { product: 'qingsong', startYear: 2025 });
  const { balance } = await enterprise.seed(bookId, 'purchase');
  const post = <T>(name: string, input: unknown) => callApi<T>(enterprise.request, `m.report-engine.${name}`, input, { token, method: 'POST' });
  const get = <T>(name: string, input: unknown) => callApi<T>(enterprise.request, `m.report-engine.${name}`, input, { token, method: 'GET' });
  const report = await post<Report>('importTemplate', balance);
  const requestId = randomUUID();
  const input = { id: report.id, expectedRevision: report.revision, period: 202601, requestId };
  const generated = await post<{ kind: string; snapshot: ReportSnapshot }>('generate', input);
  expect(generated.kind).toBe('generated');
  for (const [address, amount] of [[balanceSheetSlots.prepayments!.current, '13000'], [balanceSheetSlots.prepayments!.comparative, '5500'], [balanceSheetSlots.accountsPayable!.current, '4000'], [balanceSheetSlots.accountsPayable!.comparative, '15000']] as const)
    expect(generated.snapshot.cells.find(c => c.address === address)?.value).toBe(amount);
  await expect(post('generate', { ...input, period: 202602, requestId: randomUUID() })).rejects.toThrow(/报告期|期间/);
  const copied = await post<Report>('copy', { sourceId: report.id, code: '211', name: 'HTTP复制保留绑定' });
  expect(copied.template.profile).toEqual(report.template.profile);
  const stripped = structuredClone(copied.template); delete stripped.profile;
  await expect(post('save', { id: copied.id, expectedRevision: copied.revision, template: stripped })).rejects.toThrow(/profile|不能删除/);
  stripped.code = '212';
  const legacy = await post<Report>('importTemplate', stripped);
  await expect(post('generate', { ...input, id: legacy.id, requestId: randomUUID() })).rejects.toThrow(/旧无guard|缺少持久/);
  const exported = await get<{ base64: string }>('exportResult', { id: report.id, period: 202601 });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
  expect(wb.worksheets[0]!.getCell(balanceSheetSlots.prepayments!.current).value).toBe(130);
  await enterprise.withCore(bookId, async svc => {
    await svc.accounts.create({ code: '190103', name: '净零新科目', dimensions: [{ type: 'partner' }] }, [4,2,2]);
    await seedVouchers(svc, [{ date: '2026-01-28', status: 'posted', lines: [
      { account: '190103', debit: 999, dims: { partner: 'S001' } },
      { account: '190103', credit: 999, dims: { partner: 'S001' } },
    ] }]);
  });
  for (const id of [requestId, randomUUID()]) await expect(post('generate', { ...input, requestId: id })).rejects.toThrow(/来源|结构|profile/);
  await expect(get('exportResult', { id: report.id, period: 202601 })).rejects.toThrow(/来源|结构|profile/);
  expect((await get<ReportSnapshot>('snapshot', { id: report.id, period: 202601 })).id).toBe(generated.snapshot.id);
  const sealed = await get<Report['template']>('exportTemplate', { id: report.id }); sealed.code = '216';
  expect(sealed.profile?.mode).toBe('bound');
  await expect(post('importTemplate', sealed)).rejects.toThrow(/来源印记|换编码/);
  const missingSeal = structuredClone(sealed); delete missingSeal.profile!.binding;
  await expect(post('importTemplate', missingSeal)).rejects.toThrow(/来源印记|完整保留/);
  // 来源和分类再次明确后才能建立另一个固定月的profile。
  let renewed = balance;
  await enterprise.withCore(bookId, async svc => {
    await seedVouchers(svc, [{ date: '2026-02-10', status: 'posted', lines: [
      { account: '190101', debit: 777, dims: { partner: 'S001' } }, { account: '4001', credit: 777 },
    ] }]);
    const b = purchaseBindings(); b.period = 202602;
    b.current.items.push({ ...b.current.items[0]!, account: '190103' });
    renewed = await purchaseTemplate(svc, b); renewed.code = '213';
  });
  const fresh = await post<Report>('importTemplate', renewed);
  const next = await post<{ snapshot: ReportSnapshot }>('generate', { ...input, id: fresh.id, period: 202602, requestId: randomUUID() });
  expect(next.snapshot.cells.find(c => c.address === balanceSheetSlots.prepayments!.current)?.value).toBe('13777');
  const nextExport = await get<{ base64: string }>('exportResult', { id: fresh.id, period: 202602 });
  const nextWb = new ExcelJS.Workbook(); await nextWb.xlsx.load(Uint8Array.from(Buffer.from(nextExport.base64, 'base64')).buffer);
  expect(nextWb.worksheets[0]!.getCell(balanceSheetSlots.prepayments!.current).value).toBe(137.77);
  for (const [i, right] of ['0', 'B1'].entries()) {
    const trial = emptyTemplate({ code: String(901+i), name: '非正式自定义审核反例', rows: 3, cols: 3 });
    trial.cells = [{ address: 'A1', kind: 'money', source: '100', unit: 'cents', currency: 'CNY' },
      { address: 'B1', kind: 'text', source: '不能作数值', unit: 'number', currency: 'CNY' }];
    trial.checks = [{ name: '直接HTTP失败审核', left: 'A1', right, tolerance: '0' }];
    const bad = await post<Report>('importTemplate', trial);
    const preview = await post<{ snapshot: ReportSnapshot }>('generate', { ...input, id: bad.id, requestId: randomUUID() });
    expect(preview.snapshot.checks[0]!.status).toBe(i === 0 ? 'fail' : 'error');
    await expect(get('exportResult', { id: bad.id, period: 202601 })).rejects.toThrow(/审核/);
  }
});
