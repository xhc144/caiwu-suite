import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import {
  ActivityClassifiedMappingSchema,
  activity402ClassifiedTemplate,
  checkActivityClassifiedSources,
} from '../../templates/nonprofit/activity-classified';
import {
  classifiedChart,
  classifiedGolden,
  classifiedMapping,
  classifiedServer,
  closeClassifiedPnl,
  seedClassifiedBook,
} from './activity-classified-fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({
    modules: [classifiedServer],
    product: 'minfei',
    templateId: classifiedChart.id,
    seed: false,
  });
});
afterEach(async () => {
  await app?.close();
});

describe('民非 w_bb_get / w_bb_proc / w_bb_saveas：402实际末级分类切片', () => {
  it('15×4格及两类小计逐格等于独立手算；退款、自定义转账和负发生额保留，pnl前后相同且xlsx读回一致', async () => {
    await seedClassifiedBook(app.svc);
    const mapping = classifiedMapping();
    await app.svc.tx((svc) => checkActivityClassifiedSources(svc, 202602, mapping));
    const api = app.call(classifiedServer);
    const template = activity402ClassifiedTemplate(mapping);
    const report = await api.importTemplate(template);
    expect(await api.exportTemplate({ id: report.id })).toEqual(template);
    const generate = () =>
      api.generate({
        id: report.id,
        expectedRevision: 1,
        period: 202602,
        requestId: randomUUID(),
      });
    const before = await generate();
    if (before.kind !== 'generated') throw new Error('未生成');
    expect(before.snapshot.includeUnposted).toBe(false);
    const values = new Map(before.snapshot.cells.map((c) => [c.address, c.value]));
    expect(Object.keys(classifiedGolden)).toHaveLength(17);
    for (const [row, golden] of Object.entries(classifiedGolden)) {
      for (const [index, col] of ['B', 'C', 'E', 'F'].entries())
        expect(values.get(`${col}${row}`), `${col}${row}`).toBe(String(golden[index]));
      expect(values.get(`D${row}`)).toBe(String(golden[0] + golden[1]));
      expect(values.get(`G${row}`)).toBe(String(golden[2] + golden[3]));
    }
    expect(before.snapshot.checks).toHaveLength(34);
    expect(before.snapshot.checks.every((c) => c.status === 'pass' && c.difference === '0')).toBe(
      true,
    );
    for (const row of [27, 28, 29, 30])
      for (const col of ['B', 'C', 'D', 'E', 'F', 'G'])
        expect(values.get(`${col}${row}`)).toBe('待接入真实取数');
    expect(template.cells.some((c) => c.source.includes('后续事件来源'))).toBe(true);
    await closeClassifiedPnl(app.svc);
    const balances = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202602,
      rollup: false,
    });
    expect(
      balances
        .filter((r) => /^(41|42|43|51|52|53|54)/.test(r.accountCode))
        .every((r) => r.closing === 0),
    ).toBe(true);
    await app.svc.tx((svc) => checkActivityClassifiedSources(svc, 202602, mapping));
    const after = await generate();
    expect(after.kind === 'generated' && after.snapshot.cells).toEqual(before.snapshot.cells);
    const exported = await api.exportResult({ id: report.id, period: 202602 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
    const ws = wb.worksheets[0]!;
    for (const [row, golden] of Object.entries(classifiedGolden)) {
      for (const [index, col] of ['B', 'C', 'E', 'F'].entries())
        expect(ws.getCell(`${col}${row}`).value, `${col}${row}`).toBe(golden[index]! / 100);
      expect(ws.getCell(`D${row}`).value).toBe((golden[0] + golden[1]) / 100);
      expect(ws.getCell(`G${row}`).value).toBe((golden[2] + golden[3]) / 100);
    }
    expect(ws.getCell('G30').value).toBe('待接入真实取数');
  });

  it('分类不能重复、跨类重复、跨项目复用、父子重叠或越出D/G原项目范围', () => {
    for (const mutate of [
      (m: ReturnType<typeof classifiedMapping>) =>
        m.groups.donations.unrestricted.push(m.groups.donations.unrestricted[0]!),
      (m: ReturnType<typeof classifiedMapping>) => {
        m.groups.donations.restricted[0]!.account = '410101';
      },
      (m: ReturnType<typeof classifiedMapping>) => {
        m.groups.services.unrestricted[0]!.account = '410101';
      },
      (m: ReturnType<typeof classifiedMapping>) => {
        m.groups.donations.unrestricted[0]!.account = '4101';
      },
      (m: ReturnType<typeof classifiedMapping>) => {
        m.groups.donations.unrestricted[0]!.account = '520101';
      },
    ]) {
      const mapping = classifiedMapping();
      mutate(mapping);
      expect(() => activity402ClassifiedTemplate(mapping)).toThrow(/重复|重叠|合计范围/);
    }
  });

  it('拒绝内部决议、空凭据、空具体限制和普通project作为限定分类', () => {
    const baseline = classifiedMapping();
    for (const evidence of [
      { ...baseline.groups.donations.restricted[0]!.evidence, authority: 'internalDecision' },
      { ...baseline.groups.donations.restricted[0]!.evidence, sourceReference: '' },
      { ...baseline.groups.donations.restricted[0]!.evidence, purpose: undefined },
      { ...baseline.groups.donations.restricted[0]!.evidence, project: 'XM01' },
      {
        ...baseline.groups.donations.restricted[0]!.evidence,
        purpose: { description: '', releaseReference: '外部撤销函' },
      },
    ]) {
      const mapping = classifiedMapping();
      const raw = {
        ...mapping,
        groups: {
          ...mapping.groups,
          donations: {
            ...mapping.groups.donations,
            restricted: [{ ...mapping.groups.donations.restricted[0]!, evidence }],
          },
        },
      };
      expect(ActivityClassifiedMappingSchema.safeParse(raw).success).toBe(false);
    }
    const missingUse = structuredClone(baseline);
    missingUse.groups.activityCost.restricted[0]!.recognitionReference = '';
    expect(() => activity402ClassifiedTemplate(missingUse)).toThrow(/外部来源/);
    const missingReview = structuredClone(baseline);
    missingReview.groups.services.unrestricted[0]!.evidence.sourceReference = '';
    expect(() => activity402ClassifiedTemplate(missingReview)).toThrow(/外部来源/);
  });

  it('后续外部解除不追溯改变原确认的限定收入费用，互转事件仍独立待接入', async () => {
    await seedClassifiedBook(app.svc);
    const mapping = classifiedMapping();
    mapping.groups.donations.restricted[0]!.evidence.purpose!.releaseReference =
      '虚构提供者2月末撤销函，仅撤销尚未使用余额限制；不改变1–2月原确认分类';
    await checkActivityClassifiedSources(app.svc, 202602, mapping);
    const api = app.call(classifiedServer);
    const report = await api.importTemplate(activity402ClassifiedTemplate(mapping));
    const result = await api.generate({
      id: report.id,
      expectedRevision: 1,
      period: 202602,
      requestId: randomUUID(),
    });
    if (result.kind !== 'generated') throw new Error('未生成');
    const values = new Map(result.snapshot.cells.map((c) => [c.address, c.value]));
    expect(values.get('C6')).toBe('125');
    expect(values.get('F6')).toBe('2125');
    expect(values.get('C27')).toBe('待接入真实取数');
    expect(values.get('F27')).toBe('待接入真实取数');
  });

  it('拒绝真实非末级、非损益、收入费用错类与不存在的科目', async () => {
    for (const [code, message] of [
      ['4101', /实际末级/],
      ['1122', /不是损益/],
      ['510101', /类别/],
      ['4999', /科目/],
    ] as const) {
      const mapping = classifiedMapping();
      // 先显式移除第二类，避免schema的父子重叠掩盖真实账户检查。
      mapping.groups.donations.restricted = [];
      mapping.groups.donations.unrestricted[0]!.account = code;
      mapping.totals.groups.donations.accounts = [code];
      if (code === '510101') {
        mapping.groups.activityCost.unrestricted = [];
        mapping.totals.groups.activityCost.accounts = ['510102'];
      }
      await expect(checkActivityClassifiedSources(app.svc, 202602, mapping)).rejects.toThrow(
        message,
      );
    }
  });

  it('分类漏掉当前月或仅前月实际发生额必须拒绝；净额0仍检查借贷发生额', async () => {
    await seedClassifiedBook(app.svc);
    for (const id of ['donations', 'activityCost'] as const) {
      const mapping = classifiedMapping();
      mapping.groups[id].restricted = [];
      await expect(checkActivityClassifiedSources(app.svc, 202602, mapping)).rejects.toThrow(
        /未分类/,
      );
    }
    // 3月没有发生，但1–2月累计仍必须完整分类。
    const previousOnly = classifiedMapping(202603);
    previousOnly.groups.dues.unrestricted = [];
    await expect(checkActivityClassifiedSources(app.svc, 202603, previousOnly)).rejects.toThrow(
      /未分类/,
    );
    const zeroNet = classifiedMapping();
    zeroNet.groups.donations.unrestricted = [];
    await seedVouchers(app.svc, [
      {
        date: '2026-02-12',
        status: 'posted',
        lines: [
          { account: '410101', debit: 925 },
          { account: '1122', credit: 925 },
        ],
      },
    ]);
    await expect(checkActivityClassifiedSources(app.svc, 202602, zeroNet)).rejects.toThrow(
      /未分类.*410101/,
    );
  });

  it('D/G合计来源遗漏实际损益也拒绝，不能用同样不完整的两类碰巧配平', async () => {
    await seedClassifiedBook(app.svc);
    const mapping = classifiedMapping();
    mapping.totals.groups.donations.accounts = ['410101'];
    mapping.groups.donations.restricted = [];
    await expect(checkActivityClassifiedSources(app.svc, 202602, mapping)).rejects.toThrow(
      /未映射.*410102/,
    );
  });

  it('拒绝来源期间不符、未建立期间、年内缺月及含未过账口径', async () => {
    const mapping = classifiedMapping();
    await expect(checkActivityClassifiedSources(app.svc, 202603, mapping)).rejects.toThrow(
      /期间不匹配/,
    );
    await expect(
      checkActivityClassifiedSources(app.svc, 202701, classifiedMapping(202701)),
    ).rejects.toThrow(/还没有建立/);
    await expect(
      checkActivityClassifiedSources(app.svc, 202602, mapping, { includeUnposted: true }),
    ).rejects.toThrow(/已过账/);
    await app.svc.db.deleteFrom('period').where('period', '=', 202601).execute();
    await expect(checkActivityClassifiedSources(app.svc, 202602, mapping)).rejects.toThrow(
      /期间|建立/,
    );
  });

  it('w_bb_proc 仅模块预检不冒充公共原子门禁；公共生成及审核失败导出仍是明确缺口', async () => {
    await seedClassifiedBook(app.svc);
    const mapping = classifiedMapping();
    mapping.groups.donations.restricted = [];
    await expect(checkActivityClassifiedSources(app.svc, 202602, mapping)).rejects.toThrow(
      /未分类/,
    );
    const api = app.call(classifiedServer);
    const report = await api.importTemplate(activity402ClassifiedTemplate(mapping));
    const result = await api.generate({
      id: report.id,
      expectedRevision: 1,
      period: 202602,
      requestId: randomUUID(),
    });
    expect(result.kind).toBe('generated');
    if (result.kind !== 'generated') throw new Error('未生成');
    expect(result.snapshot.checks.some((c) => c.status !== 'pass')).toBe(true);
    // 已知公共缺口的证据；不把可导出的失败结果称为已审核或法定完成。
    expect(await api.exportResult({ id: report.id, period: 202602 })).not.toBeNull();
  });

  it('w_bb_proc 整数分性质：收入贷减借、费用借减贷，退款可超本月收入且分类守恒', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 1, max: 500_000 }),
        async (receipt, refund) => {
          const t = await createTestApp({
            modules: [classifiedServer],
            product: 'minfei',
            templateId: classifiedChart.id,
            seed: false,
          });
          try {
            await seedVouchers(t.svc, [
              {
                date: '2026-01-05',
                status: 'posted',
                lines: [
                  { account: '1122', debit: receipt },
                  { account: '410101', credit: receipt },
                ],
              },
              {
                date: '2026-02-05',
                status: 'posted',
                lines: [
                  { account: '410101', debit: refund },
                  { account: '1122', credit: refund },
                ],
              },
              {
                date: '2026-02-06',
                status: 'posted',
                lines: [
                  { account: '510102', debit: receipt },
                  { account: '1122', credit: receipt },
                ],
              },
            ]);
            await checkActivityClassifiedSources(t.svc, 202602, classifiedMapping());
            const api = t.call(classifiedServer);
            const report = await api.importTemplate(
              activity402ClassifiedTemplate(classifiedMapping()),
            );
            const out = await api.generate({
              id: report.id,
              expectedRevision: 1,
              period: 202602,
              requestId: randomUUID(),
            });
            if (out.kind !== 'generated') throw new Error('未生成');
            const values = new Map(out.snapshot.cells.map((c) => [c.address, c.value]));
            expect(values.get('B6')).toBe(String(-refund));
            expect(values.get('E6')).toBe(String(receipt - refund));
            expect(values.get('C16')).toBe(String(receipt));
            expect(out.snapshot.checks.every((c) => c.status === 'pass')).toBe(true);
          } finally {
            await t.close();
          }
        },
      ),
      { numRuns: 10, seed: 4022026 },
    );
  });
});
