import { Input, type InputProps, type InputRef } from 'antd';
import {
  forwardRef,
  useEffect,
  useState,
  useRef,
  useImperativeHandle,
  useLayoutEffect,
  useCallback,
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
  /** 原始编辑状态同步通知；非法输入 value 为 undefined。卸载的 null 不是清空草稿，重挂载时可保留缓存。 */
  onDraftStateChange?: (state: MoneyInputDraftState | null) => void;
  /** 父级缓存的编辑原文；用于重挂载恢复，不能用旧金额代替非法草稿。 */
  draftText?: string;
  /** 同一 value 下显式丢弃草稿，例如取消编辑、重载记录；不要随每次输入改变。 */
  resetKey?: string | number;
}

export type MoneyInputDraftState =
  | { text: string; valid: true; value: Cents | null }
  | {
      text: string;
      valid: false;
      value: undefined;
      reason: 'format' | 'negative' | 'range';
      message: string;
    };

function moneyDraft(text: string, allowNegative: boolean): MoneyInputDraftState {
  if (text.trim() === '') return { text, valid: true, value: null };
  let cents: Cents | null;
  try {
    cents = parseMoney(text);
  } catch {
    return { text, valid: false, value: undefined, reason: 'range', message: '金额超出可保存范围' };
  }
  if (cents == null)
    return { text, valid: false, value: undefined, reason: 'format', message: '请输入有效金额' };
  if (!allowNegative && cents < 0)
    return { text, valid: false, value: undefined, reason: 'negative', message: '金额不能为负数' };
  return { text, valid: true, value: cents };
}

/**
 * 金额输入：编辑时显示原始数字，离开时格式化成千分位。
 * 支持 "1,234.5"、"-12"、"（12.3）"、全角数字；非法草稿失焦后保留，父级保存前须检查草稿状态。
 */
export const MoneyInput = forwardRef<InputRef, MoneyInputProps>(function MoneyInput(
  {
    value,
    onChange,
    allowNegative = true,
    onDraftStateChange,
    draftText,
    resetKey,
    onBlur,
    onFocus,
    ...rest
  },
  ref,
) {
  const inputRef = useRef<InputRef>(null);
  const mouseFocus = useRef(false);
  const focusState = useRef(false);
  const callbacks = useRef({ onChange, onDraftStateChange });
  useLayoutEffect(() => {
    if (callbacks.current.onDraftStateChange && !onDraftStateChange)
      callbacks.current.onDraftStateChange(null);
    callbacks.current = { onChange, onDraftStateChange };
  });
  useImperativeHandle(ref, () => inputRef.current!, []);
  const [focused, setFocused] = useState(false);
  useLayoutEffect(() => {
    if (!focused) return;
    inputRef.current?.select();
  }, [focused]);
  const [draft, setDraft] = useState(() =>
    moneyDraft(draftText ?? formatMoney(value), allowNegative),
  );
  const currentDraft = useRef(draft);
  const external = useRef({ value, draftText, resetKey, allowNegative });
  const pendingChange = useRef<{ value: Cents | null } | undefined>(undefined);
  const publish = useCallback((state: MoneyInputDraftState) => {
    currentDraft.current = state;
    setDraft(state);
    callbacks.current.onDraftStateChange?.(state);
  }, []);
  const hasDraftCallback = onDraftStateChange != null;
  useEffect(() => {
    if (hasDraftCallback) callbacks.current.onDraftStateChange?.(currentDraft.current);
  }, [hasDraftCallback]);
  useEffect(() => {
    return () => callbacks.current.onDraftStateChange?.(null);
  }, []);
  useEffect(() => {
    const previous = external.current;
    external.current = { value, draftText, resetKey, allowNegative };
    const valueChanged = !Object.is(previous.value, value);
    const reset = !Object.is(previous.resetKey, resetKey);
    const pending = pendingChange.current;
    // 接受父级将空值规范成零；输入时仍保留空草稿，不能在每个按键后跳回 0.00。
    const acknowledged =
      pending && (Object.is(value, pending.value) || (pending.value === null && value === 0));
    if (valueChanged) pendingChange.current = undefined;
    if (reset) {
      pendingChange.current = undefined;
      publish(moneyDraft(formatMoney(value, { thousands: !focusState.current }), allowNegative));
    } else if (
      draftText !== undefined &&
      previous.draftText !== draftText &&
      draftText !== currentDraft.current.text
    ) {
      publish(moneyDraft(draftText, allowNegative));
    } else if (valueChanged && !acknowledged) {
      publish(moneyDraft(formatMoney(value, { thousands: !focusState.current }), allowNegative));
    } else if (previous.allowNegative !== allowNegative) {
      const before = currentDraft.current;
      const state = moneyDraft(before.text, allowNegative);
      publish(state);
      if (state.valid && (!before.valid || state.value !== before.value)) {
        pendingChange.current = { value: state.value };
        callbacks.current.onChange?.(state.value);
      }
    }
  }, [value, draftText, resetKey, allowNegative, publish]);
  return (
    <Input
      ref={inputRef}
      {...rest}
      inputMode="decimal"
      className={['cw-money-input', rest.className].filter(Boolean).join(' ')}
      value={draft.text}
      status={draft.valid ? rest.status : 'error'}
      aria-invalid={draft.valid ? rest['aria-invalid'] : true}
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
        focusState.current = true;
        const state = currentDraft.current;
        if (state.valid)
          publish(moneyDraft(formatMoney(state.value, { thousands: false }), allowNegative));
        onFocus?.(e);
      }}
      onChange={(e) => {
        const state = moneyDraft(e.target.value, allowNegative);
        publish(state);
        if (state.valid) {
          pendingChange.current = { value: state.value };
          onChange?.(state.value);
        }
      }}
      onBlur={(e) => {
        setFocused(false);
        focusState.current = false;
        const before = currentDraft.current;
        const state = moneyDraft(e.target.value, allowNegative);
        publish(state.valid ? moneyDraft(formatMoney(state.value), allowNegative) : state);
        if (state.valid && (!before.valid || state.value !== before.value)) {
          pendingChange.current = { value: state.value };
          onChange?.(state.value);
        }
        onBlur?.(e);
      }}
    />
  );
});
