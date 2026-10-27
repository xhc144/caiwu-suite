import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { emptyTemplate, type Report, type ReportTemplate } from '../../shared';
import { readProfileBinding } from '../../server/profile';
import {
  activity402ClassifiedTemplate,
  type ActivityRecognition,
} from '../../templates/nonprofit/activity-classified';
import {
  classifiedChart,
  classifiedServer,
  confirmClassifiedFixture,
} from './activity-classified-fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({
    modules: [classifiedServer],
    product: 'minfei',
    templateId: classifiedChart.id,
    seed: false,
  });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1122', debit: 1200 },
        { account: '410101', credit: 1200 },
      ],
    },
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '1122', debit: 700 },
        { account: '410102', credit: 700 },
      ],
    },
  ]);
});
afterEach(async () => app?.close());
const generate = (r: Report, requestId = randomUUID()) =>
  app.call(classifiedServer).generate({
    id: r.id,
    expectedRevision: r.revision,
    period: 202602,
    requestId,
  });

const mutations: [string, (r: ActivityRecognition) => void][] = [
  ['凭证ID', (r) => r.voucherId++],
  ['分录ID', (r) => r.lineId++],
  ['凭证revision', (r) => r.revision++],
  ['期间', (r) => r.period++],
  ['科目', (r) => (r.account = '410102')],
  ['借方金额', (r) => r.debit++],
  ['贷方金额', (r) => r.credit++],
  ['分类', (r) => (r.classification = 'restricted')],
  ['资源批次', (r) => (r.resourceReference = '另一虚构资源')],
  ['来源凭据', (r) => (r.sourceReference = '另一虚构协议')],
  ['依据主体', (r) => (r.classificationBasis.evidence.issuer = '另一虚构外部主体')],
  ['依据条款', (r) => (r.classificationBasis.evidence.specificClause = '另一虚构具体条款')],
  ['依据资源', (r) => (r.classificationBasis.evidence.resourceReference = '另一虚构批次')],
  ['依据来源', (r) => (r.classificationBasis.evidence.sourceReference = '另一虚构原始凭据')],
];

