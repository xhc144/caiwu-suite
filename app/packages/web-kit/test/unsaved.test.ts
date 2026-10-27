import { expect, it, vi } from 'vitest';
import { UnsavedRegistry, type UnsavedPage } from '../src/unsaved';

const page = (title: string, dirty = true): UnsavedPage => ({
  bookId: 'book',
  tabKey: title,
  title,
  dirty,
  save: async () => true,
});
it('w_frame：干净页不确认，一脏一净只列真正脏页，取消后注册内容全部保留', async () => {
  const registry = new UnsavedRegistry();
  registry.register(page('脏页'));
  registry.register(page('净页', false));
  const confirm = vi.fn(async () => 'cancel' as const);
  expect(await registry.leave('book', ['净页'], confirm)).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(await registry.leave('book', undefined, confirm)).toBe(false);
  expect(confirm.mock.calls[0]![0].map((p) => p.title)).toEqual(['脏页']);
  expect(registry.pages.size).toBe(2);
});
it('w_frame.closequery：统一确认后保存失败/冲突不关闭，成功后才允许批量离开', async () => {
  const registry = new UnsavedRegistry();
  const save = vi.fn(async () => false);
  const registration = registry.register({ ...page('录入'), save });
  registry.register(page('净页', false));
  expect(await registry.leave('book', undefined, async () => 'save')).toBe(false);
  expect(registry.pages.size).toBe(2);
  registration.update({
    ...page('录入'),
    save: async () => {
      throw new Error('版本冲突');
    },
  });
  expect(await registry.leave('book', undefined, async () => 'save')).toBe(false);
  registration.update({ ...page('录入'), save: async () => true });
  expect(await registry.leave('book', undefined, async () => 'save')).toBe(true);
  expect(save).toHaveBeenCalledOnce();
});
it('w_frame：保存期间新编辑/新增脏页使旧离开确认失效，另一账套互不影响', async () => {
  const registry = new UnsavedRegistry();
  let release!: () => void;
  registry.register({
    ...page('录入'),
    save: () =>
      new Promise<boolean>((resolve) => {
        release = () => resolve(true);
      }),
  });
  registry.register({ ...page('另一账套'), bookId: 'other' });
  const leaving = registry.leave('book', undefined, async () => 'save');
  await Promise.resolve();
  await Promise.resolve();
  registry.register(page('新修改'));
  release();
  expect(await leaving).toBe(false);
  expect(registry.dirty('other')).toHaveLength(1);
});
