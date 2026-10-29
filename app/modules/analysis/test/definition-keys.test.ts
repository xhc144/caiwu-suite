import { describe, expect, it } from 'vitest';
import { nextDefinitionProjectKey } from '../web/definition-keys';

describe('w_fx_def 恢复草稿的稳定项目编号', () => {
  it('删除最高项目2后刷新恢复，项目1仍引用项目(2)，追加须用3而非重用2', () => {
    const recovered = [{ key: 1, formula: '项目(2)' }];
    expect(nextDefinitionProjectKey(recovered)).toBe(3);
    expect(recovered).toEqual([{ key: 1, formula: '项目(2)' }]);
  });
  it('坏公式中的已有引用仍占编号；不执行公式也不补全原文', () => {
    const recovered = [{ key: 1, formula: '项目 ( 5 + 未完成' }];
    expect(nextDefinitionProjectKey(recovered)).toBe(6);
    expect(recovered[0]!.formula).toBe('项目 ( 5 + 未完成');
  });
  it('当前会话已分配的高水位不因删除、移动或低编号恢复稿而降低', () => {
    expect(
      nextDefinitionProjectKey(
        [
          { key: 3, formula: '1' },
          { key: 1, formula: '2' },
        ],
        8,
      ),
    ).toBe(8);
    expect(nextDefinitionProjectKey([{ key: 1, formula: '项目(9) + 项目(2)' }], 8)).toBe(10);
  });
  it('超出允许编号的原文令后续增加明确达到上限，不分配非法或无穷编号', () => {
    expect(nextDefinitionProjectKey([{ key: 1, formula: `项目(${'9'.repeat(100)})` }])).toBe(10000);
  });
});
