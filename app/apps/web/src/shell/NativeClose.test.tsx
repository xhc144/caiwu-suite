import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from 'antd';
import { unsavedPages } from '@caiwu/web-kit';
import { listenForNativeClose } from './guards';

afterEach(() => {
  Modal.destroyAll();
  cleanup();
  unsavedPages.pages.clear();
  Reflect.deleteProperty(window, 'caiwuDesktopHost');
});
it('桌面请求实际走壳的保存/取消守卫，异步保存失败或新编辑回应false，成功clean才回应true', async () => {
  let handler!: (id: string) => void;
  const respond = vi.fn();
  const remove = vi.fn();
  Object.assign(window, {
    caiwuDesktopHost: {
      closing: {
        onRequest: (fn: typeof handler) => {
          handler = fn;
          return remove;
        },
        respond,
      },
    },
  });
  const stop = listenForNativeClose('book');
  let finish: ((value: boolean) => void) | undefined;
  const page = {
    bookId: 'book',
    tabKey: '录入',
    title: '凭证录入',
    dirty: true,
    save: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  };
  const registration = unsavedPages.register(page);
  handler('cancel');
  fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }));
  await waitFor(() => expect(respond).toHaveBeenLastCalledWith('cancel', false));
  for (const id of ['failed', 'new-edit', 'saved']) {
    finish = undefined;
    handler(id);
    fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(respond).not.toHaveBeenCalledWith(id, true);
    if (id === 'new-edit') registration.update({ ...page, title: '新编辑' });
    if (id === 'saved') registration.update({ ...page, dirty: false });
    finish!(id !== 'failed');
    await waitFor(() => expect(respond).toHaveBeenLastCalledWith(id, id === 'saved'));
  }
  stop?.();
  expect(remove).toHaveBeenCalledOnce();
});
