import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { sessionStore, type SessionState } from '../src/session';
import { TabContext, useTab } from '../src/tabs';
import { SessionCommitBoundary } from '../src/session-commit';
import {
  unsavedPages,
  useUnsavedChanges,
  type ConfirmLeave,
  type LeaveChoice,
  type LeaveResult,
  type UnsavedSave,
} from '../src/unsaved';

afterEach(() => {
  cleanup();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});

function mountWorkspace({
  savePrint = async () => true,
  validatePassword = async () => {},
  passwordResponse = async () => true,
  beforeLogin = async () => {},
}: {
  savePrint?: () => Promise<boolean>;
  validatePassword?: () => Promise<void>;
  passwordResponse?: () => Promise<boolean>;
  beforeLogin?: () => Promise<void>;
} = {}) {
  sessionStore.set({ bookId: 'book', token: 'old-token' } as SessionState);
  const events: string[] = [];
  const switchRequest = vi.fn();
  const changePassword = vi.fn();
  const tab = (key: string, active: boolean) => ({
    key,
    active,
    close() {},
    setTitle() {},
  });
  function Workspace() {
    const [pages, setPages] = useState<readonly string[] | null>(null);
    const [result, setResult] = useState<LeaveResult | null>(null);
    const [loggedIn, setLoggedIn] = useState(true);
    const choice = useRef<(value: LeaveChoice) => void>(() => {});
    const confirm: ConfirmLeave = (dirty) =>
      new Promise((resolve) => {
        setPages(dirty.map((page) => page.title));
        choice.current = resolve;
      });
    const navigateToLogin = async () => {
      await beforeLogin();
      events.push('登录');
      setLoggedIn(false);
    };
    const leave = async (keys?: readonly string[]) => {
      const outcome = await unsavedPages.leaveWithResult('book', keys, confirm);
      setResult(outcome);
      if (outcome.allowed && !outcome.sessionRevoked) switchRequest();
    };
    return (
      <SessionCommitBoundary bookId="book">
        <button onClick={() => void leave()}>切换用户</button>
        <button onClick={() => void leave(['password'])}>关闭密码页</button>
        {loggedIn ? (
          <>
            <TabContext.Provider value={tab('password', true)}>
              <Password confirm={confirm} onResult={setResult} onLogin={navigateToLogin} />
            </TabContext.Provider>
            <TabContext.Provider value={tab('print', false)}>
              <Print />
            </TabContext.Provider>
          </>
        ) : (
          <p>请重新登录</p>
        )}
        {pages && (
          <div role="dialog" aria-label="有未保存内容">
            {pages.map((title) => (
              <p key={title}>{title}</p>
            ))}
            {(['save', 'discard', 'cancel'] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setPages(null);
                  choice.current(value);
                }}
              >
                {value === 'save' ? '保存并继续' : value === 'discard' ? '放弃修改并继续' : '取消'}
              </button>
            ))}
          </div>
        )}
        <output aria-label="协调结果">
          {result ? `${result.allowed}/${result.sessionRevoked}` : ''}
        </output>
        {result?.error instanceof Error && <p role="alert">{result.error.message}</p>}
      </SessionCommitBoundary>
    );
  }
  function Password({
    confirm,
    onResult,
    onLogin,
  }: {
    confirm: ConfirmLeave;
    onResult: (result: LeaveResult) => void;
    onLogin: () => void;
  }) {
    const [value, setValue] = useState('');
    const [saved, setSaved] = useState('');
    const tab = useTab();
    const save: UnsavedSave = async (context) => {
      if (!context) {
        const result = await unsavedPages.saveSessionChange('book', tab.key, confirm, save);
        onResult(result);
        return result.allowed;
      }
      const snapshot = value;
      await validatePassword();
      return context.commit(async () => {
        changePassword(snapshot);
        if (!(await passwordResponse())) return false;
        events.push('改密');
        setSaved(snapshot);
        context.afterLeave(onLogin);
        return { sessionRevoked: true };
      });
    };
    useUnsavedChanges({
      title: '自改密码',
      dirty: value !== saved,
      version: value,
      savePhase: 'session',
      save,
    });
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input
          aria-label="新密码"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit">保存新密码</button>
      </form>
    );
  }
  function Print() {
    const [text, setText] = useState('');
    const [saved, setSaved] = useState('');
    useUnsavedChanges({
      title: '打印设置',
      dirty: text !== saved,
      version: text,
      save: async () => {
        const snapshot = text;
        if (!(await savePrint())) return false;
        events.push(`保存打印：${snapshot}`);
        setSaved(snapshot);
        return true;
      },
      discard: () => {
        setText(saved);
      },
    });
    return (
      <input aria-label="打印草稿" value={text} onChange={(event) => setText(event.target.value)} />
    );
  }
  render(<Workspace />);
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password' } });
  fireEvent.change(screen.getByLabelText('打印草稿'), { target: { value: '另一标签的打印草稿' } });
  return { events, switchRequest, changePassword };
}

