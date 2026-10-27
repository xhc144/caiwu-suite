import { expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NonprofitConfigurationPanel } from '../../templates/nonprofit/statutory.web';
import { blankConfiguration, annual } from './fixture';
import type { Configuration, Sources } from '../../templates/nonprofit/model';

const sources = {
  entries: [],
  accounts: [],
  balances: [],
  dimensionNames: {},
} as unknown as Sources;

it('w_bb_get 隐藏比较年面板注册的保存函数读取最新草稿和持久化回调，初始只发布草稿不报dirty', async () => {
  const c = blankConfiguration('合成比较年面板', 2027),
    user = userEvent.setup();
  let save!: () => Promise<void>;
  const onSaveReady = vi.fn((fn: () => Promise<void>) => {
      save = fn;
    }),
    onDraftChange = vi.fn(),
    onDirtyChange = vi.fn(),
    oldSave = vi.fn(),
    latestSave = vi.fn().mockResolvedValue(undefined);
  const panel = (hidden: boolean) => (
    <div hidden={hidden}>
      <NonprofitConfigurationPanel
        sources={sources}
        request={{ ...annual, from: 202701, to: 202712 }}
        initial={c}
        periods={[]}
        onRequestChange={vi.fn()}
        onSave={hidden ? latestSave : oldSave}
        onGenerate={vi.fn()}
        onSaveReady={onSaveReady}
        onDraftChange={onDraftChange}
        onDirtyChange={onDirtyChange}
      />
    </div>
  );
  const view = render(panel(false));
  await waitFor(() => expect(onSaveReady).toHaveBeenCalled());
  expect(onDraftChange).toHaveBeenLastCalledWith(c);
  expect(onDirtyChange).not.toHaveBeenCalled();
  const registered = save;
  await user.type(screen.getByRole('textbox', { name: '年初凭据' }), '比较年新增凭据');
  const draft: Configuration = onDraftChange.mock.lastCall![0];
  expect(draft.transitionOpeningReference).toBe(`${c.transitionOpeningReference}比较年新增凭据`);
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  view.rerender(panel(true));
  expect(save).toBe(registered);
  await act(async () => {
    await registered();
  });
  expect(oldSave).not.toHaveBeenCalled();
  expect(latestSave).toHaveBeenCalledWith(draft);
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('w_bb_get 注册保存对无效草稿和未确认子表单返回拒绝，不持久化旧配置或清dirty', async () => {
  const c = blankConfiguration('合成保存校验', 2027),
    user = userEvent.setup();
  let save!: () => Promise<void>;
  const onSave = vi.fn(),
    onDirtyChange = vi.fn();
  render(
    <NonprofitConfigurationPanel
      sources={sources}
      request={annual}
      initial={c}
      periods={[]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={vi.fn()}
      onDirtyChange={onDirtyChange}
      onSaveReady={(fn) => {
        save = fn;
      }}
    />,
  );
  await user.clear(screen.getByRole('textbox', { name: '年初凭据' }));
  await act(async () => {
    await expect(save()).rejects.toThrow(/原始凭据/);
  });
  expect(onSave).not.toHaveBeenCalled();
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  await user.type(screen.getByRole('textbox', { name: '年初凭据' }), '合成已补来源');
  await user.click(screen.getByText('核对上年度可比口径及项目重列'));
  await user.type(
    screen.getByRole('textbox', { name: '上年可比项目及口径核对依据' }),
    '合成未确认子表单',
  );
  await act(async () => {
    await expect(save()).rejects.toThrow(/请先确认或取消/);
  });
  expect(onSave).not.toHaveBeenCalled();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
});

it('w_bb_get 注册保存可等待，保存中新编辑保持最新draft及dirty，再次保存才clean', async () => {
  const c = blankConfiguration('合成异步保存'),
    user = userEvent.setup();
  let save!: () => Promise<void>, finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onSave = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(undefined),
    onDirtyChange = vi.fn(),
    onDraftChange = vi.fn();
  render(
    <NonprofitConfigurationPanel
      sources={sources}
      request={annual}
      initial={c}
      periods={[]}
      onRequestChange={vi.fn()}
      onSave={onSave}
      onGenerate={vi.fn()}
      onDirtyChange={onDirtyChange}
      onDraftChange={onDraftChange}
      onSaveReady={(fn) => {
        save = fn;
      }}
    />,
  );
  await user.type(screen.getByRole('textbox', { name: '年初凭据' }), '第一次编辑');
  let saving!: Promise<void>;
  act(() => {
    saving = save();
  });
  const result = saving.then(
    () => null,
    (e: unknown) => e,
  );
  expect(save()).toBe(saving);
  await user.type(screen.getByRole('textbox', { name: '年初凭据' }), '保存中新增');
  const latest: Configuration = onDraftChange.mock.lastCall![0];
  await act(async () => {
    finish();
    await result;
  });
  expect(await result).toEqual(
    expect.objectContaining({ message: expect.stringMatching(/保存期间又有编辑/) }),
  );
  expect(onDirtyChange).not.toHaveBeenCalledWith(false);
  expect(onDraftChange).toHaveBeenLastCalledWith(latest);
  await act(async () => {
    await save();
  });
  expect(onSave).toHaveBeenLastCalledWith(latest);
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});
