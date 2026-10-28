import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import {
  changeStructure,
  createHistory,
  recordEdit,
  redoEdit,
  structureDelta,
  undoEdit,
  type StructureChange,
} from '../editor-operations';
import { emptyTemplate, type Report } from '../shared';
import reportServer from '../server';
import { hasReportReference } from '../editor-references';

let app: TestApp;
const api = () => app.call(reportServer);

beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer] });
});
afterEach(async () => {
  await app.close();
});

async function createTarget() {
  const template = emptyTemplate({ code: '201', name: '被引用经营表', rows: 6, cols: 5 });
  template.cells = [
    { address: 'B3', kind: 'number', source: '125', unit: 'number', currency: 'CNY' },
    { address: 'D5', kind: 'number', source: '75', unit: 'number', currency: 'CNY' },
  ];
  return api().importTemplate(template);
}
async function createReferencing(code = '202', readOnly = false) {
  const template = emptyTemplate({ code, name: `汇总引用表${code}`, rows: 5, cols: 4 });
  template.readOnly = readOnly;
  template.cells = [
    { address: 'A1', kind: 'number', source: '10', unit: 'number', currency: 'CNY' },
    {
      address: 'C2',
      kind: 'formula',
      source: '=REF("201","B3")+A1',
      unit: 'number',
      currency: 'CNY',
    },
    { address: 'C3', kind: 'formula', source: '=REF("201","D5")', unit: 'number', currency: 'CNY' },
    {
      address: 'A5',
      kind: 'text',
      source: 'REF("201","B3")是说明文字',
      unit: 'number',
      currency: 'CNY',
    },
  ];
  template.checks = [
    { name: '被引用数核对', left: 'REF("201","D5")', right: '75', tolerance: '0' },
  ];
  return api().importTemplate(template);
}
async function generate(report: Report) {
  const result = await api().generate({
    id: report.id,
    expectedRevision: report.revision,
    period: 202601,
    requestId: randomUUID(),
  });
  if (result.kind !== 'generated') throw new Error('意外的未过账凭证确认');
  return result.snapshot;
}
const source = (report: Report, address: string) =>
  report.template.cells.find((cell) => cell.address === address)?.source;

