import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineManifest } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, seedVouchers, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import { ReportTemplateSchema, type Report, type ReportSnapshot } from '../../shared';
import {
  balanceSheetSlots,
  buildBalanceSheetSlice,
  buildCashflowSlice,
  cashflowSlots,
  enterpriseBalanceSheet,
  enterpriseCashflow,
  enterpriseProfit,
  profitSlots,
} from '../../templates/enterprise';
import bsJson from '../../templates/enterprise/201.json';
import profitJson from '../../templates/enterprise/202.json';
import cashJson from '../../templates/enterprise/203.json';
import {
  balanceSlice,
  cashBindings,
  cashSlice,
  closingTransfer,
  GOLDEN,
  setupEnterpriseFixture,
} from './fixture';

let app: TestApp;
const sourceManifest = defineManifest({
  id: 'enterprise-source-test',
  name: '企业报表来源锁测试夹具',
  products: 'all',
  permissions: [],
  menu: [],
  sources: [{ type: 'receipt', name: '测试收款来源单据', path: '/receipt?id={id}' }],
});
const sourceServer = defineServerModule(sourceManifest, {
  router: moduleKit(sourceManifest).router({}),
});
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer, sourceServer] });
});
afterEach(async () => {
  await app.close();
});
const api = () => app.call(reportServer);
async function generate(
  report: Report,
  period = 202601,
  confirmUnposted = false,
): Promise<ReportSnapshot> {
  const r = await api().generate({
    id: report.id,
    expectedRevision: report.revision,
    period,
    confirmUnposted,
    requestId: randomUUID(),
  });
  if (r.kind !== 'generated') throw new Error('预料外的未过账确认');
  return r.snapshot;
}
const cell = (s: ReportSnapshot, address: string) => s.cells.find((c) => c.address === address)!;

