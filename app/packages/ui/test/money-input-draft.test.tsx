import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button, Form } from 'antd';
import userEvent from '@testing-library/user-event';
import { StrictMode, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MoneyInput, type MoneyInputDraftState, type MoneyInputProps } from '../src';

function Controlled({
  initial = 5000,
  onValue,
  coerceEmpty = false,
  ...props
}: Omit<MoneyInputProps, 'value' | 'onChange'> & {
  initial?: number | null;
  onValue?: (value: number | null) => void;
  coerceEmpty?: boolean;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <MoneyInput
        aria-label="金额"
        {...props}
        value={value}
        onChange={(next) => {
          onValue?.(next);
          setValue(coerceEmpty ? (next ?? 0) : next);
        }}
      />
      <output data-testid="model">{value == null ? 'null' : value}</output>
      <button>别处</button>
    </>
  );
}

describe('MoneyInput草稿契约', () => {
  it('父级缓存原文可跨重挂载恢复，无效状态不因收到旧value而变成有效', async () => {
    let saved: MoneyInputDraftState | undefined;
    const capture = (state: MoneyInputDraftState | null) => {
      if (state) saved = state;
    };
    const first = render(
      <MoneyInput aria-label="金额" value={600000} onDraftStateChange={capture} />,
    );
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '12..34' } });
    first.unmount();
    expect(saved).toMatchObject({ text: '12..34', valid: false, value: undefined });
    const onValue = vi.fn();
    const { rerender } = render(
      <MoneyInput
        aria-label="金额"
        value={600000}
        draftText={saved!.text}
        onChange={onValue}
        onDraftStateChange={capture}
        resetKey={0}
      />,
    );
    const input = screen.getByLabelText('金额');
    expect(input).toHaveValue('12..34');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(input);
    fireEvent.blur(input);
    expect(input).toHaveValue('12..34');
    expect(onValue).not.toHaveBeenCalled();
    rerender(
      <MoneyInput
        aria-label="金额"
        value={600000}
        draftText={saved!.text}
        onChange={onValue}
        onDraftStateChange={capture}
        resetKey={1}
      />,
    );
    expect(input).toHaveValue('6,000.00');
    expect(saved).toMatchObject({ valid: true, value: 600000 });
  });

  it('父级更新draftText能恢复新原文，合法输入回传draftText不会造成按键格式跳动', async () => {
    const onDraft = vi.fn();
    const { rerender } = render(
      <MoneyInput
        aria-label="外部原文"
        value={5000}
        draftText="12..34"
        onDraftStateChange={onDraft}
      />,
    );
    rerender(
      <MoneyInput
        aria-label="外部原文"
        value={5000}
        draftText="56..78"
        onDraftStateChange={onDraft}
      />,
    );
    expect(screen.getByLabelText('外部原文')).toHaveValue('56..78');
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ valid: false, text: '56..78' }),
    );
    function RawControlled() {
      const [value, setValue] = useState<number | null>(null),
        [state, setState] = useState<MoneyInputDraftState | null>(null);
      return (
        <MoneyInput
          aria-label="父级原文"
          value={value}
          draftText={state?.text}
          onChange={setValue}
          onDraftStateChange={(next) => {
            if (next) setState(next);
          }}
        />
      );
    }
    render(<RawControlled />);
    const input = screen.getByLabelText('父级原文');
    await userEvent.type(input, '12.34');
    expect(input).toHaveValue('12.34');
    fireEvent.change(input, { target: { value: '12..34' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('12..34');
  });
  it('非法文本同步报告undefined值，失焦/重入及父级无关重渲染均保留，不发送旧金额', async () => {
    const onDraft = vi.fn<(state: MoneyInputDraftState | null) => void>();
    const onValue = vi.fn();
    const { rerender } = render(
      <MoneyInput
        aria-label="金额"
        value={600000}
        onChange={onValue}
        onDraftStateChange={onDraft}
      />,
    );
    const input = screen.getByLabelText('金额');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: '12..34' } });
    expect(onDraft).toHaveBeenLastCalledWith({
      text: '12..34',
      valid: false,
      value: undefined,
      reason: 'format',
      message: '请输入有效金额',
    });
    expect(onValue).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input).toHaveValue('12..34');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    rerender(
      <MoneyInput
        aria-label="金额"
        title="其他字段变化"
        value={600000}
        onChange={onValue}
        onDraftStateChange={onDraft}
      />,
    );
    fireEvent.focus(input);
    expect(input).toHaveValue('12..34');
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({ valid: false, value: undefined });
    expect(onValue).not.toHaveBeenCalled();
  });

  it.each([
    ['1,234.5', 123450, '1,234.50'],
    ['（１２．３）', -1230, '-12.30'],
    ['￥１２．３０元', 1230, '12.30'],
    ['.005', 1, '0.01'],
    ['-0', 0, '0.00'],
    ['0', 0, '0.00'],
    ['', null, ''],
  ] as const)('合法输入%s保留locale解析、零值和失焦格式', async (text, value, formatted) => {
    const onDraft = vi.fn<(state: MoneyInputDraftState | null) => void>();
    const onValue = vi.fn();
    render(<Controlled onDraftStateChange={onDraft} onValue={onValue} />);
    const input = screen.getByLabelText('金额');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: text } });
    expect(onDraft.mock.calls.at(-1)![0]).toEqual({ text, valid: true, value });
    expect(onValue).toHaveBeenLastCalledWith(value);
    expect(onValue).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText('别处'));
    expect(input).toHaveValue(formatted);
    expect(onDraft.mock.calls.at(-1)![0]).toEqual({ text: formatted, valid: true, value });
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('父级空值规范成零时不在按键间跳回0.00，合法尾部小数点保留至失焦', async () => {
    render(<Controlled initial={10000} coerceEmpty />);
    const input = screen.getByLabelText('金额');
    await userEvent.clear(input);
    expect(input).toHaveValue('');
    expect(screen.getByTestId('model')).toHaveTextContent('0');
    await userEvent.type(input, '12.');
    expect(input).toHaveValue('12.');
    await userEvent.type(input, '34');
    expect(input).toHaveValue('12.34');
    expect(screen.getByTestId('model')).toHaveTextContent('1234');
  });

  it.each([
    ['-3', 'negative'],
    ['999999999999999999999999999999999999', 'range'],
  ] as const)('输入%s按%s状态拒绝且失焦不恢复旧数', async (text, reason) => {
    const onDraft = vi.fn<(state: MoneyInputDraftState | null) => void>();
    const onValue = vi.fn();
    render(<Controlled allowNegative={false} onDraftStateChange={onDraft} onValue={onValue} />);
    const input = screen.getByLabelText('金额');
    expect(() => fireEvent.change(input, { target: { value: text } })).not.toThrow();
    fireEvent.blur(input);
    expect(input).toHaveValue(text);
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({ valid: false, value: undefined, reason });
    expect(onValue).not.toHaveBeenCalled();
    expect(screen.getByTestId('model')).toHaveTextContent('5000');
  });

  it('外部新值和同值resetKey均明确重置非法草稿，聚焦中也生效', async () => {
    const onDraft = vi.fn<(state: MoneyInputDraftState | null) => void>();
    const onValue = vi.fn();
    const { rerender } = render(
      <MoneyInput
        aria-label="金额"
        value={600000}
        onChange={onValue}
        onDraftStateChange={onDraft}
        resetKey={0}
      />,
    );
    const input = screen.getByLabelText('金额');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: '12..34' } });
    rerender(
      <MoneyInput
        aria-label="金额"
        value={600000}
        onChange={onValue}
        onDraftStateChange={onDraft}
        resetKey={1}
      />,
    );
    expect(input).toHaveValue('6000.00');
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({ valid: true, value: 600000 });
    fireEvent.change(input, { target: { value: '12..34' } });
    rerender(
      <MoneyInput
        aria-label="金额"
        value={0}
        onChange={onValue}
        onDraftStateChange={onDraft}
        resetKey={1}
      />,
    );
    expect(input).toHaveValue('0.00');
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({ valid: true, value: 0 });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '12..34' } });
    rerender(
      <MoneyInput
        aria-label="金额"
        value={null}
        onChange={onValue}
        onDraftStateChange={onDraft}
        resetKey={1}
      />,
    );
    expect(input).toHaveValue('');
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({ valid: true, value: null });
    expect(onValue).not.toHaveBeenCalled();
  });

  it('负数策略切换重新报告有效性，转为允许后同步更新数值而非只把旧值标为有效', () => {
    const onDraft = vi.fn<(state: MoneyInputDraftState | null) => void>();
    const onValue = vi.fn();
    const { rerender } = render(
      <MoneyInput
        aria-label="金额"
        value={5000}
        allowNegative={false}
        onChange={onValue}
        onDraftStateChange={onDraft}
      />,
    );
    const input = screen.getByLabelText('金额');
    fireEvent.change(input, { target: { value: '-3' } });
    rerender(
      <MoneyInput
        aria-label="金额"
        value={5000}
        allowNegative
        onChange={onValue}
        onDraftStateChange={onDraft}
      />,
    );
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({ valid: true, value: -300 });
    expect(onValue).toHaveBeenLastCalledWith(-300);
    rerender(
      <MoneyInput
        aria-label="金额"
        value={5000}
        allowNegative={false}
        onChange={onValue}
        onDraftStateChange={onDraft}
      />,
    );
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({
      valid: false,
      reason: 'negative',
      value: undefined,
    });
    expect(input).toHaveValue('-3');
  });

  it('blur前DOM自动填充而没有change事件时也同步合法新值，再调用父级onBlur', () => {
    const onValue = vi.fn();
    const onBlur = vi.fn(() => expect(onValue).toHaveBeenLastCalledWith(123));
    render(<MoneyInput aria-label="金额" value={5000} onChange={onValue} onBlur={onBlur} />);
    const input = screen.getByLabelText('金额') as HTMLInputElement;
    input.value = '1.23';
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('1.23');
  });

  it('后加订阅收到当前非法草稿，撤销订阅及卸载报告null；inline回调不引发更新循环', () => {
    const onDraft = vi.fn<(state: MoneyInputDraftState | null) => void>();
    const { rerender, unmount } = render(<MoneyInput aria-label="金额" value={5000} />);
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '12..34' } });
    rerender(<MoneyInput aria-label="金额" value={5000} onDraftStateChange={onDraft} />);
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ valid: false, text: '12..34' }),
    );
    rerender(<MoneyInput aria-label="金额" value={5000} />);
    expect(onDraft).toHaveBeenLastCalledWith(null);
    rerender(<MoneyInput aria-label="金额" value={5000} onDraftStateChange={onDraft} />);
    unmount();
    expect(onDraft).toHaveBeenLastCalledWith(null);
    let renders = 0;
    function Inline() {
      renders++;
      const [state, setState] = useState<{ draft: MoneyInputDraftState | null }>({ draft: null });
      return (
        <>
          <MoneyInput
            aria-label="inline"
            value={5000}
            onDraftStateChange={(draft) => setState({ draft })}
          />
          <output>{state.draft?.valid ? '有效' : '无效'}</output>
        </>
      );
    }
    render(
      <StrictMode>
        <Inline />
      </StrictMode>,
    );
    expect(screen.getByText('有效')).toBeInTheDocument();
    expect(renders).toBeLessThan(12);
  });
});