describe('w_bb_def 插删同步其他报表入向引用', () => {
  it('插入行同事务移动其他报表 REF 和审核表达式，更新版本，历史快照保持原貌', async () => {
    const target = await createTarget();
    const referencing = await createReferencing();
    const historical = await generate(referencing);
    const unrelated = await api().create({ code: '204', name: '无引用报表', rows: 2, cols: 2 });
    const change: StructureChange = { axis: 'row', kind: 'insert', index: 2, count: 2 };
    const saved = await api().save({
      id: target.id,
      expectedRevision: target.revision,
      template: changeStructure(target.template, change),
      structureChanges: [change],
    });
    const moved = await api().get({ id: referencing.id });

    expect(saved.revision).toBe(target.revision + 1);
    expect(moved.revision).toBe(referencing.revision + 1);
    expect(source(moved, 'C2')).toBe('=REF("201","B5")+A1');
    expect(source(moved, 'C3')).toBe('=REF("201","D7")');
    expect(source(moved, 'A5')).toBe('REF("201","B3")是说明文字');
    expect(moved.template.checks[0]?.left).toBe('REF("201","D7")');
    expect(moved.template.rows).toBe(referencing.template.rows);
    expect(await api().get({ id: unrelated.id })).toEqual(unrelated);
    expect(await api().snapshot({ id: referencing.id, period: 202601 })).toEqual(historical);

    const regenerated = await generate(moved);
    expect(regenerated.cells.find((cell) => cell.address === 'C2')?.value).toBe('135');
    expect(regenerated.cells.find((cell) => cell.address === 'C3')?.value).toBe('75');
    expect(regenerated.checks[0]?.status).toBe('pass');
    expect(regenerated.dependencies).toContainEqual({
      id: saved.id,
      code: '201',
      revision: saved.revision,
    });
    await expect(
      api().save({
        id: referencing.id,
        expectedRevision: referencing.revision,
        template: referencing.template,
      }),
    ).rejects.toThrow(/不能覆盖|更改/);
  });

  it('删除未被直接引用的列时指向右侧的 REF 收缩，当前表格地址不动', async () => {
    const target = await createTarget();
    const referencing = await createReferencing();
    const change: StructureChange = { axis: 'col', kind: 'delete', index: 1, count: 1 };
    await api().save({
      id: target.id,
      expectedRevision: target.revision,
      template: changeStructure(target.template, change),
      confirmShrink: true,
      structureChanges: [change],
    });
    const moved = await api().get({ id: referencing.id });
    expect(source(moved, 'C2')).toBe('=REF("201","A3")+A1');
    expect(source(moved, 'C3')).toBe('=REF("201","C5")');
    expect(moved.template.checks[0]?.left).toBe('REF("201","C5")');
    expect(source(moved, 'A1')).toBe('10');
    expect(moved.revision).toBe(2);
  });

  it('删除被外表直接引用的单元格时阻止保存，两张表及版本都保留', async () => {
    const target = await createTarget();
    const referencing = await createReferencing();
    const change: StructureChange = { axis: 'row', kind: 'delete', index: 3, count: 1 };
    await expect(
      api().save({
        id: target.id,
        expectedRevision: target.revision,
        template: changeStructure(target.template, change),
        confirmShrink: true,
        structureChanges: [change],
      }),
    ).rejects.toThrow(/汇总引用表202.*引用|引用.*删除/);
    expect(await api().get({ id: target.id })).toEqual(target);
    expect(await api().get({ id: referencing.id })).toEqual(referencing);
  });

  it('后续遇到只读引用表时回滚先前已改的普通引用表和本表', async () => {
    const target = await createTarget();
    const mutable = await createReferencing('202');
    const locked = await createReferencing('203', true);
    const change: StructureChange = { axis: 'row', kind: 'insert', index: 2, count: 1 };
    await expect(
      api().save({
        id: target.id,
        expectedRevision: target.revision,
        template: changeStructure(target.template, change),
        structureChanges: [change],
      }),
    ).rejects.toThrow(/只读报表.*203/);
    expect(await api().get({ id: target.id })).toEqual(target);
    expect(await api().get({ id: mutable.id })).toEqual(mutable);
    expect(await api().get({ id: locked.id })).toEqual(locked);
  });

  it('尺寸与结构步骤不一致、步骤位置越界均拒绝，引用方不变', async () => {
    const target = await createTarget();
    const referencing = await createReferencing();
    await expect(
      api().save({
        id: target.id,
        expectedRevision: target.revision,
        template: target.template,
        structureChanges: [{ axis: 'row', kind: 'insert', index: 2, count: 1 }],
      }),
    ).rejects.toThrow(/步骤.*尺寸|步骤.*不一致/);
    await expect(
      api().save({
        id: target.id,
        expectedRevision: target.revision,
        template: { ...target.template, rows: 7 },
        structureChanges: [{ axis: 'row', kind: 'insert', index: 8, count: 1 }],
      }),
    ).rejects.toThrow(/步骤.*不一致/);
    expect(await api().get({ id: target.id })).toEqual(target);
    expect(await api().get({ id: referencing.id })).toEqual(referencing);
  });

  it('保存后撤销发送反向结构步骤，使外表引用回到原位置且继续可计算', async () => {
    const target = await createTarget();
    const referencing = await createReferencing();
    const change: StructureChange = { axis: 'row', kind: 'insert', index: 2, count: 1 };
    const history = recordEdit(
      createHistory(target.template),
      changeStructure(target.template, change),
      change,
    );
    const saved = await api().save({
      id: target.id,
      expectedRevision: target.revision,
      template: history.present,
      structureChanges: history.changes,
    });
    expect(source(await api().get({ id: referencing.id }), 'C2')).toBe('=REF("201","B4")+A1');
    const undone = undoEdit(history);
    const reversed = await api().save({
      id: target.id,
      expectedRevision: saved.revision,
      template: undone.present,
      confirmShrink: true,
      structureChanges: structureDelta(history.changes, undone.changes),
    });
    expect(reversed.template).toEqual(target.template);
    const restored = await api().get({ id: referencing.id });
    expect(restored.revision).toBe(3);
    expect(restored.template).toEqual(referencing.template);
    expect((await generate(restored)).cells.find((cell) => cell.address === 'C2')?.value).toBe(
      '135',
    );
  });
});

