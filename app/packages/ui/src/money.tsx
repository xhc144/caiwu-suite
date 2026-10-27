import { Input, type InputProps, type InputRef } from 'antd';
import {
  forwardRef,
  useEffect,
  useState,
  useRef,
  useImperativeHandle,
  useLayoutEffect,
} from 'react';
import { formatMoney, parseMoney, type Cents } from '@caiwu/core';

export interface MoneyTextProps {
  /** 金额（分） */
  value: Cents | null | undefined;
  /** 0 显示为空，账簿里常用 */
  blankZero?: boolean;
  /** 负数显示红字，默认开 */
  redNegative?: boolean;
  prefix?: string;
  className?: string;
}

/** 金额显示：千分位、两位小数、负数红字、等宽数字右对齐。 */
export function MoneyText({
  value,
  blankZero,
  redNegative = true,
  prefix,
  className,
}: MoneyTextProps) {
  const negative = value != null && value < 0;
  return (
    <span
      className={['cw-money', negative && redNegative ? 'cw-money-negative' : '', className]
        .filter(Boolean)
        .join(' ')}
      data-cents={value ?? ''}
    >
      {formatMoney(value, { blankZero, prefix })}
    </span>
  );
}

export interface MoneyInputProps extends Omit<InputProps, 'value' | 'onChange' | 'defaultValue'> {
  /** 金额（分），空为 null */
  value?: Cents | null;
  onChange?: (value: Cents | null) => void;
  allowNegative?: boolean;
}

/**
 * 金额输入：编辑时显示原始数字，离开时格式化成千分位。
 * 支持 "1,234.5"、"-12"、"（12.3）"、全角数字；不能解析的输入离开时恢复原值。
 */
export const MoneyInput = forwardRef<InputRef, MoneyInputProps>(function MoneyInput(
  { value, onChange, allowNegative = true, onBlur, onFocus, ...rest },
  ref,
) {
  const inputRef = useRef<InputRef>(null);
  const mouseFocus = useRef(false);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const [focused, setFocused] = useState(false);
  useLayoutEffect(() => {
    if (!focused) return;
    inputRef.current?.select();
  }, [focused]);
  const [text, setText] = useState(() => formatMoney(value, { blankZero: false }));
  useEffect(() => {
    if (!focused) setText(value == null ? '' : formatMoney(value));
  }, [value, focused]);
  return (
    <Input
      ref={inputRef}
      {...rest}
      inputMode="decimal"
      className={['cw-money-input', rest.className].filter(Boolean).join(' ')}
      value={text}
      onMouseDown={(e) => {
        mouseFocus.current = document.activeElement !== inputRef.current?.input;
        rest.onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        if (mouseFocus.current) {
          inputRef.current?.select();
          mouseFocus.current = false;
        }
        rest.onMouseUp?.(e);
      }}
      onFocus={(e) => {
        setFocused(true);
        setText(value == null ? '' : formatMoney(value, { thousands: false }));
        onFocus?.(e);
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === '') return onChange?.(null);
        const cents = parseMoney(t);
        if (cents != null && (allowNegative || cents >= 0)) onChange?.(cents);
      }}
      onBlur={(e) => {
        setFocused(false);
        const cents = text.trim() === '' ? null : parseMoney(text);
        const ok = cents == null ? text.trim() === '' : allowNegative || cents >= 0;
        setText(ok && cents != null ? formatMoney(cents) : value == null ? '' : formatMoney(value));
        onBlur?.(e);
      }}
    />
  );
});
