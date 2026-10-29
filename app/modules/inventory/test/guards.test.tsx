import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState, type ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render as baseRender,
  renderHook,
  screen,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../web/api';
import { TabContext, sessionStore, unsavedPages, type SessionState } from '@caiwu/web-kit';
import { Grid, mayDiscard, useUnsaved } from '../web/common';
import type * as PrintModule from '@caiwu/print';
import { printHtml } from '@caiwu/print';
function render(
  ui: ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { enabled: false } } }),
) {
  return baseRender(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
vi.mock('@caiwu/print', async (importOriginal) => ({
  ...(await importOriginal<typeof PrintModule>()),
  printHtml: vi.fn(),
}));
beforeEach(() => {
  sessionStore.set({ bookId: 'inventory-test', token: 'test' } as SessionState);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  unsavedPages.pages.clear();
  sessionStore.set(null);
});
describe('未保存与格式确认', () => {
  it('w_cb_tzxx：表格和打印遵守显示精度，原始数据不改变', () => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    // 表格只读取设置；此夹具不伪造账套、期间和库存控制数据。
    client.setQueryData(api.context.queryKey() as readonly unknown[], {
      settings: { quantityDigits: 2, priceDigits: 3 },
    });
    const rows = [{ id: 1, quantity: '1.234567', unitPrice: '3.123456' }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <Grid
        id="precision"
        title="精度表"
        rows={rows}
        columns={[
          { key: 'quantity', title: '数量', dataIndex: 'quantity' },
          { key: 'unitPrice', title: '单价', dataIndex: 'unitPrice' },
        ]}
      />,
      client,
    );
    expect(screen.getByText('1.23')).toBeInTheDocument();
    expect(screen.getByText('3.123')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /打\s*印/ }));
    expect(printHtml).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('<td>1.23</td><td>3.123</td>') }),
    );
    expect(rows[0]).toMatchObject({ quantity: '1.234567', unitPrice: '3.123456' });
  });
  it.each(['w_cb_cpda', 'w_cb_qc', 'w_ck_rk1', 'w_ck_ck1', 'w_cb_pdk_1'])(
    '%s：未保存关闭/刷新可取消，取消不调用后续动作',
    async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      expect(mayDiscard(true)).toBe(false);
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('未保存'));
      confirm.mockReturnValue(true);
      expect(mayDiscard(true)).toBe(true);
      expect(mayDiscard(false)).toBe(true);
      const { unmount } = renderHook(() => useUnsaved(true, { title: '当前库存表单' }));
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      expect(unsavedPages.dirty('inventory-test')).toHaveLength(1);
      expect(unsavedPages.dirty('inventory-test')[0]?.title).toBe('当前库存表单');
      expect(await unsavedPages.leave('inventory-test', ['standalone'], async () => 'cancel')).toBe(
        false,
      );
      expect(unsavedPages.dirty('inventory-test')).toHaveLength(1);
      unmount();
      const saved = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(saved);
      expect(saved.defaultPrevented).toBe(false);
    },
  );
  it('w_cb_cpda/w_ck_rk1：关闭非当前标签只检查所属未保存表单，其他账套和标签不误拦', async () => {
    const save = vi.fn(async () => false);
    render(
      <TabContext.Provider
        value={{ key: '/m/inventory/master', active: false, setTitle: () => {}, close: () => {} }}
      >
        <Guard save={save} />
      </TabContext.Provider>,
    );
    const confirm = vi.fn(async () => 'cancel' as const);
    expect(await unsavedPages.leave('inventory-test', ['/m/inventory/master'], confirm)).toBe(
      false,
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(await unsavedPages.leave('inventory-test', ['/m/inventory/stock'], confirm)).toBe(true);
    expect(await unsavedPages.leave('另一账套', undefined, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
  it('w_ck_rk1：保存失败和取消保留原输入；显式放弃后清除未保存注册', async () => {
    render(
      <Editor
        onSave={async () => {
          throw new Error('保存失败');
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('编辑内容'), { target: { value: '未存单据' } });
    await act(async () => {
      expect(await unsavedPages.leave('inventory-test', undefined, async () => 'cancel')).toBe(
        false,
      );
      expect(await unsavedPages.leave('inventory-test', undefined, async () => 'save')).toBe(false);
    });
    expect(screen.getByLabelText('编辑内容')).toHaveValue('未存单据');
    expect(unsavedPages.dirty('inventory-test')).toHaveLength(1);
    await act(async () => {
      expect(await unsavedPages.leave('inventory-test', undefined, async () => 'discard')).toBe(
        true,
      );
    });
    expect(screen.getByLabelText('编辑内容')).toHaveValue('');
    expect(unsavedPages.dirty('inventory-test')).toHaveLength(0);
  });
  it('w_ck_rk1：关闭保存只完成旧快照时保留期间新编辑，新版本保存成功才准关闭', async () => {
    let finish!: () => void;
    render(
      <Editor
        onSave={() =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    fireEvent.change(screen.getByLabelText('编辑内容'), { target: { value: '第一版' } });
    let leaving!: Promise<boolean>;
    await act(async () => {
      leaving = unsavedPages.leave('inventory-test', undefined, async () => 'save');
    });
    fireEvent.change(screen.getByLabelText('编辑内容'), { target: { value: '保存期间第二版' } });
    await act(async () => {
      finish();
      expect(await leaving).toBe(false);
    });
    expect(screen.getByLabelText('编辑内容')).toHaveValue('保存期间第二版');
    expect(unsavedPages.dirty('inventory-test')).toHaveLength(1);
    await act(async () => {
      leaving = unsavedPages.leave('inventory-test', undefined, async () => 'save');
    });
    await act(async () => {
      finish();
      expect(await leaving).toBe(true);
    });
    expect(unsavedPages.dirty('inventory-test')).toHaveLength(0);
  });
  it('w_ck_rk1：保存进行中不能放弃关页，失败结果返回前不清除草稿', async () => {
    const discard = vi.fn();
    const { rerender } = renderHook(
      ({ pending }) => {
        const [dirty, setDirty] = useState(true);
        useUnsaved(dirty, {
          title: '正在保存的单据',
          pending,
          version: '当前草稿',
          discard: () => {
            discard();
            setDirty(false);
          },
        });
      },
      { initialProps: { pending: true } },
    );
    await act(async () => {
      expect(await unsavedPages.leave('inventory-test', undefined, async () => 'discard')).toBe(
        false,
      );
    });
    expect(discard).not.toHaveBeenCalled();
    expect(unsavedPages.dirty('inventory-test')).toHaveLength(1);
    rerender({ pending: false });
    await act(async () => {
      expect(await unsavedPages.leave('inventory-test', undefined, async () => 'discard')).toBe(
        true,
      );
    });
    expect(discard).toHaveBeenCalledOnce();
  });
  it('w_ck_rk/w_ck_ck/w_cb_sl_hzyeb：恢复列宽与打印需确认；打印金额按元且转义文本', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    localStorage.setItem('caiwu.table.inventory.test.widths', '{"name":180}');
    render(
      <Grid
        id="test"
        title="表格"
        rows={[{ id: 1, name: '<script>危险</script>', amount: 123 }]}
        columns={[
          { key: 'name', title: '名称', dataIndex: 'name' },
          { key: 'amount', title: '金额', dataIndex: 'amount', money: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByText('恢复默认列宽'));
    expect(localStorage.getItem('caiwu.table.inventory.test.widths')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /打\s*印/ }));
    expect(printHtml).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText('恢复默认列宽'));
    expect(localStorage.getItem('caiwu.table.inventory.test.widths')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /打\s*印/ }));
    expect(printHtml).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('1.23') }),
    );
    expect(printHtml).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('&lt;script&gt;') }),
    );
  });
  it('w_ck_kc_hz/w_cb_hzsj_rk/w_cb_hzsj_ck/w_ck_xsmxz1：空范围中文无数据，不导出虚假文件', () => {
    render(
      <Grid
        id="empty"
        title="空表"
        rows={[]}
        columns={[{ key: 'name', title: '名称', dataIndex: 'name' }]}
      />,
    );
    expect(screen.getByText('该范围内无数据')).toBeInTheDocument();
    expect(screen.queryByText('导出 Excel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打\s*印/ }).closest('button')).toBeDisabled();
  });
});
function Guard({ save }: { save: () => Promise<boolean> }) {
  useUnsaved(true, { title: '产品档案', save });
  return null;
}
function Editor({ onSave }: { onSave: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const latest = useRef(text);
  latest.current = text;
  useUnsaved(text !== saved, {
    title: '入库单',
    version: text,
    save: async () => {
      const snapshot = latest.current;
      await onSave();
      setSaved(snapshot);
      return true;
    },
    discard: () => setText(saved),
  });
  return (
    <input aria-label="编辑内容" value={text} onChange={(event) => setText(event.target.value)} />
  );
}
