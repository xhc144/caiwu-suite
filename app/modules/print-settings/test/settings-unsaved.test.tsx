import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sessionStore, unsavedPages, type SessionState } from '@caiwu/web-kit';
import { defaultSettings, type Settings } from '../shared';
import SettingsEditor from '../web/SettingsEditor';

const { saveSettings } = vi.hoisted(() => ({
  saveSettings: vi.fn<(value: Settings) => Promise<Settings>>(),
}));
vi.mock('../web/api', () => ({
  api: {
    saveSettings: {
      mutationOptions: (options: object) => ({ ...options, mutationFn: saveSettings }),
    },
    settings: { queryKey: () => ['print-settings', 'settings'] },
  },
}));
const bookId = 'synthetic-print-book';
beforeEach(() => {
  saveSettings.mockReset().mockImplementation(async (value) => value);
  sessionStore.set({ bookId, token: 'synthetic' } as SessionState);
});
afterEach(() => {
  cleanup();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});
function editor() {
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <App>
        <SettingsEditor settings={structuredClone(defaultSettings)} onClose={close} />
      </App>
    </QueryClientProvider>,
  );
  return { close, input: screen.getByLabelText('打印单位名称') };
}

describe('w_xt_tz_zc 打印设置未保存保护', () => {
  it('干净编辑不列出，取消离开保留当前输入', async () => {
    const { input, close } = editor();
    const choose = vi.fn(async () => 'cancel' as const);
    expect(await unsavedPages.leave(bookId, undefined, choose)).toBe(true);
    expect(choose).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '合成单位甲' } });
    expect(unsavedPages.dirty(bookId).map((page) => page.title)).toEqual(['打印格式设置']);
    expect(await unsavedPages.leave(bookId, undefined, choose)).toBe(false);
    expect(input).toHaveValue('合成单位甲');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it('保存失败留稿，修正后重试成功才清除未保存状态', async () => {
    const { input, close } = editor();
    fireEvent.change(input, { target: { value: '失败后保留' } });
    saveSettings.mockRejectedValueOnce(new Error('合成保存失败'));
    let accepted = true;
    await act(async () => {
      accepted = await unsavedPages.leave(bookId, undefined, async () => 'save');
    });
    expect(accepted).toBe(false);
    expect(input).toHaveValue('失败后保留');
    expect(unsavedPages.dirty(bookId)).toHaveLength(1);
    await act(async () => {
      accepted = await unsavedPages.leave(bookId, undefined, async () => 'save');
    });
    expect(accepted).toBe(true);
    expect(unsavedPages.dirty(bookId)).toHaveLength(0);
    expect(close).not.toHaveBeenCalled();
  });
  it('保存中重复提交合并，后续新编辑留在页内并可再次保存', async () => {
    const { input, close } = editor();
    let finish!: (value: Settings) => void;
    saveSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.change(input, { target: { value: '先提交的内容' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: '保存中继续编辑' } });
    fireEvent.keyDown(input, { key: 's', code: 'KeyS', ctrlKey: true });
    const snapshot = saveSettings.mock.calls[0]![0];
    await act(async () => finish(snapshot));
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(input).toHaveValue('保存中继续编辑');
    expect(unsavedPages.dirty(bookId)).toHaveLength(1);
    let accepted = false;
    await act(async () => {
      accepted = await unsavedPages.leave(bookId, undefined, async () => 'save');
    });
    expect(accepted).toBe(true);
    expect(saveSettings.mock.calls[1]![0].voucher.unitName).toBe('保存中继续编辑');
    expect(unsavedPages.dirty(bookId)).toHaveLength(0);
  });
  it('明确放弃恢复已保存设置，不写接口', async () => {
    const { input } = editor();
    fireEvent.change(input, { target: { value: '准备放弃的修改' } });
    let accepted = false;
    await act(async () => {
      accepted = await unsavedPages.leave(bookId, undefined, async () => 'discard');
    });
    expect(accepted).toBe(true);
    expect(input).toHaveValue('');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(unsavedPages.dirty(bookId)).toHaveLength(0);
  });
});