function SaveHarness({
  initial,
  submit,
}: {
  initial: number;
  submit: (value: { amount: number; bonus: number }) => void;
}) {
  const [amount, setAmount] = useState<number | null>(initial),
    [bonus, setBonus] = useState<number | null>(0);
  const [revision, setRevision] = useState(1),
    [open, setOpen] = useState(true),
    [error, setError] = useState('');
  const drafts = useRef(new Map<string, MoneyInputDraftState>());
  const track = (key: string, state: MoneyInputDraftState | null) => {
    if (state) drafts.current.set(key, state);
    else drafts.current.delete(key);
  };
  const save = () => {
    const invalid = [...drafts.current.values()].find((state) => !state.valid);
    if (invalid && !invalid.valid) {
      setError(invalid.message);
      return;
    }
    submit({ amount: amount ?? 0, bonus: bonus ?? 0 });
    setRevision(revision + 1);
    setOpen(false);
  };
  return (
    <>
      <output data-testid="revision">{revision}</output>
      <output data-testid="amount">{amount}</output>
      <output data-testid="bonus">{bonus}</output>
      {error && <p role="alert">{error}</p>}
      {open && (
        <div
          role="dialog"
          aria-label="合成保存"
          onKeyDown={(e) => {
            if (e.key === 'F5') {
              e.preventDefault();
              save();
            }
          }}
        >
          <MoneyInput
            aria-label="基本金额"
            value={amount}
            onChange={setAmount}
            onDraftStateChange={(state) => track('amount', state)}
          />
          <MoneyInput
            aria-label="奖金"
            value={bonus}
            onChange={setBonus}
            onDraftStateChange={(state) => track('bonus', state)}
          />
          <button onClick={save}>保存</button>
        </div>
      )}
    </>
  );
}

