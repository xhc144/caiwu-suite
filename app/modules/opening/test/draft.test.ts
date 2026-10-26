import { describe, expect, it, vi } from 'vitest';
import { resolveLeave } from '../web/draft';

describe.each(['w_xt_ye', 'w_xt_xmnc', 'w_xt_dwnc', 'w_xt_bmnc', 'w_xt_grnc'])(
  '%s 未保存退出',
  (window) => {
    it(`${window}：可保存、放弃或取消；取消不退出也不调用保存`, async () => {
      const save = vi.fn(async () => true),
        leave = vi.fn();
      expect(await resolveLeave('cancel', save, leave)).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(leave).not.toHaveBeenCalled();
      expect(await resolveLeave('discard', save, leave)).toBe(true);
      expect(save).not.toHaveBeenCalled();
      expect(leave).toHaveBeenCalledOnce();
    });
    it(`${window}：存盘不成功不得退出或清理输入，重试成功才继续`, async () => {
      const form = { amount: '1.01', account: '1001' },
        save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
        leave = vi.fn(() => {
          form.amount = '';
        });
      expect(await resolveLeave('save', save, leave)).toBe(false);
      expect(form.amount).toBe('1.01');
      expect(leave).not.toHaveBeenCalled();
      expect(await resolveLeave('save', save, leave)).toBe(true);
      expect(leave).toHaveBeenCalledOnce();
    });
  },
);
