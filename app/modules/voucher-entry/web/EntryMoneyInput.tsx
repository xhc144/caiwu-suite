import { Input, type InputProps, type InputRef } from 'antd';
import { forwardRef, useContext, useLayoutEffect, useRef, useState } from 'react';
import { formatMoney, parseMoney } from '@caiwu/core';
import { AmountDraftContext } from './amount-drafts';

type Props = Omit<InputProps, 'value' | 'onChange' | 'defaultValue'> & {
  value?: number | null;
  onChange?: (value: number | null) => void;
};
/** 金额编辑文本独立保留；非法输入不能恢复成旧金额后被误保存。 */
export const EntryMoneyInput = forwardRef<InputRef, Props>(function EntryMoneyInput(
  { value, onChange, onFocus, onBlur, ...rest },
  ref,
) {
  const drafts = useContext(AmountDraftContext);
  const label = String(rest['aria-label'] ?? '金额');
  const field = String((rest as Record<string, unknown>)['data-field'] ?? 'debit');
  const key = `${label}:${field}`;
  const [editing, setEditing] = useState<string | null>(
    () => drafts?.values.get(key)?.text ?? null,
  );
  const draftEpoch = useRef(drafts?.epoch);
  useLayoutEffect(() => {
    if (draftEpoch.current !== drafts?.epoch) {
      draftEpoch.current = drafts?.epoch;
      setEditing(drafts?.values.get(key)?.text ?? null);
    }
  }, [drafts?.epoch, drafts?.values, key]);
  const input = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const entered = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const focused = editing !== null;
  const parse = (text: string) => {
    try {
      return text.trim() ? parseMoney(text) : null;
    } catch {
      return null;
    }
  };
  const text = editing ?? (value == null ? '' : formatMoney(value));
  const invalid = !!text.trim() && parse(text) == null;
  useLayoutEffect(() => {
    if (focused && document.activeElement === input.current) input.current?.select();
  }, [focused]);
  const update = (text: string) => {
    setEditing(text);
    const parsed = parse(text);
    if (!composing.current) {
      if (text.trim() && parsed == null)
        drafts?.values.set(key, {
          text,
          label,
          field,
          line: Number(/^第(\d+)行/.exec(label)?.[1] ?? 1),
        });
      else drafts?.values.delete(key);
    }
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
      className="cw-money-input"
      aria-invalid={invalid}
      status={invalid ? 'error' : rest.status}
      onMouseDown={(e) => {
        entered.current = document.activeElement !== e.currentTarget;
        pointer.current = { x: e.clientX, y: e.clientY };
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
      }}
      onFocus={(e) => {
        if (editing == null)
          setEditing(value == null ? '' : formatMoney(value, { thousands: false }));
        onFocus?.(e);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        update(e.currentTarget.value);
      }}
      onChange={(e) => update(e.target.value)}
      onBlur={(e) => {
        if (!invalid) setEditing(null);
        onBlur?.(e);
      }}
    />
  );
});
export function invalidAmount(root: HTMLElement | null): HTMLInputElement | null {
  return root?.querySelector<HTMLInputElement>('input[aria-invalid="true"][data-field]') ?? null;
}
