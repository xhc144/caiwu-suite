import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MoneyInput, MoneyText } from '../src';

function Harness({ initial = null as number | null, allowNegative = true }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <MoneyInput aria-label="金额" value={v} onChange={setV} allowNegative={allowNegative} />
      <output data-testid="cents">{v === null ? 'null' : String(v)}</output>
      <button>别处</button>
    </>
  );
}

describe('MoneyInput', () => {
  it('输入时解析成分，离开时格式化千分位', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('金额');
    await userEvent.type(input, '1234.5');
    expect(screen.getByTestId('cents')).toHaveTextContent('123450');
    await userEvent.click(screen.getByText('别处'));
    expect(input).toHaveValue('1,234.50');
  });

  it('获得焦点时显示不带千分位的原始数字', async () => {
    render(<Harness initial={123456} />);
    const input = screen.getByLabelText('金额');
    expect(input).toHaveValue('1,234.56');
    await userEvent.click(input);
    expect(input).toHaveValue('1234.56');
  });

  it('非法输入离开后保留并标错；不允许负数时不把它报告为合法数值', async () => {
    render(<Harness initial={500} allowNegative={false} />);
    const input = screen.getByLabelText('金额');
    await userEvent.clear(input);
    await userEvent.type(input, '-3');
    expect(screen.getByTestId('cents')).toHaveTextContent('null');
    await userEvent.click(screen.getByText('别处'));
    expect(input).toHaveValue('-3');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    await userEvent.click(screen.getByText('别处'));
    expect(input).toHaveValue('abc');
    expect(screen.getByTestId('cents')).toHaveTextContent('null');
  });
});

describe('MoneyText', () => {
  it('负数红字、零可显示为空', () => {
    const { container } = render(
      <>
        <MoneyText value={-1200} />
        <MoneyText value={0} blankZero />
      </>,
    );
    const spans = container.querySelectorAll('.cw-money');
    expect(spans[0]).toHaveTextContent('-12.00');
    expect(spans[0]).toHaveClass('cw-money-negative');
    expect(spans[1]).toHaveTextContent('');
  });
});
