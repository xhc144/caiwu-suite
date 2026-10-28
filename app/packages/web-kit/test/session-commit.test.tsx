import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SessionCommitBoundary } from '../src/session-commit';
import { sessionStore, useSession, type SessionState } from '../src/session';
import { unsavedPages, type LeaveResult } from '../src/unsaved';

afterEach(() => {
  cleanup();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});

it('w_pass：请求前同步锁定同账套表单及portal，另一账套仍可编辑、提交和独立协调', async () => {
  const submit = vi.fn();
  function Book({ id }: { id: string }) {
    const [text, setText] = useState('原稿');
    const [portal, setPortal] = useState('抽屉原稿');
    return (
      <SessionCommitBoundary bookId={id}>
        <form
          aria-label={`${id}表单`}
          onSubmit={(event) => {
            event.preventDefault();
            submit(id);
          }}
        >
          <input
            aria-label={`${id}内容`}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit">{id}保存</button>
        </form>
        {createPortal(
          <input
            aria-label={`${id}抽屉`}
            value={portal}
            onChange={(event) => setPortal(event.target.value)}
          />,
          document.body,
        )}
      </SessionCommitBoundary>
    );
  }
  render(
    <>
      <Book id="a" />
      <Book id="b" />
    </>,
  );
  let respond!: () => void;
  let pending!: Promise<LeaveResult>;
  await act(async () => {
    pending = unsavedPages.saveSessionChange('a', '密码', vi.fn(), async (context) =>
      context!.commit(() => {
        expect(screen.getByLabelText('a表单').parentElement).toHaveAttribute('inert');
        expect(screen.getByRole('status', { name: '正在保存登录信息' })).toHaveFocus();
        return new Promise<boolean>((resolve) => {
          respond = () => resolve(false);
        });
      }),
    );
  });
  expect(unsavedPages.isSessionCommitPending('a')).toBe(true);
  expect(unsavedPages.isSessionCommitPending('b')).toBe(false);
  for (const label of ['a内容', 'a抽屉'])
    fireEvent.change(screen.getByLabelText(label), { target: { value: '飞行期间新编辑' } });
  fireEvent.submit(screen.getByLabelText('a表单'));
  fireEvent.click(screen.getByRole('button', { name: 'a保存' }));
  expect(screen.getByLabelText('a内容')).toHaveValue('原稿');
  expect(screen.getByLabelText('a抽屉')).toHaveValue('抽屉原稿');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('b内容'), { target: { value: '另账套新编辑' } });
  fireEvent.change(screen.getByLabelText('b抽屉'), { target: { value: '另账套抽屉新编辑' } });
  fireEvent.submit(screen.getByLabelText('b表单'));
  expect(screen.getByLabelText('b内容')).toHaveValue('另账套新编辑');
  expect(screen.getByLabelText('b抽屉')).toHaveValue('另账套抽屉新编辑');
  expect(submit).toHaveBeenCalledExactlyOnceWith('b');
  expect(await unsavedPages.leave('b', undefined, vi.fn())).toBe(true);
  await act(async () => {
    respond();
    await pending;
  });
  expect(unsavedPages.isSessionCommitPending('a')).toBe(false);
  fireEvent.change(screen.getByLabelText('a内容'), { target: { value: '失败后继续编辑' } });
  expect(screen.getByLabelText('a内容')).toHaveValue('失败后继续编辑');
});

it('w_pass：afterLeave拒绝时释放锁并保留原错误，已撤销的当前令牌不能恢复编辑', async () => {
  sessionStore.set({ bookId: 'book', token: 'old-token' } as SessionState);
  function Workspace() {
    return useSession() ? (
      <SessionCommitBoundary bookId="book">
        <input aria-label="旧会话编辑" defaultValue="已保存" />
      </SessionCommitBoundary>
    ) : (
      <p>请重新登录</p>
    );
  }
  render(<Workspace />);
  let rejectLogin!: () => void;
  let pending!: Promise<LeaveResult>;
  const error = new Error('登录跳转失败');
  await act(async () => {
    pending = unsavedPages.saveSessionChange('book', '密码', vi.fn(), async (context) =>
      context!.commit(async () => {
        context!.afterLeave(
          () =>
            new Promise<void>((_, reject) => {
              rejectLogin = () => reject(error);
            }),
        );
        return { sessionRevoked: true };
      }),
    );
  });
  expect(unsavedPages.isSessionCommitPending('book')).toBe(true);
  expect(await unsavedPages.saveSessionChange('book', '密码', vi.fn(), vi.fn())).toMatchObject({
    allowed: false,
  });
  let result!: LeaveResult;
  await act(async () => {
    rejectLogin();
    result = await pending;
  });
  expect(result).toEqual({ allowed: false, sessionRevoked: true, error });
  expect(unsavedPages.isSessionCommitPending('book')).toBe(false);
  expect(screen.getByText('请重新登录')).toBeVisible();
  expect(screen.queryByLabelText('旧会话编辑')).not.toBeInTheDocument();
});

it('w_pass：异步收尾意外产生脏页并失败时保留注册稿，不能兜底清会话静默丢稿', async () => {
  sessionStore.set({ bookId: 'book', token: 'old-token' } as SessionState);
  const error = new Error('收尾失败');
  const result = await unsavedPages.saveSessionChange('book', '密码', vi.fn(), async (context) =>
    context!.commit(async () => {
      context!.afterLeave(async () => {
        unsavedPages.register({
          bookId: 'book',
          tabKey: '意外草稿',
          title: '意外草稿',
          dirty: true,
          version: 1,
          save: async () => false,
        });
        throw error;
      });
      return { sessionRevoked: true };
    }),
  );
  expect(result).toEqual({ allowed: false, sessionRevoked: true, error });
  expect(sessionStore.get()?.token).toBe('old-token');
  expect(unsavedPages.dirty('book').map((page) => page.title)).toEqual(['意外草稿']);
  expect(unsavedPages.isSessionCommitPending('book')).toBe(false);
});
