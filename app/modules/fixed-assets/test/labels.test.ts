import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';

let app: TestApp;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>;
const filter = { kind: 'labels' as const, year: 2026, cutoff: '2026-06-30' };
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  const categoryId = await api.saveMaster({ data: { kind: 'category', code: '01', name: '设备' } });
  const purposeId = await api.saveMaster({ data: { kind: 'purpose', code: '01', name: '管理用' } });
  const statusId = await api.saveMaster({ data: { kind: 'status', code: '01', name: '在用' } });
  const departmentId = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  // 故意逆序保存，另有一张晚于截止日；序号不依赖数据库 ID。
  for (const [code, acquired] of [
    ['Z99', '2026-01-01'],
    ['A01', '2026-01-01'],
    ['B02', '2026-01-01'],
    ['A00', '2026-07-01'],
  ] as const)
    await api.save({
      data: {
        code,
        name: `标签设备${code}`,
        categoryId,
        purposeId,
        statusId,
        departmentId,
        acquired,
        useDate: acquired,
        original: 10000,
        rate: '0',
        method: '1',
        lifeMonths: 60,
      },
    });
});
afterEach(async () => app.close());

describe('w_zcgl_label：标签全部与记录序号范围', () => {
  it('按当前截止日及设备编号升序编排标签序号，范围含首尾且不等同于设备编号', async () => {
    const all = await api.reports(filter);
    expect(all.labelCount).toBe(3);
    expect(all.rows.map((r) => [r.serial, r.code])).toEqual([
      [1, 'A01'],
      [2, 'B02'],
      [3, 'Z99'],
    ]);
    const ranged = await api.reports({
      ...filter,
      labelRange: 'serial',
      fromSerial: 2,
      toSerial: 3,
    });
    expect(ranged.rows.map((r) => [r.serial, r.code])).toEqual([
      [2, 'B02'],
      [3, 'Z99'],
    ]);
    expect(ranged.labelCount).toBe(3);
    expect(ranged.total).toBe(20000);
    const codeRange = await api.reports({
      ...filter,
      fromCode: 'B',
      toCode: 'Z99',
      labelRange: 'serial',
      fromSerial: 1,
      toSerial: 1,
    });
    expect(codeRange.rows.map((r) => [r.serial, r.code])).toEqual([[1, 'B02']]);
    const single = await api.reports({
      ...filter,
      labelRange: 'serial',
      fromSerial: 1,
      toSerial: 1,
    });
    expect(single.rows.map((r) => r.code)).toEqual(['A01']);
  });

  it('打印全部不套用序号范围；超出记录范围及空编号区间保留明确空态', async () => {
    expect(
      (await api.reports({ ...filter, labelRange: 'all', fromSerial: 3, toSerial: 3 })).rows,
    ).toHaveLength(3);
    const empty = await api.reports({
      ...filter,
      labelRange: 'serial',
      fromSerial: 4,
      toSerial: 9,
    });
    expect(empty.rows).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.empty).toContain('没有记录');
    expect((await api.reports({ ...filter, fromCode: 'ZZ' })).rows).toEqual([]);
  });

  it('颠倒范围、非正整数、非数值及未知颜色拒绝请求，查看权限在服务端执行', async () => {
    await expect(
      api.reports({ ...filter, labelRange: 'serial', fromSerial: 3, toSerial: 2 }),
    ).rejects.toMatchObject({ cause: { data: { code: 'FIXED_ASSETS_LABEL_RANGE' } } });
    for (const fromSerial of [0, -1, 1.5, '2'])
      await expect(
        api.reports({ ...filter, labelRange: 'serial', fromSerial } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(api.reports({ ...filter, labelColor: 'red' } as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const noView = app.call(server, await app.addUser('no-asset-view'));
    await expect(noView.reports(filter)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
