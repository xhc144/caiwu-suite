import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useRef, useState } from 'react';
import { sessionStore, type SessionState } from '../src/session';
import { unsavedPages, useUnsavedChanges } from '../src/unsaved';

afterEach(() => {
  cleanup();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});
it('真实React注册：可选version省略，保存旧快照时继续编辑保留dirty；成功保存新内容才可关闭', async () => {
  sessionStore.set({ bookId: 'book', token: 'test' } as SessionState);
  let finish!: () => void;
  function Editor() {
    const [text, setText] = useState('');
    const [saved, setSaved] = useState('');
    const textRef = useRef(text);
    textRef.current = text;
    useUnsavedChanges({
      title: '录入',
      dirty: text !== saved,
      save: async () => {
        const snapshot = textRef.current;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        setSaved(snapshot);
        return true;
      },
    });
    return (
      <input aria-label="内容" value={text} onChange={(event) => setText(event.target.value)} />
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText('内容'), { target: { value: '旧编辑' } });
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = unsavedPages.leave('book', undefined, async () => 'save');
  });
  fireEvent.change(screen.getByLabelText('内容'), { target: { value: '保存期间的新编辑' } });
  let allowed = true;
  await act(async () => {
    finish();
    allowed = await pending;
  });
  expect(allowed).toBe(false);
  expect(screen.getByLabelText('内容')).toHaveValue('保存期间的新编辑');
  expect(unsavedPages.dirty('book')).toHaveLength(1);
  await act(async () => {
    pending = unsavedPages.leave('book', undefined, async () => 'save');
  });
  await act(async () => {
    finish();
    allowed = await pending;
  });
  expect(allowed).toBe(true);
  expect(unsavedPages.dirty('book')).toHaveLength(0);
});