it.each([1000000, 600000])(
  '合成父级：金额原值%s、奖金改200后填12..34，按钮与F5都不提交旧值、不增版本、不关闭',
  async (initial) => {
    const submit = vi.fn();
    render(<SaveHarness initial={initial} submit={submit} />);
    fireEvent.change(screen.getByLabelText('奖金'), { target: { value: '200' } });
    const amount = screen.getByLabelText('基本金额');
    // 资产用例中先合法输入与旧值相同的6000，再输入非法文本，不能误认父级的旧值为新草稿。
    if (initial === 600000) fireEvent.change(amount, { target: { value: '6000' } });
    act(() => {
      fireEvent.change(amount, { target: { value: '12..34' } });
      fireEvent.keyDown(amount, { key: 'F5' });
    });
    await userEvent.click(screen.getByText('保存'));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId('revision')).toHaveTextContent('1');
    expect(screen.getByTestId('amount')).toHaveTextContent(String(initial));
    expect(screen.getByTestId('bonus')).toHaveTextContent('20000');
    expect(screen.getByRole('dialog', { name: '合成保存' })).toBeInTheDocument();
    expect(amount).toHaveValue('12..34');
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效金额');
    fireEvent.change(amount, { target: { value: '6001.23' } });
    await userEvent.click(screen.getByText('保存'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ amount: 600123, bonus: 20000 });
    expect(screen.getByTestId('revision')).toHaveTextContent('2');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);

