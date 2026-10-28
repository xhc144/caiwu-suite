import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import reportServer from '../server';
import { emptyTemplate } from '../shared';
import { reportHtml } from '../web/print';
import { changeStructure } from '../editor-operations';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer] });
});
afterEach(async () => {
  await app.close();
});

it('w_bb_def 条件审核保存、逐项生成通过/不通过/错误，插行同步调整本地和跨表引用', async () => {
  const api = app.call(reportServer);
  const template = emptyTemplate({ code: '101', name: '条件审核合成表', rows: 3, cols: 2 });
  template.cells = [
    { address: 'A1', kind: 'number', source: '10', unit: 'number', currency: 'CNY' },
    { address: 'A2', kind: 'number', source: '20', unit: 'number', currency: 'CNY' },
  ];
  template.checks = [
    {
      name: '条件成立',
      left: '0',
      right: '0',
      tolerance: '0',
      condition: 'A1 < A2 AND NOT (A1 = A2)',
    },
    { name: '条件不成立', left: '0', right: '0', tolerance: '0', condition: 'A1 > A2 OR A1 = A2' },
    { name: '条件算错', left: '0', right: '0', tolerance: '0', condition: '1 / 0 = 0' },
  ];
  const report = await api.importTemplate(template);
  const other = emptyTemplate({ code: '102', name: '跨表条件合成表', rows: 2, cols: 2 });
  other.cells = [{ address: 'B1', kind: 'number', source: '10', unit: 'number', currency: 'CNY' }];
  other.checks = [
    { name: '跨表比较', left: '0', right: '0', tolerance: '0', condition: 'REF("101","A1") = B1' },
  ];
  const linked = await api.importTemplate(other);
  const generated = await api.generate({
    id: report.id,
    expectedRevision: report.revision,
    period: 202601,
    requestId: randomUUID(),
  });
  if (generated.kind !== 'generated') throw new Error('意外确认');
  expect(
    generated.snapshot.checks.map((check) => [check.status, check.condition, check.reason]),
  ).toEqual([
    ['pass', template.checks[0]!.condition, '条件成立'],
    ['fail', template.checks[1]!.condition, '条件不成立'],
    ['error', template.checks[2]!.condition, '除数为零'],
  ]);
  expect(reportHtml(generated.snapshot)).toContain('A1 &lt; A2 AND NOT (A1 = A2)；条件成立');
  const change = { axis: 'row', kind: 'insert', index: 1, count: 1 } as const;
  const moved = changeStructure(report.template, change);
  expect(moved.checks[0]!.condition).toBe('A2 < A3 AND NOT (A2 = A3)');
  const saved = await api.save({
    id: report.id,
    expectedRevision: report.revision,
    template: moved,
    structureChanges: [change],
  });
  expect((await api.get({ id: linked.id })).template.checks[0]!.condition).toBe(
    'REF("101","A2") = B1',
  );
  const blocked = { axis: 'row', kind: 'delete', index: 2, count: 1 } as const;
  expect(() => changeStructure(saved.template, blocked)).toThrow('公式直接引用');
  await expect(
    api.save({
      id: saved.id,
      expectedRevision: saved.revision,
      template: { ...saved.template, code: '103' },
    }),
  ).rejects.toThrow('引用');
  await expect(
    api.save({
      id: saved.id,
      expectedRevision: saved.revision,
      template: {
        ...saved.template,
        checks: [{ ...saved.template.checks[0]!, condition: 'A2 > 0 AND' }],
      },
    }),
  ).rejects.toThrow('条件');
  expect(await api.get({ id: saved.id })).toEqual(saved);
});
