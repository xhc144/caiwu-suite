import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { sessionStore, unsavedPages, type SessionState } from '@caiwu/web-kit';
import { draftVersion, useUnsaved } from '../web/common';

afterEach(() => {
  cleanup();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});

function mount(save: (text: string) => Promise<void>) {
  sessionStore.set({ bookId: 'test-book', token: 'test' } as SessionState);
  let dirtySave!: () => Promise<void>;
  function Editor() {
    const [text, setText] = useState('');
    const [saved, setSaved] = useState('');
    const [left, setLeft] = useState(false);
    const unsaved = useUnsaved(
      text !== saved,
      async () => {
        await save(text);
        setSaved(text);
      },
      () => setText(saved),
      { title: '汇率编辑', version: text },
    );
    dirtySave = unsaved.save;
    return (
      <>
        <input
          aria-label="汇率"
          disabled={unsaved.isSaving}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button onClick={() => unsaved.guard(() => setLeft(true))}>关闭</button>
        <output>{left ? '已关闭' : '仍在编辑'}</output>
        {unsaved.dialog}
      </>
    );
  }
  render(
    <App>
      <Editor />
    </App>,
  );
  return { save: () => dirtySave() };
}

it('w_xt_fbwh：壳离开、保存失败与重试共用实际草稿；保存中合并重复提交并保留浏览器关闭提醒', async () => {
  let finish!: () => void;
  const persist = vi
    .fn<(text: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('写入失败'))
    .mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const editor = mount(persist);
  fireEvent.change(screen.getByLabelText('汇率'), { target: { value: '7.123456' } });
  expect(unsavedPages.dirty('test-book').map((p) => p.title)).toEqual(['汇率编辑']);
  let allowed = true;
  await act(async () => {
    allowed = await unsavedPages.leave('test-book', undefined, async () => 'save');
  });
  expect(allowed).toBe(false);
  expect(screen.getByLabelText('汇率')).toHaveValue('7.123456');
  expect(unsavedPages.dirty('test-book')).toHaveLength(1);

  let pending!: Promise<boolean>;
  let duplicate!: Promise<void>;
  await act(async () => {
    pending = unsavedPages.leave('test-book', undefined, async () => 'save');
    duplicate = editor.save();
  });
  expect(persist).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('汇率')).toBeDisabled();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await act(async () => {
    finish();
    await duplicate;
    allowed = await pending;
  });
  expect(allowed).toBe(true);
  expect(unsavedPages.dirty('test-book')).toHaveLength(0);
});

it('w_xt_dwwh：页内继续、保存失败留页、放弃后同步清理壳登记；取消壳离开不丢输入', async () => {
  const persist = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('失败'));
  mount(persist);
  fireEvent.change(screen.getByLabelText('汇率'), { target: { value: '7.5' } });
  fireEvent(window, new KeyboardEvent('keydown', { key: 'F4', ctrlKey: true, isComposing: true }));
  expect(screen.queryByRole('dialog', { name: '有未保存的修改' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('汇率')).toHaveValue('7.5');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect(persist).toHaveBeenCalledOnce());
  expect(screen.getByText('仍在编辑')).toBeVisible();
  expect(await unsavedPages.leave('test-book', undefined, async () => 'cancel')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  expect(screen.getByText('已关闭')).toBeVisible();
  expect(screen.getByLabelText('汇率')).toHaveValue('');
  expect(unsavedPages.dirty('test-book')).toHaveLength(0);
});

it('w_xt_kmwh：手工恢复原内容后不列入未保存页面，仍有实际修改时才拦截', () => {
  sessionStore.set({ bookId: 'test-book', token: 'test' } as SessionState);
  function Editor() {
    const [text, setText] = useState('原名称');
    const [dirty, setDirty] = useState(false);
    const unsaved = useUnsaved(
      dirty,
      async () => setDirty(false),
      () => {
        setText('原名称');
        setDirty(false);
      },
      { title: '科目', version: draftVersion({ text }) },
    );
    return (
      <input
        aria-label="名称"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
        }}
        disabled={unsaved.isSaving}
      />
    );
  }
  render(
    <App>
      <Editor />
    </App>,
  );
  expect(unsavedPages.dirty('test-book')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '改后名称' } });
  expect(unsavedPages.dirty('test-book')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '原名称' } });
  expect(unsavedPages.dirty('test-book')).toHaveLength(0);
});
