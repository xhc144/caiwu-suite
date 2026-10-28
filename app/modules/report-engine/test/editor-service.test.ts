import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { changeStructure, pasteCells } from '../editor-operations';
import { emptyTemplate, PrintSettingsSchema } from '../shared';
import reportServer from '../server';

let app: TestApp;
const caller = () => app.call(reportServer);

beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer] });
});
afterEach(async () => {
  await app.close();
});

async function report(readOnly = false) {
  const template = emptyTemplate({ code: '141', name: '编辑器保存测试', rows: 4, cols: 4 });
  template.readOnly = readOnly;
  template.cells = [
    { address: 'A1', kind: 'text', source: '经营报告', unit: 'number', currency: 'CNY' },
    { address: 'D4', kind: 'number', source: '125', unit: 'number', currency: 'CNY' },
  ];
  return caller().importTemplate(template);
}

describe('w_bb_def 插删行列保存', () => {
  it('自动粘贴数值和普通计算公式后可直接保存生成，不把数值公式误声明为金额', async () => {
    const template = pasteCells(
      emptyTemplate({ code: '145', name: '数量计算', rows: 2, cols: 3 }),
      'A1',
      '1.25\t2.75\t=A1+B1',
    );
    const report = await caller().importTemplate(template);
    const generated = await caller().generate({
      id: report.id,
      expectedRevision: report.revision,
      period: 202601,
      requestId: randomUUID(),
    });
    expect(generated.kind).toBe('generated');
    if (generated.kind !== 'generated') throw new Error('意外的未过账确认');
    expect(generated.snapshot.cells.find((c) => c.address === 'C1')).toMatchObject({
      value: '4',
      unit: 'number',
    });
  });
  it('未确认的缩小请求被拒绝；明确确认后保存删除结果、格式与打印设置且可生成', async () => {
    const initial = await report();
    const smaller = changeStructure(initial.template, {
      axis: 'row',
      kind: 'delete',
      index: 2,
      count: 1,
    });
    smaller.styles = [
      {
        address: 'D3',
        align: 'right',
        wrap: true,
        bold: true,
        format: 'decimal2',
        fontFamily: '仿宋',
        fontSize: 14,
        borderBottom: 'double',
      },
    ];
    smaller.print = PrintSettingsSchema.parse({
      orientation: 'landscape',
      marginMm: 12,
      repeatRows: 1,
      rowBreaks: [3],
      mode: 'overlay',
      offsetXmm: 2,
      offsetYmm: -1,
    });

    await expect(
      caller().save({ id: initial.id, expectedRevision: initial.revision, template: smaller }),
    ).rejects.toThrow(/缩小|确认/);
    expect(await caller().get({ id: initial.id })).toEqual(initial);

    const saved = await caller().save({
      id: initial.id,
      expectedRevision: initial.revision,
      template: smaller,
      confirmShrink: true,
    });
    expect(saved.revision).toBe(initial.revision + 1);
    expect(saved.template).toEqual(smaller);
    expect((await caller().exportTemplate({ id: initial.id })).print).toEqual(smaller.print);

    const generated = await caller().generate({
      id: saved.id,
      expectedRevision: saved.revision,
      period: 202601,
      requestId: randomUUID(),
    });
    expect(generated.kind).toBe('generated');
    if (generated.kind !== 'generated') throw new Error('意外的未过账确认');
    expect(generated.snapshot.cells.find((cell) => cell.address === 'D3')?.value).toBe('125');
    expect(generated.snapshot.template.styles).toEqual(smaller.styles);
    expect(generated.snapshot.template.print).toEqual(smaller.print);
  });

  it('确认缩小不能绕过乐观锁；失败保留另一个编辑者已保存的完整定义', async () => {
    const initial = await report();
    const newest = await caller().save({
      id: initial.id,
      expectedRevision: initial.revision,
      template: { ...initial.template, name: '另一位会计的修改' },
    });
    const smaller = changeStructure(initial.template, {
      axis: 'col',
      kind: 'delete',
      index: 2,
      count: 1,
    });
    await expect(
      caller().save({
        id: initial.id,
        expectedRevision: initial.revision,
        template: smaller,
        confirmShrink: true,
      }),
    ).rejects.toThrow(/不能覆盖|更改/);
    expect(await caller().get({ id: initial.id })).toEqual(newest);
  });

  it('确认缩小不能修改只读模板，也不能提升查看操作员的权限', async () => {
    const locked = await report(true);
    const smaller = changeStructure(locked.template, {
      axis: 'row',
      kind: 'delete',
      index: 2,
      count: 1,
    });
    await expect(
      caller().save({
        id: locked.id,
        expectedRevision: locked.revision,
        template: smaller,
        confirmShrink: true,
      }),
    ).rejects.toThrow(/只读/);
    expect(await caller().get({ id: locked.id })).toEqual(locked);

    const editable = await caller().copy({ sourceId: locked.id, code: '142', name: '可编辑副本' });
    const viewer = app.call(
      reportServer,
      await app.addUser('editor-viewer', { permissions: ['report-engine.view'] }),
    );
    await expect(
      viewer.save({
        id: editable.id,
        expectedRevision: editable.revision,
        template: changeStructure(editable.template, {
          axis: 'row',
          kind: 'delete',
          index: 2,
          count: 1,
        }),
        confirmShrink: true,
      }),
    ).rejects.toThrow(/权限/);
    expect(await caller().get({ id: editable.id })).toEqual(editable);
  });

  it('服务端拒绝越界字体及穿过合并格的分页，失败不覆盖当前定义', async () => {
    const initial = await report();
    const invalidFont = {
      ...initial.template,
      styles: [
        {
          address: 'A1',
          align: 'left' as const,
          wrap: false,
          bold: false,
          format: 'general' as const,
          fontSize: 100,
        },
      ],
    };
    await expect(
      caller().save({ id: initial.id, expectedRevision: initial.revision, template: invalidFont }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const invalidPage = {
      ...initial.template,
      merges: [{ row: 2, col: 1, rows: 2, cols: 1 }],
      print: PrintSettingsSchema.parse({ rowBreaks: [3] }),
    };
    await expect(
      caller().save({ id: initial.id, expectedRevision: initial.revision, template: invalidPage }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await caller().get({ id: initial.id })).toEqual(initial);
  });
});