describe('w_bb_main_bhxg 改编号的入向引用约束', () => {
  it('只改编号也拒绝仍有其他报表引用的定义，双方内容及版本不变', async () => {
    const target = await createTarget();
    const referencing = await createReferencing();
    await expect(
      api().save({
        id: target.id,
        expectedRevision: target.revision,
        template: { ...target.template, code: '205' },
      }),
    ).rejects.toThrow(/汇总引用表202.*引用编码201/);
    expect(await api().get({ id: target.id })).toEqual(target);
    expect(await api().get({ id: referencing.id })).toEqual(referencing);
  });

  it('在引用单元格之后插行但同时改编号也必须拒绝，不能以地址未移动跳过引用检查', async () => {
    const target = await createTarget();
    const referencing = await createReferencing();
    const change: StructureChange = { axis: 'row', kind: 'insert', index: 6, count: 1 };
    const changed = { ...changeStructure(target.template, change), code: '205' };
    await expect(
      api().save({
        id: target.id,
        expectedRevision: target.revision,
        template: changed,
        structureChanges: [change],
      }),
    ).rejects.toThrow(/引用编码201/);
    expect(await api().get({ id: target.id })).toEqual(target);
    expect(await api().get({ id: referencing.id })).toEqual(referencing);
  });

  it('只在审核表达式引用的报表同样阻止改编号', async () => {
    const target = await createTarget();
    const template = emptyTemplate({ code: '202', name: '仅审核引用表', rows: 2, cols: 2 });
    template.checks = [{ name: '跨表核对', left: 'REF("201","B3")', right: '125', tolerance: '0' }];
    const referencing = await api().importTemplate(template);
    await expect(
      api().save({
        id: target.id,
        expectedRevision: target.revision,
        template: { ...target.template, code: '205' },
      }),
    ).rejects.toThrow(/仅审核引用表.*引用编码201/);
    expect(await api().get({ id: target.id })).toEqual(target);
    expect(await api().get({ id: referencing.id })).toEqual(referencing);
  });

  it('本表仍用旧编码自引用时阻止改编号，移除自引用后才可保存', async () => {
    const target = await createTarget();
    const referencing = await api().save({
      id: target.id,
      expectedRevision: target.revision,
      template: {
        ...target.template,
        cells: [
          ...target.template.cells,
          {
            address: 'A1',
            kind: 'formula',
            source: 'REF("201","B3")',
            unit: 'number',
            currency: 'CNY',
          },
        ],
      },
    });
    await expect(
      api().save({
        id: referencing.id,
        expectedRevision: referencing.revision,
        template: { ...referencing.template, code: '205' },
      }),
    ).rejects.toThrow(/被引用经营表.*引用编码201/);
    expect(await api().get({ id: referencing.id })).toEqual(referencing);
    const renamed = await api().save({
      id: referencing.id,
      expectedRevision: referencing.revision,
      template: { ...target.template, code: '205' },
    });
    expect(renamed.template.code).toBe('205');
    expect(renamed.revision).toBe(referencing.revision + 1);
  });

  it.each([
    { formula: '= ref ( "201" , "B3" ) + A1', target: '201', expected: true },
    { formula: "REF('001','A1')", target: '1', expected: true },
    { formula: 'REF("202","B3")+A1', target: '201', expected: false },
    { formula: 'XREF("201","B3")', target: '201', expected: false },
    { formula: JSON.stringify('REF("201","B3")'), target: '201', expected: false },
    { formula: 'REF("10","B3")', target: '1', expected: false },
  ])('引用检测区分真实函数与字符串、函数名及完整编号 %j', ({ formula, target, expected }) => {
    expect(hasReportReference(formula, target)).toBe(expected);
  });
});

describe('w_bb_def 保存后撤销的结构路径', () => {
  const row: StructureChange = { axis: 'row', kind: 'insert', index: 2, count: 2 };
  const col: StructureChange = { axis: 'col', kind: 'delete', index: 3, count: 1 };
  const branch: StructureChange = { axis: 'col', kind: 'insert', index: 1, count: 1 };

  it('历史结构元数据跟随撤销重做；纯文本编辑不新增结构步骤', () => {
    const initial = emptyTemplate({ code: '251', name: '历史路径', rows: 6, cols: 5 });
    let history = recordEdit(createHistory(initial), changeStructure(initial, row), row);
    history = recordEdit(history, { ...history.present, name: '修改名称' });
    expect(history.changes).toEqual([row]);
    history = recordEdit(history, changeStructure(history.present, col), col);
    expect(history.changes).toEqual([row, col]);
    const undone = undoEdit(history);
    expect(undone.changes).toEqual([row]);
    expect(redoEdit(undone).changes).toEqual([row, col]);
    expect(undoEdit(undoEdit(undone)).changes).toEqual([]);
  });

  it('保存后撤销倒序反转已保存操作，仅添加共同前缀后的新分支', () => {
    expect(structureDelta([row, col], [])).toEqual([
      { ...col, kind: 'insert' },
      { ...row, kind: 'delete' },
    ]);
    expect(structureDelta([row, col], [row, branch])).toEqual([{ ...col, kind: 'insert' }, branch]);
    expect(structureDelta([row], [row])).toEqual([]);
    expect(structureDelta([], [row, branch])).toEqual([row, branch]);
  });

  it('恢复草稿携带结构元数据，新编辑与撤销保留恢复路径', () => {
    const restored = emptyTemplate({ code: '251', name: '恢复草稿', rows: 8, cols: 5 });
    const history = createHistory(restored, [row]);
    const changed = recordEdit(history, changeStructure(restored, branch), branch);
    expect(changed.changes).toEqual([row, branch]);
    expect(undoEdit(changed).changes).toEqual([row]);
    expect(structureDelta([row], undoEdit(changed).changes)).toEqual([]);
  });
});
