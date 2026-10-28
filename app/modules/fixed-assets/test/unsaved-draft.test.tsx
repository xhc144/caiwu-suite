import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from 'antd';
import { sessionStore, unsavedPages, type SessionState } from '@caiwu/web-kit';
import { useAssetDraft } from '../web/useAssetDraft';

afterEach(() => {
  cleanup();
  Modal.destroyAll();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});

function Editor({
  save,
  close = () => {},
}: {
  save: (text: string) => Promise<void>;
  close?: () => void;
}) {
  const [text, setText] = useState('');
  const draft = useAssetDraft({
    title: '资产卡片及附属设备',
    save: () => save(text),
  });
  return (
    <>
      <input
        aria-label="设备名称"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          draft.changed();
        }}
      />
      <button onClick={() => void draft.save().catch(() => {})}>保存</button>
      <button onClick={() => draft.close(close)}>关闭卡片</button>
      <span>{draft.dirty ? '尚未保存' : '已保存'}</span>
    </>
  );
}

function setup(save: (text: string) => Promise<void>, close?: () => void) {
  sessionStore.set({ bookId: 'assets-test', token: 'test' } as SessionState);
  render(<Editor save={save} close={close} />);
}

it('w_zcgl_kp：重复保存共用提交；保存旧版本期间继续编辑，壳不能关闭新版本', async () => {
  const saved: string[] = [];
  let finish!: () => void;
  const save = vi.fn(async (text: string) => {
    saved.push(text);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  setup(save);
  fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '旧编辑' } });
  let leaving!: Promise<boolean>;
  await act(async () => {
    leaving = unsavedPages.leave('assets-test', undefined, async () => 'save');
  });
  fireEvent.click(screen.getByText('保存', { exact: true }));
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '保存期间新增' } });
  let allowed = true;
  await act(async () => {
    finish();
    allowed = await leaving;
  });
  expect(allowed).toBe(false);
  expect(screen.getByLabelText('设备名称')).toHaveValue('保存期间新增');
  expect(unsavedPages.dirty('assets-test')).toHaveLength(1);
  await act(async () => {
    leaving = unsavedPages.leave('assets-test', undefined, async () => 'save');
  });
  await act(async () => {
    finish();
    allowed = await leaving;
  });
  expect(allowed).toBe(true);
  expect(saved).toEqual(['旧编辑', '保存期间新增']);
  expect(unsavedPages.dirty('assets-test')).toHaveLength(0);
});

it('w_zcgl_kp：保存失败、取消关闭保留输入；明确放弃后才关闭抽屉', async () => {
  const close = vi.fn();
  setup(async () => {
    throw new Error('模拟保存失败');
  }, close);
  fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '失败后仍保留' } });
  let allowed = true;
  await act(async () => {
    allowed = await unsavedPages.leave('assets-test', undefined, async () => 'save');
  });
  expect(allowed).toBe(false);
  expect(screen.getByLabelText('设备名称')).toHaveValue('失败后仍保留');
  fireEvent.click(screen.getByText('关闭卡片'));
  const first = await screen.findByRole('dialog', { name: '有未保存内容' });
  fireEvent.click(within(first).getByRole('button', { name: '继续编辑' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('关闭卡片'));
  const second = await screen.findByRole('dialog', { name: '有未保存内容' });
  fireEvent.click(within(second).getByRole('button', { name: '放弃修改并关闭' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(unsavedPages.dirty('assets-test')).toHaveLength(0);
});
