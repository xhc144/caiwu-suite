import { expect, it, vi } from 'vitest';
import {
  UnsavedRegistry,
  type ConfirmLeave,
  type UnsavedPage,
  type UnsavedSaveContext,
} from '../src/unsaved';

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
  const confirm = vi.fn<ConfirmLeave>(async () => 'cancel');
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
  registration.update({
    ...page('录入'),
    save: async () => {
      registration.update(page('录入', false));
      return true;
    },
  });
  expect(await registry.leave('book', undefined, async () => 'save')).toBe(true);
  expect(save).toHaveBeenCalledOnce();
});
it('w_frame：保存期间新编辑/新增脏页使旧离开确认失效，另一账套互不影响', async () => {
  const registry = new UnsavedRegistry();
  let release!: () => void;
  const original = page('录入');
  const registration = registry.register({
    ...original,
    save: () =>
      new Promise<boolean>((resolve) => {
        release = () => {
          registration.update({ ...original, dirty: false });
          resolve(true);
        };
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

it('w_frame.closequery：缺少version，保存期间原地更新仍dirty不能离开；重新保存变clean才离开', async () => {
  const registry = new UnsavedRegistry();
  let finish!: (value: boolean) => void;
  const original = {
    ...page('录入'),
    save: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  };
  const registration = registry.register(original);
  const leaving = registry.leave('book', undefined, async () => 'save');
  await Promise.resolve();
  registration.update({ ...original, title: '新编辑' });
  expect([...registry.pages.values()][0]).toBe(original);
  finish(true);
  expect(await leaving).toBe(false);
  registration.update({
    ...original,
    save: async () => {
      registration.update({ ...original, dirty: false });
      return true;
    },
  });
  expect(await registry.leave('book', undefined, async () => 'save')).toBe(true);
});

it('w_frame.closequery：新version仍dirty失效，新version已clean不误报丢数', async () => {
  for (const dirty of [true, false]) {
    const registry = new UnsavedRegistry();
    const registration = registry.register({
      ...page('录入'),
      version: 1,
      save: async () => {
        registration.update({ ...page('录入', dirty), version: 2 });
        return true;
      },
    });
    expect(await registry.leave('book', undefined, async () => 'save')).toBe(!dirty);
  }
});

it('w_pass / w_frame.closequery：单页关闭先保存同账套其他脏页，最后改密，再跳登录', async () => {
  const registry = new UnsavedRegistry();
  const calls: string[] = [];
  const password = registry.register({
    ...page('自改密码'),
    savePhase: 'session',
    save: async (context) => {
      expect(context).toMatchObject({ bookId: 'book', phase: 'session' });
      return context!.commit(async () => {
        calls.push('改密');
        password.update(page('自改密码', false));
        context!.afterLeave(async () => {
          calls.push('登录');
          // Coordination is over before navigation or cache teardown starts.
          expect(await registry.leave('book', undefined, async () => 'cancel')).toBe(true);
        });
        return { sessionRevoked: true };
      });
    },
  });
  const print = registry.register({
    ...page('打印设置'),
    save: async (context) => {
      expect(context?.phase).toBe('save');
      calls.push('保存打印');
      print.update(page('打印设置', false));
    },
  });
  const other = vi.fn();
  registry.register({ ...page('另一账套'), bookId: 'other', save: other });
  const confirm = vi.fn<ConfirmLeave>(async () => 'save');
  expect(await registry.leaveWithResult('book', ['自改密码'], confirm)).toEqual({
    allowed: true,
    sessionRevoked: true,
  });
  expect(confirm.mock.calls[0]![0].map((p) => p.title)).toEqual(['自改密码', '打印设置']);
  expect(calls).toEqual(['保存打印', '改密', '登录']);
  expect(other).not.toHaveBeenCalled();
});

it.each(['false', 'throw', 'dirty', 'new-page', 'new-version'] as const)(
  'w_pass：其他页面保存失败或新增编辑（%s）阻止凭据请求，错误可由调用方读取',
  async (failure) => {
    const registry = new UnsavedRegistry();
    const commit = vi.fn(async () => ({ sessionRevoked: true as const }));
    registry.register({ ...page('自改密码'), savePhase: 'session', save: commit });
    const error = new Error('打印设置保存失败');
    const print = registry.register({
      ...page('打印设置'),
      version: 1,
      save: async () => {
        if (failure === 'throw') throw error;
        if (failure === 'false') return false;
        print.update({ ...page('打印设置', failure === 'dirty'), version: 1 });
        if (failure === 'new-page') registry.register(page('新增草稿'));
        if (failure === 'new-version') print.update({ ...page('打印设置'), version: 2 });
        return true;
      },
    });
    const outcome = await registry.leaveWithResult('book', undefined, async () => 'save');
    expect(outcome).toMatchObject({ allowed: false, sessionRevoked: false });
    if (failure === 'throw') expect(outcome.error).toBe(error);
    expect(commit).not.toHaveBeenCalled();
  },
);

it('w_pass：直接提交也先确认其他脏页，取消不改密，无其他脏页时可正常改密', async () => {
  const registry = new UnsavedRegistry();
  const calls: string[] = [];
  const commit = vi.fn(async (context?: UnsavedSaveContext) =>
    context!.commit(async () => {
      calls.push('改密');
      return { sessionRevoked: true };
    }),
  );
  const print = registry.register({
    ...page('打印设置'),
    save: async () => {
      calls.push('打印');
      print.update(page('打印设置', false));
    },
  });
  expect(await registry.saveSessionChange('book', '密码', async () => 'cancel', commit)).toEqual({
    allowed: false,
    sessionRevoked: false,
  });
  expect(commit).not.toHaveBeenCalled();
  expect(await registry.saveSessionChange('book', '密码', async () => 'save', commit)).toEqual({
    allowed: true,
    sessionRevoked: true,
  });
  expect(calls).toEqual(['打印', '改密']);
  const confirm = vi.fn();
  expect(await registry.saveSessionChange('book', '密码', confirm, commit)).toMatchObject({
    allowed: true,
  });
  expect(confirm).not.toHaveBeenCalled();
});

it('w_pass：最终页异步校验期间产生新编辑，commit在请求前再次拒绝', async () => {
  const registry = new UnsavedRegistry();
  let ready!: () => void;
  let captured!: UnsavedSaveContext;
  const request = vi.fn(async () => ({ sessionRevoked: true as const }));
  const leaving = registry.saveSessionChange('book', '密码', vi.fn(), async (context) => {
    captured = context!;
    await new Promise<void>((resolve) => {
      ready = resolve;
    });
    return context!.commit(request);
  });
  registry.register(page('新编辑'));
  ready();
  expect(await leaving).toEqual({ allowed: false, sessionRevoked: false });
  expect(request).not.toHaveBeenCalled();
  // A retained callback cannot commit outside the operation that created it.
  expect(await captured.commit(request)).toBe(false);
});

it('w_pass：直接动作保留调用方的保存函数，不替换成同标签登记的其他操作', async () => {
  const registry = new UnsavedRegistry();
  const registeredSave = vi.fn();
  const registration = registry.register({
    ...page('密码'),
    savePhase: 'session',
    save: registeredSave,
  });
  const direct = vi.fn(async () => {
    registration.update(page('密码', false));
    return { sessionRevoked: true as const };
  });
  expect(await registry.saveSessionChange('book', '密码', vi.fn(), direct)).toEqual({
    allowed: true,
    sessionRevoked: true,
  });
  expect(direct).toHaveBeenCalledOnce();
  expect(registeredSave).not.toHaveBeenCalled();
});

it('w_frame：save收到上下文；旧式递归leave迅速拒绝，不等待自身；失败后可重试', async () => {
  const registry = new UnsavedRegistry();
  const confirm = vi.fn(async () => 'save' as const);
  const registration = registry.register({
    ...page('草稿'),
    save: async (context) => {
      expect(context?.phase).toBe('save');
      return registry.leave('book', undefined, confirm);
    },
  });
  expect(await registry.leave('book', undefined, confirm)).toBe(false);
  expect(confirm).toHaveBeenCalledOnce();
  registration.update({
    ...page('草稿'),
    save: async () => {
      registration.update(page('草稿', false));
      return true;
    },
  });
  expect(await registry.leave('book', undefined, confirm)).toBe(true);
});

it('w_frame：重复确认只弹一次，不同范围不能借用确认；确认异常保留错误并释放锁', async () => {
  const registry = new UnsavedRegistry();
  const noConfirmation = vi.fn();
  expect(
    await Promise.all([
      registry.leave('book', undefined, noConfirmation),
      registry.leave('book', undefined, noConfirmation),
    ]),
  ).toEqual([true, true]);
  expect(noConfirmation).not.toHaveBeenCalled();
  registry.register(page('草稿'));
  let finish!: (choice: 'cancel') => void;
  const confirm = vi.fn(
    () =>
      new Promise<'cancel'>((resolve) => {
        finish = resolve;
      }),
  );
  const first = registry.leaveWithResult('book', undefined, confirm);
  const duplicate = registry.leaveWithResult('book', undefined, confirm);
  expect(duplicate).toBe(first);
  expect(await registry.leave('book', ['草稿'], confirm)).toBe(false);
  finish('cancel');
  expect(await first).toEqual({ allowed: false, sessionRevoked: false });
  expect(confirm).toHaveBeenCalledOnce();
  const error = new Error('确认失败');
  expect(
    await registry.leaveWithResult('book', undefined, async () => {
      throw error;
    }),
  ).toMatchObject({ allowed: false, error });
  expect(await registry.leave('book', undefined, async () => 'discard')).toBe(true);
});

it('w_pass：放弃修改不执行改密；直接提交选择放弃其他页时，先处理其他页再改密', async () => {
  const registry = new UnsavedRegistry();
  const commit = vi.fn(async () => ({ sessionRevoked: true as const }));
  registry.register({ ...page('密码'), savePhase: 'session', save: commit });
  const discard = vi.fn();
  registry.register({ ...page('打印'), discard });
  expect(await registry.leave('book', ['密码'], async () => 'discard')).toBe(true);
  expect(commit).not.toHaveBeenCalled();
  expect(discard).toHaveBeenCalledOnce();
  registry.pages.clear();
  registry.register({ ...page('打印'), discard });
  expect(await registry.saveSessionChange('book', '密码', async () => 'discard', commit)).toEqual({
    allowed: true,
    sessionRevoked: true,
  });
  expect(discard).toHaveBeenCalledTimes(2);
  expect(commit).toHaveBeenCalledOnce();
});

it('w_pass：多页均须撤销会话时拒绝部分提交，仍允许放弃；最后阶段异常不跳登录', async () => {
  const registry = new UnsavedRegistry();
  const save = vi.fn();
  for (const title of ['密码', '授权'])
    registry.register({ ...page(title), savePhase: 'session', save });
  expect(await registry.leaveWithResult('book', undefined, async () => 'save')).toMatchObject({
    allowed: false,
    sessionRevoked: false,
    error: expect.any(Error),
  });
  expect(save).not.toHaveBeenCalled();
  expect(await registry.leave('book', undefined, async () => 'discard')).toBe(true);
  registry.pages.clear();
  const navigate = vi.fn();
  const error = new Error('原密码错误');
  expect(
    await registry.saveSessionChange('book', '密码', vi.fn(), async (context) => {
      context!.afterLeave(navigate);
      return context!.commit(async () => {
        throw error;
      });
    }),
  ).toEqual({ allowed: false, sessionRevoked: false, error });
  expect(navigate).not.toHaveBeenCalled();
});
