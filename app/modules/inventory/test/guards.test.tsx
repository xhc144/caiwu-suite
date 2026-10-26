import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { TabContext } from '@caiwu/web-kit';
import { Grid, mayDiscard, useUnsaved } from '../web/common';
import type * as PrintModule from '@caiwu/print';
import { printHtml } from '@caiwu/print';
vi.mock('@caiwu/print', async (importOriginal) => ({
  ...(await importOriginal<typeof PrintModule>()),
  printHtml: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
describe('未保存与格式确认', () => {
  it.each(['w_cb_cpda', 'w_cb_qc', 'w_ck_rk1', 'w_ck_ck1', 'w_cb_pdk_1'])(
    '%s：未保存关闭/刷新可取消，取消不调用后续动作',
    () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      expect(mayDiscard(true)).toBe(false);
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('未保存'));
      confirm.mockReturnValue(true);
      expect(mayDiscard(true)).toBe(true);
      expect(mayDiscard(false)).toBe(true);
      const { unmount } = renderHook(() => useUnsaved(true));
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      confirm.mockReturnValue(false);
      const key = new KeyboardEvent('keydown', { key: 'F4', ctrlKey: true, cancelable: true });
      window.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      unmount();
      const saved = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(saved);
      expect(saved.defaultPrevented).toBe(false);
    },
  );
  it('w_cb_cpda/w_ck_rk1：关闭非当前标签也检查所属未保存表单，其他标签不误拦', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <TabContext.Provider
        value={{ key: '/m/inventory/master', active: false, setTitle: () => {}, close: () => {} }}
      >
        <Guard />
        <div data-node-key="/m/inventory/master">
          <button className="ant-tabs-tab-remove">关产品</button>
        </div>
        <div data-node-key="/m/inventory/stock">
          <button className="ant-tabs-tab-remove">关库存</button>
        </div>
      </TabContext.Provider>,
    );
    const own = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByText('关产品').dispatchEvent(own);
    expect(own.defaultPrevented).toBe(true);
    const other = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByText('关库存').dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
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
function Guard() {
  useUnsaved(true);
  return null;
}