it('Antd Form：旧数值虽通过required校验，父级草稿预检仍阻止非法原值提交', async () => {
  const submit = vi.fn();
  function AssetForm() {
    const draft = useRef<MoneyInputDraftState | null>(null);
    const [error, setError] = useState('');
    return (
      <Form
        initialValues={{ original: 600000 }}
        onFinish={(values: { original: number }) => {
          if (draft.current && !draft.current.valid) {
            setError(draft.current.message);
            return;
          }
          submit(values);
        }}
      >
        <Form.Item name="original" label="原值" rules={[{ required: true }]}>
          <MoneyInput
            aria-label="原值"
            allowNegative={false}
            onDraftStateChange={(state) => {
              draft.current = state;
            }}
          />
        </Form.Item>
        {error && <p role="alert">{error}</p>}
        <Button htmlType="submit">保存卡片</Button>
      </Form>
    );
  }
  render(<AssetForm />);
  const input = screen.getByLabelText('原值');
  fireEvent.change(input, { target: { value: '6000' } });
  fireEvent.change(input, { target: { value: '12..34' } });
  await userEvent.click(screen.getByText('保存卡片'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('请输入有效金额'));
  expect(input).toHaveValue('12..34');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '6001.23' } });
  await userEvent.click(screen.getByText('保存卡片'));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit).toHaveBeenCalledWith({ original: 600123 });
});
