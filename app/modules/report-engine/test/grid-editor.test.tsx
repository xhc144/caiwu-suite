import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyTemplate, StyleSchema } from '../shared';
import { ReportGrid } from '../web/Grid';

function template(rows = 3, cols = 3) {
  const t = emptyTemplate({ code: '101', name: '网格编辑', rows, cols });
  t.cells = [{ address: 'A1', kind: 'text', source: '项目', unit: 'number', currency: 'CNY' }];
  return t;
}

describe('w_bb_def 网格编辑', () => {
  it('从当前格接收表格剪贴板，普通单值粘贴仍交给输入框', () => {
    const paste = vi.fn();
    render(<ReportGrid template={template()} onPaste={paste} />);
    const input = screen.getByRole('textbox', { name: 'B2' });
    const text = '项目\t金额\r\n销售\t123.45\r\n';
    expect(fireEvent.paste(input, { clipboardData: { getData: () => text } })).toBe(false);
    expect(paste).toHaveBeenCalledExactlyOnceWith('B2', text);
    paste.mockClear();
    expect(fireEvent.paste(input, { clipboardData: { getData: () => '普通中文输入' } })).toBe(true);
    expect(paste).not.toHaveBeenCalled();
  });

  it('只读网格阻止批量粘贴且不调用修改入口', () => {
    const paste = vi.fn();
    render(<ReportGrid template={template()} disabled onPaste={paste} />);
    const input = screen.getByRole('textbox', { name: 'A1' });
    expect(input).toHaveAttribute('readonly');
    expect(fireEvent.paste(input, { clipboardData: { getData: () => '新项目\t10.00' } })).toBe(
      false,
    );
    expect(paste).not.toHaveBeenCalled();
  });

  it('金额格也能以当前地址接收完整多格粘贴', () => {
    const t = template();
    t.cells = [{ address: 'A1', kind: 'money', source: '12345', unit: 'cents', currency: 'CNY' }];
    const paste = vi.fn();
    render(<ReportGrid template={t} onPaste={paste} />);
    const input = screen.getByLabelText('A1');
    expect(fireEvent.paste(input, { clipboardData: { getData: () => '123.45\t456.78' } })).toBe(
      false,
    );
    expect(paste).toHaveBeenCalledExactlyOnceWith('A1', '123.45\t456.78');
  });

  it('字体与四边分别显示，选择当前格不覆盖其打印边框', () => {
    const t = template();
    t.styles = [
      StyleSchema.parse({
        address: 'A1',
        fontFamily: '楷体',
        fontSize: 18,
        bold: true,
        italic: true,
        underline: true,
        color: '#123456',
        borderTop: 'double',
        borderRight: 'medium',
        borderBottom: 'dashed',
        borderLeft: 'none',
      }),
    ];
    render(<ReportGrid template={t} selected="A1" />);
    const input = screen.getByRole('textbox', { name: 'A1' });
    const cell = input.closest('td');
    expect(window.getComputedStyle(cell!)).toMatchObject({
      fontFamily: '楷体',
      fontSize: '24px',
      fontWeight: '700',
      fontStyle: 'italic',
      textDecoration: 'underline',
      color: 'rgb(18, 52, 86)',
      borderTopStyle: 'double',
      borderTopWidth: '3px',
      borderRightStyle: 'solid',
      borderRightWidth: '2px',
      borderBottomStyle: 'dashed',
      borderBottomWidth: '1px',
      borderLeftStyle: 'none',
      outline: '2px solid #1677ff',
    });
    expect(input.style.fontSize).toBe('inherit');
    expect(input.style.color).toBe('inherit');
  });

  it('视窗从合并区内部开始时显示原单元格及可见跨度', () => {
    const t = template(40, 22);
    t.merges = [{ row: 1, col: 1, rows: 8, cols: 4 }];
    render(<ReportGrid template={t} />);
    fireEvent.change(screen.getByLabelText('网格起始行'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('网格起始列'), { target: { value: '2' } });
    const input = screen.getByRole('textbox', { name: 'A1' });
    expect(input).toHaveValue('项目');
    expect(input.closest('td')).toHaveAttribute('rowspan', '5');
    expect(input.closest('td')).toHaveAttribute('colspan', '3');
    expect(screen.queryByRole('textbox', { name: 'B4' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'E4' })).toBeVisible();
  });

  it('在末尾窗口删除行列后，仍能显示有效区域并在撤销尺寸后恢复查看位置', () => {
    const large = template(40, 22);
    const view = render(<ReportGrid template={large} />);
    fireEvent.change(screen.getByLabelText('网格起始行'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('网格起始列'), { target: { value: '22' } });
    expect(screen.getByRole('textbox', { name: 'V40' })).toBeVisible();
    view.rerender(<ReportGrid template={template(4, 3)} />);
    expect(screen.getByRole('textbox', { name: 'C4' })).toBeVisible();
    view.rerender(<ReportGrid template={large} />);
    expect(screen.getByRole('textbox', { name: 'V40' })).toBeVisible();
  });

  it('方向键跳过合并格，中文输入法确认候选时不跳到下一行', async () => {
    const t = template();
    t.merges = [{ row: 1, col: 1, rows: 1, cols: 2 }];
    const select = vi.fn();
    render(<ReportGrid template={t} onSelect={select} />);
    const input = screen.getByRole('textbox', { name: 'A1' });
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: 'ArrowRight' })).toBe(false);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'C1' })).toHaveFocus());
    expect(select).toHaveBeenCalledWith('C1');
  });
});