describe('W2-02 w_bb_get / w_bb_proc / w_bb_saveas 企业三表', () => {
  it.each([
    ['201', bsJson, enterpriseBalanceSheet],
    ['202', profitJson, enterpriseProfit],
    ['203', cashJson, enterpriseCashflow],
  ] as const)('官方表样%s实际导入、生成、导出往返；待配置不是零', async (code, json, build) => {
    const t = ReportTemplateSchema.parse(json);
    expect(t).toEqual(build());
    expect(t.code).toBe(code);
    expect(t.readOnly).toBe(true);
    const r = await api().importTemplate(t);
    expect(await api().exportTemplate({ id: r.id })).toEqual(t);
    const s = await generate(r);
    expect(s.cells.filter((c) => c.unit !== 'text')).toEqual([]);
    expect(s.checks.every((c) => c.status === 'error' && c.difference === null)).toBe(true);
    const out = await api().exportResult({ id: r.id, period: 202601 });
    expect(out).not.toBeNull();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(out!.base64, 'base64')).buffer);
    expect(wb.worksheets[0]!.getCell('A2').value).toContain('未完成');
    expect(wb.worksheets[0]!.getCell('B6').value).toContain('待配置');
    expect(wb.worksheets[0]!.getCell('C6').value).toContain('比较期间');
    expect(wb.worksheets[1]!.getColumn(2).values).toContain('错误');
  });

  it('201保留金融工具、合同、租赁、其中项和权益总计；202保留OCI与每股收益；203保留净额及期初期末', () => {
    const text = (t: ReturnType<typeof enterpriseBalanceSheet>) =>
      t.cells.filter((c) => c.kind === 'text').map((c) => c.source);
    expect(text(enterpriseBalanceSheet())).toEqual(
      expect.arrayContaining([
        '应收款项融资',
        '合同资产',
        '合同负债',
        '使用权资产',
        '租赁负债',
        '长期应付款',
        '一年内到期的非流动资产',
        '一年内到期的非流动负债',
        '其他权益工具',
        '其中：优先股',
        '未分配利润',
        '资产总计',
        '负债和所有者权益（或股东权益）总计',
      ]),
    );
    expect(text(enterpriseProfit())).toEqual(
      expect.arrayContaining([
        '研发费用',
        '利息收入',
        '四、净利润（净亏损以“-”号填列）',
        '（一）持续经营净利润（净亏损以“-”号填列）',
        '（二）终止经营净利润（净亏损以“-”号填列）',
        '五、其他综合收益的税后净额',
        '六、综合收益总额',
        '（一）基本每股收益',
        '（二）稀释每股收益',
      ]),
    );
    expect(text(enterpriseCashflow())).toEqual(
      expect.arrayContaining([
        '经营活动产生的现金流量净额',
        '投资活动产生的现金流量净额',
        '筹资活动产生的现金流量净额',
        '四、汇率变动对现金及现金等价物的影响',
        '五、现金及现金等价物净增加额',
        '加：期初现金及现金等价物余额',
        '六、期末现金及现金等价物余额',
      ]),
    );
  });

  it('201期末净额按手算固定账套：折旧、减值、清理、工程物资；只读不改凭证和期初', async () => {
    await setupEnterpriseFixture(app.svc);
    const before = await app.svc.vouchers.list({ limit: 100 });
    const opening = await app.svc.opening.list(2026);
    const r = await api().importTemplate(balanceSlice());
    const s = await generate(r);
    for (const key of ['cash', 'fixedAssets', 'construction', 'shortTermLoans', 'capital'] as const)
      expect(cell(s, balanceSheetSlots[key]!.current)).toMatchObject({
        value: String(GOLDEN.january[key]),
        unit: 'cents',
      });
    expect(cell(s, balanceSheetSlots.cash!.comparative).unit).toBe('text');
    expect(cell(s, balanceSheetSlots.retainedEarnings!.current).value).toContain('待配置');
    expect(cell(s, balanceSheetSlots.assetsTotal!.current).unit).toBe('text');
    expect(s.checks[0]!.status).toBe('error');
    expect(await app.svc.vouchers.list({ limit: 100 })).toEqual(before);
    expect(await app.svc.opening.list(2026)).toEqual(opening);
    const out = await api().exportResult({ id: r.id, period: 202601 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(out!.base64, 'base64')).buffer);
    expect(wb.worksheets[0]!.getCell(balanceSheetSlots.cash!.current).value).toBe(1741.95);
    expect(wb.worksheets[0]!.getCell(balanceSheetSlots.fixedAssets!.current).value).toBe(950);
    expect(wb.worksheets[0]!.getCell(balanceSheetSlots.cash!.current).note).toContain('BALANCE');
  });

  it('203当前月现金项目：退款净额、现金银行内部划转抵销、政府补助经营收款、借款及还款', async () => {
    await setupEnterpriseFixture(app.svc);
    const r = await api().importTemplate(await cashSlice(app.svc));
    const s = await generate(r);
    for (const key of Object.keys(cashBindings.items) as (keyof typeof cashBindings.items)[])
      expect(cell(s, cashflowSlots[key]!.current).value).toBe(String(GOLDEN.january[key]));
    // CF01中含10000分现金/银行内部划转，两边抵销后仅剩14000分对外收款。
    expect(cell(s, cashflowSlots.salesReceipts!.current).value).toBe('14000');
    for (const key of [
      'operatingReceipts',
      'operatingNet',
      'cashIncrease',
      'cashOpening',
      'cashClosing',
    ])
      expect(cell(s, cashflowSlots[key]!.current).unit).toBe('text');
    expect(cell(s, cashflowSlots.salesReceipts!.comparative).unit).toBe('text');
    expect(s.checks[0]!.status).toBe('error');
    await seedVouchers(app.svc, [
      {
        date: '2026-02-03',
        status: 'posted',
        lines: [
          { account: '1001', debit: 501, dims: { cashflow: 'CF01' } },
          { account: '6001', credit: 501 },
        ],
      },
    ]);
    const feb = await generate(r, 202602);
    expect(cell(feb, cashflowSlots.salesReceipts!.current).value).toBe(
      String(GOLDEN.february.salesReceipts),
    );
    expect(cell(feb, cashflowSlots.purchases!.current).value).toBe('0');
    const bs = await api().importTemplate(balanceSlice());
    expect(cell(await generate(bs, 202602), balanceSheetSlots.cash!.current).value).toBe(
      String(GOLDEN.february.cash),
    );
  });

  it('203小计只在全部组成项目显式配置后开放，不把缺项当零', async () => {
    await setupEnterpriseFixture(app.svc);
    const items = { ...cashBindings.items, taxRefunds: 'CF07' };
    await app.svc.dimensions.create({ type: 'cashflow', code: 'CF07', name: '测试税费返还' });
    const r = await api().importTemplate(
      buildCashflowSlice({ ...cashBindings, items }, await app.svc.accounts.list()),
    );
    const s = await generate(r);
    expect(cell(s, cashflowSlots.operatingReceipts!.current)).toMatchObject({
      value: '16500',
      unit: 'cents',
    });
    expect(cell(s, cashflowSlots.operatingPayments!.current).unit).toBe('text');
    expect(cell(s, cashflowSlots.operatingNet!.current).unit).toBe('text');
  });

  it('w_bb_proc 未过账先确认；已确认继续仍只统计已过账，不吞草稿或作废凭证', async () => {
    await setupEnterpriseFixture(app.svc);
    const [pending] = await seedVouchers(app.svc, [
      {
        date: '2026-01-20',
        lines: [
          { account: '1001', debit: 88888, dims: { cashflow: 'CF01' } },
          { account: '6001', credit: 88888 },
        ],
      },
    ]);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-21',
        status: 'draft',
        lines: [
          { account: '1001', debit: 444, dims: { cashflow: 'CF01' } },
          { account: '6001', credit: 444 },
        ],
      },
    ]);
    const r = await api().importTemplate(balanceSlice());
    expect(
      await api().generate({
        id: r.id,
        expectedRevision: 1,
        period: 202601,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ kind: 'confirmation', count: 2 });
    expect(await api().snapshot({ id: r.id, period: 202601 })).toBeNull();
    expect(cell(await generate(r, 202601, true), balanceSheetSlots.cash!.current).value).toBe(
      '174195',
    );
    await app.svc.vouchers.setVoided(pending!.id, true);
    const s = await generate(r, 202601, true);
    expect(cell(s, balanceSheetSlots.cash!.current).value).toBe('174195');
    expect(s.includeUnposted).toBe(false);
  });

  it('202保留结转前利润缺口：结转后总账损益净额归零，不能冒充手算营业收入与净利润', async () => {
    await setupEnterpriseFixture(app.svc);
    await seedVouchers(app.svc, [closingTransfer]);
    const rows = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      accountCodes: ['6001', '6051'],
      rollup: false,
    });
    expect(rows.reduce((sum, r) => sum + r.credit - r.debit, 0)).toBe(0);
    expect(GOLDEN.january.revenue).toBe(14000);
    const pnl = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      accountCodes: ['4103'],
      rollup: false,
    });
    expect(pnl[0]!.closing).toBe(-GOLDEN.january.netProfit);
    const r = await api().importTemplate(enterpriseProfit());
    const s = await generate(r);
    expect(cell(s, profitSlots.revenue!.current)).toMatchObject({ unit: 'text' });
    expect(cell(s, profitSlots.netProfit!.current).value).toContain('待配置');
    expect(s.checks[0]!.status).toBe('error');
  });

  it('w_bb_get 重复编码/只读保护及权限拒绝不改变已导入表样', async () => {
    const t = enterpriseBalanceSheet();
    const r = await api().importTemplate(t);
    await expect(api().importTemplate(t)).rejects.toThrow(/已存在/);
    await expect(api().save({ id: r.id, expectedRevision: 1, template: t })).rejects.toThrow(
      /只读/,
    );
    await expect(api().remove({ id: r.id, expectedRevision: 1, confirmed: true })).rejects.toThrow(
      /只读/,
    );
    const viewer = app.call(
      reportServer,
      await app.addUser('reader', { permissions: ['report-engine.view'] }),
    );
    await expect(viewer.importTemplate(enterpriseProfit())).rejects.toThrow(/权限/);
    await expect(
      viewer.generate({ id: r.id, expectedRevision: 1, period: 202601, requestId: randomUUID() }),
    ).rejects.toThrow(/权限/);
    await expect(viewer.exportResult({ id: r.id, period: 202601 })).rejects.toThrow(/权限/);
    expect(await viewer.get({ id: r.id })).toEqual(r);
    expect(await api().list({})).toHaveLength(1);
    expect(await api().snapshot({ id: r.id, period: 202601 })).toBeNull();
  });

  it('w_bb_proc 缺少真实账户时整次生成回滚，保留前次成功快照，不能静默填零', async () => {
    await setupEnterpriseFixture(app.svc);
    const r = await api().importTemplate(balanceSlice());
    const good = await generate(r);
    // 通过引擎公开的只读复制路径制造需新校验的映射版本。
    const copy = await api().copy({ sourceId: r.id, code: '211', name: '测试可编辑映射' });
    const goodCopy = await generate(copy);
    const bad = await api().save({
      id: copy.id,
      expectedRevision: 1,
      template: {
        ...copy.template,
        cells: copy.template.cells.map((c) =>
          c.address === balanceSheetSlots.cash!.current
            ? { ...c, source: 'BALANCE("9999","closing","cents","CNY","signed","none","")' }
            : c,
        ),
      },
    });
    const vouchers = await app.svc.vouchers.list({ limit: 100 });
    await expect(generate(bad)).rejects.toThrow(/9999/);
    expect((await api().snapshot({ id: bad.id, period: 202601 }))!.id).toBe(goodCopy.id);
    expect((await api().snapshot({ id: r.id, period: 202601 }))!.id).toBe(good.id);
    expect(await app.svc.vouchers.list({ limit: 100 })).toEqual(vouchers);
  });

  it('企业报表生成/导出不解锁已审核来源凭证、不修改在线备份；读取后的来源保护仍生效', async () => {
    await setupEnterpriseFixture(app.svc);
    const owner = app.svcFor(sourceManifest.id);
    const input = await voucherInputFromSpec(owner, {
      date: '2026-01-25',
      lines: [
        { account: '1001', debit: 99, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 99 },
      ],
    });
    const v = await owner.vouchers.create({ ...input, source: { type: 'receipt', id: 'TEST-1' } });
    await owner.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    const locked = await owner.vouchers.get(v.id);
    const backupDir = await mkdtemp(path.join(os.tmpdir(), 'caiwu-enterprise-backup-'));
    const backup = path.join(backupDir, 'before-report.caiwu');
    const hash = async () =>
      createHash('sha256')
        .update(await readFile(backup))
        .digest('hex');
    try {
      await app.runtime.bookStore.open(app.book.id).raw.backup(backup);
      const original = await hash();
      const r = await api().importTemplate(balanceSlice());
      const snapshot = await generate(r, 202601, true);
      expect(cell(snapshot, balanceSheetSlots.cash!.current).value).toBe('174195');
      expect(await api().exportResult({ id: r.id, period: 202601 })).not.toBeNull();
      await expect(app.svcFor('report-engine').vouchers.delete(v.id)).rejects.toThrow(
        /来源锁测试夹具/,
      );
      await expect(
        owner.vouchers.update(v.id, input, { expectedRevision: locked!.revision }),
      ).rejects.toThrow(/审核.*不能修改/);
      expect(await owner.vouchers.get(v.id)).toEqual(locked);
      expect(await hash()).toBe(original);
    } finally {
      await rm(backupDir, { recursive: true, force: true });
    }
  });

  it('映射拒绝重复、父子重叠、未知项目、非现金账户，不能伪装重分类和现金等价物', async () => {
    expect(() => buildBalanceSheetSlice({ cash: ['1002', '100201'] })).toThrow(/重叠/);
    expect(() => buildBalanceSheetSlice({ cash: ['1001'], fixedAssets: ['1001'] })).toThrow(/重复/);
    expect(() => buildBalanceSheetSlice({ accountsReceivable: ['1122'] } as never)).toThrow();
    const accounts = await app.svc.accounts.list();
    expect(() =>
      buildCashflowSlice({ cashAccounts: ['1001', '1001'], items: {} }, accounts),
    ).toThrow(/重复/);
    expect(() => buildCashflowSlice({ cashAccounts: ['9999'], items: {} }, accounts)).toThrow(
      /不存在/,
    );
    expect(() => buildCashflowSlice({ cashAccounts: ['6001'], items: {} }, accounts)).toThrow(
      /非现金/,
    );
    expect(() =>
      buildCashflowSlice(
        { cashAccounts: ['1001'], items: { salesReceipts: 'CF01', purchases: 'CF01' } },
        accounts,
      ),
    ).toThrow(/多个/);
    expect(() =>
      buildCashflowSlice(
        { cashAccounts: ['1001'], items: { cashOpening: 'CF01' } } as never,
        accounts,
      ),
    ).toThrow();
  });
});
