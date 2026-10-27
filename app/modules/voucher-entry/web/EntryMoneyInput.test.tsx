import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { EntryMoneyInput } from './EntryMoneyInput';
function Harness() {
  const [amount, setAmount] = useState<number | null>(0);
  return (
    <>
      <button>前一格</button>
      <EntryMoneyInput aria-label="金额" value={amount} onChange={setAmount} />
      <button>后一格</button>
      <output>{amount}</output>
    </>
  );
}
it('w_pz_pzedit / w_pz_pzedit_mb：Tab与鼠标进入全选，直接输入替换零，不重复抢选区', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.tab();
  await user.tab();
  const input = screen.getByRole('textbox', { name: '金额' }) as HTMLInputElement;
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  await user.keyboard('1000');
  await user.tab();
  expect(input).toHaveValue('1,000.00');
  expect(screen.getByRole('status')).toHaveTextContent('100000');
  await user.click(input);
  await user.keyboard('-0.01');
  await user.tab();
  expect(input).toHaveValue('-0.01');
  expect(screen.getByRole('status')).toHaveTextContent('-1');
  await user.click(input);
  input.setSelectionRange(1, 2);
  await user.keyboard('2');
  expect(input).toHaveValue('-2.01');
});
it('w_pz_pzedit：非法数字离开后保留原文和错误标志，修正及粘贴可正常保存', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole('textbox');
  await user.click(input);
  await user.keyboard('1.2.3');
  await user.tab();
  expect(input).toHaveValue('1.2.3');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  await user.click(input);
  await user.clear(input);
  await user.paste('123.45');
  await user.tab();
  expect(input).toHaveValue('123.45');
  expect(screen.getByRole('status')).toHaveTextContent('12345');
});
it('w_pz_pzedit：输入法组合期间不提交中间数字，结束后提交一次', () => {
  const change = vi.fn();
  render(<EntryMoneyInput value={0} onChange={change} />);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '100' } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input, { data: '100' });
  expect(change).toHaveBeenLastCalledWith(10000);
});

it('w_pz_flxx1：非法原币文本关闭分录抽屉后重开仍在，明确放弃才清除', async () => {
  const { AmountDraftContext, useAmountDrafts } = await import('./amount-drafts');
  function DetailHarness() {
    const drafts = useAmountDrafts();
    const [open, setOpen] = useState(true);
    return (
      <AmountDraftContext.Provider value={drafts}>
        <button onClick={() => setOpen((v) => !v)}>分录信息</button>
        <button onClick={drafts.clear}>放弃修改</button>
        {open && <EntryMoneyInput aria-label="第3行原币金额" data-field="fcAmount" value={0} />}
      </AmountDraftContext.Provider>
    );
  }
  const user = userEvent.setup();
  render(<DetailHarness />);
  await user.click(screen.getByRole('textbox'));
  await user.keyboard('非法金额');
  await user.click(screen.getByRole('button', { name: '分录信息' }));
  await user.click(screen.getByRole('button', { name: '分录信息' }));
  expect(screen.getByRole('textbox')).toHaveValue('非法金额');
  await user.click(screen.getByRole('button', { name: '放弃修改' }));
  expect(screen.getByRole('textbox')).toHaveValue('0.00');
});

it('w_pz_pzedit：插删前行后非法金额随原分录移动，定位行号与文本一致', async () => {
  const { AmountDraftContext, useAmountDrafts } = await import('./amount-drafts');
  function GridHarness() {
    const drafts = useAmountDrafts();
    const [inserted, setInserted] = useState(false);
    return (
      <AmountDraftContext.Provider value={drafts}>
        <button
          onClick={() => {
            drafts.remap((n) => n + 1);
            setInserted(true);
          }}
        >
          前插空行
        </button>
        <button
          onClick={() => {
            drafts.remap((n) => (n === 1 ? null : n - 1));
            setInserted(false);
          }}
        >
          删除首行
        </button>
        {Array.from({ length: inserted ? 2 : 1 }, (_, i) => (
          <EntryMoneyInput key={i} aria-label={`第${i + 1}行借方`} data-field="debit" value={0} />
        ))}
      </AmountDraftContext.Provider>
    );
  }
  const user = userEvent.setup();
  render(<GridHarness />);
  await user.click(screen.getByLabelText('第1行借方'));
  await user.keyboard('坏金额');
  await user.click(screen.getByRole('button', { name: '前插空行' }));
  expect(screen.getByLabelText('第1行借方')).toHaveValue('0.00');
  expect(screen.getByLabelText('第2行借方')).toHaveValue('坏金额');
  await user.click(screen.getByRole('button', { name: '删除首行' }));
  expect(screen.getByLabelText('第1行借方')).toHaveValue('坏金额');
});
