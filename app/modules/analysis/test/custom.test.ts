import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import analysis from '../server';
import type { DefinitionInput } from '../custom';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(analysis, token);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [analysis] });
  api = caller(app);
});
afterEach(async () => {
  await app?.close();
});
const definition = (extra: Partial<DefinitionInput> = {}): DefinitionInput => ({
  code: '1',
  name: '经营分析',
  expectedRevision: 0,
  rows: [
    { key: 1, name: '应收发生', formula: '借方("1122")', subtotal: false, unit: 'money' },
    { key: 2, name: '合计', formula: '项目(1) * 2', subtotal: true, unit: 'money' },
  ],
  ...extra,
});
const filter = (id: number) => ({ definitionId: id, periodFrom: 202601, periodTo: 202602 });
async function seed() {
  await seedVouchers(app.svc, [
    {
      date: '2026-01-10',
      status: 'posted',
      lines: [
        { account: '1122', debit: 12345, dims: { partner: 'C001' } },
        { account: '6001', credit: 12345 },
      ],
    },
    {
      date: '2026-02-10',
      status: 'pending',
      lines: [
        { account: '1122', debit: 2000, dims: { partner: 'C001' } },
        { account: '6001', credit: 2000 },
      ],
    },
  ]);
}
describe('w_fx_main / w_fx_copy / w_fx_def 持久定义', () => {
  it('新增、真实回读、复制、唯一编号、版本冲突与删除确认', async () => {
    const first = await api.definitions.save(definition());
    expect(first.code).toBe('001');
    expect((await api.definitions.get({ id: first.id })).rows).toEqual(first.rows);
    await expect(api.definitions.save(definition())).rejects.toThrow('编号重复');
    const copy = await api.definitions.save(definition({ code: '2', name: '副本' }));
    const saved = await api.definitions.save({ ...first, expectedRevision: 1, name: '新名称' });
    expect(saved.revision).toBe(2);
    await expect(api.definitions.save({ ...first, expectedRevision: 1 })).rejects.toThrow(
      '另一窗口',
    );
    await expect(
      api.definitions.remove({ id: copy.id, expectedRevision: 1, confirmed: false }),
    ).rejects.toThrow('确认');
    await api.definitions.remove({ id: copy.id, expectedRevision: 1, confirmed: true });
    expect(await api.definitions.list()).toHaveLength(1);
  });
  it.each(['1 2', '(1+2', '借方("不存在")', '借方("9999")', '项目(99)', '项目(1)'])(
    'w_fx_def 错误输入阻止且保留上次保存：%s',
    async (formula) => {
      const saved = await api.definitions.save(definition());
      await expect(
        api.definitions.save({
          ...saved,
          expectedRevision: 1,
          rows: [{ key: 1, name: '坏公式', formula }],
        }),
      ).rejects.toThrow();
      expect((await api.definitions.get({ id: saved.id })).rows).toEqual(saved.rows);
    },
  );
  it('w_fx_copy 空名称、非数字编号和缺源表不建立空表', async () => {
    await expect(api.definitions.save(definition({ name: '' }))).rejects.toThrow();
    await expect(api.definitions.save(definition({ code: 'a1' }))).rejects.toThrow();
    await expect(api.definitions.get({ id: 9999 })).rejects.toThrow('不存在');
    expect(await api.definitions.list()).toEqual([]);
  });
});
describe('w_fx_demo 自定义分析与结果持久化', () => {
  it('真实过账取数、含未过账、项目引用、手工调整及重开，原数独立保留', async () => {
    await seed();
    const def = await api.definitions.save(definition());
    const sheet = await api.definitions.calculate(filter(def.id));
    expect(sheet.rows.map((r) => r.values)).toEqual([
      [12345, 0],
      [24690, 0],
    ]);
    expect(
      (await api.definitions.calculate({ ...filter(def.id), includeUnposted: true })).rows[0]!
        .values,
    ).toEqual([12345, 2000]);
    sheet.rows[0]!.values[0] = 13000;
    const saved = await api.results.save({ expectedRevision: 0, name: '调整稿', sheet });
    const reopened = await api.results.get({ id: saved.id });
    expect(reopened.sheet.rows[0]!.values).toEqual([13000, 0]);
    expect(reopened.sheet.rows[0]!.originalValues).toEqual([12345, 0]);
    expect((await api.definitions.calculate(filter(def.id))).rows[0]!.values).toEqual([12345, 0]);
    await expect(
      api.definitions.remove({ id: def.id, expectedRevision: 1, confirmed: true }),
    ).rejects.toThrow('已有保存结果');
    await api.results.remove({ id: saved.id, expectedRevision: 1, confirmed: true });
    await api.definitions.remove({ id: def.id, expectedRevision: 1, confirmed: true });
  });
  it('另存保留调整稿与取数原值，不覆盖旧结果', async () => {
    await seed();
    const def = await api.definitions.save(definition());
    const sheet = await api.definitions.calculate(filter(def.id));
    sheet.rows[0]!.values[0] = 13000;
    const first = await api.results.save({ name: '原稿', expectedRevision: 0, sheet });
    const second = await api.results.save({
      ...first,
      expectedRevision: 1,
      name: '副本',
      saveAs: true,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.revision).toBe(1);
    expect(second.sheet).toEqual(first.sheet);
    const exported = await api.results.export({ name: second.name, sheet: second.sheet });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
    expect(workbook.getWorksheet('分析结果')!.getCell('D5').value).toBe(130);
    expect(workbook.getWorksheet('取数原值')!.getCell('D2').value).toBe(123.45);
    expect((await api.results.get({ id: first.id })).name).toBe('原稿');
    expect(await api.results.list()).toHaveLength(2);
  });
  it('w_fx_demo 除零、不存在期间和倒置期间不产生假结果', async () => {
    const def = await api.definitions.save(
      definition({
        rows: [{ key: 1, name: '比率', formula: '借方("1122") / 0', unit: 'percent' }],
      }),
    );
    await expect(api.definitions.calculate(filter(def.id))).rejects.toThrow('除数为零');
    await expect(
      api.definitions.calculate({ ...filter(def.id), periodFrom: 202501 }),
    ).rejects.toThrow();
    await expect(
      api.definitions.calculate({ ...filter(def.id), periodTo: 202701 }),
    ).rejects.toThrow();
    await expect(
      api.definitions.calculate({ ...filter(def.id), periodFrom: 202603 }),
    ).rejects.toThrow();
  });
  it('首次保存前源数据变化明确拒绝，旧保存稿版本冲突保全数据', async () => {
    const def = await api.definitions.save(definition());
    const sheet = await api.definitions.calculate(filter(def.id));
    await seed();
    await expect(
      api.results.save({ name: '过期结果', expectedRevision: 0, sheet }),
    ).rejects.toThrow('已变化');
    const current = await api.definitions.calculate(filter(def.id));
    const saved = await api.results.save({ name: '当前结果', expectedRevision: 0, sheet: current });
    await api.results.save({ ...saved, expectedRevision: 1, name: '新名字' });
    await expect(
      api.results.save({ ...saved, expectedRevision: 1, name: '旧窗口' }),
    ).rejects.toThrow('另一窗口');
    expect((await api.results.get({ id: saved.id })).name).toBe('新名字');
  });
  it('权限与期间服务端复检', async () => {
    const def = await api.definitions.save(definition());
    const view = caller(app, await app.addUser('reader', { permissions: ['analysis.view'] }));
    await expect(view.definitions.save(definition({ code: '2' }))).rejects.toThrow();
    const sheet = await view.definitions.calculate(filter(def.id));
    await expect(view.results.save({ name: '无权', expectedRevision: 0, sheet })).rejects.toThrow();
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(api.results.save({ name: '已结账', expectedRevision: 0, sheet })).rejects.toThrow(
      '结账',
    );
    expect(await api.results.list()).toHaveLength(0);
  });
});
describe('w_fx_def / w_fx_nd_1 存盘失败回滚', () => {
  it('定义和结果保存日志失败后保留原记录与版本', async () => {
    const saved = await api.definitions.save(definition());
    const sheet = await api.definitions.calculate(filter(saved.id));
    const result = await api.results.save({ name: '原结果', expectedRevision: 0, sheet });
    app.runtime.bookStore
      .open(app.book.id)
      .raw.exec(
        "CREATE TEMP TRIGGER analysis_fail_save BEFORE INSERT ON operation_log WHEN NEW.action IN ('analysis.definition.save', 'analysis.result.save') BEGIN SELECT RAISE(ABORT, '合成保存失败'); END;",
      );
    await expect(
      api.definitions.save({ ...saved, expectedRevision: 1, name: '不能落库' }),
    ).rejects.toThrow('合成保存失败');
    expect((await api.definitions.get({ id: saved.id })).name).toBe('经营分析');
    await expect(
      api.results.save({ ...result, expectedRevision: 1, name: '不能落库' }),
    ).rejects.toThrow('合成保存失败');
    expect(await api.results.get({ id: result.id })).toEqual(result);
  });
});
describe('w_fx_nd_1 年度结果编辑保存', () => {
  it('调整月数后累计、月均、占比重算；源账不受影响；失败不丢已保存数据', async () => {
    await seed();
    const sheet = await api.results.trend({ accountCode: '1122', period: 202601, mode: 'annual' });
    sheet.rows[0]!.values[0] = 12000;
    const result = await api.results.save({ name: '年度调整', expectedRevision: 0, sheet });
    expect(result.sheet.rows[0]).toMatchObject({ total: 12000, average: 1000, ratio: '100.00' });
    expect(result.sheet.rows[0]!.originalValues[0]).toBe(12345);
    const corrupt = structuredClone(result.sheet);
    corrupt.rows[0]!.values.pop();
    await expect(
      api.results.save({ id: result.id, name: '坏稿', expectedRevision: 1, sheet: corrupt }),
    ).rejects.toThrow();
    expect((await api.results.get({ id: result.id })).sheet).toEqual(result.sheet);
    expect(
      (await api.trend({ accountCode: '1122', period: 202601, mode: 'annual' })).rows[0]!.ytd,
    ).toBe(12345);
  });
});