describe('w_bb_get/def/proc/saveas：402逐行明确确认', () => {
  it('完整确认持久保存，乱序仍逐行匹配；逐字段错配、缺行、多行、重复均拒绝且不保存模板', async () => {
    const api = app.call(classifiedServer);
    const mapping = await confirmClassifiedFixture(app.svc);
    expect(mapping.recognitions).toHaveLength(2);
    const template = activity402ClassifiedTemplate(mapping);
    const report = await api.importTemplate(template);
    expect((await readProfileBinding(app.svc, report.id))?.recognitions).toEqual(
      mapping.recognitions,
    );
    const valid = await generate(report);
    expect(
      valid.kind === 'generated' && valid.snapshot.cells.find((c) => c.address === 'E6')?.value,
    ).toBe('1200');
    expect(await api.exportResult({ id: report.id, period: 202602 })).not.toBeNull();
    const reversed = structuredClone(mapping);
    reversed.recognitions.reverse();
    await api.importTemplate({ ...activity402ClassifiedTemplate(reversed), code: '411' });
    for (const [field, mutate] of mutations) {
      const invalid = structuredClone(mapping);
      mutate(invalid.recognitions[0]!);
      await expect(
        api.importTemplate({ ...activity402ClassifiedTemplate(invalid), code: '412' }),
        field,
      ).rejects.toThrow(/逐笔确认|分类依据|混合分类/);
    }
    for (const change of [
      (r: ActivityRecognition) => {
        if ('recognitionReference' in r.classificationBasis)
          r.classificationBasis.recognitionReference = '另一取得关联';
      },
      (r: ActivityRecognition) => {
        if ('purpose' in r.classificationBasis.evidence)
          r.classificationBasis.evidence.purpose = { description: '另一用途限制' };
      },
    ]) {
      const invalid = structuredClone(mapping);
      change(invalid.recognitions[1]!);
      await expect(
        api.importTemplate({ ...activity402ClassifiedTemplate(invalid), code: '412' }),
      ).rejects.toThrow(/逐笔确认/);
    }
    for (const recognitions of [
      [],
      mapping.recognitions.slice(1),
      [...mapping.recognitions, mapping.recognitions[0]!],
      [mapping.recognitions[0]!, mapping.recognitions[0]!],
    ]) {
      await expect(
        api.importTemplate({
          ...activity402ClassifiedTemplate({ ...mapping, recognitions }),
          code: '412',
        }),
      ).rejects.toThrow(/逐笔确认/);
    }
    const missing = structuredClone(template);
    delete missing.profile!.mapping.recognitions;
    await expect(api.importTemplate({ ...missing, code: '412' })).rejects.toThrow(
      /recognitions|profile/,
    );
    const noBasis = structuredClone(template);
    const rows = noBasis.profile!.mapping.recognitions as Record<string, unknown>[];
    delete rows[0]!.classificationBasis;
    await expect(api.importTemplate({ ...noBasis, code: '412' })).rejects.toThrow(
      /classificationBasis|profile/,
    );
    expect(await api.list({})).toHaveLength(2);
  });

  it('初次和重新declaration都拒绝漏掉新增限定500；混合来源同叶明确确认也拒绝，旧快照和REF绑定保留', async () => {
    const api = app.call(classifiedServer);
    const mapping = await confirmClassifiedFixture(app.svc);
    const original = await api.importTemplate(activity402ClassifiedTemplate(mapping));
    const requestId = randomUUID();
    const before = await generate(original, requestId);
    if (before.kind !== 'generated') throw new Error('未生成');
    const outer = emptyTemplate({ code: '901', name: '合成REF试算', rows: 2, cols: 2 });
    outer.cells = [
      { address: 'A1', kind: 'formula', source: 'REF("402","E6")', unit: 'cents', currency: 'CNY' },
    ];
    const dependency = await api.importTemplate(outer);
    const refBefore = await generate(dependency);
    expect(
      refBefore.kind === 'generated' && refBefore.snapshot.profileProofs?.map((p) => p.reportId),
    ).toContain(original.id);
    const [newVoucher] = await seedVouchers(app.svc, [
      {
        date: '2026-02-20',
        status: 'posted',
        summary: '虚构提供者R另批限定500误记入U专用末级',
        lines: [
          { account: '1122', debit: 500 },
          { account: '410101', credit: 500 },
        ],
      },
    ]);
    // 尚未在此来源状态导入过的新declaration，不能把新增行从旧叶子分类补齐。
    const fresh: ReportTemplate = { ...activity402ClassifiedTemplate(mapping), code: '412' };
    await expect(api.importTemplate(fresh)).rejects.toThrow(/逐笔确认/);
    const redeclared = {
      ...original.template,
      profile: { ...original.template.profile!, mode: 'declaration' as const },
    };
    delete redeclared.profile.binding;
    await expect(api.importTemplate({ ...redeclared, code: '413' })).rejects.toThrow(/逐笔确认/);
    const noRows = structuredClone(fresh);
    delete noRows.profile!.mapping.recognitions;
    await expect(api.importTemplate(noRows)).rejects.toThrow(/recognitions|profile/);
    const mixed = structuredClone(mapping);
    const actual = await app.svc.vouchers.get(newVoucher!.id);
    if (!actual) throw new Error('合成凭证不存在');
    const line = actual.lines.find((l) => l.accountCode === '410101')!;
    const restricted = mapping.recognitions.find((r) => r.classification === 'restricted')!;
    mixed.recognitions.push({
      ...restricted,
      voucherId: actual.id,
      lineId: line.id,
      revision: actual.revision,
      period: actual.period,
      account: '410101',
      debit: 0,
      credit: 500,
    });
    await expect(
      api.importTemplate({ ...activity402ClassifiedTemplate(mixed), code: '412' }),
    ).rejects.toThrow(/同末级混合分类/);
    for (const id of [requestId, randomUUID()])
      await expect(generate(original, id)).rejects.toThrow(/逐笔确认|来源.*变更/);
    await expect(generate(dependency)).rejects.toThrow(/逐笔确认|来源.*变更/);
    for (const report of [original, dependency])
      await expect(api.exportResult({ id: report.id, period: 202602 })).rejects.toThrow(
        /逐笔确认|来源.*变更/,
      );
    expect((await api.snapshot({ id: original.id, period: 202602 }))?.id).toBe(before.snapshot.id);
    expect((await api.get({ id: original.id })).revision).toBe(1);
    expect(await api.list({})).toHaveLength(2);
  });

  it('新同类独占资源行也不能省确认；明确补充完整新行后重新declaration可生成1900并真实导出', async () => {
    const api = app.call(classifiedServer);
    const mapping = await confirmClassifiedFixture(app.svc);
    const r = await api.importTemplate(activity402ClassifiedTemplate(mapping));
    await seedVouchers(app.svc, [
      {
        date: '2026-02-21',
        status: 'posted',
        lines: [
          { account: '1122', debit: 1200 },
          { account: '410102', credit: 1200 },
        ],
      },
    ]);
    await expect(
      api.importTemplate({ ...activity402ClassifiedTemplate(mapping), code: '412' }),
    ).rejects.toThrow(/逐笔确认/);
    const confirmed = await confirmClassifiedFixture(app.svc);
    expect(confirmed.recognitions).toHaveLength(3);
    const saved = await api.importTemplate({
      ...activity402ClassifiedTemplate(confirmed),
      code: '412',
    });
    const out = await generate(saved);
    expect(
      out.kind === 'generated' && out.snapshot.cells.find((c) => c.address === 'F6')?.value,
    ).toBe('1900');
    expect((await readProfileBinding(app.svc, saved.id))?.recognitions).toEqual(
      confirmed.recognitions,
    );
    expect((await api.get({ id: r.id })).revision).toBe(1);
    const exported = await api.exportResult({ id: saved.id, period: 202602 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
    expect(workbook.worksheets[0]!.getCell('E6').value).toBe(12);
    expect(workbook.worksheets[0]!.getCell('F6').value).toBe(19);
  });
});
