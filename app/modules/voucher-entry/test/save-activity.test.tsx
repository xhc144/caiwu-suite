import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { sessionStore, unsavedPages, useUnsavedChanges, type SessionState } from '@caiwu/web-kit';
import { useSaveActivity } from '../web/useSaveActivity';

afterEach(() => {
  cleanup();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function editor() {
  sessionStore.set({ bookId: 'voucher-book', token: 'test' } as SessionState);
  const response = deferred();
  const cleanupDone = deferred();
  let save!: (success?: boolean) => Promise<void>;
  function Editor() {
    const [text, setText] = useState('原内容');
    const [status, setStatus] = useState('已恢复');
    const version = useRef(0);
    const savedVersion = useRef(0);
    const { pending, saving, startSaving, finishSaving } = useSaveActivity();
    save = async (success = true) => {
      const snapshot = version.current;
      startSaving();
      try {
        await response.promise;
        if (success) savedVersion.current = snapshot;
        setStatus(success ? '已保存' : '保存失败');
        // 响应已到，缓存和队列收尾尚未结束；此时真实壳登记仍须阻止离开。
        await cleanupDone.promise;
      } finally {
        finishSaving();
      }
    };
    useUnsavedChanges({
      title: '凭证',
      dirty: version.current !== savedVersion.current || saving,
      version: version.current,
      save: () => save().then(() => true),
    });
    return (
      <>
        <input
          aria-label="摘要"
          value={text}
          onChange={(event) => {
            version.current += 1;
            setText(event.target.value);
          }}
        />
        <p role="status">{status}</p>
        <span data-testid="pending">{String(pending.current)}</span>
      </>
    );
  }
  render(<Editor />);
  fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '已编辑' } });
  return { response, cleanupDone, save: (success = true) => save(success) };
}

it('w_pz_pzedit_b：等待保存队列后立即关标签，清除在途状态登记且不再询问已保存内容', async () => {
  const form = editor();
  let saving!: Promise<void>;
  await act(async () => {
    saving = form.save();
  });
  await act(async () => form.response.resolve());
  expect(screen.getByRole('status')).toHaveTextContent('已保存');
  expect(unsavedPages.dirty('voucher-book')).toHaveLength(1);
  const confirm = vi.fn(async () => 'cancel' as const);
  const close = saving.then(() => unsavedPages.leave('voucher-book', undefined, confirm));
  await act(async () => {
    form.cleanupDone.resolve();
    // 必须在队列回调内同步可见，不能等下一次任意页面渲染才变 clean。
    expect(await close).toBe(true);
    expect(unsavedPages.dirty('voucher-book')).toHaveLength(0);
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByTestId('pending')).toHaveTextContent('false');
});

it.each([false, true])(
  'w_pz_pzedit_b：保存期间新编辑或保存失败仍登记未保存，失败=%s',
  async (failed) => {
    const form = editor();
    let saving!: Promise<void>;
    await act(async () => {
      saving = form.save(!failed);
    });
    if (!failed)
      fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '保存中的新编辑' } });
    await act(async () => form.response.resolve());
    const confirm = vi.fn(async () => 'cancel' as const);
    const close = saving.then(() => unsavedPages.leave('voucher-book', undefined, confirm));
    await act(async () => {
      form.cleanupDone.resolve();
      expect(await close).toBe(false);
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(unsavedPages.dirty('voucher-book')).toHaveLength(1);
    expect(screen.getByLabelText('摘要')).toHaveValue(failed ? '已编辑' : '保存中的新编辑');
  },
);
