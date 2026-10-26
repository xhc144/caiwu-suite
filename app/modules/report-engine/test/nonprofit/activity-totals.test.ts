import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import {
  activity402TotalsTemplate,
  checkActivityTotalsSources,
} from '../../templates/nonprofit/activity-totals';
import {
  activityFixtureChart,
  activityFixtureMapping,
  activityTestServer,
  seedActivity402Book,
  closeActivity402Pnl,
} from './activity-fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({
    modules: [activityTestServer],
    product: 'minfei',
    templateId: activityFixtureChart.id,
    seed: false,
  });
});
afterEach(async () => {
  await app?.close();
});

describe('402合计列真实取数，不冒充限定性完整报表', () => {
  it('真实导入/生成/导出：退回和自定义转账保留，pnl结转前后本月/累计合计一致', async () => {
    await seedActivity402Book(app.svc);
    const mapping = activityFixtureMapping();
    await checkActivityTotalsSources(app.svc, 202602, mapping);
    const api = app.call(activityTestServer);
    const r = await api.importTemplate(activity402TotalsTemplate(mapping));
    const generate = () =>
      api.generate({ id: r.id, expectedRevision: 1, period: 202602, requestId: randomUUID() });
    const first = await generate();
    if (first.kind !== 'generated') throw new Error('未生成');
    const values = Object.fromEntries(
      first.snapshot.cells.filter((c) => c.unit === 'cents').map((c) => [c.address, c.value]),
    );
    expect(values).toEqual({
      D6: '-3000',
      D7: '0',
      D8: '20000',
      D9: '0',
      D10: '0',
      D11: '0',
      D12: '0',
      D13: '0',
      D14: '17000',
      D16: '2000',
      D19: '0',
      D20: '0',
      D21: '0',
      D23: '0',
      D24: '0',
      D25: '0',
      D26: '2000',
      G6: '97000',
      G7: '0',
      G8: '20000',
      G9: '0',
      G10: '0',
      G11: '0',
      G12: '0',
      G13: '0',
      G14: '117000',
      G16: '17000',
      G19: '0',
      G20: '0',
      G21: '0',
      G23: '0',
      G24: '0',
      G25: '0',
      G26: '17000',
    });
    for (const address of ['B6', 'C6', 'E6', 'F6', 'D27', 'D28', 'D29', 'D30', 'G30'])
      expect(first.snapshot.cells.find((c) => c.address === address)?.value).toBe('待接入真实取数');
    await closeActivity402Pnl(app.svc);
    await checkActivityTotalsSources(app.svc, 202602, mapping);
    const closed = await generate();
    expect(closed.kind === 'generated' && closed.snapshot.cells).toEqual(first.snapshot.cells);
    const result = await api.exportResult({ id: r.id, period: 202602 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(result!.base64, 'base64')).buffer);
    expect(wb.worksheets[0]!.getCell('G14').value).toBe(1170);
    expect(wb.worksheets[0]!.getCell('G30').value).toBe('待接入真实取数');
  });

  it('拒绝未建立期间、含未过账、非损益来源和缺依据，不以零代替未知', async () => {
    await seedActivity402Book(app.svc);
    const mapping = activityFixtureMapping();
    await expect(
      checkActivityTotalsSources(app.svc, 202602, mapping, { includeUnposted: true }),
    ).rejects.toThrow(/已过账/);
    await expect(
      checkActivityTotalsSources(app.svc, 202701, activityFixtureMapping(202701)),
    ).rejects.toThrow('2027年01月还没有建立');
    const bad = structuredClone(mapping);
    bad.groups.donations.accounts = ['1001'];
    await expect(checkActivityTotalsSources(app.svc, 202602, bad)).rejects.toThrow(/不是损益/);
    expect(() =>
      activity402TotalsTemplate({
        ...mapping,
        groups: { ...mapping.groups, donations: { accounts: ['4101'], basis: '' } },
      }),
    ).toThrow(/依据/);
  });
});
