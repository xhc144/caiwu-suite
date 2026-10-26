import { describe, expect, it, vi } from 'vitest';
import { continueAfterEdit } from '../web/unsaved';
describe('w_bb_def_gs 打开别格式和关闭前确认', () => {
  it('取消保留编辑，不保存、不切换', async () => {
    const save = vi.fn(),
      next = vi.fn();
    await continueAfterEdit(true, async () => 'cancel', save, next);
    expect(save).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
  it('放弃才切换，不调用保存', async () => {
    const save = vi.fn(),
      next = vi.fn();
    await continueAfterEdit(true, async () => 'discard', save, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
  it('保存完成后才切换，校验失败不关闭', async () => {
    const next = vi.fn();
    await continueAfterEdit(
      true,
      async () => 'save',
      async () => false,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    await continueAfterEdit(
      true,
      async () => 'save',
      async () => true,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('保存抛错不丢稿，无修改直接切换', async () => {
    const next = vi.fn(),
      choose = vi.fn();
    await expect(
      continueAfterEdit(
        true,
        async () => 'save',
        async () => {
          throw new Error('保存失败');
        },
        next,
      ),
    ).rejects.toThrow('保存失败');
    expect(next).not.toHaveBeenCalled();
    await continueAfterEdit(false, choose, async () => true, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(choose).not.toHaveBeenCalled();
  });
});
