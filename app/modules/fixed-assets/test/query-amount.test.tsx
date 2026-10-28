import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryAmountInput } from '../web/QueriesPage';
import { queryUrlDefaults, readQueryFilters } from '../web/query-filters';

function Amount({ initial = '10000' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <QueryAmountInput aria-label="折旧金额（元）" value={value} onChange={setValue} />
      <output data-testid="stored-value">{value}</output>
    </>
  );
}

describe('w_zjgl_cx：金额条件按元编辑、按分保留既有查询契约', () => {
  it('原10000分显示100元，输入1.50元保存150分，清空与零金额不混淆', () => {
    render(<Amount />);
    const input = screen.getByLabelText('折旧金额（元）');
    expect(input).toHaveValue('100.00');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1.50' } });
    expect(screen.getByTestId('stored-value')).toHaveTextContent('150');
    fireEvent.blur(input);
    expect(input).toHaveValue('1.50');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByTestId('stored-value')).toBeEmptyDOMElement();
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByTestId('stored-value')).toHaveTextContent('0');
    fireEvent.blur(input);
    expect(input).toHaveValue('0.00');
  });
  it('旧链接仍按分解释，非法旧条件不会静默改成有效金额', () => {
    const legacy = { ...queryUrlDefaults(2026), field: 'amount', op: 'eq', value: '10000' };
    expect(readQueryFilters(legacy).input?.conditions[0]?.value).toBe('10000');
    expect(readQueryFilters({ ...legacy, value: '1.5' }).input).toBeNull();
    render(<Amount initial="1.5" />);
    expect(screen.getByLabelText('折旧金额（元）')).toHaveValue('');
    expect(screen.getByTestId('stored-value')).toHaveTextContent('1.5');
  });
});
