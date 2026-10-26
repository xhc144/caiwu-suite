import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyTemplate } from '../../shared';
import { useDefinitionHistory } from '../../web/history';

describe('w_bb_def 撤销/重做', () => {
  it('整批定义作为一个动作恢复，包含内容、审核、格式；新编辑清除重做', () => {
    const original = emptyTemplate({ code: '101', name: '原文', rows: 3, cols: 3 });
    const { result } = renderHook(() => useDefinitionHistory(() => original));
    const edited = {
      ...original,
      name: '修改后',
      checks: [{ name: '审核1', left: 'A1', right: 'A1', tolerance: '0' }],
    };
    act(() => result.current.edit(edited));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.draft).toEqual(original);
    act(() => result.current.redo());
    expect(result.current.draft).toEqual(edited);
    act(() => result.current.undo());
    act(() => result.current.edit((d) => ({ ...d, cols: 4 })));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.draft.name).toBe('原文');
    expect(result.current.draft.cols).toBe(4);
  });
  it('保存后清除历史、相同编辑不入历史，最多撤销20次', () => {
    const original = emptyTemplate({ code: '101', name: '原文', rows: 3, cols: 3 });
    const { result } = renderHook(() => useDefinitionHistory(() => original));
    act(() => result.current.edit({ ...original }));
    expect(result.current.canUndo).toBe(false);
    for (let i = 1; i <= 25; i++)
      act(() => result.current.edit((d) => ({ ...d, name: String(i) })));
    for (let i = 0; i < 25; i++) act(() => result.current.undo());
    expect(result.current.draft.name).toBe('5');
    act(() => result.current.reset(original));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });
});
