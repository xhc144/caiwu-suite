import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { cashflow403Template, checkCashflow403Sources } from '../../templates/nonprofit/cashflow';
import {
  activityRows,
  assetRows,
  liabilityRows,
  nonprofitFormDraft,
} from '../../templates/nonprofit/forms';
import { ReportTemplateSchema, type Report } from '../../shared';
import {
  cashflowGolden,
  fixtureChart,
  fixtureMapping,
  nonprofitTestServer,
  seedCashflowBook,
} from './fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({
    modules: [nonprofitTestServer],
    product: 'minfei',
    templateId: fixtureChart.id,
    seed: false,
  });
});
afterEach(async () => {
  await app?.close();
});
const api = () => app.call(nonprofitTestServer);
const generate = (r: Report) =>
  api().generate({
    id: r.id,
    expectedRevision: r.revision,
    period: 202602,
    confirmUnposted: true,
    requestId: randomUUID(),
  });

describe('民非 w_bb_get / w_bb_proc / w_bb_saveas', () => {
  it('历史账户或现金流量项目停用后仍可真实取数，新引用仍由core拒绝', async () => {
    await seedCashflowBook(app.svc);
    await app.svc.db
      .updateTable('account')
      .set({ disabled: 1 })
      .where('code', '=', '100201')
      .execute();
    await app.svc.db
      .updateTable('dimension_item')
      .set({ disabled: 1 })
      .where('type_id', '=', 'cashflow')
      .where('code', '=', 'NF_donations')
      .execute();
    await checkCashflow403Sources(app.svc, 202602, fixtureMapping());
    const r = await api().importTemplate(cashflow403Template(fixtureMapping(), 202602));
    const out = await generate(r);
    expect(
      out.kind === 'generated' && out.snapshot.cells.find((c) => c.address === 'B41')?.value,
    ).toBe('121700');
    await expect(
      seedVouchers(app.svc, [
        {
          date: '2026-02-20',
          lines: [
            { account: '100201', debit: 100, dims: { cashflow: 'NF_donations' } },
            { account: '410101', credit: 100 },
          ],
        },
      ]),
    ).rejects.toThrow(/停用/);
  });
  it('401/402/403完整表样使用ReportTemplateSchema；未接入金额不以零或假公式代替', async () => {
    for (const code of ['401', '402', '403'] as const) {
      const template = nonprofitFormDraft(code, 2026);
      expect(ReportTemplateSchema.parse(template)).toEqual(template);
      expect(template.cells.every((c) => c.kind === 'text')).toBe(true);
      expect(template.name).toContain('取数未完成');
      const imported = await api().importTemplate(template);
      expect(await api().exportTemplate({ id: imported.id })).toEqual(template);
    }
    expect(assetRows.map((r) => r.label)).toEqual(
      expect.arrayContaining(['文物资源', '固定资产净值', '受托代理资产', '一年内到期的长期投资']),
    );
    expect(liabilityRows.map((r) => r.label)).toContain('一年内到期的长期负债');
    expect(activityRows.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        'release',
        'restriction',
        'priorAdjustment',
        'charitableTrust',
        'fundraisingCost',
      ]),
    );
    expect(ReportTemplateSchema.safeParse(fixtureChart).success).toBe(false);
  });

  it('2026比较例外只用于活动表/现金流量；2027恢复可比期间，资产负债表年初仍待真实来源', () => {
    expect(nonprofitFormDraft('401', 2026).cells.find((c) => c.address === 'B6')?.source).toBe(
      '待接入真实取数',
    );
    expect(nonprofitFormDraft('403', 2026).cells.find((c) => c.address === 'C6')?.source).toContain(
      '不要求填列',
    );
    expect(nonprofitFormDraft('403', 2027).cells.find((c) => c.address === 'C6')?.source).toBe(
      '待接入真实取数',
    );
    expect(nonprofitFormDraft('402', 2027).cells.find((c) => c.address === 'H4')?.source).toBe(
      '上年可比本月·合计',
    );
    expect(nonprofitFormDraft('402', 2027).cells.find((c) => c.address === 'I4')?.source).toBe(
      '上年可比累计·合计',
    );
    expect(() =>
      cashflow403Template({ ...fixtureMapping(), year: 2027 } as never, 202602),
    ).toThrow();
  });

  it('403真实导入、生成、勾稽、重算及xlsx逐项等于手算固定账套；含退回、处置净额及内部划转', async () => {
    await seedCashflowBook(app.svc);
    const mapping = fixtureMapping();
    await checkCashflow403Sources(app.svc, 202602, mapping);
    const report = await api().importTemplate(cashflow403Template(mapping, 202602));
    const out = await generate(report);
    expect(out.kind).toBe('generated');
    if (out.kind !== 'generated') throw new Error('未生成');
    const amounts = Object.fromEntries(
      out.snapshot.cells.filter((c) => c.unit === 'cents').map((c) => [c.address, c.value]),
    );
    expect(amounts).toEqual(cashflowGolden);
    expect(out.snapshot.includeUnposted).toBe(false);
    expect(out.snapshot.checks).toEqual([
      {
        name: '分类净额等于选定现金及现金等价物账户本年变动',
        status: 'pass',
        difference: '0',
        tolerance: '0',
      },
    ]);
    const exported = await api().exportResult({ id: report.id, period: 202602 });
    expect(exported).not.toBeNull();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('B41').value).toBe(1217);
    expect(ws.getCell('B23').value).toBe(47);
    expect(ws.getCell('B30').value).toBe(-253);
    expect(ws.getCell('C41').value).toContain('不要求填列');
    expect(ws.getCell('A1').value).toContain('切片');
    expect(ws.getCell('B6').note).toContain('BALANCE');
    const repeated = await generate(report);
    expect(repeated.kind === 'generated' && repeated.snapshot.cells).toEqual(out.snapshot.cells);
  });

  it('w_bb_get 拒绝缺少分类依据、漏映射、未知行和重复项目，不借普通项目冒充民非限定性', async () => {
    const base = fixtureMapping();
    const missing = structuredClone(base);
    delete missing.items.donations;
    expect(() => cashflow403Template(missing, 202602)).toThrow(/缺少/);
    expect(() => cashflow403Template({ ...base, policyBasis: '' }, 202602)).toThrow(/依据/);
    expect(() =>
      cashflow403Template(
        { ...base, items: { ...base.items, fake: base.items.donations! } },
        202602,
      ),
    ).toThrow(/未知/);
    expect(() =>
      cashflow403Template({ ...base, internalTransfer: base.items.donations! }, 202602),
    ).toThrow(/重复/);
    await seedCashflowBook(app.svc);
    await expect(checkCashflow403Sources(app.svc, 202702, base)).rejects.toThrow(/比较数/);
    await expect(
      checkCashflow403Sources(app.svc, 202602, {
        ...base,
        accounts: [{ code: '1002', basis: '上级不能重复计数' }],
      }),
    ).rejects.toThrow(/末级/);
    await expect(
      checkCashflow403Sources(app.svc, 202602, { ...base, accounts: base.accounts.slice(0, 1) }),
    ).rejects.toThrow(/尚未明确/);
  });

  it('逐笔检查能抓住净额碰巧抵消的漏分类；内部划转不能掩盖费用支出', async () => {
    await seedCashflowBook(app.svc);
    await app.svc.dimensions.create({ type: 'cashflow', code: 'UNKNOWN', name: '未映射' });
    await seedVouchers(app.svc, [
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '100201', debit: 100, dims: { cashflow: 'UNKNOWN' } },
          { account: '1001', credit: 100, dims: { cashflow: 'UNKNOWN' } },
        ],
      },
    ]);
    await expect(checkCashflow403Sources(app.svc, 202602, fixtureMapping())).rejects.toThrow(
      /未分类|未映射/,
    );
  });

  it('内部划转排除前核实完整凭证，禁止把管理费用藏在内部划转项目', async () => {
    await seedCashflowBook(app.svc);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '5201', debit: 100 },
          { account: '100201', credit: 100, dims: { cashflow: 'NF_INTERNAL' } },
        ],
      },
    ]);
    await expect(checkCashflow403Sources(app.svc, 202602, fixtureMapping())).rejects.toThrow(
      /内部划转/,
    );
  });

  it('w_bb_proc失败事务不覆盖成功快照；w_bb_get重复编码不产生部分写入', async () => {
    await seedCashflowBook(app.svc);
    const original = await api().importTemplate(cashflow403Template(fixtureMapping(), 202602));
    await expect(api().importTemplate(original.template)).rejects.toThrow(/已存在/);
    expect(await api().list({})).toHaveLength(1);
    const report = await api().copy({ sourceId: original.id, code: '404', name: '失败回滚测试' });
    const good = await generate(report);
    if (good.kind !== 'generated') throw new Error('未生成');
    const template = structuredClone(report.template);
    template.cells.push({
      address: 'B42',
      kind: 'formula',
      source: 'BALANCE("9999","closing","cents","CNY","signed","none","")',
      unit: 'cents',
      currency: 'CNY',
    });
    await expect(api().save({ id: report.id, expectedRevision: 1, template })).rejects.toThrow(
      /公式|profile/,
    );
    // 故意破坏实际来源也会在公共生成事务被拒绝，不依赖只读UI保护。
    await seedVouchers(app.svc, [
      {
        date: '2026-02-20',
        status: 'posted',
        lines: [
          { account: '1001', debit: 123 },
          { account: '410101', credit: 123 },
        ],
      },
    ]);
    await expect(generate(report)).rejects.toThrow(/未分类|来源.*变更/);
    expect(await api().snapshot({ id: report.id, period: 202602 })).toEqual(good.snapshot);
  });

  it('w_bb_get/proc/saveas按真实权限拒绝只读用户，金额拒绝小数分', async () => {
    await seedCashflowBook(app.svc);
    const template = cashflow403Template(fixtureMapping(), 202602);
    const report = await api().importTemplate(template);
    const viewer = app.call(
      nonprofitTestServer,
      await app.addUser('nf-view', { permissions: ['report-engine.view'] }),
    );
    expect((await viewer.get({ id: report.id })).template.code).toBe('403');
    await expect(viewer.importTemplate(template)).rejects.toThrow(/权限/);
    await expect(
      viewer.generate({
        id: report.id,
        expectedRevision: 1,
        period: 202602,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(/权限/);
    await expect(viewer.exportResult({ id: report.id, period: 202602 })).rejects.toThrow(/权限/);
    await expect(
      seedVouchers(app.svc, [
        {
          date: '2026-02-10',
          lines: [
            { account: '1001', debit: 0.5 },
            { account: '410101', credit: 0.5 },
          ],
        },
      ]),
    ).rejects.toThrow();
  });

  it('记账不变量：现金内部划转的任意整数分不改变403现金净增加额', async () => {
    await seedCashflowBook(app.svc);
    let revision = 0;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (amount) => {
        await seedVouchers(app.svc, [
          {
            date: '2026-02-10',
            status: 'posted',
            lines: [
              { account: '1001', debit: amount, dims: { cashflow: 'NF_INTERNAL' } },
              { account: '100201', credit: amount, dims: { cashflow: 'NF_INTERNAL' } },
            ],
          },
        ]);
        await checkCashflow403Sources(app.svc, 202602, fixtureMapping());
        // 新增来源后显式重确认完整映射；不能复用旧profile。
        const template = cashflow403Template(fixtureMapping(), 202602);
        template.code = String(500 + revision++);
        const report = await api().importTemplate(template);
        const out = await generate(report);
        expect(
          out.kind === 'generated' && out.snapshot.cells.find((c) => c.address === 'B41')?.value,
        ).toBe('121700');
      }),
      { numRuns: 15, seed: 4032026 },
    );
  });
});