it.each(['切换用户', '关闭密码页', '保存新密码'])(
  'w_pass：真实双标签React注册，从%s进入均保存另一页后改密，协调完成才卸载，旧令牌不再切换',
  async (action) => {
    const { events, switchRequest, changePassword } = mountWorkspace();
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('打印设置');
    expect(changePassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    await screen.findByText('请重新登录');
    expect(events).toEqual(['保存打印：另一标签的打印草稿', '改密', '登录']);
    expect(changePassword).toHaveBeenCalledWith('new-password');
    expect(screen.getByLabelText('协调结果')).toHaveTextContent('true/true');
    expect(switchRequest).not.toHaveBeenCalled();
  },
);

it('w_pass：直接提交取消保留两页；其他页保存期间继续编辑阻止改密，重新保存后才成功', async () => {
  let finish!: () => void;
  const savePrint = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
  );
  const { events, changePassword } = mountWorkspace({ savePrint });
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.getByLabelText('协调结果')).toHaveTextContent('false/false'));
  expect(screen.getByLabelText('打印草稿')).toHaveValue('另一标签的打印草稿');
  expect(screen.getByLabelText('新密码')).toHaveValue('new-password');
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
  await waitFor(() => expect(savePrint).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('打印草稿'), { target: { value: '保存时的新编辑' } });
  await act(async () => {
    finish();
  });
  expect(changePassword).not.toHaveBeenCalled();
  expect(screen.getByLabelText('打印草稿')).toHaveValue('保存时的新编辑');
  expect(unsavedPages.dirty('book')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
  await waitFor(() => expect(savePrint).toHaveBeenCalledTimes(2));
  await act(async () => {
    finish();
  });
  expect(events).toEqual([
    '保存打印：另一标签的打印草稿',
    '保存打印：保存时的新编辑',
    '改密',
    '登录',
  ]);
});

it('w_pass：凭据响应挂起期间，原clean页不能新增编辑或提交，延迟跳登录完成才结束保护', async () => {
  let respond!: (success: boolean) => void;
  let finishLogin!: () => void;
  const response = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        respond = resolve;
      }),
  );
  const beforeLogin = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishLogin = resolve;
      }),
  );
  const { changePassword, events } = mountWorkspace({ passwordResponse: response, beforeLogin });
  fireEvent.click(screen.getByRole('button', { name: '切换用户' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
  await waitFor(() => expect(changePassword).toHaveBeenCalledOnce());
  expect(screen.getByRole('status', { name: '正在保存登录信息' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('打印草稿'), {
    target: { value: '请求飞行期间的新编辑' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  expect(screen.getByLabelText('打印草稿')).toHaveValue('另一标签的打印草稿');
  expect(changePassword).toHaveBeenCalledOnce();
  await act(async () => {
    respond(true);
  });
  await waitFor(() => expect(beforeLogin).toHaveBeenCalledOnce());
  expect(unsavedPages.isSessionCommitPending('book')).toBe(true);
  expect(await unsavedPages.saveSessionChange('book', 'password', vi.fn(), vi.fn())).toMatchObject({
    allowed: false,
  });
  fireEvent.change(screen.getByLabelText('打印草稿'), {
    target: { value: '延迟登录期间的新编辑' },
  });
  expect(screen.getByLabelText('打印草稿')).toHaveValue('另一标签的打印草稿');
  await act(async () => {
    finishLogin();
  });
  expect(events).toEqual(['保存打印：另一标签的打印草稿', '改密', '登录']);
  expect(screen.getByLabelText('协调结果')).toHaveTextContent('true/true');
  expect(unsavedPages.isSessionCommitPending('book')).toBe(false);
});

it.each(['false', 'reject'] as const)(
  'w_pass：凭据响应%s释放同账套交互保护，保留草稿并允许继续编辑',
  async (failure) => {
    let respond!: () => void;
    const error = new Error('改密请求失败');
    const passwordResponse = () =>
      new Promise<boolean>((resolve, reject) => {
        respond = () => {
          if (failure === 'reject') reject(error);
          else resolve(false);
        };
      });
    const { changePassword, events } = mountWorkspace({ passwordResponse });
    fireEvent.click(screen.getByRole('button', { name: '切换用户' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledOnce());
    expect(screen.getByRole('status', { name: '正在保存登录信息' })).toBeVisible();
    await act(async () => {
      respond();
    });
    expect(screen.queryByRole('status', { name: '正在保存登录信息' })).not.toBeInTheDocument();
    expect(unsavedPages.isSessionCommitPending('book')).toBe(false);
    expect(screen.getByLabelText('新密码')).toHaveValue('new-password');
    expect(events).toEqual(['保存打印：另一标签的打印草稿']);
    if (failure === 'reject') expect(screen.getByRole('alert')).toHaveTextContent(error.message);
    fireEvent.change(screen.getByLabelText('打印草稿'), { target: { value: '失败后继续编辑' } });
    expect(screen.getByLabelText('打印草稿')).toHaveValue('失败后继续编辑');
    expect(sessionStore.get()?.token).toBe('old-token');
  },
);

it('w_pass：其他页真实保存异常显示原错误，保留输入、会话和标签', async () => {
  const { changePassword, events } = mountWorkspace({
    savePrint: async () => {
      throw new Error('打印设置写入失败');
    },
  });
  fireEvent.click(screen.getByRole('button', { name: '关闭密码页' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('打印设置写入失败');
  expect(changePassword).not.toHaveBeenCalled();
  expect(events).toEqual([]);
  expect(sessionStore.get()?.token).toBe('old-token');
  expect(screen.getByLabelText('打印草稿')).toHaveValue('另一标签的打印草稿');
});

it('w_pass：最终校验期间重新编辑已保存的另一页，commit不会发出改密请求', async () => {
  let finish!: () => void;
  const validatePassword = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { changePassword, events } = mountWorkspace({ validatePassword });
  fireEvent.click(screen.getByRole('button', { name: '切换用户' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }));
  await waitFor(() => expect(validatePassword).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('打印草稿'), { target: { value: '校验时新增草稿' } });
  await act(async () => {
    finish();
  });
  expect(changePassword).not.toHaveBeenCalled();
  expect(events).toEqual(['保存打印：另一标签的打印草稿']);
  expect(screen.getByLabelText('协调结果')).toHaveTextContent('false/false');
  expect(screen.getByLabelText('打印草稿')).toHaveValue('校验时新增草稿');
});
