import { describe, expect, it } from 'vitest';
import { emptyTemplate, ReportTemplateSchema, type Report } from '../shared';
import { readEditorDraft } from '../web/editor-draft';

const initial = (): Report => ({
  id: 71,
  revision: 3,
  template: emptyTemplate({ code: '271', name: '已保存的经营报表', rows: 6, cols: 5 }),
});

describe('w_bb_def 本机草稿恢复', () => {
  it('没有草稿时使用服务器定义，不产生恢复警告', () => {
    const saved = initial();
    expect(readEditorDraft(null, saved)).toEqual({
      template: saved.template,
      structureChanges: [],
      recovery: null,
    });
    expect(readEditorDraft('', saved)).toEqual({
      template: saved.template,
      structureChanges: [],
      recovery: null,
    });
  });

  it.each(['number', 'money'] as const)(
    '同版本草稿保留空名称、空编码和未输入完整的%s值及审核表达式',
    (kind) => {
      const saved = initial();
      const draft = {
        revision: saved.revision,
        template: {
          ...saved.template,
          code: '',
          name: '',
          rows: 7,
          cells: [
            {
              address: 'A1',
              kind,
              source: '-',
              unit: kind === 'money' ? 'cents' : 'number',
              currency: 'CNY',
            },
          ],
          checks: [{ name: '', left: 'SUM(', right: '', tolerance: '-', condition: '' }],
        },
        structureChanges: [{ axis: 'row', kind: 'insert', index: 2, count: 1 }],
      };
      expect(ReportTemplateSchema.safeParse(draft.template).success).toBe(false);

      const restored = readEditorDraft(JSON.stringify(draft), saved);
      expect(restored.template).toEqual(draft.template);
      expect(restored.structureChanges).toEqual(draft.structureChanges);
      expect(restored.recovery).toBeNull();
      expect(saved).toEqual(initial());
    },
  );

  it('旧草稿未带结构元数据时默认空路径，完整但尚未保存的长内容仍保留', () => {
    const saved = initial();
    const draft = {
      ...saved.template,
      name: '正在改名',
      cells: [
        {
          address: 'A1',
          kind: 'text',
          source: '草稿'.repeat(1500),
          unit: 'number',
          currency: 'CNY',
        },
      ],
    };
    const restored = readEditorDraft(
      JSON.stringify({ revision: saved.revision, template: draft }),
      saved,
    );
    expect(restored.template).toEqual(draft);
    expect(restored.structureChanges).toEqual([]);
    expect(restored.recovery).toBeNull();
  });

  it('版本冲突使用服务器定义并保留原始草稿和版本提示，避免覆盖较新定义', () => {
    const saved = initial();
    const raw = JSON.stringify({
      revision: 2,
      template: { ...saved.template, name: '另一版本草稿' },
      structureChanges: [{ axis: 'col', kind: 'insert', index: 2, count: 1 }],
    });
    const restored = readEditorDraft(raw, saved);
    expect(restored.template).toBe(saved.template);
    expect(restored.structureChanges).toEqual([]);
    expect(restored.recovery).toMatchObject({ raw });
    expect(restored.recovery?.message).toMatch(/版本2.*版本3/);
    expect(saved).toEqual(initial());
  });

  it('坏 JSON 不丢弃原文，返回明确恢复提示且不套用损坏内容', () => {
    const saved = initial();
    const raw = '{"revision":3,"template":{"name":"未结束的草稿';
    const restored = readEditorDraft(raw, saved);
    expect(restored.template).toBe(saved.template);
    expect(restored.structureChanges).toEqual([]);
    expect(restored.recovery).toEqual({
      raw,
      message: expect.stringMatching(/读取失败.*原始内容已保留/),
    });
  });

  it('超出受限草稿长度或损坏的结构数据转入原文恢复，不把内容当成有效编辑', () => {
    const saved = initial();
    const drafts = [
      {
        revision: 3,
        template: {
          ...saved.template,
          cells: [
            {
              address: 'A1',
              kind: 'text',
              source: '长'.repeat(100_001),
              unit: 'number',
              currency: 'CNY',
            },
          ],
        },
      },
      {
        revision: 3,
        template: saved.template,
        structureChanges: [{ axis: 'row', kind: 'insert', index: 0, count: 1 }],
      },
      { revision: 3, template: { ...saved.template, rows: 0 } },
    ];
    for (const draft of drafts) {
      const raw = JSON.stringify(draft);
      const restored = readEditorDraft(raw, saved);
      expect(restored.template).toBe(saved.template);
      expect(restored.structureChanges).toEqual([]);
      expect(restored.recovery).toMatchObject({
        raw,
        message: expect.stringMatching(/无法自动恢复.*原始内容已保留/),
      });
    }
  });
});
