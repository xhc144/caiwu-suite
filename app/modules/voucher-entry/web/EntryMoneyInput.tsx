import { Input, type InputProps, type InputRef } from 'antd';
import { forwardRef, useContext, useLayoutEffect, useRef, useState } from 'react';
import { formatMoney, parseMoney } from '@caiwu/core';
import { AmountDraftContext, amountDraftKey } from './amount-drafts';

type Props = Omit<InputProps, 'value' | 'onChange' | 'defaultValue'> & {
  value?: number | null;
  onChange?: (value: number | null) => void;
};
const parse = (text: string) => {
  try {
    return text.trim() ? parseMoney(text) : null;
  } catch {
    return null;
  }
};

/** 金额编辑文本独立保留；非法输入不能恢复成旧金额后被误保存。 */
export const EntryMoneyInput = forwardRef<InputRef, Props>(function EntryMoneyInput(
  { value, onChange, onFocus, onBlur, ...rest },
  ref,
) {
  const drafts = useContext(AmountDraftContext);
  const label = String(rest['aria-label'] ?? '金额');
  const field = String((rest as Record<string, unknown>)['data-field'] ?? 'debit');
  const line = Number(/^第(\d+)行/.exec(label)?.[1] ?? 1);
  const key = amountDraftKey(line, field);
  const [editing, setEditing] = useState<string | null>(
    () => drafts?.values.get(key)?.text ?? null,
  );
  useLayoutEffect(() => {
    setEditing(drafts?.values.get(key)?.text ?? null);
  }, [drafts?.epoch, drafts?.values, key]);
  const input = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const entered = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const text = editing ?? (value == null ? '' : formatMoney(value));
  const invalid = !!text.trim() && parse(text) == null;
  useLayoutEffect(() => {
    if (focused && document.activeElement === input.current) input.current?.select();
  }, [focused]);
  const update = (text: string) => {
    setEditing(text);
    const parsed = parse(text);
    // 输入法组合中的文本尚未提交，也必须阻止保存旧金额。
    drafts?.update(
      key,
      composing.current || (text.trim() && parsed == null) ? { text, label, field, line } : null,
    );
    if (!composing.current && (parsed != null || !text.trim())) onChange?.(parsed);
  };
  return (
    <Input
      {...rest}
      ref={(node) => {
        input.current = node?.input ?? null;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      value={text}
      inputMode="decimal"
      className={['cw-money-input', rest.className].filter(Boolean).join(' ')}
      aria-invalid={invalid}
      status={invalid ? 'error' : rest.status}
      onMouseDown={(e) => {
        entered.current = document.activeElement !== e.currentTarget;
        pointer.current = { x: e.clientX, y: e.clientY };
        rest.onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        const start = pointer.current;
        if (
          entered.current &&
          start &&
          e.detail === 1 &&
          !e.shiftKey &&
          Math.abs(start.x - e.clientX) < 3 &&
          Math.abs(start.y - e.clientY) < 3
        )
          e.currentTarget.select();
        entered.current = false;
        rest.onMouseUp?.(e);
      }}
      onFocus={(e) => {
        setFocused(true);
        if (editing == null)
          setEditing(value == null ? '' : formatMoney(value, { thousands: false }));
        onFocus?.(e);
      }}
      onCompositionStart={() => {
        composing.current = true;
        update(input.current?.value ?? text);
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        update(e.currentTarget.value);
      }}
      onChange={(e) => update(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        if (
          !composing.current &&
          (!e.currentTarget.value.trim() || parse(e.currentTarget.value) != null)
        )
          setEditing(null);
        onBlur?.(e);
      }}
    />
  );
});
